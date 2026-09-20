#!/usr/bin/env node
/**
 * MAÇ TAHMİNİ SENKRONİZASYONU — her yaklaşan fikstür için üç kaynaklı
 * zincir: sağlayıcı tahmini → piyasa oranı → FutbolRadar modeli.
 *
 * NEYİN YERİNE GEÇTİ. Eski `sync-match-predictions.mjs` YALNIZCA Süper
 * Lig'i hedefliyordu ve tek kaynağı vardı: API-Football `/predictions`.
 * Sağlayıcı bir maç için tahmin üretmediğinde (ya da lig hedef listesinde
 * olmadığında) maç detayındaki kutu boş kalıyordu — 661 üretilmiş maç
 * sayfasının 660'ında tahmin yoktu. Bu betik lig ayrımı yapmaz: takvimde
 * yaklaşan HER fikstür için zinciri yürütür.
 *
 * ---------------------------------------------------------------------
 * KOTA: SORMADAN ÖNCE DÜŞÜN
 * ---------------------------------------------------------------------
 *   • `coverage.predictions` false olan lige `/predictions` İSTEĞİ YOK.
 *     Yanıtı baştan bilinen istek, kotadan düşer ve hiçbir şey getirmez.
 *   • `coverage.odds` false olan lige `/odds` isteği yok — aynı gerekçe.
 *   • Aynı tazeleme basamağında (T-72s/T-24s/T-6s/T-90dk) ikinci istek yok.
 *   • Sağlayıcı kimliği çözülememiş fikstüre istek yok: yanlış fikstür
 *     kimliğiyle gelen tahmin, YANLIŞ MAÇIN tahminidir.
 *   • Bütçe `services/requestBudget.js` ile sayılır; canlı skor için
 *     ayrılan pay asla yenmez.
 *
 * FutbolRadar modeli kotadan BAĞIMSIZDIR (yerel doğrulanmış maç geçmişi,
 * lig tablosu, sakat listesi). Bu yüzden anahtar hiç yapılandırılmamış
 * olsa bile bu betik çalışır ve her uygun maça bir tahmin üretir.
 *
 * UYDURMA YOK: sağlayıcı boş dönerse veri uydurulmaz, bir alt kaynağa
 * geçilir. Üç kaynak da yoksa kayıt YAZILMAZ ve sebebi raporlanır.
 * Başlamış maçın maç öncesi tahmini bir daha değişmez (`frozen`).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadProbabilityContext, coverageFor } from "./lib/fixtureProbabilityData.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const probability = require("../services/fixtureProbabilityService.js");
const store = require("../services/fixturePredictionStore.js");
const { createRequestBudget } = require("../services/requestBudget.js");
const { canonicalStatus } = require("../services/matchStatus.js");

const STORE_PATH = path.join(root, "data", "fixture-predictions.json");
const PUBLIC_STORE_PATH = path.join(root, "public", "data", "fixture-predictions.json");
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const PUBLIC_CALENDAR_PATH = path.join(root, "public", "data", "fixture-calendar.json");

/** Kaç gün ilerisi hazırlanır. Tahmin "önceden" hazır olmalı (T-72s). */
const WINDOW_DAYS = 7;
/** Tek koşuda sağlayıcıya sorulabilecek en fazla fikstür. */
const MAX_PROVIDER_TARGETS = 24;
/** Bu kadar günden eski kayıtlar depodan düşer; doğruluk ölçümü arşive bakar. */
const RETENTION_DAYS = 120;

const UPCOMING_STATUSES = new Set(["SCHEDULED", "TIMED", "NS", "NOT_STARTED", "TBD"]);

function parseArgs(argv) {
  const args = { apply: false, all: false, modelOnly: false, windowDays: WINDOW_DAYS, limit: MAX_PROVIDER_TARGETS };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--all") args.all = true;
    else if (raw === "--model-only") args.modelOnly = true;
    else if (raw.startsWith("--window=")) args.windowDays = Number(raw.slice(9)) || WINDOW_DAYS;
    else if (raw.startsWith("--limit=")) args.limit = Number(raw.slice(8)) || MAX_PROVIDER_TARGETS;
  }
  return args;
}

/**
 * Sağlayıcı fikstür kimliği. `providerIds.apiFootball` güvenilirdir;
 * üst düzey `providerId` yalnızca kayıt API-Football'dan geldiyse onun
 * fikstür kimliğidir. Başka kaynaktan gelen sayısal kimlik (örn.
 * TheSportsDB etkinlik numarası) ASLA kabul edilmez — yanlış maçın
 * tahminini getirir.
 */
export function apiFootballFixtureId(match) {
  const declared = match && match.providerIds && match.providerIds.apiFootball;
  if (declared && /^\d+$/.test(String(declared))) return String(declared);
  if (match && match.source === "api-football" && /^\d+$/.test(String(match.providerId || ""))) {
    return String(match.providerId);
  }
  return null;
}

/** Takvim kaydından tahmin bağlamının beklediği sade fikstür nesnesi. */
export function toFixture(match) {
  return {
    id: match.id || null,
    providerFixtureId: apiFootballFixtureId(match),
    competitionId: match.competitionId || null,
    leagueId: match.providerLeagueId || null,
    season: match.season || null,
    kickoff: match.kickoff || null,
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    homeTeamId: match.homeTeamId || null,
    awayTeamId: match.awayTeamId || null
  };
}

/** Yaklaşan fikstürler: başlamamış, pencere içinde, kimliği olan kayıtlar. */
/**
 * Depodaki kayıt bugünün kurallarını geçiyor mu. Kural sonradan
 * sıkılaştığında (ör. %0'lı sağlayıcı üçlüsünün reddi) eski kayıtlar
 * kendiliğinden geçersizleşmez — bu kontrol onları yakalar.
 */
export function isRejectedRecord(record) {
  if (!record) return false;
  if (record.source !== probability.SOURCES.PROVIDER) return false;
  return probability.hasZeroOutcome({
    home: record.homeProbability,
    draw: record.drawProbability,
    away: record.awayProbability
  });
}

export function selectUpcoming(matches, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const horizon = nowMs + (options.windowDays || WINDOW_DAYS) * 24 * 60 * 60 * 1000;

  return (Array.isArray(matches) ? matches : [])
    .filter((match) => {
      if (!match || !match.id || !match.homeTeam || !match.awayTeam) return false;
      const kickoff = Date.parse(match.kickoff);
      if (!Number.isFinite(kickoff)) return false;
      if (kickoff < nowMs || kickoff > horizon) return false;
      const status = String(match.status || match.providerStatus || "").toUpperCase();
      if (status && !UPCOMING_STATUSES.has(status) && canonicalStatus(status) !== "SCHEDULED") return false;
      return true;
    })
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)) ||
      String(left.id).localeCompare(String(right.id)));
}

/** Yeni kaynak, eldekinden daha mı zayıf? */
function isDowngrade(cachedSource, nextSource) {
  const order = probability.SOURCE_PRIORITY;
  return order.indexOf(nextSource) > order.indexOf(cachedSource);
}

/**
 * Üst kaynağın yokluğu erişim engelinden mi (anahtar/kota/ağ) kaynaklanıyor?
 * Sağlayıcı GERÇEKTEN boş döndüyse düşüş meşrudur: elimizdeki en iyi
 * bilgi artık alt kaynaktır.
 */
function blockedByAccess(reasons, source) {
  const reason = String(reasons[source] || "");
  return reason === "provider-not-configured" ||
    reason === "request-budget-exhausted" ||
    reason.startsWith("provider-request-failed") ||
    reason.startsWith("odds-request-failed");
}

function logLine(message) {
  console.log(message);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const context = loadProbabilityContext(root);
  const existing = store.readStore(STORE_PATH);
  const index = store.indexStore(existing);
  const providerReady = !args.modelOnly && apiFootballProvider.hasConfig();

  if (!providerReady) {
    logLine(args.modelOnly
      ? "Model-only run: no provider request will be made."
      : "No live provider configured (APIFOOTBALL_API_KEY missing). Provider prediction and odds fallback are skipped; the FutbolRadar model still runs on verified local data.");
  }

  const targets = selectUpcoming(context.calendarMatches, { now, windowDays: args.windowDays });
  logLine(`${targets.length} upcoming fixture(s) in the next ${args.windowDays} day(s).`);

  const budget = createRequestBudget({ perUnit: 1 });
  const report = {
    total: targets.length,
    cached: 0,
    provider: 0,
    market: 0,
    model: 0,
    kept: 0,
    unresolved: [],
    skippedCoverage: { predictions: 0, odds: 0 },
    budgetStops: 0,
    rejectedStored: 0
  };

  let providerTargets = 0;
  let calendarChanged = false;

  for (const match of targets) {
    const fixture = toFixture(match);
    const cached = index.find(fixture.id, fixture.providerFixtureId);

    // KURALI ARTIK GEÇMEYEN KAYIT TAZE SAYILMAZ. Sağlayıcının %0'lı
    // üçlüsü depoya yazıldıktan SONRA reddedilir oldu (bkz.
    // services/fixtureProbabilityService.js → parseProviderPercent).
    // Basamak kapısı bu kayıtları "taze" görüp bir sonraki basamağa
    // kadar ekranda bırakırdı; yanlış bir iddiayı saatlerce taşımak,
    // bir istek tasarrufuna değmez.
    const cachedRejected = isRejectedRecord(cached);
    if (!args.all && !cachedRejected && !store.needsRefresh(cached, fixture.kickoff, now)) {
      report.cached += 1;
      continue;
    }
    if (cachedRejected) {
      report.rejectedStored += 1;
      logLine(`  ${fixture.id}: stored ${cached.source} record rejected by current rules (zero outcome); re-resolving.`);
    }

    const coverage = coverageFor(context, fixture);
    const reasons = {};
    let provider = null;
    let market = null;

    const canQueryProvider = providerReady &&
      Boolean(fixture.providerFixtureId) &&
      coverage.predictions !== false &&
      providerTargets < args.limit;

    if (!fixture.providerFixtureId) reasons[probability.SOURCES.PROVIDER] = "no-verified-provider-fixture-id";
    else if (coverage.predictions === false) {
      reasons[probability.SOURCES.PROVIDER] = "league-coverage-has-no-predictions";
      report.skippedCoverage.predictions += 1;
    } else if (!providerReady) reasons[probability.SOURCES.PROVIDER] = "provider-not-configured";

    if (canQueryProvider) {
      if (budget.canAfford(1)) {
        providerTargets += 1;
        budget.spend(1, "/predictions");
        try {
          const items = await apiFootballProvider.getPredictions({ fixtureId: fixture.providerFixtureId });
          const raw = Array.isArray(items) && items.length ? items[0] : null;
          provider = raw ? probability.normalizeProviderPrediction(raw, { providerUpdatedAt: new Date().toISOString() }) : null;
          if (!provider) {
            const issue = raw ? probability.providerPercentIssue(raw.predictions && raw.predictions.percent) : null;
            reasons[probability.SOURCES.PROVIDER] = raw
              ? `provider-percentages-unusable:${issue || "unknown"}`
              : "provider-returned-empty";
          }
          if (raw) {
            // Ham yükü takvime de yaz: ikili rekabet ve h2h bloklarını
            // okuyan mevcut bölümler oradan besleniyor.
            match.prediction = raw;
            match.predictionFetchedAt = new Date().toISOString();
            calendarChanged = true;
          }
        } catch (error) {
          reasons[probability.SOURCES.PROVIDER] = `provider-request-failed:${error.code || error.message}`;
        }
      } else {
        reasons[probability.SOURCES.PROVIDER] = "request-budget-exhausted";
        report.budgetStops += 1;
      }
    }

    // Takvimde daha önce yazılmış ham tahmin varsa yeni istek atmadan
    // kullanılır: kapsam görünse bile kota bitmiş olabilir.
    if (!provider && match.prediction) {
      provider = probability.normalizeProviderPrediction(match.prediction, { providerUpdatedAt: match.predictionFetchedAt || null });
      if (provider) reasons[probability.SOURCES.PROVIDER] = undefined;
    }

    if (!provider) {
      const canQueryOdds = providerReady && Boolean(fixture.providerFixtureId) && coverage.odds !== false;
      if (!fixture.providerFixtureId) reasons[probability.SOURCES.MARKET] = "no-verified-provider-fixture-id";
      else if (coverage.odds === false) {
        reasons[probability.SOURCES.MARKET] = "league-coverage-has-no-odds";
        report.skippedCoverage.odds += 1;
      } else if (!providerReady) reasons[probability.SOURCES.MARKET] = "provider-not-configured";

      if (canQueryOdds) {
        if (budget.canAfford(1)) {
          budget.spend(1, "/odds");
          try {
            const items = await apiFootballProvider.getOdds({ fixtureId: fixture.providerFixtureId });
            market = probability.consensusFromOdds(items);
            if (!market) reasons[probability.SOURCES.MARKET] = "no-usable-1x2-market";
          } catch (error) {
            reasons[probability.SOURCES.MARKET] = `odds-request-failed:${error.code || error.message}`;
          }
        } else {
          reasons[probability.SOURCES.MARKET] = "request-budget-exhausted";
          report.budgetStops += 1;
        }
      }
    }

    const modelResult = context.engine.modelFor(fixture);
    if (!modelResult.prediction) reasons[probability.SOURCES.MODEL] = modelResult.reason;

    const resolved = probability.resolveFixtureProbability({
      provider,
      market,
      model: modelResult.prediction,
      reasons
    });

    // DÜŞÜŞ KORUMASI: elde daha güçlü kaynaklı bir kayıt varken, üst
    // kaynaklar YOKLUKLARINDAN DEĞİL erişilemezliklerinden (anahtar yok,
    // kota bitti) ötürü boş kaldıysa kayıt düşürülmez. Aksi hâlde
    // kotanın bittiği bir koşu, sağlayıcı tahminini modelle değiştirir ve
    // kullanıcı ertesi gün daha zayıf bir kaynağa bakar.
    // Reddedilen kayıt korunmaz: düşüş koruması "elimizdeki daha iyi"
    // içindir, "elimizdeki geçersiz" için değil.
    if (resolved && cached && !cachedRejected && isDowngrade(cached.source, resolved.source) && blockedByAccess(reasons, cached.source)) {
      const refreshed = {
        ...cached,
        refreshStage: store.refreshStageFor(fixture.kickoff, now),
        expiresAt: store.expiresAtFor(fixture.kickoff, now)
      };
      store.upsertRecord(existing, refreshed);
      report.kept += 1;
      logLine(`  ${fixture.id}: kept ${cached.source} (upper source unreachable: ${reasons[cached.source] || "unknown"}).`);
      continue;
    }

    if (!resolved) {
      report.unresolved.push({
        fixtureId: fixture.id,
        kickoff: fixture.kickoff,
        competitionId: fixture.competitionId,
        reasons
      });
      logLine(`  ${fixture.id}: no source produced a probability (${Object.values(reasons).filter(Boolean).join(", ") || "unknown"}).`);
      continue;
    }

    const record = store.buildRecord({ fixture, resolved, now });
    store.upsertRecord(existing, record);
    if (resolved.source === probability.SOURCES.PROVIDER) report.provider += 1;
    else if (resolved.source === probability.SOURCES.MARKET) report.market += 1;
    else report.model += 1;
    logLine(`  ${fixture.id}: ${resolved.source} ${record.homeProbability}/${record.drawProbability}/${record.awayProbability} (stage ${record.refreshStage}).`);
  }

  // Başlamış maçların kayıtları dondurulur; eskiyenler düşürülür.
  const retentionLimit = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  existing.predictions = existing.predictions
    .map((record) => store.freezeIfStarted(record, record.kickoff, now))
    .filter((record) => {
      const kickoff = Date.parse(record.kickoff);
      return !Number.isFinite(kickoff) || kickoff >= retentionLimit;
    });

  logLine([
    "",
    "Summary:",
    `  provider_prediction : ${report.provider}`,
    `  market_probability  : ${report.market}`,
    `  futbolradar_model   : ${report.model}`,
    `  cached (fresh)      : ${report.cached}`,
    `  kept (upper source unreachable): ${report.kept}`,
    `  rejected stored records: ${report.rejectedStored}`,
    `  unresolved          : ${report.unresolved.length}`,
    `  provider requests   : ${budget.summary().spent} (ceiling ${budget.summary().ceiling})`,
    ""
  ].join("\n"));

  for (const row of report.unresolved.slice(0, 20)) {
    logLine(`  unresolved ${row.fixtureId}: ${Object.entries(row.reasons).map(([key, value]) => `${key}=${value}`).join(" · ")}`);
  }

  // ZAMANLANMIŞ KOŞUNUN DURUM DOSYASINA KAPSAM RAPORU.
  //
  // Tahmin artık saatlik koşunun bir adımı; "çalıştı mı" sorusunun cevabı
  // koşu günlüğünün içinde kalırsa yalnızca birisi o günlüğü açtığında
  // okunur. Kapsam bu yüzden data/update-status.json'a da yazılır:
  // `covered < checked` olan bir koşu, kapatılması gereken gerçek bir veri
  // boşluğunu görünür kılar (bkz. scripts/run-scheduled-update.mjs).
  const covered = report.provider + report.market + report.model + report.cached + report.kept;
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({
    source: "api-football",
    checked: report.total,
    covered,
    updated: report.provider + report.market + report.model,
    provider: report.provider,
    market: report.market,
    model: report.model,
    cached: report.cached,
    kept: report.kept,
    rejectedStored: report.rejectedStored,
    uncovered: report.unresolved.length,
    uncoveredReasons: report.unresolved.slice(0, 10).map((row) => ({ fixtureId: row.fixtureId, reasons: row.reasons })),
    providerRequests: budget.summary().spent,
    errors: []
  })}`);

  if (!args.apply) {
    logLine(`Dry run: ${existing.predictions.length} record(s) would be written to data/fixture-predictions.json. No file written.`);
    return;
  }

  for (const filePath of [STORE_PATH, PUBLIC_STORE_PATH]) {
    store.writeStore(filePath, existing);
  }
  logLine(`Wrote ${existing.predictions.length} prediction record(s) to data/fixture-predictions.json (+ public mirror).`);

  if (calendarChanged) {
    for (const filePath of [CALENDAR_PATH, PUBLIC_CALENDAR_PATH]) {
      const tempPath = `${filePath}.tmp-${process.pid}`;
      fs.writeFileSync(tempPath, `${JSON.stringify(context.calendar, null, 2)}\n`);
      fs.renameSync(tempPath, filePath);
    }
    logLine("Raw provider prediction payloads written back to fixture-calendar.json (+ public mirror).");
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
