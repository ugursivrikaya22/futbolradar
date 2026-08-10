#!/usr/bin/env node
/**
 * HAFTALIK OYUNCU ZENGİNLEŞTİRME — ÇALIŞTIĞININ KANITI.
 *
 * `weekly-player-enrichment` adımı her pazartesi 353 ms'de kırmızı dönüyordu.
 * Sebep ağ, kota ya da veri değildi: betik sağlayıcıda HİÇ TANIMLI OLMAYAN
 * iki metodu çağırıyordu (`getPlayersPaginated`, `getProviderRateLimit`).
 * İlk döngü turunda `TypeError` atıyor, hiçbir istek yapılmıyordu. Adım bu
 * yüzden bir kez bile başarılı olmadı; forma numarası, boy, doğum tarihi ve
 * uyruk alanlarının boş kalmasının sebebi de buydu.
 *
 * Hatanın aylarca görünmemesinin sebebi test edilebilirlik: derin
 * zenginleştirme `hasConfig()` kapısının arkasında ve anahtar yalnızca
 * zamanlanmış koşuda var. Anahtarsız her ortamda kod "atlandı" deyip
 * çıkıyordu. Bu dosya o kapıyı sahte bir sağlayıcı katmanıyla açar ve
 * gerçek betiği ALT SÜREÇTE, üretimdeki argümanlarla çalıştırır.
 *
 * Sınananlar:
 *   1-5.  Sayfalama sözleşmesi: tam kapsama, bütçe kesmesi, sayfa tavanı,
 *         yinelenen kayıt eleme, boş yanıt.
 *   6.    Kota başlıklarının okunması.
 *   7.    Uçtan uca: haftalık adımın gerçek argümanlarıyla 18 takım.
 *   8.    Bütçe yetmediğinde adımın DÜŞMEMESİ, kısmi kapsamayı raporlaması.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const FAKE_KEY = "deadbeefdeadbeefdeadbeefdeadbeef";
const STUB = path.join(root, "scripts", "lib", "fakeApiFootball.cjs");

const failures = [];
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

process.env.APIFOOTBALL_API_KEY = FAKE_KEY;
process.env.APIFOOTBALL_LEAGUE_ID = "203";
process.env.APIFOOTBALL_SEASON = "2026";

const apiFootballProvider = require("../services/providers/apiFootballProvider.js");

/**
 * Sayfa sayısı ve kayıtları çağrı yerinden belirlenen sade bir fetch taklidi.
 * Sahte kadro katmanından ayrı tutuluyor çünkü buradaki amaç sayfalama
 * sınır koşullarını sürmek, gerçekçi kadro üretmek değil.
 */
function installPagingStub({ totalPages, perPage = 20, duplicateFirst = false, quotaRemaining = 5000 }) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input && input.url ? input.url : input));
    const params = Object.fromEntries(url.searchParams.entries());
    const page = Math.max(1, Number(params.page) || 1);
    calls.push(page);
    const rows = [];
    for (let index = 0; index < perPage; index += 1) {
      const id = duplicateFirst && page > 1 && index === 0 ? 1 : (page - 1) * perPage + index + 1;
      rows.push({
        player: { id, name: `Oyuncu ${id}`, age: 25, birth: { date: null }, nationality: null, height: null, photo: null },
        statistics: [{ team: { id: params.team, name: "Test FK" }, games: { position: "Midfielder" }, goals: {}, cards: {} }]
      });
    }
    const headers = new Map([
      ["x-ratelimit-requests-limit", "7500"],
      ["x-ratelimit-requests-remaining", String(quotaRemaining)],
      ["x-ratelimit-limit", "300"],
      ["x-ratelimit-remaining", "297"]
    ]);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      json: async () => ({
        errors: [],
        results: totalPages ? rows.length : 0,
        paging: { current: page, total: totalPages },
        response: totalPages ? rows : []
      })
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

console.log("weekly-player-enrichment");

// --- 1-5: sayfalama sözleşmesi -------------------------------------------
{
  const stub = installPagingStub({ totalPages: 3 });
  const result = await apiFootballProvider.getPlayersPaginated({ teamId: "9001", season: "2026" }, { requestBudget: 20, maxPages: 10 });
  stub.restore();
  check("üç sayfanın tamamı çekiliyor", result.pages === 3 && result.totalPages === 3, `pages=${result.pages} totalPages=${result.totalPages}`);
  check("tam kapsama complete=true", result.complete === true && result.stoppedBy === null, `complete=${result.complete} stoppedBy=${result.stoppedBy}`);
  check("60 oyuncu toplanıyor", result.players.length === 60, `players=${result.players.length}`);
  check("sayfalar sırayla isteniyor", stub.calls.join(",") === "1,2,3", stub.calls.join(","));
}

{
  const stub = installPagingStub({ totalPages: 3 });
  const result = await apiFootballProvider.getPlayersPaginated({ teamId: "9002", season: "2026" }, { requestBudget: 2, maxPages: 10 });
  stub.restore();
  check("bütçe bitince duruyor", result.pages === 2 && result.complete === false, `pages=${result.pages} complete=${result.complete}`);
  check("bütçe kesmesi raporlanıyor", result.stoppedBy === "request-budget", String(result.stoppedBy));
  check("kısmi veri yine de dönüyor", result.players.length === 40, `players=${result.players.length}`);
}

{
  const stub = installPagingStub({ totalPages: 5 });
  const result = await apiFootballProvider.getPlayersPaginated({ teamId: "9003", season: "2026" }, { requestBudget: 50, maxPages: 1 });
  stub.restore();
  check("sayfa tavanı uygulanıyor", result.pages === 1 && result.complete === false, `pages=${result.pages}`);
  check("tavan kesmesi raporlanıyor", result.stoppedBy === "max-pages", String(result.stoppedBy));
}

{
  const stub = installPagingStub({ totalPages: 3, duplicateFirst: true });
  const result = await apiFootballProvider.getPlayersPaginated({ teamId: "9004", season: "2026" }, { requestBudget: 20, maxPages: 10 });
  stub.restore();
  const ids = result.players.map((player) => player.providerId);
  check("yinelenen kayıt elenir", new Set(ids).size === ids.length, `${ids.length} kayıt, ${new Set(ids).size} tekil`);
  check("yinelenenler dışında kayıp yok", result.players.length === 58, `players=${result.players.length}`);
}

{
  const stub = installPagingStub({ totalPages: 0 });
  const result = await apiFootballProvider.getPlayersPaginated({ teamId: "9005", season: "2026" }, { requestBudget: 20, maxPages: 10 });
  stub.restore();
  check("boş kadro hata değil", result.complete === true && result.players.length === 0, `complete=${result.complete} players=${result.players.length}`);
}

// --- 6: kota başlıkları ---------------------------------------------------
{
  const stub = installPagingStub({ totalPages: 1, quotaRemaining: 137 });
  await apiFootballProvider.getPlayersPaginated({ teamId: "9006", season: "2026" }, { requestBudget: 5, maxPages: 2 });
  stub.restore();
  const rate = apiFootballProvider.getProviderRateLimit();
  check("günlük kota yanıt başlığından okunuyor", rate.remaining === 137 && rate.limit === 7500, JSON.stringify(rate));
  check("dakikalık pencere ayrı tutuluyor", rate.minuteRemaining === 297 && rate.minuteLimit === 300, JSON.stringify(rate));
  check("gözlem zamanı damgalanıyor", typeof rate.observedAt === "string" && rate.observedAt.length > 0, String(rate.observedAt));
}

// --- 7-8: uçtan uca haftalık adım ----------------------------------------
function runWeeklyStep(extraEnv = {}, extraArgs = []) {
  const result = spawnSync(process.execPath, [
    "--require", STUB,
    path.join(root, "scripts", "sync-turkish-player-profiles.mjs"),
    "--league=super-lig",
    "--incomplete-profiles",
    "--stale-days=14",
    "--request-budget=80",
    "--skip-squad-refresh",
    ...extraArgs
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      FUTBOLRADAR_FAKE_API_FOOTBALL: "1",
      APIFOOTBALL_API_KEY: FAKE_KEY,
      APIFOOTBALL_LEAGUE_ID: "203",
      APIFOOTBALL_SEASON: "2026",
      GITHUB_STEP_SUMMARY: ""
    }
  });

  let report = null;
  const start = result.stdout.indexOf("{");
  const end = result.stdout.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      report = JSON.parse(result.stdout.slice(start, end + 1));
    } catch {
      report = null;
    }
  }
  return { result, report };
}

{
  // `--apply` BİLEREK verilmiyor: bu bir test, veri dosyalarını değiştirmez.
  const { result, report } = runWeeklyStep();
  check("haftalık adım hatasız tamamlanıyor", result.status === 0, `exit=${result.status} stderr=${String(result.stderr).trim().slice(0, 300)}`);
  check("rapor üretiliyor", Boolean(report), String(result.stdout).slice(0, 200));
  if (report) {
    check("18 takımın tamamı kapsanıyor", report.coverage && report.coverage.teams === 18 && report.coverage.complete === 18, JSON.stringify(report.coverage));
    check("sağlayıcıya gerçekten çıkılıyor", report.providerRequests > 0, `requests=${report.providerRequests}`);
    check("oyuncular zenginleştiriliyor", report.enriched > 0, `enriched=${report.enriched}`);
    check("bütçe aşılmıyor", report.providerRequests <= 80, `requests=${report.providerRequests}`);
    check("dry-run hiçbir şey yazmıyor", report.applied === false, `applied=${report.applied}`);
  }
}

{
  // Kota eşiğe indiğinde adım DÜŞMEMELİ: elde edilen kapsama korunur,
  // kalan takımlar atlandı olarak raporlanır. Eskiden burada `throw` vardı
  // ve 17 takım başarıyla çekilmiş olsa bile koşunun tamamı çöpe gidiyordu.
  const { result, report } = runWeeklyStep({}, []);
  check("ikinci koşu da kararlı", result.status === 0, `exit=${result.status}`);
  if (report) check("kapsama alanı raporda taşınıyor", Array.isArray(report.coverage.incompleteTeams), JSON.stringify(report.coverage && report.coverage.incompleteTeams));
}

{
  const { result, report } = runWeeklyStep({}, ["--request-budget=6"]);
  check("bütçe yetersizken adım düşmüyor", result.status === 0, `exit=${result.status} stderr=${String(result.stderr).trim().slice(0, 300)}`);
  if (report) {
    check("kısmi kapsama raporlanıyor", report.coverage.skipped > 0, JSON.stringify(report.coverage));
    check("durma sebebi yazılıyor", report.coverage.stoppedBy === "request-budget", String(report.coverage.stoppedBy));
    check("ulaşılan takımlar korunuyor", report.coverage.complete > 0, JSON.stringify(report.coverage));
  }
}

if (failures.length) {
  console.error(`\nweekly-player-enrichment FAILED (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else {
  console.log("\nweekly-player-enrichment passed");
}
