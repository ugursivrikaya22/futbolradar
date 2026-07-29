/**
 * Biten maçların istatistik/olay/kadro dökümünü sağlayıcıdan çekip
 * data/matches.json'a işler. Maç raporları bu veriden üretildiği için
 * rapor kalitesi doğrudan bu adıma bağlıdır.
 *
 * Birleştirme kuralı sitenin geri kalanıyla aynı: kürasyonlu (elle
 * doğrulanmış) alanlar sağlayıcı verisiyle EZİLMEZ. Sağlayıcı yalnızca
 *   - boş olan istatistik/olay/kadro listelerini doldurur,
 *   - maç durumunu ileri taşır (SCHEDULED/LIVE -> FINISHED),
 *   - doğrulanmış skor yoksa skoru yazar.
 * Böylece bir sağlayıcı hatası, elle doğrulanmış veriyi bozamaz.
 *
 * Kimlik bilgisi yoksa script temiz şekilde no-op olur; altyapı yerinde
 * kalır ve APIFOOTBALL_API_KEY tanımlandığı anda devreye girer.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");

const { selectSyncTargets, mergeProviderDetail } = require("../services/matchResultSyncService.js");
const { API_FOOTBALL, providerIdFor } = require("../services/providerIdentityService.js");
const { recordSnapshot } = require("../services/liveSnapshotService.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const PUBLIC_MATCHES_PATH = path.join(root, "public", "data", "matches.json");
const SNAPSHOTS_PATH = path.join(root, "data", "live-snapshots.json");
const MAX_TARGETS_PER_RUN = 12;

function parseArgs(argv) {
  const args = { apply: false, now: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--now=")) args.now = raw.slice("--now=".length);
  }
  return args;
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = args.now ? new Date(args.now).getTime() : Date.now();
  const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));
  const targets = selectSyncTargets(matches, now);

  if (!targets.length) {
    console.log("Sync edilecek maç yok: tüm biten maçların dökümü mevcut.");
    return;
  }

  const withoutId = targets.filter((entry) => entry.skipped);
  const actionable = targets.filter((entry) => !entry.skipped).slice(0, MAX_TARGETS_PER_RUN);

  console.log(`Aday maç: ${targets.length} (sorgulanabilir ${actionable.length}, providerId eksik ${withoutId.length})`);
  withoutId.forEach((entry) => console.log(`  - atlandı: ${entry.match.id} (${entry.skipped}; ${entry.reason})`));

  if (!apiFootballProvider.hasConfig()) {
    console.log(
      "Canlı sağlayıcı yapılandırılmadı (APIFOOTBALL_API_KEY yok). Senkron altyapısı hazır; " +
      "kimlik bilgisi tanımlandığında bu adım otomatik çalışacak. Şimdilik değişiklik yapılmadı."
    );
    actionable.forEach((entry) => console.log(`  - beklemede: ${entry.match.id} (${entry.reason})`));
    return;
  }

  const timestamp = new Date(now).toISOString();
  let updated = 0;
  let snapshotsRecorded = 0;
  const nextMatches = [...matches];

  // Ölçülmüş momentumun kaynağı: oynanan maçın kümülatif istatistiklerinden
  // beş dakikalık kova başına bir anlık görüntü. Depo yalnızca eklemelidir;
  // servis aynı kovaya ikinci yazımı kendisi reddeder (idempotent döngü).
  const snapshotStore = fs.existsSync(SNAPSHOTS_PATH)
    ? JSON.parse(fs.readFileSync(SNAPSHOTS_PATH, "utf8"))
    : {};

  for (const entry of actionable) {
    const { match, reason } = entry;
    let detail = null;
    try {
      detail = await apiFootballProvider.getMatchDetail({ fixtureId: providerIdFor(match, API_FOOTBALL) });
    } catch (error) {
      console.log(`  ! ${match.id}: sağlayıcı hatası (${error.code || error.message}) — kayıt değişmedi`);
      continue;
    }

    if (!detail) {
      console.log(`  ! ${match.id}: sağlayıcı boş yanıt döndü — kayıt değişmedi`);
      continue;
    }

    // Maç hâlâ oynanıyorsa (LIVE/HALFTIME) ölçüm anı kaydedilir. Bitmiş maç
    // için görüntü alınmaz: kümülatif son değerler momentumu temsil etmez.
    if (["LIVE", "HALFTIME"].includes(String(detail.status || "").toUpperCase())) {
      if (recordSnapshot(snapshotStore, match, detail, timestamp)) {
        snapshotsRecorded += 1;
        console.log(`  ~ ${match.id}: canlı anlık görüntü kaydedildi (dk ${detail.minute})`);
      }
    }

    const merged = mergeProviderDetail(match, detail, timestamp);
    if (!merged) {
      console.log(`  = ${match.id}: eklenecek yeni veri yok`);
      continue;
    }

    const index = nextMatches.findIndex((row) => row.id === match.id);
    nextMatches[index] = merged.record;
    updated += 1;
    console.log(`  + ${match.id} (${reason}) -> ${merged.changes.join(", ")}`);
  }

  if (!updated && !snapshotsRecorded) {
    console.log("Uygulanacak değişiklik yok.");
    return;
  }

  if (!args.apply) {
    console.log(`\n${updated} maç güncellenecek, ${snapshotsRecorded} anlık görüntü yazılacak. Yazmak için --apply ile çalıştır.`);
    return;
  }

  // Anlık görüntüler kürasyonlu kayıttan bağımsız yazılır: canlı bir maçta
  // henüz birleştirilecek kürasyon farkı olmasa da ölçüm kaybedilmemeli.
  if (snapshotsRecorded) {
    atomicWrite(SNAPSHOTS_PATH, snapshotStore);
    console.log(`${snapshotsRecorded} canlı anlık görüntü data/live-snapshots.json dosyasına yazıldı.`);
  }

  if (updated) {
    atomicWrite(MATCHES_PATH, nextMatches);
    if (fs.existsSync(path.dirname(PUBLIC_MATCHES_PATH))) {
      atomicWrite(PUBLIC_MATCHES_PATH, nextMatches);
    }
    console.log(`\n${updated} maç güncellendi ve data/matches.json yazıldı.`);
  }
}

main().catch((error) => {
  console.error("sync-match-results başarısız:", error.message);
  process.exitCode = 1;
});
