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
const { isAnalyzableMatch, isAwardedMatch, isFinishedMatch } = require("../services/matchStatus.js");

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
const pool = curatedMatches();

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
const previousBody = JSON.stringify(previousStore.records);
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
