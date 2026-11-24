/**
 * Tamamlanmış her maç için analiz kaydını üretir ve
 * `data/post-match-reports.json` dosyasına yazar.
 *
 * Bu script analiz zincirinin TEK üretim noktasıdır. Rapor sayfaları
 * (scripts/generate-post-match-pages.mjs), maç detay sayfası, günlük analiz
 * sayfası ve ana sayfa bu dosyayı okur — hepsi aynı analizi gösterir.
 *
 * MAÇ HAVUZU kürasyonlu kayıtlar ile sağlayıcı takviminin BİRLEŞİMİdir
 * (`curatedMatches`). Eskiden yalnızca `data/matches.json` okunuyordu ve
 * yalnızca sağlayıcı takviminde bulunan bitmiş maçlar — bugün üç Türk
 * takımı maçı — hiç analiz edilmiyordu.
 *
 * "Bir kez üret" parmak iziyle sağlanır: girdisi değişmemiş maçın kaydı
 * aynen korunur, zaman damgası dahil hiçbir alanı değişmez.
 *
 * --apply olmadan hiçbir şey yazılmaz (kuru koşu).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const { syncPostMatchReports, MODEL_VERSION } = require("../services/postMatchReportStore.js");
const { attachAiMatchSummaries } = require("../services/aiMatchSummary.js");
const { isAnalyzableMatch, isAwardedMatch, isFinishedMatch } = require("../services/matchStatus.js");
const { sameClub } = require("../services/superLigTeams.js");

const STORE_PATH = path.join(root, "data", "post-match-reports.json");
const apply = process.argv.includes("--apply");

function readStore() {
  if (!fs.existsSync(STORE_PATH)) {
    return { records: [] };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return parsed && Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch (error) {
    // Bozuk depo koşuyu durdurmaz: kayıtlar zaten maç verisinden yeniden
    // üretilebiliyor. Sebep günlüğe düşer.
    console.warn(`[post-match-reports] depo okunamadı, sıfırdan üretiliyor: ${error.message}`);
    return { records: [] };
  }
}

const previousStore = readStore();
const permanentArchive = (() => {
  const archivePath = path.join(root, "data", "historical-match-archive.json");
  if (!fs.existsSync(archivePath)) return [];
  try {
    const archive = JSON.parse(fs.readFileSync(archivePath, "utf8"));
    return (archive.records || [])
      .filter((record) => record && record.workflowState !== "needs_manual_review" && record.match)
      .map((record) => ({ ...record.match, id: record.match.id || record.canonicalId }));
  } catch (error) {
    console.warn(`[post-match-reports] kalıcı arşiv okunamadı: ${error.message}`);
    return [];
  }
})();

/**
 * AYNI GERÇEK MAÇ MI — arşiv kaydı ile canlı kayıt arasında.
 *
 * `curatedMatches()` kendi içinde bu eşleşmeyi zaten yapıyor (bkz.
 * services/providers/mockProvider.js), ama kalıcı arşivle birleşirken
 * yapmıyordu: bir maç geçmişte sağlayıcı tarafından farklı yazılmış bir
 * takım adıyla ("Gençlerbirliği" / "Gençlerbirliği S.K." gibi) arşivlenmişse
 * havuzda İKİ FARKLI kimlikle beliriyordu. Sonucu görünürdü: rapor sayfası
 * yalnızca güncel kimlik altında üretiliyor, eski kimliğe bağlanan her
 * bağlantı (takım maçları sayfası gibi) kırık kalıyordu.
 *
 * SAAT DE EŞLEŞMELİ, YALNIZCA GÜN DEĞİL. Aynı gün aynı iki kulüp arasında
 * (ör. hazırlık maçlarında A takımı akşam, U21 öğleden önce) birden fazla
 * GERÇEKTEN AYRI karşılaşma olabiliyor — ilk sürüm yalnızca günü
 * karşılaştırıyordu ve "Rennes–Brentford U21 12:00"ı "Rennes–Brentford
 * 18:00" ile aynı maç sanıp yanlışlıkla eledi. Başlama saati de birebir
 * eşleşmezse iki kayıt farklı maç sayılır.
 */
function sameRealMatch(left, right) {
  const leftKickoff = left && (left.kickoff || left.date || left.utcDate);
  const rightKickoff = right && (right.kickoff || right.date || right.utcDate);
  if (!leftKickoff || !rightKickoff || leftKickoff !== rightKickoff) return false;
  const straight = sameClub(left.homeTeam, right.homeTeam) && sameClub(left.awayTeam, right.awayTeam);
  const swapped = sameClub(left.homeTeam, right.awayTeam) && sameClub(left.awayTeam, right.homeTeam);
  return straight || swapped;
}

// Havuz ÖNCE canlı/kürasyonlu veriden kurulur — kimlikleri güncel ve
// tutarlı. Kalıcı arşiv yalnızca havuzda AYNI GERÇEK MAÇIN bulunmadığı
// kayıtları ekler; bir sağlayıcı eski fikstürü güncel pencereden
// kaldırdığında raporun ve kanonik URL'nin kaybolmaması için var, güncel
// kayıtla çakışan bir hayalet kimlik üretmek için değil.
const poolById = new Map(curatedMatches().map((match) => [match.id, match]));
for (const archived of permanentArchive) {
  if (poolById.has(archived.id)) continue;
  const hasLiveEquivalent = [...poolById.values()].some((live) => sameRealMatch(live, archived));
  if (hasLiveEquivalent) continue;
  poolById.set(archived.id, archived);
}
const pool = [...poolById.values()];

// Hükmen sonuçlar analiz edilmez (maç oynanmadı, olay/istatistik yok) ama
// sessizce yok sayılmaz — sayıları günlüğe yazılır.
const awarded = pool.filter((match) => isFinishedMatch(match) && isAwardedMatch(match));

const { records, stats } = syncPostMatchReports({
  matches: pool,
  previous: previousStore.records,
  generatedAt: new Date().toISOString(),
  context: { fixtures: pool }
});

const payload = {
  source: "futbolradar-post-match-reports",
  modelVersion: MODEL_VERSION,
  updatedAt: new Date().toISOString(),
  matchCount: records.length,
  records
};

// Yalnızca kayıtlar gerçekten değiştiyse yaz. `updatedAt` tek başına
// değişmiş bir dosya, içeriği aynı olan gürültülü bir commit demektir.
// Parmak izi burada, AI özeti kayıtlara yazılmadan önce alınır: yeniden
// kullanılan kayıtlar depodaki nesnelerle aynı referanstır.
const previousBody = JSON.stringify(previousStore.records);
let aiStats = { reason: "disabled" };
try {
  const attached = await attachAiMatchSummaries({
    records,
    matches: pool,
    previous: JSON.parse(previousBody),
    generatedAt: new Date().toISOString()
  });
  aiStats = attached.stats;
} catch (error) {
  aiStats = { reason: "error" };
  const message = String((error && error.message) || error || "bilinmeyen hata")
    .replace(/AI_GATEWAY_API_KEY[=:]\s*\S+/gi, "AI_GATEWAY_API_KEY")
    .slice(0, 180);
  console.warn(`[post-match-reports] AI özeti atlandı, şablon rapor duruyor: ${message}`);
}
const nextBody = JSON.stringify(records);
const changed = previousBody !== nextBody;

const withPage = records.filter((record) => record.publishState === "page").length;
const storeOnly = records.length - withPage;

console.log(
  `[post-match-reports] ${stats.total} tamamlanmış maç · ` +
  `${stats.created} yeni, ${stats.regenerated} yenilendi, ${stats.reused} korundu` +
  (stats.failed ? `, ${stats.failed} üretilemedi` : "") +
  ` · ${withPage} rapor sayfası, ${storeOnly} yalnızca depoda`
);

if (aiStats.reason === "disabled") {
  console.log("[post-match-reports] AI özeti kapalı (AI_MATCH_SUMMARY_ENABLED).");
} else if (aiStats.reason === "missing_api_key") {
  console.log("[post-match-reports] AI özeti atlandı: AI_GATEWAY_API_KEY yok.");
} else if (aiStats.reason === "missing_model") {
  console.log("[post-match-reports] AI özeti atlandı: AI_MATCH_SUMMARY_MODEL veya AI_GATEWAY_MODEL yok.");
} else if (aiStats.reason === "error") {
  console.log("[post-match-reports] AI özeti bu koşuda üretilemedi.");
} else {
  console.log(
    `[post-match-reports] AI özeti: ${aiStats.generated || 0} üretildi, ` +
    `${aiStats.reused || 0} korundu, ${aiStats.fallback || 0} şablona düştü, ` +
    `${aiStats.retry || 0} yeniden denenecek, ${aiStats.deferred || 0} sonraki koşuya kaldı`
  );
}

for (const record of records) {
  if (record.publishState === "store-only") {
    console.log(
      `[post-match-reports] sayfa basılmadı (ölçülmüş bölüm yok): ${record.matchId} — ` +
      `eksik: ${record.missingInputs.map((item) => item.label).join(", ") || "-"}`
    );
  }
}

for (const match of awarded) {
  console.log(`[post-match-reports] hükmen sonuç, analiz üretilmedi: ${match.id}`);
}

if (!apply) {
  console.log(`[post-match-reports] kuru koşu — yazım yok${changed ? " (değişiklik var)" : " (değişiklik yok)"}. Yazmak için --apply.`);
  process.exit(0);
}

if (!changed && fs.existsSync(STORE_PATH)) {
  console.log("[post-match-reports] içerik değişmedi, dosya olduğu gibi bırakıldı.");
  process.exit(0);
}

fs.writeFileSync(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const publicPath = path.join(root, "public", "data", "post-match-reports.json");
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.writeFileSync(publicPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`[post-match-reports] yazıldı: data/post-match-reports.json (${records.length} kayıt)`);

// Analiz edilemeyen bitmiş maç kalmadığından emin ol: bu script'in varlık
// sebebi "hiçbir bitmiş maç analizsiz kalmasın".
const analyzable = pool.filter(isAnalyzableMatch);
const covered = new Set(records.map((record) => record.matchId));
const uncovered = analyzable.filter((match) => !covered.has(match.id));

if (uncovered.length) {
  console.error(`[post-match-reports] KAPSANMAYAN maçlar: ${uncovered.map((match) => match.id).join(", ")}`);
  process.exit(1);
}
