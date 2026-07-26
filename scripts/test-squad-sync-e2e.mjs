/**
 * KADRO SENKRONU — UÇTAN UCA TEST
 *
 * "Anahtar eklendiği anda on sekiz takımın kadrosu dolacak" cümlesi, bu depoda
 * gerçek bir anahtar olmadığı için doğrulanamaz bir vaat olarak kalıyordu.
 * Aylardır sessizce no-op eden bir senkronu tam olarak bu tür bir vaat
 * gizlemişti.
 *
 * Bu test o boşluğu kapatır: API-Football protokolünü konuşan yerel bir
 * sunucu kurar, GERÇEK senkron scriptini ayrı bir süreçte, geçici bir çalışma
 * dizininde çalıştırır ve sonucu dosyalardan doğrular.
 *
 * Sunucu bir TEST ÇİFTİDİR, veri kaynağı değil: ürettiği hiçbir kayıt depo
 * içindeki data/ altına yazılmaz, hiçbir sayfaya çıkmaz. Kanıtladığı şey
 * veri değil, kod yolu:
 *
 *   • lig kimliği env'de yokken /leagues üzerinden çözülüyor,
 *   • on sekiz takım çekilip data/teams.json'a birleştiriliyor,
 *   • her takım için kadro çekilip data/super-lig-squads.json'a yazılıyor,
 *   • API anahtarı stdout/stderr'e ve yazılan hiçbir dosyaya sızmıyor,
 *   • yapılandırma eksikken script sıfırdan farklı kodla ve tek tek adlarla
 *     duruyor, hiçbir dosyaya dokunmuyor.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const SYNC_SCRIPT = path.join(repoRoot, "scripts", "sync-super-lig-squads.mjs");
const CANONICAL_SCRIPT = path.join(repoRoot, "scripts", "sync-canonical-players.mjs");
const PREFLIGHT_SCRIPT = path.join(repoRoot, "scripts", "preflight-api-football.mjs");

const SECRET_KEY = "abcdef0123456789abcdef0123456789";
const SUPER_LIG_ID = 203;

const TEAM_NAMES = [
  "Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Başakşehir",
  "Göztepe", "Konyaspor", "Samsunspor", "Rizespor", "Kasımpaşa",
  "Alanyaspor", "Antalyaspor", "Gaziantep FK", "Eyüpspor",
  "Kayserispor", "Kocaelispor", "Gençlerbirliği", "Karagümrük"
];

function teamPayload(index) {
  return {
    team: {
      id: 1000 + index,
      name: TEAM_NAMES[index],
      code: TEAM_NAMES[index].slice(0, 3).toUpperCase(),
      country: "Turkey",
      logo: `https://media.api-sports.io/football/teams/${1000 + index}.png`
    },
    venue: { name: `${TEAM_NAMES[index]} Stadyumu` }
  };
}

/** Gerçekçi bir kadro büyüklüğü: "complete" eşiğini geçecek kadar. */
function squadPayload(teamId, teamName) {
  const players = Array.from({ length: 24 }, (_, slot) => ({
    id: teamId * 100 + slot,
    name: `${teamName} Oyuncu ${slot + 1}`,
    age: 20 + (slot % 14),
    number: slot + 1,
    position: ["Goalkeeper", "Defender", "Midfielder", "Attacker"][slot % 4],
    photo: null
  }));

  return { team: { id: teamId, name: teamName }, players };
}

function startProviderDouble() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.headers["x-apisports-key"] !== SECRET_KEY) {
      send({ errors: ["Error/Missing application key."], response: [] });
      return;
    }

    if (url.pathname === "/status") {
      send({ response: { subscription: { plan: "Pro", active: true }, requests: { current: 12, limit_day: 7500 } } });
      return;
    }

    if (url.pathname === "/leagues") {
      send({
        response: [
          {
            league: { id: 204, name: "1. Lig", type: "League" },
            country: { name: "Turkey" },
            seasons: [{ year: 2026 }]
          },
          {
            league: { id: SUPER_LIG_ID, name: "Süper Lig", type: "League" },
            country: { name: "Turkey" },
            seasons: [{ year: 2026 }]
          }
        ]
      });
      return;
    }

    if (url.pathname === "/teams") {
      // Lig kimliği doğru geçirilmezse boş dönülür: yanlış ligden takım
      // çekmenin sessizce başarılı görünmesi engellenir.
      if (url.searchParams.get("league") !== String(SUPER_LIG_ID)) {
        send({ response: [] });
        return;
      }
      send({ response: TEAM_NAMES.map((_, index) => teamPayload(index)) });
      return;
    }

    if (url.pathname === "/players/squads") {
      const teamId = Number(url.searchParams.get("team"));
      const index = teamId - 1000;
      if (!TEAM_NAMES[index]) {
        send({ response: [] });
        return;
      }
      send({ response: [squadPayload(teamId, TEAM_NAMES[index])] });
      return;
    }

    send({ response: [] });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Geçici çalışma dizini: depo içindeki data/ dosyalarına asla dokunulmaz. */
function makeWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-sync-"));
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  fs.writeFileSync(path.join(dir, "data", "teams.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dir, "data", "super-lig-squads.json"), "[]", "utf8");
  return dir;
}

function runScript(script, cwd, env, args = ["--apply"]) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd, env: { ...process.env, ...env }, timeout: 120000 },
      (error, stdout, stderr) => resolve({ code: error ? (error.code ?? 1) : 0, stdout, stderr })
    );
  });
}

/** Anahtarın hiçbir varyantı ortamdan miras alınmasın. */
const BLANK_CREDENTIALS = {
  APIFOOTBALL_API_KEY: "", API_FOOTBALL_API_KEY: "", APIFOOTBALL_KEY: "",
  API_FOOTBALL_KEY: "", API_SPORTS_API_KEY: "", APISPORTS_API_KEY: "",
  APIFOOTBALL_LEAGUE_ID: "", API_FOOTBALL_LEAGUE_ID: "",
  APIFOOTBALL_LEAGUEID: "", API_SPORTS_LEAGUE_ID: ""
};

function runSync(cwd, env) {
  return runScript(SYNC_SCRIPT, cwd, env);
}

/** Depo içindeki gerçek veri dosyalarının parmak izi; test sonunda karşılaştırılır. */
function repoDataFingerprint() {
  return ["teams.json", "super-lig-squads.json"].map((file) => {
    const full = path.join(repoRoot, "data", file);
    return `${file}:${fs.existsSync(full) ? fs.statSync(full).size : "absent"}`;
  }).join("|");
}

// ---------------------------------------------------------------------------

async function testFullSyncPopulatesAllTeams() {
  const before = repoDataFingerprint();
  const workspace = makeWorkspace();
  const { server, baseUrl } = await startProviderDouble();

  try {
    const result = await runSync(workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      // Lig kimliği BİLEREK verilmiyor: otomatik çözümleme sınanıyor.
      APIFOOTBALL_LEAGUE_ID: "",
      APIFOOTBALL_SEASON: "2026"
    });

    assert.equal(result.code, 0, `senkron başarısız oldu:\n${result.stdout}\n${result.stderr}`);
    assert.ok(
      result.stdout.includes(`Lig kimliği: ${SUPER_LIG_ID} (provider)`),
      `çözülen lig kimliği bildirilmeli, alınan çıktı:\n${result.stdout}`
    );

    const teams = JSON.parse(fs.readFileSync(path.join(workspace, "data", "teams.json"), "utf8"));
    const current = teams.filter((team) => team.isCurrentSuperLigTeam);
    assert.equal(current.length, 18, `on sekiz takım güncel işaretlenmeli, ${current.length} bulundu`);

    const squads = JSON.parse(fs.readFileSync(path.join(workspace, "data", "super-lig-squads.json"), "utf8"));
    assert.equal(squads.length, 18, `on sekiz kadro yazılmalı, ${squads.length} bulundu`);
    for (const snapshot of squads) {
      assert.equal(snapshot.status, "complete", `${snapshot.teamName}: kadro eksik işaretlendi`);
      assert.equal(snapshot.players.length, 24, `${snapshot.teamName}: oyuncu sayısı beklenenden farklı`);
      assert.ok(snapshot.players.every((player) => player.name), `${snapshot.teamName}: isimsiz oyuncu var`);
    }

    // Göztepe, boş rapor sayfası şikâyetinin kaynağıydı; adıyla doğrulanır.
    const goztepe = squads.find((snapshot) => snapshot.teamName === "Göztepe");
    assert.ok(goztepe, "Göztepe kadrosu yazılmalı");
    assert.equal(goztepe.players.length, 24);

    // Önbellek çözülen kimliği taşımalı, anahtarı değil.
    const cache = JSON.parse(fs.readFileSync(path.join(workspace, "data", "api-football-league.json"), "utf8"));
    assert.equal(String(cache.leagueId), String(SUPER_LIG_ID));

    // Anahtar hiçbir çıktıya ve hiçbir yazılan dosyaya girmemeli.
    assert.ok(!result.stdout.includes(SECRET_KEY), "anahtar stdout'a sızmamalı");
    assert.ok(!result.stderr.includes(SECRET_KEY), "anahtar stderr'e sızmamalı");
    for (const file of fs.readdirSync(path.join(workspace, "data"))) {
      const content = fs.readFileSync(path.join(workspace, "data", file), "utf8");
      assert.ok(!content.includes(SECRET_KEY), `anahtar ${file} içine yazılmamalı`);
    }

    assert.equal(repoDataFingerprint(), before, "test, depo içindeki gerçek veri dosyalarına dokunmamalı");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function testMissingKeyBlocksAndWritesNothing() {
  const workspace = makeWorkspace();

  const result = await runSync(workspace, {
    APIFOOTBALL_API_KEY: "",
    API_FOOTBALL_API_KEY: "",
    APIFOOTBALL_KEY: "",
    API_FOOTBALL_KEY: "",
    API_SPORTS_API_KEY: "",
    APISPORTS_API_KEY: "",
    APIFOOTBALL_LEAGUE_ID: ""
  });

  try {
    assert.notEqual(result.code, 0, "yapılandırma eksikken script sıfır dönmemeli");
    assert.ok(result.stdout.includes("APIFOOTBALL_API_KEY"), "eksik değişken adıyla bildirilmeli");
    assert.ok(
      /uydurma kadro üretilmiyor/i.test(result.stdout),
      "sahte veri üretilmediği açıkça yazılmalı"
    );

    const teams = JSON.parse(fs.readFileSync(path.join(workspace, "data", "teams.json"), "utf8"));
    const squads = JSON.parse(fs.readFileSync(path.join(workspace, "data", "super-lig-squads.json"), "utf8"));
    assert.equal(teams.length, 0, "engelli koşuda takım yazılmamalı");
    assert.equal(squads.length, 0, "engelli koşuda kadro yazılmamalı — mock üretilmemeli");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function testWrongLeagueIdDoesNotSilentlyProduceEmptyData() {
  const workspace = makeWorkspace();
  const { server, baseUrl } = await startProviderDouble();

  try {
    const result = await runSync(workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      // Operatör yanlış bir kimlik verirse sunucu boş döner; senkron bunu
      // başarı sayıp mevcut veriyi silmemeli.
      APIFOOTBALL_LEAGUE_ID: "999999"
    });

    const squads = JSON.parse(fs.readFileSync(path.join(workspace, "data", "super-lig-squads.json"), "utf8"));
    const teams = JSON.parse(fs.readFileSync(path.join(workspace, "data", "teams.json"), "utf8"));

    assert.equal(squads.length, 0, "boş fetch sonrası uydurma kadro yazılmamalı");
    assert.equal(teams.length, 0, "boş fetch sonrası boş takım listesi yazılmamalı");

    // Zayıf iddia ("0 takım" yazdıysa yeter) yerine sert iddia: boş çekim
    // BAŞARISIZLIKTIR. previousCount 0 iken sayı korumaları devre dışı
    // kaldığı için bu daha önce sessizce "başarılı senkron" sayılıyordu.
    assert.notEqual(result.code, 0, `boş sonuç başarı sayılmamalı, çıktı:\n${result.stdout}\n${result.stderr}`);
    assert.ok(
      /empty-fetch-result|hiç takım döndürmedi/.test(result.stderr),
      `boş çekim açıkça bildirilmeli, stderr:\n${result.stderr}`
    );
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Kadroların yazılması tek başına yetmez: asıl şikâyet takım rapor
 * sayfalarının ve aramanın boş olmasıydı. Bu test bir sonraki halkayı da
 * kanıtlar — kadro anlık görüntüleri canonical oyuncu verisine geçiyor mu?
 */
async function testSquadsFlowIntoCanonicalPlayerData() {
  const workspace = makeWorkspace();
  fs.writeFileSync(path.join(workspace, "data", "players.json"), "[]", "utf8");
  const { server, baseUrl } = await startProviderDouble();

  try {
    const sync = await runSync(workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      APIFOOTBALL_LEAGUE_ID: "",
      APIFOOTBALL_SEASON: "2026"
    });
    assert.equal(sync.code, 0, `kadro senkronu başarısız:\n${sync.stdout}\n${sync.stderr}`);

    const merge = await runScript(CANONICAL_SCRIPT, workspace, {});
    assert.equal(merge.code, 0, `canonical birleştirme başarısız:\n${merge.stdout}\n${merge.stderr}`);

    const players = JSON.parse(fs.readFileSync(path.join(workspace, "data", "players.json"), "utf8"));
    // 18 takım x 24 oyuncu; guard eşiği (100) rahatça aşılmalı.
    assert.ok(players.length >= 400, `canonical oyuncu verisi dolmalı, ${players.length} kayıt bulundu`);

    const goztepePlayers = players.filter((player) => /Göztepe/.test(player.currentTeam || ""));
    assert.equal(goztepePlayers.length, 24, `Göztepe oyuncuları canonical veriye geçmeli, ${goztepePlayers.length} bulundu`);

    // Her kayıt sağlayıcıdan geldiğini taşımalı; "verified" gibi bir etiket
    // uydurulmamalı.
    for (const player of goztepePlayers) {
      assert.ok(player.name, "isimsiz oyuncu yazılmamalı");
      assert.equal(player.dataStatus, "provider", "sağlayıcı kaydı provider olarak işaretlenmeli");
    }

    assert.ok(!merge.stdout.includes(SECRET_KEY), "anahtar birleştirme çıktısına sızmamalı");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Ön kontrol, teşhis aracının kendisi. Yanlış cevap vermesi, engelin
 * kendisinden daha pahalıya mal olur: daha önce burada olmayan bir alan
 * okunduğu için GEÇERLİ bir anahtar "reddedildi" diye raporlanıyordu.
 */
async function testPreflightProbeReportsValidKeyAsAccepted() {
  const workspace = makeWorkspace();
  const { server, baseUrl } = await startProviderDouble();

  try {
    const result = await runScript(PREFLIGHT_SCRIPT, workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      APIFOOTBALL_LEAGUE_ID: ""
    }, ["--probe"]);

    assert.equal(result.code, 0, `geçerli yapılandırmada ön kontrol geçmeli:\n${result.stdout}`);
    assert.ok(
      /kabul edildi/.test(result.stdout),
      `geçerli anahtar kabul edilmiş olarak raporlanmalı, çıktı:\n${result.stdout}`
    );
    assert.ok(
      !/reddedildi/.test(result.stdout),
      `geçerli anahtar reddedilmiş gösterilmemeli, çıktı:\n${result.stdout}`
    );
    assert.ok(result.stdout.includes(`Lig kimliği: ${SUPER_LIG_ID}`) ||
      result.stdout.includes(`${SUPER_LIG_ID} (provider)`), "çözülen lig kimliği yazılmalı");

    // Maskeleme: tam anahtar hiçbir yerde görünmemeli.
    assert.ok(!result.stdout.includes(SECRET_KEY), "ön kontrol anahtarı yazmamalı");
    assert.ok(!result.stderr.includes(SECRET_KEY), "ön kontrol anahtarı stderr'e yazmamalı");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Anahtarın VAR OLMASI, KULLANILABİLİR olması demek değil. İptal edilmiş bir
 * anahtar kapıyı açsaydı kadro senkronu ilk çağrıda düşer ve aynı doğrusal
 * zincirdeki maç sonucu senkronunu ve site derlemesini de yanında götürürdü.
 * Lig kimliği env'den geldiğinde çözümleme ağa hiç çıkmaz, dolayısıyla
 * --probe tek doğrulama noktasıdır.
 */
async function testRevokedKeyClosesTheGate() {
  const workspace = makeWorkspace();
  const outputFile = path.join(workspace, "gh-output");
  fs.writeFileSync(outputFile, "", "utf8");

  // Her isteği reddeden sağlayıcı: anahtar var ama tanınmıyor.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ errors: ["Error/Missing application key."], response: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await runScript(PREFLIGHT_SCRIPT, workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      // Lig kimliği env'de: çözümleme ağa çıkmaz, yalnızca --probe doğrular.
      APIFOOTBALL_LEAGUE_ID: String(SUPER_LIG_ID),
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: outputFile
    }, ["--resolve", "--probe"]);

    assert.notEqual(result.code, 0, "reddedilen anahtarla ön kontrol geçmemeli");

    const output = fs.readFileSync(outputFile, "utf8");
    assert.ok(/^ready=false$/m.test(output),
      `reddedilen anahtarda kapı kapanmalı, çıktı: ${JSON.stringify(output)}`);
    assert.ok(!/^ready=true$/m.test(output), "reddedilen anahtarda ready=true yazılmamalı");
    assert.ok(!result.stdout.includes(SECRET_KEY), "anahtar yazılmamalı");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Kapı kapandığında kadro senkronu HİÇ çalışmıyor; özet yazıcısı orada
 * olsaydı operatör yalnızca sessizce atlanmış adımlar görürdü. Özeti yazan
 * taraf, gerçekten koşan adım olmalı.
 */
async function testPreflightWritesRunSummaryWhenBlocked() {
  const workspace = makeWorkspace();
  const summaryFile = path.join(workspace, "gh-summary");
  fs.writeFileSync(summaryFile, "", "utf8");

  await runScript(PREFLIGHT_SCRIPT, workspace, {
    ...BLANK_CREDENTIALS,
    GITHUB_ACTIONS: "true",
    GITHUB_STEP_SUMMARY: summaryFile
  }, []);

  try {
    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.ok(summary.trim(), "koşu özeti boş kalmamalı");
    assert.ok(summary.includes("APIFOOTBALL_API_KEY"), "eksik değişken özet içinde adıyla geçmeli");
    assert.ok(/docs\/api-football-setup\.md/.test(summary), "kurulum belgesine yönlendirmeli");
    assert.ok(!summary.includes(SECRET_KEY), "özet anahtar içermemeli");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Kapının AÇIK yolu da sınanmalı. Yalnızca ready=false doğrulansaydı, ön
 * kontrol her koşulda false üretmeye başlasa bile bütün testler geçerdi —
 * kadro senkronu bir daha hiç çalışmaz, hiçbir test bunu fark etmezdi.
 */
async function testGateOpensForHealthyConfig() {
  const workspace = makeWorkspace();
  const outputFile = path.join(workspace, "gh-output");
  const summaryFile = path.join(workspace, "gh-summary");
  fs.writeFileSync(outputFile, "", "utf8");
  fs.writeFileSync(summaryFile, "", "utf8");

  const { server, baseUrl } = await startProviderDouble();

  try {
    const result = await runScript(PREFLIGHT_SCRIPT, workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      APIFOOTBALL_LEAGUE_ID: "",
      GITHUB_ACTIONS: "true",
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile
    }, ["--resolve", "--probe"]);

    assert.equal(result.code, 0, `sağlıklı yapılandırmada ön kontrol geçmeli:\n${result.stdout}`);

    const output = fs.readFileSync(outputFile, "utf8");
    assert.ok(/^ready=true$/m.test(output), `kapı açılmalı, çıktı: ${JSON.stringify(output)}`);
    assert.ok(new RegExp(`^league_id=${SUPER_LIG_ID}$`, "m").test(output),
      `çözülen lig kimliği çıktıya yazılmalı, alınan: ${JSON.stringify(output)}`);

    const summary = fs.readFileSync(summaryFile, "utf8");
    assert.ok(/hazır/i.test(summary), "sağlıklı koşuda özet de yazılmalı");
    assert.ok(!summary.includes(SECRET_KEY), "özet anahtar içermemeli");
    assert.ok(!output.includes(SECRET_KEY), "çıktı anahtar içermemeli");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Yanlış olduğu anlaşılan önbelleğin silinmesi, korumanın kendini
 * onaran parçası. Silinmezse her koşu aynı yanlış kimlikle aynı duvara
 * çarpar ve kadrolar süresiz güncellenmez.
 */
async function testWrongCachedLeagueIsSelfHealed() {
  const workspace = makeWorkspace();
  const cacheFile = path.join(workspace, "data", "api-football-league.json");
  fs.writeFileSync(cacheFile, JSON.stringify({
    leagueId: "204",
    leagueName: "1. Lig",
    country: "Turkey",
    resolvedAt: new Date().toISOString()
  }), "utf8");

  // Önbellekteki kimlikle çağrıldığında yanlış ligin takımlarını döndürür.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/teams") {
      res.end(JSON.stringify({
        response: Array.from({ length: 18 }, (_, index) => ({
          team: { id: 7000 + index, name: `Alt Lig Kulübü ${index + 1}`, country: "Turkey" },
          venue: {}
        }))
      }));
      return;
    }
    res.end(JSON.stringify({ response: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const result = await runSync(workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      APIFOOTBALL_LEAGUE_ID: ""
    });

    assert.notEqual(result.code, 0, "yanlış önbellekle senkron başarılı sayılmamalı");
    assert.ok(
      !fs.existsSync(cacheFile),
      "yanlış olduğu anlaşılan önbellek silinmeli; yoksa her koşu aynı duvara çarpar"
    );
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/** CI kapısının dayandığı çıktı: eksik yapılandırmada ready=false. */
async function testPreflightWritesCiGateOutput() {
  const workspace = makeWorkspace();
  const outputFile = path.join(workspace, "gh-output");
  fs.writeFileSync(outputFile, "", "utf8");

  const result = await runScript(PREFLIGHT_SCRIPT, workspace, {
    ...BLANK_CREDENTIALS,
    GITHUB_ACTIONS: "true",
    GITHUB_OUTPUT: outputFile
  }, []);

  try {
    assert.notEqual(result.code, 0, "eksik yapılandırmada ön kontrol sıfır dönmemeli");

    const output = fs.readFileSync(outputFile, "utf8");
    assert.ok(/^ready=false$/m.test(output), `ready=false yazılmalı, alınan: ${JSON.stringify(output)}`);
    assert.ok(!/^ready=true$/m.test(output), "eksik yapılandırmada ready=true yazılmamalı");

    // Kapı 'true' ile karşılaştırdığı için 'false' ve boş değer aynı yöne
    // düşer: kadro senkronu atlanır. Bu, tasarımın güvenli tarafı.
    assert.ok(
      result.stdout.includes("APIFOOTBALL_API_KEY"),
      "eksik değişken adıyla bildirilmeli"
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * En sinsi arıza: yanlış lig kimliği DOĞRU SAYIDA takım döndürür. Sayı
 * koruması bunu göremez — gerçek Süper Lig kulüpleri "artık ligde değil"
 * diye işaretlenir, başka bir ligin kulüpleri güncel diye eklenir ve hepsi
 * doğrulanmış veri gibi yayımlanır. Kimlik koruması burada devreye girmeli.
 */
async function testWrongLeagueWithRightTeamCountIsRejected() {
  const workspace = makeWorkspace();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.headers["x-apisports-key"] !== SECRET_KEY) {
      send({ errors: ["Error/Missing application key."], response: [] });
      return;
    }

    if (url.pathname === "/teams") {
      // Tam on sekiz takım — ama hiçbiri Süper Lig kulübü değil.
      send({
        response: Array.from({ length: 18 }, (_, index) => ({
          team: { id: 5000 + index, name: `FC Yabancı ${index + 1}`, country: "Turkey" },
          venue: { name: "Stadyum" }
        }))
      });
      return;
    }

    send({ response: [] });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const result = await runSync(workspace, {
      APIFOOTBALL_API_KEY: SECRET_KEY,
      APIFOOTBALL_API_BASE_URL: baseUrl,
      APIFOOTBALL_LEAGUE_ID: "204"
    });

    assert.notEqual(result.code, 0, "yanlış lig kabul edilmemeli");
    assert.ok(
      /league-identity-mismatch/.test(result.stderr) || /Lig kimliği doğrulaması başarısız/.test(result.stderr),
      `kimlik uyuşmazlığı bildirilmeli, stderr:\n${result.stderr}`
    );

    const teams = JSON.parse(fs.readFileSync(path.join(workspace, "data", "teams.json"), "utf8"));
    const squads = JSON.parse(fs.readFileSync(path.join(workspace, "data", "super-lig-squads.json"), "utf8"));
    assert.equal(teams.length, 0, "yanlış ligden takım yazılmamalı");
    assert.equal(squads.length, 0, "yanlış ligden kadro yazılmamalı");
  } finally {
    await closeServer(server);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

const tests = [
  testFullSyncPopulatesAllTeams,
  testWrongLeagueWithRightTeamCountIsRejected,
  testMissingKeyBlocksAndWritesNothing,
  testWrongLeagueIdDoesNotSilentlyProduceEmptyData,
  testSquadsFlowIntoCanonicalPlayerData,
  testPreflightProbeReportsValidKeyAsAccepted,
  testPreflightWritesCiGateOutput,
  testRevokedKeyClosesTheGate,
  testPreflightWritesRunSummaryWhenBlocked,
  testGateOpensForHealthyConfig,
  testWrongCachedLeagueIsSelfHealed
];

for (const test of tests) {
  await test();
}

console.log(`Squad sync e2e tests passed (${tests.length} senaryo: 18 takım + kadro, otomatik lig ` +
  "çözümleme, canonical oyuncu birleştirme, yanlış lig reddi, engelli koşuda sıfır yazım, " +
  "iptal edilmiş anahtarda kapalı kapı, koşu özeti, anahtar sızıntısı yok).");
