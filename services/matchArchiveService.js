/**
 * MAÇ ARŞİVİ — bir kez görülen maç bir daha kaybolmaz.
 *
 * KÖK NEDEN. `scripts/sync-fixture-calendar.mjs` her koşuda
 * `data/fixture-calendar.json` dosyasını BAŞTAN YAZIYOR ve yalnızca kayan bir
 * pencereyi saklıyor: 3 gün geçmiş, 35 gün gelecek. Dosyanın kendi yorumu
 * bunu açıkça söylüyordu — "Yalnızca yakın pencere tutulur… Sınırsız büyüyen
 * bir takvim dosyası hem gereksiz hem de bayatlama riski."
 *
 * Sonuç: dört gün önce oynanmış Trabzonspor - Eintracht Frankfurt maçı
 * yalnızca o dosyada duruyordu ve bir sonraki senkronda SİLİNECEKTİ. Maçın
 * analiz sayfası diskte kalır ama veri kaynağı kaybolduğu için bir daha
 * üretilmez; ana sayfa kartı, Maç Merkezi listesi ve arama dizini sessizce
 * boşalır. Sağlayıcının geçmiş penceresi, sitenin hafızası olamaz.
 *
 * ÇÖZÜM. Sağlayıcı cevapları GERÇEĞİN TAMAMI değil, GÜNCELLEME sayılır.
 * Görülen her maç `data/match-archive/YYYY/MM/YYYY-MM-DD.json` altına yazılır
 * ve oradan bir daha silinmez. Birleştirme yıkıcı değil: daha zengin olan
 * kayıt korunur, boş cevap dolu alanı ezmez.
 *
 * NEDEN JSON, NEDEN VERİTABANI DEĞİL. Depoda çalışan bir veritabanı yok:
 * Supabase katmanı isteğe bağlı ve anahtarsız ortamda kapalı, `package.json`
 * bağımlılıksız, `vercel.json` içinde `installCommand` boş. Arşivin
 * çalışması bir dış servise bağlı olsaydı, o servis yokken site geçmişini
 * yine kaybederdi. Günlük dosyalara bölmek de bilinçli: tek dosya sezon
 * boyunca büyüyüp her derlemede tamamen okunurdu.
 */

const fs = require("node:fs");
const path = require("node:path");

const { dateOnly, todayInIstanbul } = require("./matchCalendar.js");
const {
  MATCH_STATUS,
  isFinishedStatus,
  isInPlayStatus,
  isNotPlayedStatus,
  normalizeMatchStatus
} = require("./matchStatus.js");
const { normalizeText } = require("./matchEvents.js");

const ARCHIVE_DIR = path.join(__dirname, "..", "data", "match-archive");
const INDEX_PATH = path.join(ARCHIVE_DIR, "index.json");

/**
 * MAÇ YAŞAM DÖNGÜSÜ.
 *
 * `ARCHIVED`, `FINISHED`in üstüne binen bir KAYIT durumudur, yeni bir maç
 * durumu değil: maç bitmiştir ve arşive alınmıştır. Ertelenen, iptal edilen
 * ve tatil edilen maçlar da arşivde kalır — gerçek durumlarıyla. Onları
 * "bitti" saymak, oynanmamış bir maçı oynanmış göstermek olurdu.
 */
const LIFECYCLE = Object.freeze({
  SCHEDULED: "scheduled",
  LIVE: "live",
  FINISHED: "finished",
  ARCHIVED: "archived"
});

/** Yaşam döngüsündeki ilerleme sırası. Geriye gidilmez. */
const LIFECYCLE_ORDER = Object.freeze([
  LIFECYCLE.SCHEDULED, LIFECYCLE.LIVE, LIFECYCLE.FINISHED, LIFECYCLE.ARCHIVED
]);

/**
 * Zengin içerik taşıyan diziler. Birleştirmede DAHA UZUN olan kazanır.
 *
 * Sebep: sağlayıcı aynı maçı bazen özet, bazen ayrıntılı gönderiyor. Özet
 * cevabın ayrıntılı kaydı ezmesi, tamamlanmış bir analizi geri almak demek.
 */
const RICH_ARRAYS = Object.freeze([
  "events", "lineups", "substitutions", "statistics", "playerRatings", "momentum"
]);

/** Birleştirmede korunan zengin nesneler. */
const RICH_OBJECTS = Object.freeze(["analysis", "preMatchAnalysis", "postMatchAnalysis", "prediction"]);

function isFilled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isNumber(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== "";
}

/** Skor tam mı? "2-?" diye bir sonuç yoktur. */
function hasCompleteScore(score) {
  return Boolean(score) && isNumber(score.home) && isNumber(score.away);
}

/**
 * MAÇIN ARŞİV KİMLİĞİ.
 *
 * Sağlayıcı fikstür kimliği BİRİNCİL: maç yeniden adlandırılsa, saati
 * değişse bile aynı kalır. Yoksa bileşik anahtar kullanılır —
 * `turnuva:sezon:tarih:ev:deplasman`. Rastgele bir kimlik üretmek, aynı maçı
 * her koşuda "yeni" saydırır ve arşivi kopyalarla doldururdu.
 *
 * Bileşik anahtar TARİHİ TAŞIR. Ertelenen maçın tarihi değiştiğinde yeni bir
 * kayıt açılır; bu bilinçli bir kabul: sağlayıcı kimliği olmayan bir kayıtta
 * "aynı maç mı yoksa yeniden oynanan bir maç mı?" sorusunun dürüst cevabı
 * yok. Sağlayıcı kimliği olan kayıtlarda böyle bir sorun yaşanmaz.
 */
function archiveKey(match) {
  const provider = String(
    (match && (match.providerId || (match.providerIds && (match.providerIds.apiFootball || match.providerIds.thesportsdb)))) || ""
  ).trim();
  if (provider) return `fixture:${provider}`;

  const parts = [
    normalizeText(match && (match.competitionId || match.league)) || "turnuva-yok",
    normalizeText(match && match.season) || "sezon-yok",
    dateOnly(match && (match.kickoff || match.date)) || "tarih-yok",
    normalizeText(match && match.homeTeam),
    normalizeText(match && match.awayTeam)
  ];
  return `composite:${parts.join(":")}`;
}

/** Maçın arşiv dosyası: data/match-archive/YYYY/MM/YYYY-MM-DD.json */
function archiveFileFor(match) {
  const day = dateOnly(match && (match.kickoff || match.date));
  if (!day) return null;
  const [year, month] = day.split("-");
  return path.join(ARCHIVE_DIR, year, month, `${day}.json`);
}

/** Kaydın yaşam döngüsü aşaması. */
function lifecycleOf(match, options = {}) {
  const status = normalizeMatchStatus(match && match.status);

  // Oynanmamış/yarıda kalmış maç bitmiş sayılmaz ama arşivlenir: gerçek
  // durumuyla saklanır.
  if (isNotPlayedStatus(status)) {
    return options.archived ? LIFECYCLE.ARCHIVED : LIFECYCLE.SCHEDULED;
  }
  if (isInPlayStatus(status)) return LIFECYCLE.LIVE;
  if (isFinishedStatus(status)) return options.archived ? LIFECYCLE.ARCHIVED : LIFECYCLE.FINISHED;

  // Etiket okunamıyor ama skor tam ve tarih geçmiş: bitmiş sayılır.
  if (hasCompleteScore(match && match.score)) {
    const day = dateOnly(match && (match.kickoff || match.date));
    if (day && day < todayInIstanbul(options)) {
      return options.archived ? LIFECYCLE.ARCHIVED : LIFECYCLE.FINISHED;
    }
  }
  return LIFECYCLE.SCHEDULED;
}

/** Yaşam döngüsü ileri mi gidiyor? */
function isForwardTransition(from, to) {
  const fromIndex = LIFECYCLE_ORDER.indexOf(from);
  const toIndex = LIFECYCLE_ORDER.indexOf(to);
  if (fromIndex === -1 || toIndex === -1) return true;
  return toIndex >= fromIndex;
}

/**
 * ARŞİV BİRLEŞTİRME — hiçbir zengin veri kaybolmaz.
 *
 * Kural sırası:
 *   1. Zengin diziler: daha uzun olan kazanır. Boş cevap dolu listeyi ezmez.
 *   2. Zengin nesneler: dolu olan kazanır; ikisi de doluysa gelen kazanır
 *      (analiz yeniden üretilebilir ve yeni sürüm daha doğrudur).
 *   3. Skor: tam skor eksik skoru ezemez.
 *   4. Durum: yalnızca ileri gider — AMA oynanmama durumları (ertelendi,
 *      iptal, tatil) her an gelebilir ve her zaman kabul edilir. Bir maç
 *      "bitti" göründükten sonra "ertelendi" bilgisi gelirse, sağlayıcı
 *      düzeltme yapıyordur ve doğrusu odur.
 *   5. Diğer alanlar: gelen değer DOLUYSA kazanır, boşsa mevcut korunur.
 *
 * @returns {{record: object, changed: boolean}}
 */
function mergeMatch(existing, incoming, options = {}) {
  const now = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();

  if (!existing) {
    const record = {
      ...incoming,
      archiveKey: archiveKey(incoming),
      lifecycle: lifecycleOf(incoming, options),
      firstSeenAt: now,
      lastUpdatedAt: now
    };
    return { record, changed: true };
  }

  const merged = { ...existing };
  let changed = false;

  for (const [field, value] of Object.entries(incoming || {})) {
    if (field === "firstSeenAt" || field === "lastUpdatedAt" || field === "archiveKey" || field === "lifecycle") {
      continue;
    }

    if (RICH_ARRAYS.includes(field)) {
      const incomingLength = Array.isArray(value) ? value.length : 0;
      const existingLength = Array.isArray(merged[field]) ? merged[field].length : 0;
      if (incomingLength > existingLength) {
        merged[field] = value;
        changed = true;
      }
      continue;
    }

    if (RICH_OBJECTS.includes(field)) {
      if (isFilled(value)) {
        if (JSON.stringify(merged[field]) !== JSON.stringify(value)) {
          merged[field] = value;
          changed = true;
        }
      }
      continue;
    }

    if (field === "score") {
      if (hasCompleteScore(value)) {
        if (JSON.stringify(merged.score) !== JSON.stringify(value)) {
          merged.score = value;
          changed = true;
        }
      }
      continue;
    }

    if (field === "status") {
      const nextStatus = normalizeMatchStatus(value);
      const currentStatus = normalizeMatchStatus(merged.status);
      const accept = isNotPlayedStatus(nextStatus)
        || isForwardTransition(lifecycleOf(merged, options), lifecycleOf({ ...merged, status: value }, options));
      if (accept && nextStatus !== currentStatus) {
        merged.status = value;
        changed = true;
      }
      continue;
    }

    if (isFilled(value) && JSON.stringify(merged[field]) !== JSON.stringify(value)) {
      merged[field] = value;
      changed = true;
    }
  }

  const lifecycle = lifecycleOf(merged, options);
  if (merged.lifecycle !== lifecycle) {
    merged.lifecycle = lifecycle;
    changed = true;
  }
  merged.archiveKey = merged.archiveKey || archiveKey(merged);
  if (changed) merged.lastUpdatedAt = now;
  merged.firstSeenAt = existing.firstSeenAt || now;

  return { record: merged, changed };
}

/** Tek bir arşiv gün dosyasını okur. */
function readArchiveFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed && parsed.matches) ? parsed.matches : [];
  } catch (error) {
    // Bozuk gün dosyası tüm arşivi düşürmemeli; sebep günlüğe yazılır.
    console.warn(`[futbolradar:archive-unreadable] file=${path.basename(file)} reason="${error.message}"`);
    return [];
  }
}

/** Arşivdeki tüm gün dosyalarının yolları, eskiden yeniye. */
function archiveFiles() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  const files = [];
  for (const year of fs.readdirSync(ARCHIVE_DIR).sort()) {
    const yearDir = path.join(ARCHIVE_DIR, year);
    if (!fs.statSync(yearDir).isDirectory()) continue;
    for (const month of fs.readdirSync(yearDir).sort()) {
      const monthDir = path.join(yearDir, month);
      if (!fs.statSync(monthDir).isDirectory()) continue;
      for (const day of fs.readdirSync(monthDir).sort()) {
        if (day.endsWith(".json")) files.push(path.join(monthDir, day));
      }
    }
  }
  return files;
}

/**
 * Arşivdeki bütün maçlar.
 *
 * @param {{from?: string, to?: string}} [options] "YYYY-MM-DD" aralığı.
 *   Aralık verilmezse tamamı okunur — çağıran taraf ne istediğini bilmeli;
 *   arşiv büyüdükçe tamamını okumak pahalılaşır.
 */
function archivedMatches(options = {}) {
  const out = [];
  for (const file of archiveFiles()) {
    const day = path.basename(file, ".json");
    if (options.from && day < options.from) continue;
    if (options.to && day > options.to) continue;
    out.push(...readArchiveFile(file));
  }
  return out;
}

/** Arşivdeki maçları kimliğe göre haritalar. */
function archiveIndex(options = {}) {
  const map = new Map();
  for (const match of archivedMatches(options)) {
    map.set(match.archiveKey || archiveKey(match), match);
  }
  return map;
}

/**
 * Maç kümesini arşive yazar.
 *
 * @param {object[]} matches
 * @param {{apply?: boolean, now?: Date}} [options]
 * @returns {{created: number, updated: number, unchanged: number, files: string[], entries: object[]}}
 */
function upsertMatches(matches, options = {}) {
  const pool = Array.isArray(matches) ? matches : [];
  const byFile = new Map();
  const summary = { created: 0, updated: 0, unchanged: 0, skipped: [], files: [], entries: [] };

  for (const match of pool) {
    const file = archiveFileFor(match);
    if (!file) {
      // Tarihi okunamayan kayıt arşivlenemez: hangi güne yazılacağı bilinmiyor.
      summary.skipped.push({ id: match && match.id, reason: "tarih okunamadı" });
      console.warn(`[futbolradar:archive-skipped] id=${match && match.id} reason="tarih okunamadı"`);
      continue;
    }
    if (!byFile.has(file)) {
      const existing = new Map();
      for (const row of readArchiveFile(file)) {
        existing.set(row.archiveKey || archiveKey(row), row);
      }
      byFile.set(file, existing);
    }

    const store = byFile.get(file);
    const key = archiveKey(match);
    const previous = store.get(key) || null;
    const { record, changed } = mergeMatch(previous, match, options);

    if (!previous) summary.created += 1;
    else if (changed) summary.updated += 1;
    else summary.unchanged += 1;

    store.set(key, record);
    summary.entries.push(record);
  }

  for (const [file, store] of byFile) {
    const rows = [...store.values()].sort((left, right) =>
      String(left.kickoff || "").localeCompare(String(right.kickoff || "")));
    const day = path.basename(file, ".json");
    const payload = { date: day, count: rows.length, matches: rows };
    const next = `${JSON.stringify(payload, null, 2)}\n`;

    // Yalnızca gerçekten değiştiyse yazılır: her koşuda damga atmak, hiçbir
    // şey değişmediği hâlde diff üretirdi.
    const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (current === next) continue;
    summary.files.push(file);
    if (options.apply) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, next, "utf8");
    }
  }

  return summary;
}

/**
 * ARŞİV DİZİNİ — sayfa ve arama için hafif özet.
 *
 * Tam arşivi tarayıcıya indirmek, sezon ilerledikçe ana sayfayı yavaşlatan
 * bir yükü herkesin üstüne yıkardı. Dizin yalnızca listeleme ve süzme için
 * gereken alanları taşır; ayrıntı maçın kendi sayfasında.
 */
function buildIndex(options = {}) {
  const rows = archivedMatches(options).map((match) => ({
    id: match.id,
    archiveKey: match.archiveKey || archiveKey(match),
    date: dateOnly(match.kickoff || match.date),
    kickoff: match.kickoff || null,
    competition: match.league || null,
    competitionId: match.competitionId || null,
    season: match.season || null,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    status: normalizeMatchStatus(match.status),
    lifecycle: match.lifecycle || lifecycleOf(match, options),
    score: hasCompleteScore(match.score)
      ? { home: match.score.home, away: match.score.away }
      : null,
    page: match.archivePage || null
  }));

  rows.sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  return {
    generatedAt: (options.now instanceof Date ? options.now : new Date()).toISOString(),
    count: rows.length,
    matches: rows
  };
}

function writeIndex(index, options = {}) {
  const next = `${JSON.stringify(index, null, 2)}\n`;
  const current = fs.existsSync(INDEX_PATH) ? fs.readFileSync(INDEX_PATH, "utf8") : "";
  if (current === next) return false;
  if (options.apply) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, next, "utf8");
  }
  return true;
}

function readIndex() {
  if (!fs.existsSync(INDEX_PATH)) return { count: 0, matches: [] };
  try {
    return JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  } catch (error) {
    console.warn(`[futbolradar:archive-index-unreadable] reason="${error.message}"`);
    return { count: 0, matches: [] };
  }
}

module.exports = {
  ARCHIVE_DIR,
  INDEX_PATH,
  LIFECYCLE,
  LIFECYCLE_ORDER,
  MATCH_STATUS,
  RICH_ARRAYS,
  RICH_OBJECTS,
  archiveFileFor,
  archiveFiles,
  archiveIndex,
  archiveKey,
  archivedMatches,
  buildIndex,
  hasCompleteScore,
  isForwardTransition,
  lifecycleOf,
  mergeMatch,
  readArchiveFile,
  readIndex,
  upsertMatches,
  writeIndex
};
