#!/usr/bin/env node
/**
 * TRABZONSPOR MAÇ SONU KÖŞE YAZISI — ÜRETİM KOŞUSU.
 *
 * Bitiş düdüğü doğrulandıktan sonra maç sonu analizini üretir ve
 * `data/columns.json`a yazar. Sayfalar, ana sayfa vitrini, sitemap, hreflang
 * ve İngilizce sürüm bu depodan `scripts/generate-column-pages.mjs` ile
 * üretiliyor; bu betik onların girdisini hazırlar.
 *
 * Kullanım:
 *   node scripts/generate-trabzonspor-post-match-column.mjs            # kuru koşu
 *   node scripts/generate-trabzonspor-post-match-column.mjs --apply    # yazar
 *   node scripts/generate-trabzonspor-post-match-column.mjs --match=<id>
 *   node scripts/generate-trabzonspor-post-match-column.mjs --window=48
 *
 * ── BİTİŞ DOĞRULANMADAN YAZI YOK ────────────────────────────────────────
 *
 * `selectMatch` yalnızca durumu bitmiş VE skoru iki taraflı sayı olan bir
 * kaydı seçer. Sağlayıcının "FT" işaretleyip skoru boş bıraktığı kayıt
 * bitmiş bir maç değil, yarım bir kayıttır; ondan yazı üretmek okuyucuya
 * doğrulanmamış bir sonuç sunmak olurdu.
 *
 * ── YAYIN İÇİN ELLE ONAY BEKLENMEZ, AMA KAPI KALKMAZ ────────────────────
 *
 * Bu depoda köşe yazısının elle yayına alınması kuraldı
 * (services/columnService.js). Bu betik o kuralın TEK ve DAR istisnası:
 * yalnızca `trabzonspor` kategorisindeki, yalnızca bu betiğin ürettiği
 * (`generated.by` damgası taşıyan) maç sonu analizleri kendiliğinden
 * yayımlanır. Sebep, bu metnin kanaat üretmiyor oluşu: her cümlesi
 * sağlayıcıdan ölçülmüş bir sayıya bağlı ve hiçbir yerde alıntı, iddia ya
 * da tahmin yok.
 *
 * Kapılar yerinde duruyor ve hepsi otomatik denetleniyor:
 *   bitiş doğrulaması → veri kapsamı (olay + istatistik + kadro)
 *   → uzunluk kapısı (1.000–1.500 kelime) → künye alanları
 * Herhangi biri düşerse kayıt `draft` yazılır; taslak hiçbir yüzeyde
 * görünmez ve bir sonraki koşuda veri tamamlandığında yeniden denenir.
 *
 * ── ELLE DÜZENLENMİŞ YAZIYA DOKUNULMAZ ──────────────────────────────────
 *
 * Aynı maç için kayıt zaten varsa ve `generated.by` damgası yoksa (yani bir
 * insan o yazıyı devralmışsa) koşu hiçbir şey yazmaz. Otomatik üretim, elle
 * yapılmış bir düzenlemeyi asla ezmez.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const siteLinks = require("../services/siteLinks.js").defaultSiteLinks();

const { curatedMatches } = require("../services/providers/mockProvider.js");
const { selectMatch, isTrabzonspor, normalize, slugify } = require("../services/trabzonsporMatchColumn.js");
const { buildColumnEntry } = require("../services/trabzonsporColumnBuild.js");
const { buildOpponentFocus } = require("../services/opponentFocus.js");
const { validateColumn } = require("../services/columnService.js");
const { sendTelegramMessage, telegramConfig, escapeMarkdown } = require("../services/telegramNotifier.js");

const COLUMNS_PATH = path.join(root, "data", "columns.json");
const STANDINGS_PATH = path.join(root, "data", "league-standings.json");
const REPORTS_PATH = path.join(root, "data", "post-match-reports.json");
const SLUGS_PATH = path.join(root, "data", "player-url-slugs.json");
const ROUTE_MAP_PATH = path.join(root, "data", "en-route-map.json");
const HISTORY_PATH = path.join(root, "data", "player-match-history.json");
const TRANSFERS_PATH = path.join(root, "data", "transfers.json");
const REMOVED_PATH = path.join(root, "data", "removed-columns.json");

const GENERATOR = "scripts/generate-trabzonspor-post-match-column.mjs";

function parseArgs(argv) {
  const args = { apply: false, match: null, windowHours: 36 };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--match=")) args.match = raw.slice("--match=".length);
    else if (raw.startsWith("--window=")) args.windowHours = Number(raw.slice("--window=".length)) || 36;
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.warn(`[ts-column] ${path.basename(filePath)} okunamadı: ${error.message}`);
    return fallback;
  }
}

function atomicWrite(filePath, contents) {
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, contents, "utf8");
  fs.renameSync(temp, filePath);
}

/** Depoda gerçekten VAR OLAN sayfaya bağlanır; olmayan adrese link verilmez. */
function pageIfExists(relativePath) {
  if (!relativePath || !fs.existsSync(path.join(root, relativePath))) return "";
  // Dosya var; bağlantı 301 zincirinin son (kanonik) adresine verilir.
  return siteLinks.resolveFinalPath(`/${relativePath}`).replace(/^\//, "");
}

/* ------------------------------------------------------------------ *
 * BAĞLAMLAR
 * ------------------------------------------------------------------ */

function standingFor() {
  const store = readJson(STANDINGS_PATH, {});
  const league = store["super-lig"];
  const table = (league && Array.isArray(league.table)) ? league.table : [];
  return table.find((row) => isTrabzonspor(row && (row.team || row.name))) || null;
}

/** Sıradaki maç: havuzdaki en yakın gelecek Trabzonspor karşılaşması. */
function nextMatchFor(pool, afterIso) {
  const after = Date.parse(afterIso);
  const rows = pool
    .filter((match) => isTrabzonspor(match.homeTeam) || isTrabzonspor(match.awayTeam))
    .filter((match) => !/\bu(1[4-9]|2[0-3])\b/.test(normalize(`${match.id} ${match.homeTeam} ${match.awayTeam}`)))
    .filter((match) => {
      const kickoff = Date.parse(match.kickoff || "");
      return Number.isFinite(kickoff) && kickoff > after;
    })
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  const next = rows[0];
  if (!next) return null;
  const isHome = isTrabzonspor(next.homeTeam);
  return {
    opponent: isHome ? next.awayTeam : next.homeTeam,
    isHome,
    date: new Date(next.kickoff),
    competition: next.league || next.competition || ""
  };
}

/** Maç raporu sayfasının adresi — üretilmemişse bağlantı verilmez. */
function reportPathFor(matchId) {
  const store = readJson(REPORTS_PATH, { records: [] });
  const record = (store.records || []).find((row) => row && row.matchId === matchId);
  const candidate = record && (record.seo && record.seo.path
    ? record.seo.path
    : String(record.reportUrl || "").replace(/^\.\//, ""));
  return pageIfExists(candidate) || pageIfExists(`mac-raporu/${matchId}.html`);
}

/**
 * Oyuncu adı → oyuncu sayfası.
 *
 * Eşleşme tam ada VE kısaltılmış sağlayıcı adına ("A. Onana") bakar;
 * eşleşmeyen isim için bağlantı ÜRETİLMEZ, düz metin kalır.
 */
function playerLinks() {
  const store = readJson(SLUGS_PATH, { entries: [] });
  const map = {};
  for (const entry of store.entries || []) {
    const target = pageIfExists(`futbolcu/${entry.slug}.html`);
    if (!target) continue;
    for (const name of [entry.fullName, entry.name]) {
      if (name) map[normalize(name)] = target;
    }
  }
  return map;
}

function englishPlayerLinks() {
  const store = readJson(SLUGS_PATH, { entries: [] });
  const map = {};
  for (const entry of store.entries || []) {
    const target = pageIfExists(`en/player/${entry.slug}.html`);
    if (!target) continue;
    for (const name of [entry.fullName, entry.name]) {
      if (name) map[normalize(name)] = target;
    }
  }
  return map;
}

/** TR adresinin İngilizce karşılığı — haritada yoksa boş döner. */
function englishCounterpart(trPath) {
  const rows = readJson(ROUTE_MAP_PATH, []);
  const list = Array.isArray(rows) ? rows : (rows.routes || []);
  const hit = list.find((row) => row && row.tr === trPath);
  return hit ? pageIfExists(hit.en) : "";
}

/* ------------------------------------------------------------------ *
 * KOŞU
 * ------------------------------------------------------------------ */

const args = parseArgs(process.argv.slice(2));
const pool = curatedMatches();

/**
 * ELLE VERİLEN MAÇ KİMLİĞİ DE AYNI KAPILARDAN GEÇER.
 *
 * İlk sürüm `--match` verildiğinde havuzdan kimliği doğrudan alıyor ve
 * `selectMatch`i atlıyordu — yani Trabzonspor kontrolü, bitiş
 * doğrulaması, skor kontrolü ve pencere kontrolü devre dışı kalıyordu.
 * Elle tetiklenen bir koşu, dökümü tam olan BAŞKA bir takımın maçını
 * seçip Trabzonspor analizi diye yayımlayabilirdi. Kimlik artık yalnızca
 * havuzu daraltıyor; kararı yine `selectMatch` veriyor.
 */
const match = args.match
  ? selectMatch(pool.filter((row) => row && row.id === args.match), { windowHours: args.windowHours })
  : selectMatch(pool, { windowHours: args.windowHours });

if (!match) {
  console.log(
    args.match
      ? `[ts-column] --match=${args.match}: bu kimlik kapılardan geçmedi ` +
        `(Trabzonspor maçı değil, bitişi doğrulanmamış, skoru eksik ya da ${args.windowHours} saatlik pencerenin dışında).`
      : `[ts-column] Son ${args.windowHours} saat içinde bitişi doğrulanmış bir Trabzonspor maçı yok.`
  );
  console.log("[ts-column] Hiçbir şey üretilmedi.");
  // MAKİNE OKUNUR SONUÇ. İş akışı bu satıra bakıyor; günlük metnini
  // ayrıştırmak kırılgandı (bkz. aşağıdaki `sonuc=` satırları).
  console.log("[ts-column] sonuc=yok");
  process.exit(0);
}

console.log(`[ts-column] maç: ${match.id} (${match.homeTeam} ${match.score && match.score.home}-${match.score && match.score.away} ${match.awayTeam}, ${match.status})`);

const trPlayers = playerLinks();
const enPlayers = englishPlayerLinks();

/**
 * Rakip yüzeyleri. Takım adından türetilen adresler DENETLENİR
 * (`pageIfExists`); üretilmemiş bir sayfaya bağlantı vermek okuyucuyu 404'e
 * göndermek olurdu. Teknik direktör sayfası bu depoda yok, o yüzden
 * yazıda da bağlantısı verilmiyor.
 */
const opponentName = isTrabzonspor(match.homeTeam) ? match.awayTeam : match.homeTeam;
const opponentSlug = slugify(opponentName);

const links = {
  opponentTeam: pageIfExists(`${opponentSlug}-maclari.html`),
  opponentStandings: pageIfExists(`${opponentSlug}-puan-durumu.html`),
  opponentTransfers: pageIfExists("super-lig-transferleri-2026-2027.html"),
  transfers: pageIfExists("super-lig-transferleri-2026-2027.html"),
  fixtures: pageIfExists("super-lig-fikstur.html"),
  report: reportPathFor(match.id),
  team: pageIfExists("trabzonspor-maclari.html"),
  standings: pageIfExists("trabzonspor-puan-durumu.html") || pageIfExists("super-lig-puan-durumu.html"),
  news: pageIfExists("haberler.html"),
  players: trPlayers
};

const linksEn = {
  opponentTeam: pageIfExists(`en/team/${opponentSlug}.html`),
  opponentStandings: pageIfExists("en/super-lig-standings.html"),
  opponentTransfers: null,
  transfers: null,
  report: englishCounterpart(links.report),
  team: pageIfExists("en/team/trabzonspor.html"),
  standings: pageIfExists("en/super-lig-standings.html") || pageIfExists("en/standings.html"),
  news: pageIfExists("en/news.html"),
  players: enPlayers
};

/**
 * RAKİP DOSYASI. Transfer verimi, rotasyon ve fikstür yükü ölçümleri
 * `services/opponentFocus.js`ten geliyor; oyuncu–maç zaman serisi
 * `data/player-match-history.json`da birikiyor (bkz.
 * scripts/harvest-player-match-history.mjs).
 */
const opponentFocus = buildOpponentFocus({
  team: opponentName,
  match,
  pool,
  history: readJson(HISTORY_PATH, { rows: [] }),
  transfers: (() => {
    const store = readJson(TRANSFERS_PATH, []);
    return Array.isArray(store) ? store : Object.values(store);
  })(),
  kickoff: match.kickoff
});

if (opponentFocus) {
  console.log(
    `[ts-column] rakip dosyası: ${opponentFocus.team} · ${opponentFocus.signings.length} doğrulanmış transfer · ` +
    `pencere karşılaştırması ${opponentFocus.evidence.windowsAvailable ? "VAR" : `YOK (en uzun seri ${opponentFocus.evidence.bestSeries} maç, gereken ${opponentFocus.evidence.required})`}`
  );
}

const built = buildColumnEntry(match, {
  now: new Date().toISOString(),
  opponentFocus,
  standing: standingFor(),
  nextMatch: nextMatchFor(pool, match.kickoff),
  links,
  linksEn
});

const { entry, assessment, verdict, social, cover } = built;

/**
 * ELLE KALDIRILMIŞ YAZI GERİ GETİRİLMEZ.
 *
 * 20 Eylül'de yayımlanan maç sonu analizi elle silindi; bu liste o kararı
 * zamanlanmış yeniden üretime karşı korur.
 *
 * İki sağlamlaştırma:
 *
 * 1) DOSYA OKUMASI ARTIK ÜRETİCİYİ ÇÖKERTMEZ. Çıplak readFileSync, dosya
 *    silindiğinde ya da bozulduğunda bütün koşuyu 1 ile düşürüyordu —
 *    kaldırma listesi olmayan bir depoda maç sonu zinciri hiç çalışmazdı.
 *    Liste okunamıyorsa boş sayılır ve yayın kararı eskisi gibi verilir.
 *
 * 2) SONUÇ SATIRI. İş akışının yoklama döngüsü `sonuc=` satırını okuyor;
 *    kaldırılmış yazı için hiçbir şey basılmadığından döngü pencere dolana
 *    kadar aynı kararı boşuna tekrar ölçüyordu. `sonuc=kaldirildi` döngüyü
 *    ilk yoklamada durduruyor.
 *
 * Karar hem Türkçe hem İngilizce adresi kapatır: slug ikisinde de aranır.
 */
const removedColumns = (() => {
  const raw = readJson(REMOVED_PATH, []);
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw && raw.slugs) ? raw.slugs : [];
  return new Set(rows.map((row) => normalize(String(row || ""))).filter(Boolean));
})();
if (removedColumns.has(normalize(entry.id)) || removedColumns.has(normalize(entry.en && entry.en.slug))) {
  console.log(`[ts-column] ${entry.id} elle kaldırılmış (data/removed-columns.json) — yeniden yayımlanmayacak.`);
  console.log("[ts-column] sonuc=kaldirildi");
  process.exit(0);
}

console.log(`[ts-column] veri kapsamı: ${verdict.ready ? "tam" : `eksik (${verdict.missing.join(", ")})`}`);
console.log(`[ts-column] uzunluk: ${assessment.words} kelime (TR), ${assessment.wordsEn} kelime (EN)`);
console.log(`[ts-column] durum: ${entry.status}${assessment.reasons.length ? ` — ${assessment.reasons.join("; ")}` : ""}`);

const schema = validateColumn(entry);
if (!schema.valid) {
  console.error(`[ts-column] kayıt şemadan geçmedi: ${schema.errors.join("; ")}`);
  process.exit(1);
}

const store = readJson(COLUMNS_PATH, { columns: [] });
const columns = Array.isArray(store.columns) ? store.columns : [];
const existingIndex = columns.findIndex((row) => row && row.id === entry.id);
const existing = existingIndex >= 0 ? columns[existingIndex] : null;

// ELLE DEVRALINMIŞ YAZI KORUNUR.
if (existing && !(existing.generated && existing.generated.by === GENERATOR)) {
  console.log(
    `[ts-column] ${entry.id} zaten var ve otomatik üretim damgası taşımıyor — ` +
    "elle düzenlenmiş bir yazı olabilir. Hiçbir şey yazılmadı."
  );
  process.exit(0);
}

// YAYIMLANMIŞ YAZI GERİ TASLAĞA ÇEKİLMEZ: sağlayıcı bir bölümü geri
// çekerse yayındaki yazı kaybolmamalı, yerinde kalmalı.
if (existing && existing.status === "published" && entry.status !== "published") {
  console.log(`[ts-column] ${entry.id} yayında ve bu koşunun çıktısı yayın kapısından geçmedi — kayıt korundu.`);
  process.exit(0);
}

// SONUÇ SATIRI: yayımlanabilir mi? İş akışı yoklama döngüsünü buna göre
// kırıyor. "Hiçbir şey üretilmedi" yokluğuna bakmak yanlıştı: taslak da o
// dizeyi basmıyor, yani maç daha bitmeden döngü kırılıp taslak yazılıyordu.
console.log(`[ts-column] sonuc=${entry.status === "published" ? "published" : "draft"}`);

if (!args.apply) {
  console.log("[ts-column] kuru koşu — hiçbir dosya yazılmadı.");
  console.log(`[ts-column] başlık: ${entry.title}`);
  console.log(`[ts-column] adres: kose-yazilari/${entry.slug}.html · en/columns/${entry.en.slug}.html`);
  console.log(`[ts-column] paylaşım metni: ${social.text}`);
  console.log(`[ts-column] paylaşım görseli başlığı: ${social.imageTitle}`);
  process.exit(0);
}

if (existingIndex >= 0) columns[existingIndex] = entry;
else columns.push(entry);

atomicWrite(COLUMNS_PATH, `${JSON.stringify({ ...store, updatedAt: new Date().toISOString(), columns }, null, 2)}\n`);
console.log(`[ts-column] data/columns.json güncellendi (${existingIndex >= 0 ? "güncelleme" : "yeni kayıt"}).`);

// Kapak görseli hem kaynak ağaca hem yayın kopyasına yazılır.
for (const base of [root, path.join(root, "public")]) {
  const target = path.join(base, "assets", "columns", `${entry.slug}.svg`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, cover, "utf8");
}
console.log(`[ts-column] kapak görseli yazıldı: assets/columns/${entry.slug}.svg`);

// Paylaşım metni ÜRETİLİR ve günlüğe basılır; gönderimi yayın adımı yapar.
console.log("[ts-column] ── paylaşım ─────────────────────────────");
console.log(`[ts-column] TR: ${social.text} ${social.url}`);
console.log(`[ts-column] EN: ${social.textEn} ${social.urlEn}`);
console.log(`[ts-column] görsel: ${social.image} (${social.imageTitle})`);

// ── Bildirim: YAN ETKİ. Gönderilemezse yazı yine üretilmiş durumda. ──
const config = telegramConfig();
if (!config.ready) {
  console.warn(`[ts-column] Telegram bildirimi gönderilmedi. Eksik değişken: ${config.missing.join(", ")}.`);
  process.exit(0);
}

const notice = [
  `*${escapeMarkdown(entry.status === "published" ? "Maç sonu analizi yayımlandı" : "Maç sonu analizi taslağı hazır")}*`,
  escapeMarkdown(entry.title),
  escapeMarkdown(social.url),
  escapeMarkdown(social.text)
].join("\n");

const result = await sendTelegramMessage(notice, { dryRun: false });
console.log(result.sent ? "[ts-column] Telegram bildirimi gönderildi." : `[ts-column] Telegram bildirimi gönderilemedi: ${result.reason}`);
process.exit(0);
