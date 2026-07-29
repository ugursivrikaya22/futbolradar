/**
 * ÜST HABER BANDI — TEK MERKEZ.
 *
 * Sitenin en üstündeki akan şerit buradan beslenir. Bandın ne göstereceğine
 * dair her karar (hangi kaynak, hangi sıra, hangi rozet, ne kadar öğe) tek
 * bir yerde verilir; sunum katmanı (scripts/lib/layout.mjs) yalnızca burada
 * üretilen listeyi çizer ve hiçbir içerik kararı vermez.
 *
 * ── KAYNAKLAR ───────────────────────────────────────────────────────────────
 * Bant altı doğrulanmış kaynaktan beslenir ve elle güncelleme gerektirmez:
 *
 *   canlı      Oynanan maçın anlık skoru (data/matches.json + fikstür takvimi)
 *   bugün      Bugünün başlayacak karşılaşmaları, saatiyle
 *   sonuç      Biten maçların skoru
 *   açıklama   Maç sonu teknik direktör / futbolcu sözleri (data/statements.json)
 *   transfer   Onaylı transfer hareketleri (data/transfers.json)
 *   gündem     Doğrulanmış editoryal haberler (data/news.json)
 *
 * Yeni bir kaynak eklemek = SOURCES dizisine tek bir giriş eklemek. Sıra,
 * kota ve tekilleştirme kendiliğinden uygulanır.
 *
 * ── SONRADAN API ────────────────────────────────────────────────────────────
 * Her kaynak `load(context)` sözleşmesine uyan saf bir fonksiyondur ve
 * `context.now` dışında hiçbir şey varsaymaz. Bir sağlayıcıya bağlanmak,
 * ilgili kaynağın `load` gövdesini değiştirmekten ibarettir; kota, rozet,
 * tekilleştirme ve sunum katmanına dokunulmaz. `composeTickerFeed`
 * çağıranın verdiği kaynak listesini de kabul eder, böylece API kaynağı
 * dosya kaynağının yanına ya da yerine takılabilir.
 *
 * ── UYDURMA YOK ─────────────────────────────────────────────────────────────
 * Hiçbir başlık üretilmez; her öğe bir veri dosyasındaki doğrulanmış kaydın
 * birebir karşılığıdır. Doğrulanmış hiçbir kayıt yoksa bant sahte içerikle
 * doldurulmaz: `awaiting` işaretiyle döner ve şerit açıkça "veri bekleniyor"
 * yazar.
 *
 * ── TAZELİK BİR İDDİADIR ────────────────────────────────────────────────────
 * Rozet ölçülen duruma göre yazılır:
 *   • banttaki bir maç canlıysa                    -> "Canlı"
 *   • en taze öğe FRESH_WINDOW_HOURS içindeyse     -> "Son Dakika"
 *   • değilse                                      -> "Gündem"
 *   • hiç doğrulanmış öğe yoksa                    -> "Veri Bekleniyor"
 */

const fs = require("node:fs");
const path = require("node:path");

const {
  publishableTransfers,
  logExcludedTransfers,
  logDuplicateTransfers,
  involvesSuperLigTeam
} = require("./transferService.js");
const { publishableStatements, logExcludedStatements } = require("./matchStatementService.js");
const { isDisplayableMatch } = require("./matchEligibility.js");
const { clubPopularity } = require("./matchPriorityService.js");

/** "Son Dakika" rozetinin geçerli sayıldığı pencere. */
const FRESH_WINDOW_HOURS = 36;

/** Banda alınabilecek en eski maç/haber içeriği. Bundan eskisi hiç girmez. */
const MAX_AGE_HOURS = 24 * 7;

/**
 * Transferler daha uzun ömürlü. Bir maç sonucu bir hafta sonra haber
 * değerini yitirir; transfer dönemi boyunca "X kulübe katıldı" bilgisi
 * geçerliliğini korur. Yedi günlük pencere doğrulanmış transferlerin banda
 * hiç girememesine yol açıyordu.
 *
 * Bu, tazelik iddiasını gevşetmiyor: rozet hâlâ banttaki EN TAZE öğeye göre
 * veriliyor, eski bir transfer tek başına "Son Dakika" üretemez.
 */
const TRANSFER_MAX_AGE_HOURS = 24 * 21;

/** Bant en fazla bu kadar öğe taşır; şerit kalabalıklaşmamalı. */
const MAX_ITEMS = 10;

/** Bandın hiçbir doğrulanmış öğe bulamadığında yazdığı cümle. */
const AWAITING_NOTE = "Doğrulanmış maç, skor ve açıklama akışı bekleniyor. Kaynak doğrulandığı anda bant kendiliğinden güncellenir.";

const root = () => process.cwd();

function readDataFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root(), "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function hoursSince(value, now) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return Infinity;
  return (now.getTime() - time) / 3600000;
}

/** Bandın günü Türkiye saatiyle başlar; sunucunun saat dilimi belirleyici değil. */
function istanbulDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
}

const LIVE_STATUSES = ["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET", "P", "BT"];
const FINISHED_STATUSES = ["FINISHED", "FT", "AET", "PEN"];
const SCHEDULED_STATUSES = ["SCHEDULED", "TIMED", "NS", "PST"];

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) &&
    score.home !== null && score.home !== undefined &&
    score.away !== null && score.away !== undefined;
}

function normalizeName(value) {
  return String(value || "")
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Maç havuzu: elle doğrulanmış kayıtlar + sağlayıcıdan senkronlanan fikstür
 * takvimi. İki dosya aynı karşılaşmayı taşıyabilir; kimlik ev/deplasman +
 * tarih üzerinden kurulur ve doğrulanmış kayıt kazanır.
 *
 * Dosyalar her çağrıda taze okunur (require önbelleği değil): bant beş
 * dakikalık CI döngüsünde yeniden üretiliyor ve senkron adımı dosyaları aynı
 * koşu içinde değiştirebiliyor.
 */
function matchPool() {
  const curated = asArray(readDataFile("matches.json", []), "matches");
  const calendar = asArray(readDataFile("fixture-calendar.json", { matches: [] }), "matches");
  const pool = new Map();

  const identity = (match) => [
    normalizeName(match.homeTeam),
    normalizeName(match.awayTeam),
    String(match.kickoff || "").slice(0, 10)
  ].join("|");

  for (const match of curated) {
    if (!match || !match.homeTeam || !match.awayTeam) continue;
    pool.set(identity(match), match);
  }

  for (const match of calendar) {
    if (!match || !match.homeTeam || !match.awayTeam) continue;
    const key = identity(match);
    if (!pool.has(key)) pool.set(key, match);
  }

  return [...pool.values()];
}

/** Maç kaydının zaman damgası: ne zaman doğrulandığı, yoksa başlama saati. */
function matchStamp(match) {
  return match.lastVerifiedAt || match.fetchedAt || match.kickoff;
}

function scoreText(match) {
  return `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`;
}

/**
 * Biten maçın bağlantısı: raporu üretilmişse rapora, üretilmemişse canlı
 * skor sayfasına. Var olmayan bir rapor adresine bağlanmaz.
 */
function resultHref(match) {
  const reportPath = path.join(root(), "mac-raporu", `${match.id}.html`);
  try {
    if (match.id && fs.existsSync(reportPath)) {
      return `mac-raporu/${match.id}.html`;
    }
  } catch {
    /* Dosya sistemi okunamazsa canlı skor sayfası her zaman geçerli. */
  }
  return `canli-skor.html#${match.id}`;
}


/**
 * KULÜP AĞIRLIĞI — bant içi sıralama.
 *
 * Bant, her kategoride yalnızca tazeliğe göre diziliyordu: aynı gün gelen iki
 * transferden hangisinin daha çok aranacağı hesaba katılmıyor, Galatasaray
 * hareketi bir alt sıra kulübün hareketinin altında kalabiliyordu.
 *
 * Ağırlık `services/matchPriorityService.js`teki ilgi tablosundan geliyor —
 * ayrı bir liste tutmak, iki tablonun zamanla ayrışması demekti. Öğenin
 * ilgili kulüpleri arasından EN YÜKSEK değer alınır.
 */
function clubWeight(...names) {
  const values = names
    .filter(Boolean)
    .map((name) => clubPopularity(name));
  return values.length ? Math.max(...values) : 0;
}

// ── Kaynaklar ───────────────────────────────────────────────────────────────

/**
 * Oynanmakta olan maçların anlık skoru.
 *
 * `hasScore` kontrolü zaten vardı; kapı (services/matchEligibility.js) burada
 * da uygulanıyor ki bant ile sayfa listeleri AYNI maç kümesini göstersin.
 * İkisi ayrışırsa bantta görünen bir maç sayfada bulunamaz.
 */
function liveItems({ now }) {
  return matchPool()
    .filter((match) => isDisplayableMatch(match, now))
    .filter((match) => LIVE_STATUSES.includes(String(match.status || "").toUpperCase()))
    .filter((match) => hasScore(match))
    .filter((match) => hoursSince(matchStamp(match), now) <= MAX_AGE_HOURS)
    .map((match) => ({
      kind: "live",
      label: "Canlı",
      weight: clubWeight(match.homeTeam, match.awayTeam),
      text: scoreText(match),
      href: `canli-skor.html#${match.id}`,
      at: matchStamp(match)
    }));
}

/**
 * Bugünün henüz başlamamış karşılaşmaları, saatiyle.
 *
 * Bandın en çok sorulan sorusu bu: "bugün ne var?". Sıralama zamanı
 * damgası olarak başlama saati kullanılır — okuyucu için anlamlı olan
 * tazelik ölçüsü maçın ne zaman oynanacağıdır.
 */
function todayItems({ now }) {
  const today = istanbulDay(now);

  return matchPool()
    .filter((match) => isDisplayableMatch(match, now))
    .filter((match) => String(match.kickoff || "").slice(0, 10) === today)
    .filter((match) => {
      const status = String(match.status || "SCHEDULED").toUpperCase();
      return SCHEDULED_STATUSES.includes(status) || !status;
    })
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .map((match) => {
      const time = match.time || String(match.kickoff || "").slice(11, 16);
      return {
        kind: "today",
        label: "Bugün",
        weight: clubWeight(match.homeTeam, match.awayTeam),
        text: `${time ? `${time} ` : ""}${match.homeTeam} - ${match.awayTeam}`,
        href: "bugunun-maclari.html",
        at: match.kickoff
      };
    });
}

/** Biten maçların skoru. */
function resultItems({ now }) {
  return matchPool()
    .filter((match) => isDisplayableMatch(match, now))
    .filter((match) => FINISHED_STATUSES.includes(String(match.status || "").toUpperCase()))
    .filter((match) => hasScore(match))
    .filter((match) => hoursSince(matchStamp(match), now) <= MAX_AGE_HOURS)
    .map((match) => ({
      kind: "result",
      label: "Sonuç",
      weight: clubWeight(match.homeTeam, match.awayTeam),
      text: scoreText(match),
      href: resultHref(match),
      at: matchStamp(match)
    }));
}

/**
 * Maç sonu açıklamaları: teknik direktör ve futbolcu sözleri.
 *
 * Yayın kuralı burada tekrarlanmıyor — services/matchStatementService.js tek
 * yetkili nokta. Söz kısaltılmadan, kaynağına bağlanarak geçer.
 */
function statementItems({ now }) {
  const { statements, excluded } = publishableStatements();
  logExcludedStatements("ticker", excluded);

  return statements
    .filter((statement) => hoursSince(statement.publishedAt, now) <= MAX_AGE_HOURS)
    .map((statement) => ({
      kind: "statement",
      label: statement.role === "player" ? "Futbolcu" : "Maç Sonu",
      weight: clubWeight(statement.team),
      text: `${statement.speaker}: "${statement.quote}"`,
      href: statement.url,
      at: statement.publishedAt
    }));
}

/**
 * Doğrulanmış transferler.
 *
 * Yayın kuralı services/transferService.js'de; iki yerde ayrı yazılsaydı biri
 * gevşediğinde bant ile takım sayfaları farklı şeyler gösterirdi.
 */
function transferItems({ now }) {
  const { transfers, excluded, duplicates } = publishableTransfers();
  logExcludedTransfers("ticker", excluded);
  logDuplicateTransfers("ticker", duplicates);

  return transfers
    // Bant Süper Lig gündemi: en az bir taraf lig kulübü olmalı. Giden
    // transferde karşı taraf yabancı kulüp olabilir, o da lig haberidir.
    .filter((item) => involvesSuperLigTeam(item))
    .filter((item) => hoursSince(item.date, now) <= TRANSFER_MAX_AGE_HOURS)
    .map((item) => ({
      kind: "transfer",
      label: "Transfer",
      weight: clubWeight(item.toTeam, item.fromTeam),
      // Yön açıkça yazılıyor: "kadrosunda" ifadesi gidenler için yanıltıcıydı.
      text: `${item.playerName}, ${item.toTeam} kadrosuna katıldı (${item.type})`,
      href: item.sourceUrl,
      at: item.date
    }));
}

/** Editoryal haberler; yalnızca doğrulanmış ve kaynaklı olanlar. */
function newsItems({ now }) {
  return asArray(readDataFile("news.json", []), "news", "items")
    .filter((item) =>
      item &&
      item.title &&
      String(item.status || "").toLowerCase() === "verified" &&
      item.url)
    .filter((item) => hoursSince(item.publishedAt, now) <= MAX_AGE_HOURS)
    .map((item) => ({
      kind: "news",
      label: item.category || "Gündem",
      weight: clubWeight(item.team),
      text: item.title,
      href: item.url,
      at: item.publishedAt
    }));
}

/**
 * KAYNAK KAYDI.
 *
 * `priority` sırayı, `minSlots` kategorinin garantili yerini, `maxItems`
 * üst sınırını belirler. minSlots toplamı MAX_ITEMS'i aşmamalı — aksi hâlde
 * son kategoriler garantisini alamaz (composeTickerFeed bunu doğrular).
 */
const SOURCES = Object.freeze([
  { id: "live", priority: 0, minSlots: 2, maxItems: 4, load: liveItems },
  { id: "today", priority: 1, minSlots: 2, maxItems: 4, load: todayItems },
  { id: "result", priority: 2, minSlots: 1, maxItems: 3, load: resultItems },
  { id: "statement", priority: 3, minSlots: 1, maxItems: 3, load: statementItems },
  { id: "transfer", priority: 4, minSlots: 1, maxItems: 2, load: transferItems },
  { id: "news", priority: 5, minSlots: 1, maxItems: 2, load: newsItems }
]);

function dedupe(items, seen = new Set()) {
  const unique = [];
  for (const item of items) {
    const key = String(item.text || "").toLocaleLowerCase("tr");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

const byRecency = (left, right) => String(right.at || "").localeCompare(String(left.at || ""));

/**
 * Kategori içi sıralama: önce kulüp ağırlığı, sonra tazelik.
 *
 * Tazelik tek ölçüt olduğunda, aynı gün gelen iki transferden daha az
 * aranan kulübünki öne geçebiliyordu. Ağırlık farkı yoksa tazelik belirler.
 */
const byInterest = (left, right) => {
  const weight = (right.weight || 0) - (left.weight || 0);
  if (weight !== 0) return weight;
  return byRecency(left, right);
};

/**
 * Bandın içeriğini üretir.
 *
 * @param {{now?: Date, sources?: Array}} options
 * @returns {{items: Array, badge: string, fresh: boolean, live: boolean,
 *            awaiting: boolean, note: string|null, newestItemAgeHours: number|null,
 *            sourceReport: Array}}
 */
function composeTickerFeed(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const sources = Array.isArray(options.sources) ? options.sources : SOURCES;
  const context = { now };

  const seen = new Set();
  const loaded = [];

  for (const source of [...sources].sort((left, right) => left.priority - right.priority)) {
    let produced = [];
    try {
      produced = source.load(context) || [];
    } catch (error) {
      // Tek bir kaynağın çökmesi bandın tamamını düşürmemeli; diğer
      // kaynaklar yayımlanır, gerekçe iç günlüğe yazılır.
      console.warn(`[ticker] "${source.id}" kaynağı okunamadı — ${error.message}`);
    }

    const items = dedupe(produced, seen)
      .map((item) => ({ ...item, source: source.id, priority: source.priority }))
      .sort(byInterest)
      .slice(0, source.maxItems);

    loaded.push({ source, items });
  }

  // 1. Kota turu: her dolu kategori garantili yerini alır. Tek bir kategori
  //    (ör. altı maç sonucu) bandı ele geçirip transfer ve açıklamaları
  //    tamamen dışarıda bırakamaz.
  const picked = [];
  for (const { source, items } of loaded) {
    if (picked.length >= MAX_ITEMS) break;
    const take = Math.min(source.minSlots, items.length, MAX_ITEMS - picked.length);
    picked.push(...items.slice(0, take));
  }

  // 2. Doldurma turu: kalan yerler önceliğe, eşitlikte tazeliğe göre dolar.
  const rest = loaded
    .flatMap(({ items }) => items)
    .filter((item) => !picked.includes(item))
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return byInterest(left, right);
    });

  const items = [...picked, ...rest].slice(0, MAX_ITEMS);
  const sourceReport = loaded.map(({ source, items: produced }) => ({
    id: source.id,
    available: produced.length,
    used: items.filter((item) => item.source === source.id).length
  }));

  if (!items.length) {
    return {
      items: [],
      badge: "Veri Bekleniyor",
      fresh: false,
      live: false,
      awaiting: true,
      note: AWAITING_NOTE,
      newestItemAgeHours: null,
      sourceReport
    };
  }

  // TAZELİK YALNIZCA OLMUŞ ŞEYLERDEN HESAPLANIR.
  //
  // "Son Dakika" bir olayın az önce gerçekleştiğini söyler. Bugünün henüz
  // başlamamış maçı ise bir PROGRAM kaydıdır; zaman damgası gelecekte olduğu
  // için ham yaş hesabı onu "eksi saat önce" sayıyor ve bant, hiçbir şey
  // olmamışken bile sürekli "Son Dakika" rozeti taşıyordu. Rozetin sürekli
  // yanması onu bir sinyal olmaktan çıkarır.
  //
  // Bu yüzden rozet yalnızca GEÇMİŞTE gerçekleşmiş öğelere bakar: canlı skor,
  // maç sonucu, açıklama, transfer, haber.
  const happened = items.filter((item) =>
    item.kind !== "today" && hoursSince(item.at, now) >= 0);
  const newestAge = happened.length
    ? Math.min(...happened.map((item) => hoursSince(item.at, now)))
    : Infinity;
  const fresh = newestAge <= FRESH_WINDOW_HOURS;
  const live = items.some((item) => item.kind === "live");

  return {
    items,
    badge: live ? "Canlı" : fresh ? "Son Dakika" : "Gündem",
    fresh,
    live,
    awaiting: false,
    note: null,
    newestItemAgeHours: Number.isFinite(newestAge) ? Math.round(newestAge * 10) / 10 : null,
    sourceReport
  };
}

module.exports = {
  AWAITING_NOTE,
  FRESH_WINDOW_HOURS,
  MAX_AGE_HOURS,
  MAX_ITEMS,
  SOURCES,
  TRANSFER_MAX_AGE_HOURS,
  composeTickerFeed,
  istanbulDay,
  matchPool
};
