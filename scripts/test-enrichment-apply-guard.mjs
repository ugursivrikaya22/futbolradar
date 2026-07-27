/**
 * KORUMALI YAZMA YOLU TESTLERİ
 *
 * `--apply` bu depoda veri yazan tek zenginleştirme komutu ve elle
 * açılan tek kapının arkasında. Bu test o kapının gerçekten kapalı
 * olduğunu kanıtlıyor — iki cephede:
 *
 *   1. İŞ AKIŞI SÖZLEŞMESİ: tetikleyici yalnızca workflow_dispatch,
 *      onay dizesi birebir, preflight gerçek bir kapı, `git add -A` yok,
 *      eski anahtar adı yok, gizli değer hiçbir yerde yankılanmıyor.
 *   2. KAPI DENETİMİ: verify-enrichment-gate.mjs taban çizgisini
 *      karşılamayan HER durumda kapanıyor. Kapının kapandığını görmeden
 *      "kapı var" demek, kapıyı denemeden kilitli sanmaktır.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const GATE = path.join(root, "scripts", "verify-enrichment-gate.mjs");
const WORKFLOW = path.join(root, ".github", "workflows", "post-match-enrichment-apply.yml");
const CONFIRMATION = "APPLY_VERIFIED_POST_MATCH_7";

/* ------------------------------------------------------------------ *
 * 1. İŞ AKIŞI SÖZLEŞMESİ
 * ------------------------------------------------------------------ */

assert.ok(fs.existsSync(WORKFLOW), "korumalı yazma iş akışı bulunmalı");
const workflow = fs.readFileSync(WORKFLOW, "utf8");

/**
 * "Bulunmamalı" iddiaları YALNIZCA çalışan YAML'a bakmalı.
 *
 * Bu dosyanın yorumları neyin YASAK olduğunu anlatıyor ("git add -A
 * KULLANILMIYOR", "continue-on-error YOK"). Ham metinde arama yapmak o
 * açıklamaları ihlal sanardı — ve daha kötüsü, yorumu silmek testi
 * "düzeltirdi". Yorum satırlarını ayıklayıp koda bakıyoruz.
 */
const workflowCode = workflow
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

// PLANLI YAZIM YOK. Bu dosyada schedule/push/pull_request tetikleyicisi
// bulunursa yazma yolu kendiliğinden çalışabilir hâle gelir.
const triggerBlock = workflowCode.slice(workflowCode.indexOf("\non:"), workflowCode.indexOf("permissions:"));
assert.match(triggerBlock, /workflow_dispatch:/, "tek tetikleyici workflow_dispatch olmalı");
for (const forbidden of ["schedule:", "cron:", "push:", "pull_request:", "repository_dispatch:"]) {
  assert.ok(!triggerBlock.includes(forbidden), `yazma iş akışında ${forbidden} bulunmamalı`);
}

// ONAY DİZESİ BİREBİR. Koşullu, işin kendisinde olmalı ki dize
// tutmadığında hiçbir adım kurulmasın.
assert.match(
  workflow,
  new RegExp(`if:\\s*github\\.event\\.inputs\\.confirm == '${CONFIRMATION}'`),
  "iş, onay dizesiyle birebir korunmalı"
);
assert.match(workflow, /inputs:\s*\n\s*confirm:/, "confirm girdisi tanımlı olmalı");
assert.match(workflow, /required: true/, "onay girdisi zorunlu olmalı");

// SIRA: kuru koşu → kapı → apply → kapı → dosya kapsamı.
const order = ["Dry run (no writes)", "Gate check (dry run output)", "Apply enrichment",
  "Gate check (written store)", "Verify only the enrichment store changed", "Commit to automation branch"];
let cursor = -1;
for (const step of order) {
  const at = workflow.indexOf(step);
  assert.ok(at > -1, `adım bulunmalı: ${step}`);
  assert.ok(at > cursor, `adım sırası bozuk: ${step}`);
  cursor = at;
}

// PREFLIGHT GERÇEK KAPI OLMALI: bu iş akışında continue-on-error yasak.
assert.ok(!/continue-on-error/.test(workflowCode),
  "yazma zincirinde hiçbir adım continue-on-error taşımamalı");
assert.match(workflow, /preflight-api-football\.mjs --resolve --probe/,
  "preflight sağlayıcıya gerçekten sormalı (--probe)");

// `git add -A` YASAK: yol açıkça yazılmalı.
assert.ok(!/git add -A/.test(workflowCode), "git add -A kullanılmamalı");
assert.ok(!/git add \./.test(workflowCode), "git add . kullanılmamalı");
assert.match(workflow, /git add data\/match-enrichment\.json/, "yalnızca zenginleştirme deposu eklenmeli");

// main'e YAZILMAZ.
assert.match(workflow, /git checkout -b "\$BRANCH"/, "çıktı ayrı bir dala gitmeli");
assert.match(workflow, /automation\/post-match-enrichment-/, "dal adı koşu kimliği taşımalı");
assert.ok(!/git push[^\n]*origin[^\n]*\bmain\b/.test(workflowCode), "main'e push edilmemeli");

// GİZLİ DEĞER: yalnızca secrets ifadesiyle geçmeli, asla yankılanmamalı.
assert.ok(!/API_FOOTBALL_KEY/.test(workflowCode), "eski anahtar adı geri eklenmemeli");
const keyMentions = workflowCode.match(/APIFOOTBALL_API_KEY[^\n]*/g) || [];
for (const mention of keyMentions) {
  assert.ok(
    /APIFOOTBALL_API_KEY:\s*\$\{\{\s*secrets\.APIFOOTBALL_API_KEY\s*\}\}/.test(mention),
    `anahtar yalnızca secrets ifadesiyle geçmeli: ${mention.trim()}`
  );
}
assert.ok(!/echo[^\n]*APIFOOTBALL/.test(workflowCode), "anahtar hiçbir yerde yankılanmamalı");

// Planlı iş akışı yazma yetkisi ALMAMALI.
const scheduled = fs.readFileSync(path.join(root, ".github", "workflows", "match-analysis.yml"), "utf8");
assert.ok(!/enrich-post-match\.mjs --apply/.test(scheduled),
  "planlı iş akışı zenginleştirme yazımı yapmamalı");
assert.ok(!/enrich:post-match[^\n]*--apply/.test(scheduled),
  "planlı iş akışı --apply ile çağırmamalı");

/* ------------------------------------------------------------------ *
 * 2. KAPI DENETİMİ — kapanmayı KANITLA
 * ------------------------------------------------------------------ */

const REQUIRED = {
  "fenerbahce-gornik-zabrze-2026-07-21": ["1556502", 100, 6],
  "umraniyespor-galatasaray-2026-07-17": ["1589272", 67, 4],
  "besiktas-midtjylland-2026-07-23": ["1556543", 83, 5],
  "galatasaray-monza-2026-07-24": ["1583419", 50, 3],
  "konyaspor-hull-city-2026-07-25": ["1584975", 67, 4],
  "osijek-caykur-rizespor-2026-07-25": ["1583460", 50, 3],
  "goztepe-rudes-2026-07-26": ["1598546", 50, 3]
};
const EXCLUDED = ["besiktas-spartak-trnava-2026-07-14", "samsunspor-raal-la-louviere-2026-07-25"];
const SECTIONS = ["summary", "goals", "events", "lineups", "teamStats", "playerStats"];

/** Kimliklendirilmiş koşunun çıktısını yeniden üretir. */
function buildLog(overrides = {}) {
  const rows = { ...REQUIRED, ...(overrides.fixtures || {}) };
  let out = "Tamamlanmış fikstür: 9\n";
  for (const [id, [fixtureId, coverage, ready]] of Object.entries(rows)) {
    out += `\n[${id}]\n  aday fikstür: 100 (tarih 2026-07-26)\n`;
    out += `  fixtureId=${fixtureId} (high: takım adları ve skor eşleşti)\n`;
    out += `  kapsam %${coverage} (${ready}/6) · durum: ${ready === 6 ? "complete" : "partial"}\n`;
    out += `  DOLU  : ${SECTIONS.slice(0, ready).join(", ")}\n  EKSİK : ${SECTIONS.slice(ready).join(", ") || "—"}\n`;
  }
  for (const id of overrides.excludedResolved ? [] : EXCLUDED) {
    out += `\n[${id}]\n  aday fikstür: 100 (tarih 2026-07-25)\n  kimlik ÇÖZÜLEMEDİ — sağlayıcı listesinde takım eşleşmesi yok\n`;
  }
  if (overrides.excludedResolved) {
    out += `\n[${EXCLUDED[0]}]\n  fixtureId=999999 (high: uydurma)\n  kapsam %50 (3/6) · durum: partial\n`;
    out += `\n[${EXCLUDED[1]}]\n  kimlik ÇÖZÜLEMEDİ — sağlayıcı listesinde takım eşleşmesi yok\n`;
  }
  const summary = overrides.summary || "Özet: çözülen 7 · çözülemeyen 2 · zenginleşen 7 · " +
    "önbellekten atlanan 0 · reddedilen 0 · sağlayıcı hatası 0 · doğrulanamayan kayıt kimliği 0";
  out += `\n${summary}\n\nBölüm bazında kapsam:\n`;
  const fill = overrides.sectionFill || { summary: 7, goals: 7, events: 7, lineups: 4, teamStats: 2, playerStats: 1 };
  for (const key of SECTIONS) out += `  ${key.padEnd(12)} ${fill[key]}/7  %${Math.round((fill[key] / 7) * 100)}\n`;
  return out;
}

/** Kimliklendirilmiş koşuya karşılık gelen depoyu üretir. */
function buildStore(mutate) {
  const store = {};
  for (const [id, [fixtureId, coverage, ready]] of Object.entries(REQUIRED)) {
    const sections = {};
    SECTIONS.forEach((key, index) => {
      const isReady = index < ready;
      sections[key] = {
        key, label: key, status: isReady ? "ready" : "awaiting",
        value: isReady ? [{ x: 1 }] : null,
        source: isReady ? "provider" : null,
        overridden: false,
        message: isReady ? null : `${key} için doğrulanmış veri gelmedi.`,
        provenance: isReady ? { source: "API-Football", observedAt: "2026-07-27T16:22:30.000Z", fixtureId } : null
      };
    });
    store[id] = {
      matchId: id, fixtureId,
      resolution: { fixtureId, confidence: "high", reason: "takım adları ve skor eşleşti" },
      sections, filledSections: ready, totalSections: 6, coverage,
      dataStatus: ready === 6 ? "complete" : "partial",
      observedAt: "2026-07-27T16:22:30.000Z",
      partialMessage: ready === 6 ? null : "Şu bölümler için doğrulanmış veri bekleniyor: …"
    };
  }
  if (typeof mutate === "function") mutate(store);
  return store;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "enrich-gate-"));
function runGate(flag, contents) {
  const file = path.join(tmp, flag === "log" ? `${Math.random().toString(36).slice(2)}.log` : `${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  const result = spawnSync(process.execPath, [GATE, `--${flag}=${file}`], { cwd: root, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

// TABAN ÇİZGİSİ: kapı açılmalı.
const okLog = runGate("log", buildLog());
assert.equal(okLog.status, 0, `taban çizgisi günlüğü kapıyı açmalı:\n${okLog.out}`);
assert.match(okLog.out, /dolu bölüm 28\/42/, "dolu bölüm toplamı raporlanmalı");

const okStore = runGate("store", buildStore());
assert.equal(okStore.status, 0, `taban çizgisi deposu kapıyı açmalı:\n${okStore.out}`);

// DAHA YÜKSEK kapsam kabul edilir (sağlayıcı veri eklemiş olabilir).
const better = runGate("store", buildStore((store) => {
  const record = store["goztepe-rudes-2026-07-26"];
  record.sections.lineups = {
    key: "lineups", label: "Dizilişler", status: "ready", value: [{ team: "G" }],
    source: "provider", overridden: false, message: null,
    provenance: { source: "API-Football", observedAt: "2026-07-27T16:22:30.000Z", fixtureId: "1598546" }
  };
  record.filledSections = 4; record.coverage = 67;
}));
assert.equal(better.status, 0, `artan kapsam kapıyı kapatmamalı:\n${better.out}`);

/** Kapının kapandığı her durum ADIYLA sabitleniyor. */
const LOG_FAILURES = [
  ["çözülen sayısı değişti", buildLog({ summary: "Özet: çözülen 6 · çözülemeyen 3 · sağlayıcı hatası 0 · doğrulanamayan kayıt kimliği 0" }), /çözülen maç 6/],
  ["sağlayıcı hatası var", buildLog({ summary: "Özet: çözülen 7 · çözülemeyen 2 · sağlayıcı hatası 1 · doğrulanamayan kayıt kimliği 0" }), /sağlayıcı hatası sıfır olmalı/],
  ["doğrulanamayan kimlik var", buildLog({ summary: "Özet: çözülen 7 · çözülemeyen 2 · sağlayıcı hatası 0 · doğrulanamayan kayıt kimliği 1" }), /doğrulanamayan kayıt kimliği sıfır/],
  ["yanlış fikstüre bağlandı", buildLog({ fixtures: { "goztepe-rudes-2026-07-26": ["2542013", 50, 3] } }), /yasak fikstür kimliği|beklenen 1598546/],
  ["kapsam taban altına düştü", buildLog({ fixtures: { "besiktas-midtjylland-2026-07-23": ["1556543", 50, 3] } }), /kapsam %50, taban %83/],
  ["dışlanan maç bağlandı", buildLog({ excludedResolved: true }), /çözülmemiş kalmalıydı|uydurma bağlama/],
  ["bölüm tablosu düştü", buildLog({ sectionFill: { summary: 7, goals: 7, events: 7, lineups: 3, teamStats: 2, playerStats: 1 } }), /lineups: 3\/7 dolu, taban 4\/7/],
  ["kimlik doğrulama hatası izi", `${buildLog()}\n[enrich] 401 Unauthorized\n`, /kimlik\/kota hatası/]
];

for (const [label, log, pattern] of LOG_FAILURES) {
  const result = runGate("log", log);
  assert.equal(result.status, 1, `kapı kapanmalıydı: ${label}`);
  assert.match(result.out, /KAPALI/, `${label}: kapalı olduğu söylenmeli`);
  assert.match(result.out, pattern, `${label}: gerekçe adıyla bildirilmeli\n${result.out}`);
}

const STORE_FAILURES = [
  ["kayıt sayısı fazla", (store) => { store["uydurma-mac"] = store["goztepe-rudes-2026-07-26"]; }, /kayıt sayısı 8/],
  ["dışlanan maç depoya girdi", (store) => { store[EXCLUDED[0]] = store["goztepe-rudes-2026-07-26"]; }, /çözülemeyen maç depoya girmiş/],
  ["yasak fikstür kimliği", (store) => { store["goztepe-rudes-2026-07-26"].fixtureId = "2542013"; }, /yasak fikstür kimliği depoda/],
  ["eksik bölüm değer taşıyor", (store) => { store["goztepe-rudes-2026-07-26"].sections.lineups.value = []; }, /eksik bölüm değer taşıyor/],
  ["eksik bölüm köken taşıyor", (store) => {
    store["goztepe-rudes-2026-07-26"].sections.lineups.provenance = { source: "API-Football", fixtureId: "1598546" };
  }, /eksik bölüm köken taşıyor/],
  ["dolu bölüm kökensiz", (store) => { store["goztepe-rudes-2026-07-26"].sections.events.provenance = null; }, /dolu bölüm kökensiz/],
  ["dolu bölüm değersiz", (store) => { store["goztepe-rudes-2026-07-26"].sections.events.value = null; }, /dolu bölüm değersiz/],
  ["dataStatus çelişkisi", (store) => { store["besiktas-midtjylland-2026-07-23"].dataStatus = "complete"; }, /çelişiyor/],
  ["dolu bölüm toplamı düştü", (store) => {
    const record = store["fenerbahce-gornik-zabrze-2026-07-21"];
    for (const key of ["playerStats", "teamStats", "lineups"]) {
      record.sections[key] = { key, label: key, status: "awaiting", value: null, source: null, overridden: false, message: "bekleniyor", provenance: null };
    }
    record.filledSections = 3; record.coverage = 50; record.dataStatus = "partial"; record.partialMessage = "…";
  }, /kapsam %50, taban %100/],
  ["gözlem zamanı yok", (store) => { store["goztepe-rudes-2026-07-26"].observedAt = null; }, /gözlem zamanı yok/],
  ["çözümleme gerekçesi yok", (store) => { store["goztepe-rudes-2026-07-26"].resolution.reason = ""; }, /çözümleme gerekçesi yok/]
];

for (const [label, mutate, pattern] of STORE_FAILURES) {
  const result = runGate("store", buildStore(mutate));
  assert.equal(result.status, 1, `kapı kapanmalıydı: ${label}\n${result.out}`);
  assert.match(result.out, pattern, `${label}: gerekçe adıyla bildirilmeli\n${result.out}`);
}

// Argümansız çağrı sessizce başarılı olmamalı.
const noArgs = spawnSync(process.execPath, [GATE], { cwd: root, encoding: "utf8" });
assert.notEqual(noArgs.status, 0, "argümansız kapı çağrısı başarı dönmemeli");

// Kapı betiği hiçbir şey YAZMAMALI.
const gateSource = fs.readFileSync(GATE, "utf8");
assert.ok(!/writeFileSync|appendFileSync|rmSync|unlinkSync/.test(gateSource),
  "kapı betiği dosya yazmamalı");

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`OK korumalı yazma yolu · tetikleyici yalnızca workflow_dispatch · onay dizesi birebir · ` +
  `preflight kapısı · ${LOG_FAILURES.length} günlük + ${STORE_FAILURES.length} depo ihlalinde kapı kapanıyor · ` +
  "git add -A yok · anahtar yankılanmıyor · planlı yazım kapalı");
