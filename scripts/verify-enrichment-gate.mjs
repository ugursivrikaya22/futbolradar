/**
 * ZENGİNLEŞTİRME YAZIM KAPISI — apply'dan ÖNCE ve SONRA çalışan denetim.
 *
 * `--apply` bu depoda ilk kez çalıştırılacak. Kuru koşu temiz çıktı diye
 * yazmaya geçmek yetmez: kuru koşu ile yazımın arasında sağlayıcı
 * cevabı değişebilir, bir fikstür başka maça bağlanabilir, kapsam
 * düşebilir. Bu betik ikisini de aynı ölçütle denetler:
 *
 *   --log=<dosya>    kuru koşunun ÇIKTISINI denetler (yazımdan önce)
 *   --store=<dosya>  üretilen JSON'u denetler (yazımdan sonra)
 *
 * Ölçüt, kimliklendirilmiş koşu 30281589276'nın taban çizgisi. Daha
 * YÜKSEK kapsam kabul edilir (sağlayıcı veri eklemiş olabilir); daha
 * düşüğü kapıyı kapatır. Kapı kapanırsa çıkış kodu 1 olur ve iş akışı
 * yazma adımına hiç ulaşmaz.
 *
 * Betik hiçbir şey YAZMAZ ve ağa çıkmaz.
 */

import fs from "node:fs";
import path from "node:path";

/** Yazılması BEKLENEN maçlar ve bağlanmaları gereken fikstür kimlikleri. */
const REQUIRED_FIXTURES = {
  "fenerbahce-gornik-zabrze-2026-07-21": "1556502",
  "besiktas-midtjylland-2026-07-23": "1556543",
  "umraniyespor-galatasaray-2026-07-17": "1589272",
  "konyaspor-hull-city-2026-07-25": "1584975",
  "galatasaray-monza-2026-07-24": "1583419",
  "osijek-caykur-rizespor-2026-07-25": "1583460",
  "goztepe-rudes-2026-07-26": "1598546"
};

/**
 * Sağlayıcının taşımadığı iki hazırlık maçı. Bunlar ÇÖZÜLMEDEN kalmalı;
 * depoda anahtarları bulunursa bir yerde uydurma bağlama yapılmış demektir.
 */
const EXCLUDED_MATCHES = [
  "besiktas-spartak-trnava-2026-07-14",
  "samsunspor-raal-la-louviere-2026-07-25"
];

/** Maç başına EN AZ bu kapsam. Taban çizgisi kimliklendirilmiş koşudan. */
const MIN_COVERAGE = {
  "fenerbahce-gornik-zabrze-2026-07-21": 100,
  "besiktas-midtjylland-2026-07-23": 83,
  "umraniyespor-galatasaray-2026-07-17": 67,
  "konyaspor-hull-city-2026-07-25": 67,
  "galatasaray-monza-2026-07-24": 50,
  "osijek-caykur-rizespor-2026-07-25": 50,
  "goztepe-rudes-2026-07-26": 50
};

/** Bölüm başına EN AZ kaç maçta dolu olmalı. */
const MIN_SECTION_FILL = {
  summary: 7, goals: 7, events: 7, lineups: 4, teamStats: 2, playerStats: 1
};

const SECTION_KEYS = ["summary", "goals", "events", "lineups", "teamStats", "playerStats"];
const EXPECTED_RECORDS = 7;
const EXPECTED_UNRESOLVED = 2;
const SECTIONS_PER_RECORD = 6;
const TOTAL_SLOTS = EXPECTED_RECORDS * SECTIONS_PER_RECORD; // 42
const MIN_READY = 28;
const MAX_AWAITING = TOTAL_SLOTS - MIN_READY; // 14

/**
 * TheSportsDB olay numarası. Bir dönem `data/matches.json` içinde
 * API-Football fikstür kimliği sanılıp kullanıldı ve maç boş bir fikstüre
 * bağlandı. Depoda hiçbir yerde görünmemeli.
 */
const FORBIDDEN_FIXTURE_IDS = ["2542013"];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

/* ------------------------------------------------------------------ *
 * KURU KOŞU ÇIKTISI DENETİMİ (yazımdan önce)
 * ------------------------------------------------------------------ */

function verifyLog(text) {
  // GitHub ham günlüğü satır başına zaman damgası ekleyebiliyor.
  const clean = text.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z /gm, "");

  const summary = clean.match(/Özet: çözülen (\d+) · çözülemeyen (\d+)[^\n]*/);
  check(Boolean(summary), "kuru koşu özeti bulunamadı");
  if (summary) {
    check(Number(summary[1]) === EXPECTED_RECORDS, `çözülen maç ${summary[1]}, beklenen ${EXPECTED_RECORDS}`);
    check(Number(summary[2]) === EXPECTED_UNRESOLVED, `çözülemeyen maç ${summary[2]}, beklenen ${EXPECTED_UNRESOLVED}`);

    const providerErrors = summary[0].match(/sağlayıcı hatası (\d+)/);
    check(providerErrors && Number(providerErrors[1]) === 0,
      `sağlayıcı hatası sıfır olmalı: ${providerErrors ? providerErrors[1] : "okunamadı"}`);

    const strayIds = summary[0].match(/doğrulanamayan kayıt kimliği (\d+)/);
    check(strayIds && Number(strayIds[1]) === 0,
      `doğrulanamayan kayıt kimliği sıfır olmalı: ${strayIds ? strayIds[1] : "okunamadı"}`);
  }

  // Kimlik doğrulama / kota hataları kapıyı kapatır.
  check(!/PROVIDER_AUTH|PROVIDER_QUOTA|401|403|429/.test(clean),
    "kuru koşu günlüğünde kimlik/kota hatası izi var");

  // Maç bazında bağlama ve kapsam.
  let readyTotal = 0;
  for (const [matchId, fixtureId] of Object.entries(REQUIRED_FIXTURES)) {
    const block = clean.match(new RegExp(`\\[${matchId}\\]([\\s\\S]*?)(?=\\n\\[|\\nÖzet:)`));
    check(Boolean(block), `${matchId}: kuru koşu bloğu bulunamadı`);
    if (!block) continue;

    const bound = block[1].match(/fixtureId=(\d+)/);
    check(bound && bound[1] === fixtureId,
      `${matchId}: fikstür ${bound ? bound[1] : "yok"}, beklenen ${fixtureId}`);

    const coverage = block[1].match(/kapsam %(\d+) \((\d+)\/(\d+)\)/);
    check(Boolean(coverage), `${matchId}: kapsam satırı okunamadı`);
    if (coverage) {
      check(Number(coverage[1]) >= MIN_COVERAGE[matchId],
        `${matchId}: kapsam %${coverage[1]}, taban %${MIN_COVERAGE[matchId]}`);
      check(Number(coverage[3]) === SECTIONS_PER_RECORD, `${matchId}: bölüm sayısı ${coverage[3]}`);
      readyTotal += Number(coverage[2]);
    }
  }

  for (const excluded of EXCLUDED_MATCHES) {
    const block = clean.match(new RegExp(`\\[${excluded}\\]([\\s\\S]*?)(?=\\n\\[|\\nÖzet:)`));
    check(Boolean(block) && /kimlik ÇÖZÜLEMEDİ/.test(block[1]),
      `${excluded}: çözülmemiş kalmalıydı`);
    check(!block || !/fixtureId=/.test(block[1]),
      `${excluded}: fikstüre bağlanmış — uydurma bağlama`);
  }

  check(readyTotal >= MIN_READY, `dolu bölüm ${readyTotal}, taban ${MIN_READY}`);
  check(TOTAL_SLOTS - readyTotal <= MAX_AWAITING,
    `eksik bölüm ${TOTAL_SLOTS - readyTotal}, tavan ${MAX_AWAITING}`);

  // Bölüm bazında tablo.
  for (const [key, minimum] of Object.entries(MIN_SECTION_FILL)) {
    const row = clean.match(new RegExp(`${key}\\s+(\\d+)/(\\d+)`));
    check(Boolean(row), `${key}: bölüm tablosu satırı bulunamadı`);
    if (row) {
      check(Number(row[1]) >= minimum, `${key}: ${row[1]}/${row[2]} dolu, taban ${minimum}/7`);
    }
  }

  for (const forbidden of FORBIDDEN_FIXTURE_IDS) {
    check(!clean.includes(`fixtureId=${forbidden}`), `yasak fikstür kimliği kullanıldı: ${forbidden}`);
  }

  return { readyTotal, awaitingTotal: TOTAL_SLOTS - readyTotal };
}

/* ------------------------------------------------------------------ *
 * ÜRETİLEN DEPO DENETİMİ (yazımdan sonra)
 * ------------------------------------------------------------------ */

function verifyStore(store) {
  const keys = Object.keys(store);
  check(keys.length === EXPECTED_RECORDS, `kayıt sayısı ${keys.length}, beklenen ${EXPECTED_RECORDS}`);

  for (const excluded of EXCLUDED_MATCHES) {
    check(!(excluded in store), `çözülemeyen maç depoya girmiş: ${excluded}`);
  }

  const serialized = JSON.stringify(store);
  for (const forbidden of FORBIDDEN_FIXTURE_IDS) {
    check(!serialized.includes(forbidden), `yasak fikstür kimliği depoda: ${forbidden}`);
  }

  let readyTotal = 0;
  const sectionFill = Object.fromEntries(SECTION_KEYS.map((key) => [key, 0]));

  for (const [matchId, expectedFixture] of Object.entries(REQUIRED_FIXTURES)) {
    const record = store[matchId];
    check(Boolean(record), `${matchId}: kayıt yok`);
    if (!record) continue;

    check(String(record.fixtureId) === expectedFixture,
      `${matchId}: fikstür ${record.fixtureId}, beklenen ${expectedFixture}`);
    check(record.matchId === matchId, `${matchId}: matchId alanı uyuşmuyor (${record.matchId})`);
    check(Number(record.coverage) >= MIN_COVERAGE[matchId],
      `${matchId}: kapsam %${record.coverage}, taban %${MIN_COVERAGE[matchId]}`);
    check(Number(record.totalSections) === SECTIONS_PER_RECORD,
      `${matchId}: bölüm sayısı ${record.totalSections}`);
    check(Boolean(record.observedAt) && !Number.isNaN(Date.parse(record.observedAt)),
      `${matchId}: geçerli gözlem zamanı yok`);
    check(record.resolution && String(record.resolution.fixtureId) === expectedFixture,
      `${matchId}: çözümleme kaydı fikstürle uyuşmuyor`);
    check(record.resolution && typeof record.resolution.reason === "string" && record.resolution.reason.trim(),
      `${matchId}: çözümleme gerekçesi yok`);

    const sectionKeys = Object.keys(record.sections || {});
    check(sectionKeys.length === SECTIONS_PER_RECORD,
      `${matchId}: ${sectionKeys.length} bölüm nesnesi, beklenen ${SECTIONS_PER_RECORD}`);

    let ready = 0;
    for (const key of SECTION_KEYS) {
      const section = (record.sections || {})[key];
      check(Boolean(section), `${matchId}.${key}: bölüm nesnesi yok`);
      if (!section) continue;

      if (section.status === "ready") {
        ready += 1;
        sectionFill[key] += 1;
        check(section.value !== null && section.value !== undefined,
          `${matchId}.${key}: dolu bölüm değersiz`);
        check(Boolean(section.provenance), `${matchId}.${key}: dolu bölüm kökensiz`);
        if (section.provenance) {
          check(/API-Football|kürasyon/i.test(String(section.provenance.source)),
            `${matchId}.${key}: tanınmayan köken "${section.provenance.source}"`);
          check(String(section.provenance.fixtureId) === expectedFixture,
            `${matchId}.${key}: köken fikstürü uyuşmuyor`);
        }
      } else {
        check(section.status === "awaiting", `${matchId}.${key}: tanınmayan durum "${section.status}"`);
        check(section.value === null, `${matchId}.${key}: eksik bölüm değer taşıyor`);
        check(section.provenance === null, `${matchId}.${key}: eksik bölüm köken taşıyor`);
        check(Boolean(section.message), `${matchId}.${key}: eksik bölüm sessiz kalmamalı`);
      }
    }

    readyTotal += ready;
    check(record.filledSections === ready, `${matchId}: filledSections ${record.filledSections} ≠ ${ready}`);

    // dataStatus === "complete" ⟺ eksik bölüm yok.
    check((record.dataStatus === "complete") === (ready === SECTIONS_PER_RECORD),
      `${matchId}: "${record.dataStatus}" ile ${ready}/${SECTIONS_PER_RECORD} dolu bölüm çelişiyor`);
    check((record.dataStatus === "complete") === (record.partialMessage === null),
      `${matchId}: dataStatus ile partialMessage çelişiyor`);
  }

  check(readyTotal >= MIN_READY, `dolu bölüm ${readyTotal}, taban ${MIN_READY}`);
  check(TOTAL_SLOTS - readyTotal <= MAX_AWAITING,
    `eksik bölüm ${TOTAL_SLOTS - readyTotal}, tavan ${MAX_AWAITING}`);

  for (const [key, minimum] of Object.entries(MIN_SECTION_FILL)) {
    check(sectionFill[key] >= minimum, `${key}: ${sectionFill[key]}/7 dolu, taban ${minimum}/7`);
  }

  return { readyTotal, awaitingTotal: TOTAL_SLOTS - readyTotal, sectionFill };
}

/* ------------------------------------------------------------------ *
 * GİRİŞ
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { log: null, store: null };
  for (const raw of argv) {
    if (raw.startsWith("--log=")) args.log = raw.slice("--log=".length);
    else if (raw.startsWith("--store=")) args.store = raw.slice("--store=".length);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.log && !args.store) {
    console.error("Kullanım: node scripts/verify-enrichment-gate.mjs --log=<dosya> | --store=<dosya>");
    process.exitCode = 2;
    return;
  }

  let mode = "";
  let totals = null;

  if (args.log) {
    mode = "kuru koşu çıktısı";
    const logPath = path.resolve(args.log);
    if (!fs.existsSync(logPath)) {
      console.error(`[kapı] günlük bulunamadı: ${args.log}`);
      process.exitCode = 1;
      return;
    }
    totals = verifyLog(fs.readFileSync(logPath, "utf8"));
  }

  if (args.store) {
    mode = "üretilen depo";
    const storePath = path.resolve(args.store);
    if (!fs.existsSync(storePath)) {
      console.error(`[kapı] depo bulunamadı: ${args.store}`);
      process.exitCode = 1;
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch (error) {
      console.error(`[kapı] depo okunamadı: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    totals = verifyStore(parsed);
  }

  if (failures.length) {
    console.error(`\n[kapı] KAPALI — ${mode} ${failures.length} ölçütü karşılamıyor:`);
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error("\nYazma adımı çalıştırılmamalı.");
    process.exitCode = 1;
    return;
  }

  console.log(`[kapı] AÇIK — ${mode} taban çizgisini karşılıyor.`);
  console.log(`  kayıt ${EXPECTED_RECORDS} · çözülemeyen ${EXPECTED_UNRESOLVED} (dışlandı)`);
  console.log(`  dolu bölüm ${totals.readyTotal}/${TOTAL_SLOTS} (taban ${MIN_READY}) · eksik ${totals.awaitingTotal} (tavan ${MAX_AWAITING})`);
}

main();

export { verifyLog, verifyStore, REQUIRED_FIXTURES, EXCLUDED_MATCHES, MIN_READY, MAX_AWAITING };
