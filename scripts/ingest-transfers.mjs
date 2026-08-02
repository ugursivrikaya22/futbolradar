/**
 * TRANSFER ALIM KOŞUSU — hattın orkestratörü.
 *
 * Modülleri sırayla çağırır ve hiçbir iş MANTIĞI barındırmaz; kararlar
 * services/transfers/* içinde. Buranın işi sırayı kurmak, sonucu yazmak ve
 * NE OLMADIĞINI raporlamaktır.
 *
 * Akış:
 *   kaynak kaydı → getir → ayrıştır → tekilleştir → doğrula →
 *   oluştur/birleştir → yaz (transfers/news/ticker) → sağlık raporu → bildir
 *
 * Kullanım:
 *   node scripts/ingest-transfers.mjs --cadence=fast
 *   node scripts/ingest-transfers.mjs --cadence=broad
 *   node scripts/ingest-transfers.mjs --dry-run            (hiçbir dosya yazılmaz)
 *   node scripts/ingest-transfers.mjs --fixture=path.json  (ağ yerine sabit veri)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { activeSources, dormantSources } = require("../services/transfers/sourceRegistry.js");
const { fetchSource } = require("../services/transfers/fetcher.js");
const { extractCandidates } = require("../services/transfers/parser.js");
const { collapseCandidates, findExisting, transferKey } = require("../services/transfers/deduplicator.js");
const { validateAll } = require("../services/transfers/validator.js");
const { createRecord, mergeRecord } = require("../services/transfers/updater.js");
const publisher = require("../services/transfers/publisher.js");
const { notify } = require("../services/transfers/notifier.js");
const { isMajorClub } = require("../services/transfers/notifier.js");
const { seasonLabel, transferWindow } = require("../services/transfers/normalizer.js");

const TRANSFERS = path.join(root, "data", "transfers.json");
const NEWS = path.join(root, "data", "news.json");
const TICKER = path.join(root, "data", "news-ticker.json");
const HEALTH = path.join(root, "data", "transfer-ingestion-health.json");
const QUARANTINE = path.join(root, "data", "transfer-quarantine.json");

function parseArgs(argv) {
  const args = { cadence: "fast", dryRun: false, fixture: "" };
  for (const raw of argv) {
    if (raw === "--dry-run") args.dryRun = true;
    else if (raw.startsWith("--cadence=")) args.cadence = raw.slice(10);
    else if (raw.startsWith("--fixture=")) args.fixture = raw.slice(10);
  }
  return args;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

/**
 * Tek koşu. Test edilebilir olsun diye dışa açık ve saf parametreli:
 * ağ ve dosya sistemi seçenekten gelir.
 */
export async function runIngestion(options = {}) {
  const cadence = options.cadence || "fast";
  const startedAt = new Date().toISOString();
  const report = {
    cadence,
    startedAt,
    finishedAt: "",
    sourcesChecked: 0,
    sourceFailures: [],
    dormantSources: dormantSources().map((source) => ({
      id: source.id,
      tier: source.tier,
      reason: source.unreachableReason || "taşıyıcı yok (browser)"
    })),
    candidatesFound: 0,
    created: 0,
    updated: 0,
    duplicatesSkipped: 0,
    rejected: [],
    quarantined: [],
    statusChanges: [],
    averageDelaySeconds: null,
    latestOfficial: "",
    failed: false,
    failureReason: ""
  };

  const existingTransfers = options.existingTransfers || readJson(TRANSFERS, []);
  const sources = options.sources || activeSources(cadence);

  // ── 1. Getir ve ayrıştır ───────────────────────────────────────────────
  const candidates = [];

  for (const source of sources) {
    let body = "";

    if (options.fixtures && options.fixtures[source.id] !== undefined) {
      body = options.fixtures[source.id];
      report.sourcesChecked += 1;
    } else {
      const fetched = await fetchSource(source, options);
      report.sourcesChecked += 1;
      if (!fetched.ok) {
        report.sourceFailures.push({ sourceId: source.id, error: fetched.error, status: fetched.status });
        continue;
      }
      body = fetched.body;
    }

    try {
      const { candidates: found } = extractCandidates(source, body);
      candidates.push(...found);
    } catch (error) {
      report.sourceFailures.push({ sourceId: source.id, error: `ayrıştırma hatası: ${error.message}`, status: 0 });
    }
  }

  report.candidatesFound = candidates.length;

  // ── 2. Koşu içi tekilleştirme ──────────────────────────────────────────
  const { candidates: collapsed, merged } = collapseCandidates(
    candidates.map((candidate) => {
      const when = candidate.sourcePublishedAt || startedAt;
      return {
        ...candidate,
        transferWindow: transferWindow(when) || transferWindow(startedAt),
        season: seasonLabel(when) || seasonLabel(startedAt),
        announcedAt: Date.isNaN ? when : when
      };
    })
  );
  report.duplicatesSkipped += merged.length;

  // ── 3. Doğrula ─────────────────────────────────────────────────────────
  const { accepted, quarantined, rejected } = validateAll(
    collapsed.map((candidate) => ({ ...candidate, status: candidate.requestedStatus })),
    { existing: existingTransfers }
  );

  report.rejected = rejected.map((row) => ({
    playerName: row.candidate.playerName || "",
    sourceUrl: row.candidate.sourceUrl || "",
    reasons: row.reasons
  }));
  report.quarantined = quarantined.map((row) => ({
    playerName: row.candidate.playerName || "",
    sourceUrl: row.candidate.sourceUrl || "",
    reasons: row.reasons
  }));

  // ── 4. Oluştur / birleştir ─────────────────────────────────────────────
  const transfers = existingTransfers.slice();
  const articles = [];
  const tickerItems = [];
  const delays = [];

  for (const candidate of accepted) {
    const { match } = findExisting(candidate, transfers);

    if (!match) {
      const { record } = createRecord({ ...candidate, id: transferKey(candidate) });
      const published = publisher.buildTransferRecord(record);
      transfers.unshift(published);
      report.created += 1;
      report.statusChanges.push({
        playerName: record.playerName,
        from: "",
        to: record.transferStatus,
        fromTeam: record.fromTeam,
        toTeam: record.toTeam
      });
      if (Number.isFinite(record.ingestionDelaySeconds)) delays.push(record.ingestionDelaySeconds);

      const major = isMajorClub(record.toTeam) || isMajorClub(record.fromTeam);
      articles.push(publisher.buildArticle(record, { major }));
      tickerItems.push(publisher.buildTickerItem(record, { major }));
      continue;
    }

    const before = match.transferStatus;
    const { record, changed, statusChanged } = mergeRecord(match, candidate);

    if (!changed) {
      report.duplicatesSkipped += 1;
      continue;
    }

    const published = publisher.buildTransferRecord(record);
    const index = transfers.findIndex((row) => row.id === match.id);
    if (index >= 0) transfers[index] = { ...transfers[index], ...published };

    report.updated += 1;
    if (statusChanged) {
      report.statusChanges.push({
        playerName: record.playerName,
        from: before,
        to: record.transferStatus,
        fromTeam: record.fromTeam,
        toTeam: record.toTeam
      });
      const major = isMajorClub(record.toTeam) || isMajorClub(record.fromTeam);
      // AYNI kayıt güncellenir; ikinci makale AÇILMAZ.
      articles.push(publisher.buildArticle(record, { major }));
      tickerItems.push(publisher.buildTickerItem(record, { major }));
    }
  }

  report.averageDelaySeconds = delays.length
    ? Math.round(delays.reduce((sum, value) => sum + value, 0) / delays.length)
    : null;

  const official = transfers.filter((row) => row.transferStatus === "official");
  report.latestOfficial = official.length
    ? `${official[0].playerName} (${official[0].toTeam || official[0].fromTeam})`
    : "";

  report.finishedAt = new Date().toISOString();

  return { report, transfers, articles, tickerItems, quarantined };
}

/** Haber ve bant dosyalarına, VAR OLANI EZMEDEN yazar. */
function applyArticles(articles) {
  if (!articles.length) return 0;
  const news = readJson(NEWS, []);
  let written = 0;

  for (const article of articles) {
    const index = news.findIndex((row) => row && row.id === article.id);
    if (index >= 0) {
      // Aynı transferin ikinci makalesi açılmaz; mevcut kayıt güncellenir.
      news[index] = { ...news[index], ...article };
    } else {
      news.unshift(article);
    }
    written += 1;
  }

  writeJson(NEWS, news);
  return written;
}

function applyTicker(items) {
  if (!items.length) return 0;
  const store = readJson(TICKER, { items: [] });
  store.items = Array.isArray(store.items) ? store.items : [];

  for (const item of items) {
    const index = store.items.findIndex((row) => row && row.id === item.id);
    if (index >= 0) store.items[index] = item;
    else store.items.unshift(item);
  }

  store.updatedAt = new Date().toISOString();
  writeJson(TICKER, store);
  return items.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let outcome;

  try {
    const fixtures = args.fixture ? readJson(path.resolve(args.fixture), {}) : undefined;
    outcome = await runIngestion({ cadence: args.cadence, fixtures });
  } catch (error) {
    const failure = {
      cadence: args.cadence,
      startedAt: new Date().toISOString(),
      failed: true,
      failureReason: String((error && error.stack) || error)
    };
    writeJson(HEALTH, failure);
    const notified = await notify(failure);
    console.error(`[transfer] KOŞU ÇÖKTÜ: ${failure.failureReason}`);
    writeSummary(notified.summary);
    process.exit(1);
    return;
  }

  const { report, transfers, articles, tickerItems, quarantined } = outcome;

  if (!args.dryRun) {
    writeJson(TRANSFERS, transfers);
    applyArticles(articles);
    applyTicker(tickerItems);
    writeJson(QUARANTINE, {
      updatedAt: report.finishedAt,
      items: quarantined.map((row) => ({ ...row.candidate, quarantineReasons: row.reasons }))
    });
    writeJson(HEALTH, report);
  }

  const notified = await notify(report);
  writeSummary(notified.summary);

  console.log(
    `[transfer] ${report.cadence}: ${report.sourcesChecked} kaynak · ` +
    `${report.created} yeni · ${report.updated} güncel · ` +
    `${report.duplicatesSkipped} yinelenen · ${report.rejected.length} red · ` +
    `${report.quarantined.length} karantina`
  );

  for (const failure of report.sourceFailures) {
    console.warn(`[transfer:source-failed] ${failure.sourceId}: ${failure.error}`);
  }
  if (notified.telegram.reason) {
    console.warn(`[transfer:telegram] ${notified.telegram.reason}`);
  }
}

function writeSummary(markdown) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target || !markdown) return;
  try {
    fs.appendFileSync(target, `${markdown}\n`, "utf8");
  } catch {
    /* özet yazılamazsa koşu düşmez */
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
