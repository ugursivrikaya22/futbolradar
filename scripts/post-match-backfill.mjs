/**
 * MAÇ SONU 96 SAATLİK KAPSAYICI — kayan pencere geri doldurma / günlük kapanış.
 *
 * Ne yapar:
 *   1. Pencereyi HER KOŞUDA şimdiden geriye hesaplar (sabit tarih yok).
 *   2. Kürasyon (data/matches.json) + sağlayıcı takvimi (fixture-calendar)
 *      içinde pencerede TAMAMLANMIŞ her maçı sayar.
 *   3. Kürasyonda karşılığı olmayan tamamlanmış takvim maçlarını asgari
 *      sağlayıcı kaydı olarak matches.json'a terfi ettirir (idempotent;
 *      mevcut kayıtlara asla dokunmaz).
 *   4. Yapılandırılmış bir yürütme raporu basar (pencere, keşif, terfi,
 *      atlananlar ve gerekçeleri, sağlayıcı çağrı sayacı).
 *
 * Ne YAPMAZ:
 *   - API-Football çağrısı yapmaz. Olay/istatistik zenginleştirmesi bu
 *     deponun TEK yazma yolundan geçer (enrich-post-match --apply, korumalı
 *     manuel iş akışı). Bu betik o kapıyı BİLEREK açmaz; anahtar varsa
 *     yalnızca kuru koşu değerlendirmesini raporlar.
 *   - Rapor sayfası yazmaz; sayfalar mevcut üreticide (generate-post-match-
 *     pages) tek yoldan üretilir. CI sırası: takvim senkronu → bu betik →
 *     sayfa üretimi.
 *
 * Kullanım:
 *   node scripts/post-match-backfill.mjs                # kuru koşu
 *   node scripts/post-match-backfill.mjs --apply        # terfileri yaz
 *   node scripts/post-match-backfill.mjs --window-hours=96 --now=ISO  # test
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  WINDOW_HOURS_DEFAULT,
  windowFor,
  isEligible,
  promoteCalendarFixtures,
  buildExecutionReport
} = require("../services/postMatchBackfillService.js");
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const PUBLIC_MATCHES_PATH = path.join(root, "public", "data", "matches.json");
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");

function parseArgs(argv) {
  const args = { apply: false, now: null, windowHours: WINDOW_HOURS_DEFAULT };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--now=")) args.now = raw.slice("--now=".length);
    else if (raw.startsWith("--window-hours=")) args.windowHours = Number(raw.slice("--window-hours=".length)) || WINDOW_HOURS_DEFAULT;
  }
  return args;
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const nowMs = args.now ? Date.parse(args.now) : Date.now();
  if (!Number.isFinite(nowMs)) {
    console.error(`Geçersiz --now değeri: ${args.now}`);
    process.exitCode = 1;
    return;
  }
  const nowIso = new Date(nowMs).toISOString();
  const window = windowFor(nowMs, args.windowHours);

  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));
  const calendar = fs.existsSync(CALENDAR_PATH)
    ? JSON.parse(fs.readFileSync(CALENDAR_PATH, "utf8"))
    : { matches: [] };
  const calendarMatches = Array.isArray(calendar.matches) ? calendar.matches : [];

  const promotion = promoteCalendarFixtures(matches, calendarMatches, window, nowIso);

  const notes = [];
  // Sağlayıcı kota koruması: bu betik API-Football'a HİÇ istek atmaz.
  // Zenginleştirme tek yazma kapısından geçer; anahtar durumu yalnızca
  // raporlanır ki koşu özeti "neden ayrıntı yok" sorusunu yanıtlasın.
  if (apiFootballProvider.hasConfig()) {
    notes.push("APIFOOTBALL_API_KEY tanımlı: olay/istatistik zenginleştirmesi korumalı 'enrich:post-match --apply' kapısından çalıştırılabilir.");
  } else {
    notes.push("APIFOOTBALL_API_KEY tanımlı değil: terfi eden kayıtlar skor+künye seviyesinde kalır; rapor sayfaları bunu 'Skor Özeti' olarak etiketler ve dizine kapatır.");
  }

  const report = buildExecutionReport({
    window,
    curated: matches,
    calendar: calendarMatches.filter((fixture) => isEligible(fixture, window)),
    promotion,
    providerCalls: { used: 0, cacheHits: 0, batches: 0, remaining: null },
    notes
  });

  console.log("Maç sonu 96 saatlik kapsayıcı — yürütme raporu:");
  console.log(JSON.stringify(report, null, 2));

  if (!promotion.additions.length) {
    console.log("\nTerfi edilecek takvim maçı yok; kürasyon penceredeki her tamamlanmış maçı zaten kapsıyor.");
    return;
  }

  if (!args.apply) {
    console.log(`\nKuru koşu: ${promotion.additions.length} kayıt terfi edilecekti. Yazmak için --apply ekleyin.`);
    return;
  }

  const next = [...promotion.additions, ...matches];
  atomicWrite(MATCHES_PATH, next);
  if (fs.existsSync(path.dirname(PUBLIC_MATCHES_PATH))) {
    atomicWrite(PUBLIC_MATCHES_PATH, next);
  }
  console.log(`\n${promotion.additions.length} kayıt data/matches.json'a terfi ettirildi. Rapor sayfaları bir sonraki üretim adımında oluşur.`);
}

main();
