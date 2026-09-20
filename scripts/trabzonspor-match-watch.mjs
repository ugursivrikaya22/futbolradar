#!/usr/bin/env node
/**
 * MAÇ GÖZCÜSÜ — "ŞİMDİ İZLEMEYE DEĞER Mİ?" SORUSUNU CEVAPLAR.
 *
 * ── NEDEN VAR: BEŞ DAKİKALIK CRON PAHALIYDI ─────────────────────────────
 *
 * İlk sürüm maç saatlerini kapsayan pencerede beş dakikada bir koşuyordu:
 * günde 144 iş. GitHub her işi EN AZ BİR DAKİKADAN faturalandırıyor, yani
 * hiçbir maç olmayan günlerde bile ayda binlerce dakika. Bu depo private
 * olduğu için o dakikalar doğrudan plan kotasından düşüyor ve kota bittiği
 * anda BÜTÜN iş akışları duruyor — tam olarak 19 Eylül akşamı yaşanan şey.
 *
 * Çözüm, sıklığı düşürmek değil, SIKLIĞI MAÇA BAĞLAMAK: saatte bir çalışan
 * ucuz bir gözcü, ortada biten bir maç yoksa saniyeler içinde "izleme" der
 * ve çıkar. Yalnızca gerçekten bir Trabzonspor maçı bitmek üzereyken
 * dakikalık yoklama başlar.
 *
 * ── ÇIKTI ──────────────────────────────────────────────────────────────
 *
 * GitHub Actions çıktıları olarak (GITHUB_OUTPUT):
 *   watch=true|false   yoklama yapılsın mı
 *   match=<id>         hangi maç
 *   polls=<n>          en fazla kaç kez yoklanacak (60 saniye aralıkla)
 *   reason=<metin>     kararın gerekçesi (günlüğe de basılır)
 *
 * Çıkış kodu HER ZAMAN 0: "izlenecek maç yok" bir hata değil, normal gün.
 *
 * Kullanım:
 *   node scripts/trabzonspor-match-watch.mjs --plan
 *   node scripts/trabzonspor-match-watch.mjs --plan --now=2026-09-19T20:00:00Z
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isTrabzonspor, normalize, isFinishedMatch } = require("../services/trabzonsporMatchColumn.js");

/**
 * Bir maçın bitmesi beklenen en erken ve en geç an (dakika, ilk düdükten).
 *
 * 80: devre arası dahil en erken bitiş yakını — bundan önce yoklamak boşa
 *     istek. 150: uzatma dakikaları, VAR duraksamaları ve sağlayıcının
 *     kaydı FT'ye çevirme gecikmesi için tavan.
 */
const WATCH_FROM_MINUTES = 80;
const WATCH_UNTIL_MINUTES = 150;

/** Bitmiş ama henüz yazısı çıkmamış maç için geriye bakma penceresi. */
const CATCHUP_HOURS = 6;

/** Yoklama aralığı ve iş başına tavan (dakika). */
const POLL_INTERVAL_SECONDS = 60;
const MAX_POLLS = 45;

function parseArgs(argv) {
  const args = { now: null };
  for (const raw of argv) {
    if (raw.startsWith("--now=")) args.now = raw.slice("--now=".length);
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/** Bu maçın yayımlanmış bir analizi zaten var mı? */
function alreadyPublished(matchId) {
  const store = readJson(path.join(root, "data", "columns.json"), { columns: [] });
  return (store.columns || []).some((entry) =>
    entry
    && entry.status === "published"
    && entry.generated
    && entry.generated.matchId === matchId);
}

function emit(outputs) {
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  for (const line of lines) console.log(`[watch] ${line}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  }
}

const args = parseArgs(process.argv.slice(2));
const now = args.now ? new Date(args.now) : new Date();
const nowMs = now.getTime();

const candidates = curatedMatches()
  .filter((match) => match && (isTrabzonspor(match.homeTeam) || isTrabzonspor(match.awayTeam)))
  // Altyapı maçı A takım maçı sanılmasın.
  .filter((match) => !/\bu(1[4-9]|2[0-3])\b/.test(normalize(`${match.id} ${match.homeTeam} ${match.awayTeam}`)))
  .map((match) => ({ match, kickoff: Date.parse(match.kickoff || "") }))
  .filter((row) => Number.isFinite(row.kickoff))
  .sort((left, right) => right.kickoff - left.kickoff);

const minutesSince = (kickoff) => Math.floor((nowMs - kickoff) / 60000);

// 1) BİTMİŞ AMA YAZISI ÇIKMAMIŞ MAÇ. Kaçırılan bir maç sessizce kaybolmasın:
//    koşucular düştüğü ya da veri geç geldiği için atlanan maç, pencere
//    içinde bir sonraki saatlik gözcüde yakalanır.
for (const { match, kickoff } of candidates) {
  const age = minutesSince(kickoff);
  if (age < 0 || age > CATCHUP_HOURS * 60) continue;
  if (!isFinishedMatch(match)) continue;
  if (alreadyPublished(match.id)) continue;
  emit({
    watch: "true",
    match: match.id,
    polls: "1",
    reason: `bitmis-yazisiz-mac (${age} dk once bitti)`
  });
  process.exit(0);
}

// 2) BİTMEK ÜZERE OLAN MAÇ. Yoklama penceresi ilk düdükten 80-150 dakika.
for (const { match, kickoff } of candidates) {
  const age = minutesSince(kickoff);
  if (age < WATCH_FROM_MINUTES || age > WATCH_UNTIL_MINUTES) continue;
  if (alreadyPublished(match.id)) continue;
  const remaining = Math.max(1, Math.min(MAX_POLLS, WATCH_UNTIL_MINUTES - age));
  emit({
    watch: "true",
    match: match.id,
    polls: String(remaining),
    reason: `mac-bitmek-uzere (${age}. dakika, ${remaining} yoklama)`
  });
  process.exit(0);
}

// 3) YAKINDA BAŞLAYACAK/DEVAM EDEN AMA HENÜZ ERKEN. Bir sonraki saatlik
//    gözcü yakalar; şimdi yoklamak boşa dakika harcamak olurdu.
const upcoming = candidates.find(({ kickoff }) => {
  const age = minutesSince(kickoff);
  return age >= 0 && age < WATCH_FROM_MINUTES;
});

emit({
  watch: "false",
  match: upcoming ? upcoming.match.id : "",
  polls: "0",
  reason: upcoming
    ? `mac-devam-ediyor (${minutesSince(upcoming.kickoff)}. dakika; yoklama ${WATCH_FROM_MINUTES}. dakikada baslar)`
    : "izlenecek-mac-yok"
});
process.exit(0);
