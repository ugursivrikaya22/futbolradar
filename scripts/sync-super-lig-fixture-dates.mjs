#!/usr/bin/env node
/**
 * TFF EŞLEŞMELERİNE DOĞRULANMIŞ TARİH/SAAT YAZAR.
 *
 * `data/super-lig-fixtures.json` sezonun 34 haftalık eşleşme listesini
 * taşıyor ama tek bir başlama saati yok: 306 maçın hepsi
 * `fixtureStatus: "confirmed-pairing"` ve `dateLabel: "14-17 Ağustos 2026"`
 * gibi bir ARALIK etiketiyle duruyor. TFF fikstürü açıklarken önce
 * eşleşmeleri, gün/saat atamalarını sonra veriyor; dosya o ilk hâlde
 * kalmış ve saat atamaları geldiğinde onları içeri alan bir adım yoktu.
 *
 * Bu betik o adımı ekliyor. Kaynak uydurmuyor: yalnızca
 * `data/fixture-calendar.json` içinde SAĞLAYICIDAN gelmiş Süper Lig
 * satırlarını okuyor ve eşleşme birebir tutuyorsa (aynı ev sahibi, aynı
 * deplasman, aynı hafta) o maça gerçek başlama anını yazıyor.
 *
 * KURALLAR
 *   • Eşleşme belirsizse (aynı çift birden çok haftada) DOKUNULMAZ.
 *   • Sağlayıcıda olmayan maç `confirmed-pairing` olarak kalır; sahte
 *     tarih üretilmez.
 *   • Yalnızca eklenen alanlar yazılır: kickoff, dateLabel, venue,
 *     fixtureStatus. Skor/durum bu betiğin işi değil.
 *
 * Kullanım:
 *   node scripts/sync-super-lig-fixture-dates.mjs            # kuru koşu
 *   node scripts/sync-super-lig-fixture-dates.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { normalizeKey } = require("../services/competitionCatalog.js");
const { istanbulDay } = require("../services/matchStatus.js");

const root = process.cwd();
const FIXTURES_PATH = path.join(root, "data", "super-lig-fixtures.json");
const PUBLIC_FIXTURES_PATH = path.join(root, "public", "data", "super-lig-fixtures.json");
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const APPLY = process.argv.includes("--apply");

/** Sağlayıcı yazımı → dosyadaki kanonik takım adı. */
const TEAM_ALIASES = new Map([
  ["genclerbirligi-s-k", "Gençlerbirliği"],
  ["istanbul-basaksehir", "Başakşehir"],
  ["rizespor", "Çaykur Rizespor"],
  ["corum", "Çorum FK"],
  ["amed", "Amed Sportif Faaliyetler"],
  ["erzurumspor", "Erzurumspor FK"],
  ["gaziantep", "Gaziantep FK"]
]);

function teamKey(value) {
  const key = normalizeKey(value);
  const alias = TEAM_ALIASES.get(key);
  return alias ? normalizeKey(alias) : key;
}

function pairKey(home, away) {
  return `${teamKey(home)}|${teamKey(away)}`;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, filePath);
}

const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

/** "14 Ağustos 2026 Cuma 21:30" — TSİ. */
function dateLabelFor(kickoff) {
  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).formatToParts(parsed).map((part) => [part.type, part.value])
  );
  const weekday = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "long" }).format(parsed);
  const month = MONTHS[Number(parts.month) - 1] || parts.month;
  return `${Number(parts.day)} ${month} ${parts.year} ${weekday} ${parts.hour}:${parts.minute}`;
}

function providerRows() {
  const calendar = readJson(CALENDAR_PATH, { matches: [] });
  const rows = Array.isArray(calendar.matches) ? calendar.matches : [];
  return rows.filter((row) => row && row.competitionId === "super-lig" && row.kickoff);
}

function main() {
  const fixtures = readJson(FIXTURES_PATH, null);
  if (!fixtures || !Array.isArray(fixtures.rounds)) {
    console.error("Süper Lig fikstür dosyası okunamadı.");
    process.exitCode = 1;
    return;
  }

  const rows = providerRows();
  if (!rows.length) {
    console.log("Sağlayıcı takviminde Süper Lig satırı yok; fikstür dosyası değiştirilmedi.");
    return;
  }

  // Aynı çift sezon içinde iki kez oynanır (ev sahibi değişerek). Ev/deplasman
  // sırası anahtarın parçası olduğu için çakışma yalnızca sağlayıcı aynı maçı
  // iki kez döndürdüğünde olur; o durumda kayıt BELİRSİZ sayılır ve atlanır.
  const byPair = new Map();
  for (const row of rows) {
    const key = pairKey(row.homeTeam, row.awayTeam);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(row);
  }

  const updates = [];
  const ambiguous = [];
  let unchanged = 0;

  for (const round of fixtures.rounds) {
    for (const match of round.matches || []) {
      const candidates = byPair.get(pairKey(match.homeTeam, match.awayTeam)) || [];
      if (!candidates.length) continue;

      // Sağlayıcı hafta numarası veriyorsa onunla daralt.
      const scoped = candidates.filter((row) => row.round == null || Number(row.round) === Number(round.round));
      if (scoped.length !== 1) {
        if (scoped.length > 1) ambiguous.push(`${round.round}. hafta ${match.homeTeam}-${match.awayTeam}`);
        continue;
      }

      const row = scoped[0];
      const label = dateLabelFor(row.kickoff);
      if (match.kickoff === row.kickoff && match.venue === (row.venue || null)) {
        unchanged += 1;
        continue;
      }

      updates.push({
        round: round.round,
        match,
        kickoff: row.kickoff,
        dateLabel: label,
        venue: row.venue || null,
        day: istanbulDay(row.kickoff)
      });
    }
  }

  console.log(
    `Süper Lig fikstür tarihleri: ${updates.length} maça doğrulanmış başlama anı yazılacak ` +
    `(${unchanged} zaten güncel, ${ambiguous.length} belirsiz eşleşme atlandı).`
  );
  for (const update of updates) {
    console.log(`  ${update.round}. hafta  ${update.match.homeTeam} - ${update.match.awayTeam}  ->  ${update.dateLabel}`);
  }
  for (const item of ambiguous) {
    console.log(`  atlandı (belirsiz): ${item}`);
  }

  if (!updates.length) return;

  if (!APPLY) {
    console.log("Kuru koşu — --apply ile yazın.");
    return;
  }

  for (const update of updates) {
    update.match.kickoff = update.kickoff;
    update.match.dateLabel = update.dateLabel;
    if (update.venue) update.match.venue = update.venue;
    update.match.fixtureStatus = "confirmed-date";
  }

  // Hafta etiketi artık gerçek günlerden türetilir; "Tarih ve saat atamaları
  // bekleniyor" yalnızca gerçekten atanmamış haftalarda kalır.
  for (const round of fixtures.rounds) {
    const days = (round.matches || []).map((match) => match.kickoff).filter(Boolean).map(istanbulDay).sort();
    if (!days.length) continue;
    const first = new Date(`${days[0]}T12:00:00+03:00`);
    const last = new Date(`${days[days.length - 1]}T12:00:00+03:00`);
    const monthFirst = MONTHS[first.getUTCMonth()];
    const monthLast = MONTHS[last.getUTCMonth()];
    const year = last.getUTCFullYear();
    round.dateRange = days[0] === days[days.length - 1]
      ? `${first.getUTCDate()} ${monthFirst} ${year}`
      : monthFirst === monthLast
        ? `${first.getUTCDate()}-${last.getUTCDate()} ${monthLast} ${year}`
        : `${first.getUTCDate()} ${monthFirst} - ${last.getUTCDate()} ${monthLast} ${year}`;
  }

  const nowIso = new Date().toISOString();
  const allConfirmed = fixtures.rounds.every((round) => (round.matches || []).every((match) => Boolean(match.kickoff)));
  fixtures.fixtureStatus = allConfirmed ? "confirmed" : "partially-confirmed";
  fixtures.lastVerifiedAt = nowIso;
  fixtures.freshness = {
    ...(fixtures.freshness || {}),
    source: "TFF eşleşme listesi + doğrulanmış sağlayıcı takvimi",
    provider: "TFF + TheSportsDB",
    fetchedAt: nowIso,
    verifiedAt: nowIso,
    status: "verified"
  };

  atomicWrite(FIXTURES_PATH, fixtures);
  if (fs.existsSync(path.dirname(PUBLIC_FIXTURES_PATH))) atomicWrite(PUBLIC_FIXTURES_PATH, fixtures);
  console.log(`Yazıldı: ${path.relative(root, FIXTURES_PATH)}`);
}

main();
