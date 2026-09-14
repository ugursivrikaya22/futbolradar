#!/usr/bin/env node
/**
 * TAZELİK DEFTERİNİ GERÇEK SENKRON ZAMANLARINDAN TAZELER.
 *
 * `data/freshness.json` sayfalarda görünen "Son kontrol", "Fikstür durumu"
 * ve "Radar güveni" etiketlerini besliyor. Elle yazılmış bir defterdi ve
 * onu güncelleyen HİÇBİR otomatik adım yoktu: hat her saat kadroyu,
 * oyuncuları, maçları ve haberleri gerçekten tazeliyorken defterdeki
 * `validUntil` alanları çoktan geçmişti. Sonuç ters yönde yanıltıcıydı —
 * `freshnessService` süresi geçmiş kaydı "Güncelleme gerekli" diye
 * işaretliyor, yani okuyucuya taze veriyi bayat gibi gösteriyordu.
 *
 * Bu betik deftere BİR ŞEY UYDURMAZ. Her kaydın zamanını, o verinin
 * kendi dosyasında zaten duran senkron damgasından okur:
 *
 *   squads/players → data/players.json · lastProviderSeenAt (en yenisi)
 *   teamRadar      → data/teams.json   · lastStandingsSyncedAt (en yenisi)
 *   matches        → data/fixture-calendar.json · fetchedAt
 *   transfers      → data/transfers.json · lastVerifiedAt (en yenisi)
 *   news           → data/news-ticker.json · updatedAt
 *   fixtures       → data/super-lig-fixtures.json · freshness.verifiedAt
 *
 * Damga bulunamayan kayda dokunulmaz: eski değeri kalır ve süresi
 * geçmişse arayüz bunu doğru biçimde "güncelleme gerekli" olarak yazar.
 *
 * Kullanım:
 *   node scripts/refresh-freshness-ledger.mjs           # kuru koşu
 *   node scripts/refresh-freshness-ledger.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const LEDGER_PATH = path.join(root, "data", "freshness.json");
const APPLY = process.argv.includes("--apply");

/** Kayıt başına geçerlilik süresi (saat). Veri ne sıklıkla tazeleniyorsa o. */
const VALIDITY_HOURS = {
  matches: 24,
  squads: 24 * 7,
  players: 24 * 7,
  transfers: 24 * 7,
  news: 24,
  teamRadar: 24 * 7,
  // Süper Lig fikstür tarihleri yalnızca GÜNLÜK tam koşuda tazeleniyor
  // (`run-scheduled-update.mjs` → `full`), o yüzden geçerlilik de 24 saat.
  fixtures: 24
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

function latest(values) {
  const stamps = (values || [])
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return stamps.length ? new Date(Math.max(...stamps)).toISOString() : null;
}

function istanbulIso(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).formatToParts(parsed).map((part) => [part.type, part.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}+03:00`;
}

function collectStamps() {
  const players = readJson("data/players.json", []);
  const teams = readJson("data/teams.json", []);
  const calendar = readJson("data/fixture-calendar.json", {});
  const transfers = readJson("data/transfers.json", []);
  const ticker = readJson("data/news-ticker.json", {});
  const superLigFixtures = readJson("data/super-lig-fixtures.json", {});

  const playerStamp = latest(players.map((row) => row.lastProviderSeenAt || row.lastSyncedAt));

  // `teamRadar` BİLEREK LİSTEDE YOK. O kayıt sağlayıcı verisini değil,
  // FutbolRadar'ın sezon öncesi model referansını tanımlıyor
  // (`isFallback: true`, `confidence: "low"`). Puan durumu senkronunun
  // damgasını oraya yazmak, elle üretilmiş bir referansı sağlayıcı
  // doğrulamasıymış gibi göstermek olurdu. Model tazelendiğinde o kayıt
  // elle güncellenir.
  void teams;

  return {
    players: playerStamp,
    squads: playerStamp,
    matches: latest([calendar.fetchedAt]),
    transfers: latest(transfers.map((row) => row.lastVerifiedAt)),
    news: latest([ticker.updatedAt]),
    // `fixtures` KAYDI HİÇ BESLENMİYORDU ve 24 Temmuz 2026'da donmuştu;
    // `validUntil` 17 Ağustos'ta dolduğu için arayüz o kaydı süresiz
    // "güncelleme gerekli" gösteriyordu. Gerçek damga `sync-super-lig-
    // fixture-dates.mjs`'in yazdığı `freshness` bloğunda zaten duruyor —
    // burada uydurulmuyor, oradan okunuyor.
    fixtures: latest([
      superLigFixtures.freshness && superLigFixtures.freshness.verifiedAt,
      superLigFixtures.freshness && superLigFixtures.freshness.fetchedAt,
      superLigFixtures.lastVerifiedAt
    ])
  };
}

function main() {
  const ledger = readJson("data/freshness.json", null);
  if (!ledger || !ledger.records) {
    console.error("data/freshness.json okunamadı.");
    process.exitCode = 1;
    return;
  }

  const stamps = collectStamps();
  const updates = [];

  for (const [key, record] of Object.entries(ledger.records)) {
    const stamp = stamps[key];
    if (!stamp) continue;

    const iso = istanbulIso(stamp);
    const validUntil = istanbulIso(new Date(Date.parse(stamp) + (VALIDITY_HOURS[key] || 24) * 3600000).toISOString());
    if (record.fetchedAt === iso && record.verifiedAt === iso && record.validUntil === validUntil) continue;

    updates.push({ key, from: record.verifiedAt || record.fetchedAt, to: iso, validUntil });
    record.fetchedAt = iso;
    record.verifiedAt = iso;
    record.validUntil = validUntil;
    // Süresi dolmuş bir kayıt "stale" gösteriliyordu; gerçek senkron
    // damgasıyla tazelenen kayıt yeniden "verified" olur. Yalnızca
    // durum alanı düzeltilir, güven seviyesi olduğu gibi bırakılır.
    if (record.status === "stale") record.status = "verified";
  }

  if (!updates.length) {
    console.log("Tazelik defteri zaten güncel.");
    return;
  }

  console.log(`Tazelik defteri: ${updates.length} kayıt gerçek senkron damgasıyla güncellendi.`);
  for (const update of updates) {
    console.log(`  ${update.key.padEnd(12)} ${update.from || "—"}  ->  ${update.to}   (geçerlilik ${update.validUntil})`);
  }

  if (!APPLY) {
    console.log("Kuru koşu — --apply ile yazın.");
    return;
  }

  ledger.generatedAt = istanbulIso(new Date().toISOString());
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  console.log(`Yazıldı: ${path.relative(root, LEDGER_PATH)}`);
}

main();
