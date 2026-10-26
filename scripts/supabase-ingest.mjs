#!/usr/bin/env node
/**
 * SUPABASE ALIMI — sağlayıcı/statik veriden Supabase'e.
 *
 * KULLANIM:
 *   node scripts/supabase-ingest.mjs                 # her şeyi al
 *   node scripts/supabase-ingest.mjs --only=teams,players
 *   node scripts/supabase-ingest.mjs --dry-run        # normalize et, YAZMA
 *
 * ---------------------------------------------------------------------
 * NEDEN AYRI BİR SCRIPT, API UÇ NOKTASI DEĞİL
 * ---------------------------------------------------------------------
 * Alım dakikalarca sürebilir (672 oyuncu, 436 rapor) ve Vercel
 * sunucusuz işlevlerinin süre sınırı var. Bu script GitHub Actions'taki
 * zamanlanmış güncelleme akışından çağrılır (`test-scheduled-updates.mjs`
 * ile aynı aile); `/api` altına konmadı çünkü Hobby planının 12 işlev
 * sınırı zaten dolu (aynı gerekçe `homePollRoute.js` başlığında yazılı).
 *
 * ---------------------------------------------------------------------
 * VERİ DOSYALARI SABİT YOLLA OKUNUR
 * ---------------------------------------------------------------------
 * Bu bir Vercel sunucusuz işlevi değil, ama aynı disiplin burada da
 * geçerli: `import()` değişkenle çağrılmıyor, her kaynak dosya adı
 * kodda sabit dize. Sebep farklı ama sonuç aynı — okunabilirlik: hangi
 * varlığın hangi dosyadan geldiği tek bakışta görülsün.
 *
 * ---------------------------------------------------------------------
 * DEPO YOKSA BAŞARISIZ OLUR, SESSİZCE ATLAMAZ
 * ---------------------------------------------------------------------
 * `--dry-run` dışında Supabase yapılandırılmamışsa script `PASS`
 * numarası ÇIKARMADAN çıkış kodu 1 ile durur. "Alım koştu ve hiçbir şey
 * yazmadı" ile "alım hiç koşmadı" dışarıdan aynı görünmemeli.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const client = require("../services/supabase/client.js");
const normalize = require("../services/supabase/normalize.js");
const { TABLES } = require("../services/supabase/schema.js");
const { pollRowsFrom } = require("../services/supabase/pollRows.js");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",")) : null;

function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch (error) {
    return null;
  }
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Bir alım adımını çalıştır, kütüğe yaz, hatayı YUTMADAN geçir.
 *
 * `ingestion_runs` satırı `--dry-run`da da açılır ve `dry-run` notuyla
 * kapanır — operatör kütükte "hiç çalışmadı" ile "kuru çalıştı"yı
 * ayırt edebilsin.
 */
async function runStep(entity, sourceId, fn) {
  const startedAt = new Date().toISOString();
  let runId = null;

  if (!dryRun) {
    const [run] = await client.insert("ingestion_runs", [{
      entity, source_id: sourceId, status: "running", started_at: startedAt,
      rows_read: 0, rows_written: 0, rows_skipped: 0, detail: {}
    }]).then(() => client.select("ingestion_runs", {
      filters: { entity: `eq.${entity}`, started_at: `eq.${startedAt}` },
      order: "id.desc", limit: 1
    }));
    runId = run && run.id;
  }

  const result = { entity, read: 0, written: 0, skipped: 0, error: null };

  try {
    const outcome = await fn();
    result.read = outcome.read || 0;
    result.written = outcome.written || 0;
    result.skipped = outcome.skipped || 0;

    if (runId) {
      await client.request(`ingestion_runs?id=eq.${runId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: result.skipped > 0 && result.written > 0 ? "partial" : "ok",
          finished_at: new Date().toISOString(),
          rows_read: result.read, rows_written: result.written, rows_skipped: result.skipped,
          detail: dryRun ? { dryRun: true } : {}
        })
      });
    }
  } catch (error) {
    result.error = String(error.message || error).slice(0, 500);
    if (runId) {
      await client.request(`ingestion_runs?id=eq.${runId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "failed", finished_at: new Date().toISOString(),
          rows_read: result.read, rows_written: result.written, rows_skipped: result.skipped,
          error: result.error
        })
      });
    }
    // HATA YUTULMAZ: kütüğe yazıldıktan sonra yeniden fırlatılır.
    // Bu adımın başarısız olduğunu yalnızca kütükten öğrenmek, "PASS"
    // yazıp arkada sessizce başarısız olmuş bir alımı üretime çıkarırdı.
    throw Object.assign(error, { ingestResult: result });
  }

  return result;
}

// ── Adımlar ──────────────────────────────────────────────────────────

async function ingestSources() {
  const rows = [
    { id: "internal", name: "FutbolRadar Internal", kind: "internal", trust: "derived", note: "data/*.json üretim kütüğü" },
    { id: "thesportsdb", name: "TheSportsDB", kind: "provider", trust: "provider", base_url: "https://www.thesportsdb.com" },
    { id: "api-football", name: "API-Football", kind: "provider", trust: "provider", base_url: "https://v3.football.api-sports.io" }
  ];
  const written = dryRun ? 0 : (await client.upsert(TABLES.dataSources.name, rows.map(row => ({ base_url: null, note: null, ...row })), TABLES.dataSources.conflict)).written;
  return { read: rows.length, written, skipped: 0 };
}

async function ingestTeams() {
  const raw = readJson("data/teams.json") || [];
  const rows = raw.map((r) => normalize.team(r, "internal")).filter(Boolean);
  const written = dryRun ? 0 : (await client.upsert(TABLES.teams.name, rows, TABLES.teams.conflict)).written;
  return { read: raw.length, written, skipped: raw.length - rows.length };
}

async function ingestPlayers() {
  const raw = readJson("data/players.json") || [];
  const rawPlayers = Array.isArray(raw) ? raw : (raw.players || []);
  const players = rawPlayers.map((r) => normalize.player(r, "internal")).filter(Boolean);
  const written = dryRun ? 0 : (await client.upsert(TABLES.players.name, players, TABLES.players.conflict)).written;

  // İstatistik satırları oyuncudan SONRA yazılır (yabancı anahtar).
  // Sezon kaynak verisinde yok — bu depoda henüz oyuncu kaydında sezon
  // etiketi taşınmıyor; "current" güncel sezon anlamına gelir ve yeni
  // sezon verisi geldiğinde ÜZERİNE YAZAR (uydurma değil, mevcut tek
  // gerçek kaynağın tuttuğu sezonun kaydı).
  const season = "current";
  const statsRows = rawPlayers.map((r) => normalize.playerStats(r, season, "internal")).filter(Boolean);
  const statsWritten = dryRun ? 0 : (await client.upsert(TABLES.playerStats.name, statsRows, TABLES.playerStats.conflict)).written;

  return {
    read: rawPlayers.length,
    written: written + statsWritten,
    skipped: (rawPlayers.length - players.length) + (rawPlayers.length - statsRows.length)
  };
}

async function ingestMatches() {
  const curated = readJson("data/matches.json") || [];
  const reports = (readJson("data/post-match-reports.json") || {}).records || [];
  const calendar = (readJson("data/fixture-calendar.json") || {}).matches || [];

  // İki kaynak aynı maçı taşıyabilir (kısa liste + arşiv raporu);
  // kimlik (id) üzerinden BİRLEŞTİRİLİR, tekrarlanmaz. Rapor kütüğü
  // skor/durum için daha güncel kabul edilir çünkü senkron sıklığı
  // daha yüksek (saatlik).
  const byId = new Map();
  for (const record of curated) {
    const row = normalize.match(record, record.providerIds?.apiFootball ? "api-football" : record.providerIds?.theSportsDb ? "thesportsdb" : "internal");
    if (row) byId.set(row.id, row);
  }
  for (const record of reports) {
    const shaped = {
      id: record.matchId, fixtureId: record.fixtureId, kickoff: record.kickoffUtc || record.kickoff,
      homeTeam: record.homeTeam, awayTeam: record.awayTeam, status: record.status,
      providerStatus: record.providerStatus, competition: record.competition, venue: record.venue,
      score: record.score
    };
    const row = normalize.match(shaped, "api-football");
    if (row) byId.set(row.id, row);
  }

  // The daily calendar is the durable fixture pool, including lower leagues.
  for (const record of calendar) {
    const source = record.providerIds?.apiFootball || String(record.source).includes('api-football') ? 'api-football' : 'thesportsdb';
    const row = normalize.match(record, source);
    if (row) byId.set(row.id, row);
  }
  const unique = new Map();
  for (const row of byId.values()) {
    const key = row.provider_fixture_id ? row.source_id + ':' + row.provider_fixture_id : row.id;
    unique.set(key, row);
  }
  const rows = [...unique.values()];
  // Keep referenced DB/SEO ids stable even when a provider renames a club.
  let inserted = 0, updated = 0;
  if (!dryRun) {
    for (const batch of client.chunk(rows, 100)) {
      const ids = batch.map(row => row.provider_fixture_id).filter(Boolean);
      const existing = ids.length ? await client.select('matches', { columns: 'id,provider_fixture_id,source_id', filters: { provider_fixture_id: 'in.(' + ids.join(',') + ')' }, limit: 1000 }) : [];
      for (const row of batch) {
        const old = existing.find(item => item.source_id === row.source_id && item.provider_fixture_id === row.provider_fixture_id);
        if (old) { row.id = old.id; updated++; } else inserted++;
      }
    }
  }
  const total = curated.length + reports.length + calendar.length;
  const written = dryRun ? 0 : (await client.upsert(TABLES.matches.name, rows, TABLES.matches.conflict)).written;
  log(JSON.stringify({ entity: "fixtures", rowsRead: total, rowsWritten: written, inserted: dryRun ? null : inserted, updated: dryRun ? null : updated, timezone: "Europe/Istanbul" }));
  return { read: total, written, skipped: total - rows.length };
}

/**
 * MAÇ TAHMİNLERİ. Kaynak `data/fixture-predictions.json` — üç kaynaklı
 * zincirin çözdüğü kayıtlar. Toplamı 100 etmeyen ya da tanınmayan kaynak
 * etiketi taşıyan satırlar normalize katmanında elenir; şema da aynı
 * kuralı ayrıca uygular.
 */
async function ingestPredictions() {
  const store = readJson("data/fixture-predictions.json") || {};
  const records = Array.isArray(store.predictions) ? store.predictions : [];
  const rows = records.map((record) => normalize.fixturePrediction(record, "api-football")).filter(Boolean);
  const written = dryRun ? 0 : (await client.upsert(TABLES.fixturePredictions.name, rows, TABLES.fixturePredictions.conflict)).written;
  return { read: records.length, written, skipped: records.length - rows.length };
}

async function ingestTransfers() {
  const raw = readJson("data/transfers.json") || [];
  const list = Array.isArray(raw) ? raw : (raw.transfers || []);
  const rows = list.map((r) => normalize.transfer(r, "internal")).filter(Boolean);
  const written = dryRun ? 0 : (await client.upsert(TABLES.transfers.name, rows, TABLES.transfers.conflict)).written;
  return { read: list.length, written, skipped: list.length - rows.length };
}

async function ingestReports() {
  const store = readJson("data/post-match-reports.json") || {};
  const records = store.records || [];
  const rows = records.map((r) => normalize.analysisReport(r, "api-football")).filter(Boolean);
  const written = dryRun ? 0 : (await client.upsert(TABLES.analysisReports.name, rows, TABLES.analysisReports.conflict)).written;
  return { read: records.length, written, skipped: records.length - rows.length };
}

async function ingestPolls() {
  const raw = readJson("data/home-polls.json") || {};
  const entries = Array.isArray(raw) ? raw : (raw.polls || raw.items || []);
  // İki dilli metin ve optionSource'tan türeyen seçenekler: services/supabase/pollRows.js
  const { polls, options } = pollRowsFrom(raw, { teams: readJson("data/teams.json") || [] });

  if (!dryRun && polls.length) await client.upsert(TABLES.polls.name, polls, TABLES.polls.conflict);
  if (!dryRun && options.length) await client.upsert(TABLES.pollOptions.name, options, TABLES.pollOptions.conflict);

  return { read: entries.length, written: dryRun ? 0 : polls.length + options.length, skipped: entries.length - polls.length };
}

const STEPS = {
  sources: () => runStep("data_sources", "internal", ingestSources),
  teams: () => runStep("teams", "internal", ingestTeams),
  players: () => runStep("players", "internal", ingestPlayers),
  matches: () => runStep("matches", "internal", ingestMatches),
  predictions: () => runStep("fixture_predictions", "api-football", ingestPredictions),
  transfers: () => runStep("transfers", "internal", ingestTransfers),
  reports: () => runStep("analysis_reports", "api-football", ingestReports),
  polls: () => runStep("polls", "internal", ingestPolls)
};

// Sıra ÖNEMLİ: yabancı anahtarlar yüzünden kaynaklar takımlardan,
// takımlar oyunculardan/maçlardan önce yazılmalı.
const ORDER = ["sources", "teams", "players", "matches", "predictions", "transfers", "reports", "polls"];

async function main() {
  if (!dryRun && !client.isConfigured()) {
    log("SUPABASE ALIMI: BAŞARISIZ — depo yapılandırılmamış.");
    log(`  ${client.configurationHint()}`);
    process.exitCode = 1;
    return;
  }

  const steps = ORDER.filter((name) => !only || only.has(name));
  log(`Supabase alımı başlıyor${dryRun ? " (kuru çalıştırma — hiçbir şey yazılmayacak)" : ""}: ${steps.join(", ")}`);

  // KAYNAKLAR DENETİM İZİNDEN ÖNCE TOHUMLANIR — tavuk-yumurta kırılır.
  //
  // `ingestion_runs.source_id`, `data_sources`e yabancı anahtarla bağlı
  // (bir alım çalışmasının HANGİ kaynaktan geldiğini izlemek için).
  // "sources" adımının kendisi ilk adımdır ve o adımın açılış denetim
  // satırı `source_id = 'internal'` yazmaya çalışır — ama `internal`
  // satırı `data_sources`a henüz YAZILMAMIŞTIR, çünkü onu yazacak olan
  // adım daha başlamamıştır. Bu, ilk çalıştırmada HER adımı düşüren bir
  // yabancı anahtar hatasıydı ve yalnızca gerçek bir veritabanına karşı
  // çalıştırılınca ortaya çıktı — normalize testleri satır biçimini
  // doğruluyordu, sıralamayı değil.
  //
  // Çözüm: kaynak satırları denetimsiz, sessizce ve en baştan yazılır.
  // "sources" adımı yine ORDER içinde kalır ve kendi denetim izniyle
  // çalışır — artık idempotent upsert olduğu için tekrar yazmak zararsız.
  if (!dryRun && client.isConfigured() && steps.some((name) => STEPS[name])) {
    try {
      await ingestSources();
    } catch (error) {
      log(`  ön-tohumlama (kaynaklar): HATA — ${String(error.message || error).slice(0, 300)}`);
    }
  }

  const results = [];
  let failed = false;

  for (const name of steps) {
    try {
      const result = await STEPS[name]();
      results.push(result);
      log(`  ${name}: okunan ${result.read}, yazılan ${result.written}, atlanan ${result.skipped}`);
    } catch (error) {
      failed = true;
      const partial = error.ingestResult || { entity: name, read: 0, written: 0, skipped: 0 };
      results.push({ ...partial, error: String(error.message || error) });
      log(`  ${name}: HATA — ${String(error.message || error).slice(0, 300)}`);
      // Bir adımın başarısızlığı diğerlerini durdurmaz: takımlar
      // yazılamadıysa bile transferlerin denenmesi, o gece yalnızca bir
      // varlık sınıfının eksik kalmasına izin verir, hepsinin değil.
    }
  }

  const totalWritten = results.reduce((sum, r) => sum + (r.written || 0), 0);
  const totalRead = results.reduce((sum, r) => sum + (r.read || 0), 0);
  log("");
  log(`Toplam: okunan ${totalRead}, yazılan ${totalWritten}${dryRun ? " (kuru çalıştırma)" : ""}`);
  log(failed ? "SUPABASE ALIMI: KISMEN BAŞARISIZ" : "SUPABASE ALIMI: BAŞARILI");

  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  log(`SUPABASE ALIMI: BEKLENMEYEN HATA — ${String(error.message || error)}`);
  process.exitCode = 1;
});
