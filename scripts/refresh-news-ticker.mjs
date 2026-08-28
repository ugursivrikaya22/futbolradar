/**
 * "GÜNDEM" BANDINI OTOMATİK TAZELER.
 *
 * SORUN. `data/news-ticker.json` elle yazılan tek kaynaktı ve elle yazılan
 * her şey gibi elle de bayatlıyordu. Kimse silmediği için "5 Ağustos'ta
 * oynanacak" duyurusu 12 Ağustos'ta hâlâ bantta duruyordu; iki farklı
 * editör aynı olayı iki farklı cümleyle giriyordu; sıralama giriş sırasına
 * kalıyordu. Bandın kendisi doğruydu, BAKIMI yoktu.
 *
 * BU BETİK BAKIMI ÜSTLENİR. Her koşuda:
 *
 *   1. `data/news.json` içindeki DOĞRULANMIŞ haberlerden bandı besler.
 *      Bir haber kaydı isteğe bağlı bir `ticker` bloğu taşıyorsa (kategori
 *      ve güven seviyesi ile) banda kendiliğinden yansır. Böylece editör
 *      TEK dosya günceller, bant peşinden gelir — ana sayfadaki haber
 *      ızgarası ile bandın çelişmesi de yapısal olarak imkânsızlaşır.
 *   2. Tarihi geçmiş kayıtları DÜŞÜRÜR (`expiresAt`, kategori raf ömrü).
 *   3. Süresi dolmuş "son dakika" işaretini SÖNDÜRÜR — 24 saat sonra, kayıt
 *      `developing: true` demiyorsa. İşaret dosyadan da silinir; yalnızca
 *      ekranda gizlenmesi, dosyanın yalan söylemeye devam etmesi olurdu.
 *   4. Aynı olayın farklı yazımlarını TEKLEŞTİRİR.
 *   5. Editoryal sıraya dizer: son dakika → dört büyükler → Avrupa'daki Türk
 *      kulüpleri → Süper Lig → büyük Avrupa kulüpleri, her kademede tazelik.
 *
 * NE YAPMAZ — ve bu kısım en az yaptıkları kadar önemli:
 *
 *   • İÇERİK UYDURMAZ. Kaynağı, saati ve güven seviyesi olmayan hiçbir şey
 *     üretmez. Bant boşalırsa boş bırakır; bandın "son doğrulanmış içeriği
 *     koru" yedeği (scripts/lib/tickerFeed.mjs) devreye girer ve okuyucu
 *     gerçek ama eski bir başlık görür, sahte bir "son dakika" görmez.
 *   • GEÇERSİZ KAYDI SİLMEZ. Doğrulamadan geçemeyen kayıt raporlanır ve
 *     dosyada bırakılır: silmek editoryal içeriği kimse bakmadan yok eder,
 *     bırakmak ise testte kırmızı yanar ve düzeltilir.
 *
 * Kullanım:
 *   node scripts/refresh-news-ticker.mjs            (kuru koşu, yazmaz)
 *   node scripts/refresh-news-ticker.mjs --apply
 *   node scripts/refresh-news-ticker.mjs --strict   (geçersiz kayıtta 1 döner)
 *
 * `npm run postprocess` içinde çalışır; CI'ın beş dakikalık döngüsü ve
 * günlük işi aynı adımı çağırdığı için bant elle müdahale olmadan tazelenir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readJsonFile } from "./lib/readJsonFile.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  CATEGORIES,
  CONFIDENCE,
  BREAKING_WINDOW_HOURS,
  dedupeByMeaning,
  editorialRank,
  shelfLifeVerdict,
  validateTickerItem
} = require("../services/newsTicker.js");

const TICKER_PATH = path.join(root, "data", "news-ticker.json");
const PUBLIC_TICKER_PATH = path.join(root, "public", "data", "news-ticker.json");
const NEWS_PATH = path.join(root, "data", "news.json");

/**
 * `data/news.json` üzerinden üretilen kayıtların işareti.
 *
 * Bu kayıtlar her koşuda SIFIRDAN yeniden üretilir; dosyadaki eski
 * kopyaları atılır. Gerekçe: haber kaydı düzenlendiğinde ya da silindiğinde
 * bandın peşinden gelmesi gerekir. Elle yazılmış kayıtlara (origin yok)
 * dokunulmaz — onlar bandın kendi gündemi.
 */
const MIRROR_ORIGIN = "news.json";

const apply = process.argv.includes("--apply");

/**
 * Geçersiz kayıt koşuyu DÜŞÜRSÜN mü?
 *
 * Dağıtım hattında hayır. Geçersiz bir kayıt zaten banda giremiyor; onun
 * yüzünden `npm run build` kırmızıya dönerse tek bir editoryal yazım hatası
 * ilgisiz her dağıtımı da bloke eder. Uyarı her hâlükârda basılıyor ve kaydı
 * asıl yakalayan yer test kapısı: scripts/test-news-ticker.mjs dosyadaki her
 * kaydın geçerli olmasını şart koşuyor.
 *
 * `--strict` bu kapıyı elle çalıştıran ya da ayrı bir doğrulama adımı kuran
 * için duruyor.
 */
const strict = process.argv.includes("--strict");
const now = new Date();

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function log(line) {
  console.log(`[ticker-refresh] ${line}`);
}

/**
 * Haber kaydını bant kaydına çevirir.
 *
 * DÖNÜŞÜM SESSİZ TAHMİN YAPMAZ. Kategori ve güven seviyesi haber kaydındaki
 * `ticker` bloğundan gelir; blok yoksa kayıt banda hiç girmez. "Doğrulanmış
 * haber" ile "banda girecek kadar kesin haber" aynı şey değildir: haber
 * ızgarasında bir basın aktarımı özetiyle birlikte durur, bantta ise tek
 * cümleyle ve rozetiyle durur. O rozeti tahmin etmek yerine editörden
 * istiyoruz.
 */
function mirrorFromNews(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (text(entry.status).toLowerCase() !== "verified") return null;

  const hint = entry.ticker;
  if (!hint || typeof hint !== "object") return null;

  const title = text(entry.title);
  const url = text(entry.url);
  const sourceName = text(entry.sourceName);
  const publishedAt = text(entry.publishedAt);
  if (!title || !url || !sourceName || !publishedAt) return null;

  const mirrored = {
    id: `news-${text(entry.id) || title.slice(0, 40)}`,
    origin: MIRROR_ORIGIN,
    category: text(hint.category),
    confidence: text(hint.confidence),
    // Bantta cümle DEĞİL başlık okunur; `ticker.text` verilmişse kısa sürüm
    // tercih edilir, verilmemişse haber başlığı aynen kullanılır.
    text: text(hint.text) || title,
    timestamp: publishedAt,
    source: { name: sourceName, url }
  };

  if (text(hint.team) || text(entry.team)) mirrored.team = text(hint.team) || text(entry.team);
  if (text(hint.competition)) mirrored.competition = text(hint.competition);
  // "official" kategorisi resmî ağız gerektirir ama bant öğesinin source.url
  // alanı her zaman KENDİ haber sayfamıza gider (bkz. üstteki `mirrored`
  // tanımı) — kulübün resmî sayfası bu yüzden asla oradan doğrulanamaz.
  // `ticker.publisher`, editörün "bu haberin birincil kaynağı gerçekten
  // kulübün/UEFA'nın kendi ağzı" dediği durumda ikinci, bağımsız yolu açar
  // (services/newsTicker.js → validateTickerItem zaten publisher'ı da kabul
  // ediyordu, yalnızca haber kaydından buraya taşınmıyordu).
  if (text(hint.publisher)) mirrored.source.publisher = text(hint.publisher);
  if (text(hint.expiresAt)) mirrored.expiresAt = text(hint.expiresAt);
  if (text(entry.updatedAt)) mirrored.updatedAt = text(entry.updatedAt);
  if (hint.breaking === true) mirrored.breaking = true;
  if (hint.developing === true) mirrored.developing = true;
  // Editörün `isFeatured: true` işaretlediği haber banttaki normal 72 saatlik
  // raf ömrünü aşıp 5 güne kadar anasayfada kalabilir (services/newsTicker.js
  // → IMPORTANT_ARTICLE_MAX_AGE_HOURS). Haber sayfasının kendisi bundan
  // bağımsız kalıcıdır; bu yalnızca bant/anasayfa görünürlüğünü uzatır.
  if (entry.isFeatured === true) mirrored.important = true;

  return mirrored;
}

const payload = readJsonFile(TICKER_PATH, { items: [] });
const stored = Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : []);
const comment = Array.isArray(payload) ? "" : text(payload._comment);

const news = readJsonFile(NEWS_PATH, []);
const newsRows = Array.isArray(news) ? news : (Array.isArray(news.items) ? news.items : []);

// 1. Elle yazılmış kayıtlar korunur, aynadan gelenler yeniden üretilir.
const curated = stored.filter((entry) => text(entry && entry.origin) !== MIRROR_ORIGIN);
const mirrored = newsRows.map(mirrorFromNews).filter(Boolean);

log(`${curated.length} küratörlü kayıt, data/news.json'dan ${mirrored.length} yansıtılan kayıt.`);

const merged = [...curated, ...mirrored];

// 2. Doğrulama. Geçersiz kayıt SİLİNMEZ, raporlanır ve dosyada kalır.
const invalid = [];
const valid = [];
for (const entry of merged) {
  const verdict = validateTickerItem(entry);
  if (verdict.valid) valid.push(entry);
  else invalid.push({ entry, errors: verdict.errors });
}

for (const row of invalid) {
  console.warn(`[ticker-refresh] GEÇERSİZ ${text(row.entry && row.entry.id) || "(kimliksiz)"}: ${row.errors.join("; ")}`);
}

// 3. Raf ömrü ve son dakika penceresi.
const surviving = [];
for (const entry of valid) {
  const verdict = shelfLifeVerdict(entry, now);

  if (verdict.drop) {
    log(`düştü  ${entry.id}: ${verdict.drop}`);
    continue;
  }

  const next = { ...entry };

  // Son dakika işareti kendiliğinden sönümlenir ve DOSYADAN da silinir.
  if (next.breaking === true && verdict.breaking === false) {
    delete next.breaking;
    delete next.developing;
    log(`rütbe indi ${entry.id}: ${BREAKING_WINDOW_HOURS} saatlik son dakika penceresi doldu`);
  }

  surviving.push(next);
}

// 4. Sıralama — bant ne görüyorsa dosya da o sırada dursun. Dosyayı açan
//    kişi bandın sırasını okuyabilmeli; JSON'daki sıra ile ekrandaki sıra
//    ayrışırsa dosya yanıltıcı olur.
const ranked = surviving
  .map((entry) => ({
    entry,
    breaking: shelfLifeVerdict(entry, now).breaking,
    rank: editorialRank({ team: entry.team, teams: entry.teams, competition: entry.competition }),
    priority: CATEGORIES[text(entry.category)].priority,
    at: text(entry.timestamp)
  }))
  .sort((left, right) => {
    if (left.breaking !== right.breaking) return left.breaking ? -1 : 1;
    if (left.rank !== right.rank) return left.rank - right.rank;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return right.at.localeCompare(left.at);
  });

// 5. Aynı olayın iki yazımı. Sıralamadan SONRA yapılıyor: tekleştirme
//    "hangisi kalsın" derken güven ve kategoriye bakıyor, o karar da
//    sıralamanın kullandığı ölçütlerle aynı olmalı.
const deduped = dedupeByMeaning(ranked.map((row) => ({
  id: row.entry.id,
  text: row.entry.text,
  confidence: row.entry.confidence,
  priority: row.priority,
  at: row.at
})));

for (const row of deduped.dropped) {
  log(`tekleşti ${row.id}: ${row.errors.join("; ")}`);
}

const keptIds = new Set(deduped.items.map((item) => item.id));
const finalEntries = ranked
  .filter((row) => keptIds.has(row.entry.id))
  .map((row) => row.entry);

// Geçersiz kayıtlar dosyada kalır — sıranın sonunda, düzeltilmeyi bekler.
const nextItems = [...finalEntries, ...invalid.map((row) => row.entry)];

const nextPayload = {
  ...(comment ? { _comment: comment } : {}),
  updatedAt: now.toISOString(),
  items: nextItems
};

const serialized = `${JSON.stringify(nextPayload, null, 2)}\n`;
const current = fs.existsSync(TICKER_PATH) ? fs.readFileSync(TICKER_PATH, "utf8") : "";

// `updatedAt` dışındaki her şey aynıysa dosya yeniden YAZILMAZ. Bu betik
// beş dakikada bir koşuyor; sırf zaman damgası değişti diye yazmak her
// turda bir commit ve gereksiz bir dağıtım üretirdi.
const sameContent = (() => {
  if (!current) return false;
  try {
    const previous = JSON.parse(current);
    return JSON.stringify(previous.items) === JSON.stringify(nextItems);
  } catch {
    return false;
  }
})();

log(
  `sonuç: ${finalEntries.length} yayına hazır kayıt, ` +
  `${valid.length - surviving.length} raf ömrü doldu, ` +
  `${deduped.dropped.length} yinelenen, ${invalid.length} geçersiz.`
);

if (!finalEntries.length) {
  log(
    "UYARI: yayına hazır küratörlü kayıt kalmadı. Bant uydurma içerik ÜRETMEZ; " +
    "son doğrulanmış öğeler data/ticker-state.json üzerinden korunur."
  );
}

for (const row of finalEntries) {
  const badge = CONFIDENCE[text(row.confidence)];
  log(`  ${row.timestamp}  ${badge && badge.badge ? `[${badge.badge}] ` : ""}${row.text}`);
}

if (!apply) {
  log(sameContent ? "kuru koşu: değişiklik yok." : "kuru koşu: yazılmadı (--apply ile uygulayın).");
  process.exit(strict && invalid.length ? 1 : 0);
}

if (!sameContent) {
  fs.writeFileSync(TICKER_PATH, serialized, "utf8");
  log(`yazıldı: ${path.relative(root, TICKER_PATH)}`);
} else {
  log("içerik değişmedi, dosya yeniden yazılmadı.");
}

// AYNA AYRI DEĞERLENDİRİLİR.
//
// Bu betik `npm run postprocess` içinde, yani `sync-public-assets.mjs`ten
// SONRA çalışıyor: ayna bir önceki hâlde kalıyor ve iki kopya her koşuda
// ayrışıyordu. "İçerik değişmedi" kararı yalnızca kök dosyaya bakıyordu,
// dolayısıyla bayat bir aynayı kendi başına düzeltemiyordu da. Ayna artık
// kendi içeriğiyle karşılaştırılır; kök dosya yazılmasa bile hizalanır.
const publicDir = path.dirname(PUBLIC_TICKER_PATH);
if (fs.existsSync(publicDir)) {
  const published = fs.existsSync(TICKER_PATH) ? fs.readFileSync(TICKER_PATH, "utf8") : serialized;
  const mirrored = fs.existsSync(PUBLIC_TICKER_PATH) ? fs.readFileSync(PUBLIC_TICKER_PATH, "utf8") : "";
  if (mirrored !== published) {
    fs.writeFileSync(PUBLIC_TICKER_PATH, published, "utf8");
    log(`ayna hizalandı: ${path.relative(root, PUBLIC_TICKER_PATH)}`);
  }
}

process.exit(strict && invalid.length ? 1 : 0);
