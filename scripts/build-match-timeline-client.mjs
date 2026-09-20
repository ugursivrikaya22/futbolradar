#!/usr/bin/env node
/**
 * TARAYICIYA GİDEN MAÇ ANLATIMI ÇEKİRDEĞİ.
 *
 * `services/matchTimeline.js` hem Node'da (testler, derleme anındaki SSR)
 * hem tarayıcıda (`match-center.js`) çalışacak biçimde (UMD) yazıldı. Aynı
 * kararları istemci için İKİNCİ KEZ yazmak — hangi kayıt gol, hangi olay
 * "önemli", koşan skor yazılabilir mi — testlerin doğruladığı kuralla
 * okuyucunun maç sürerken gördüğü ekranın ayrışması demekti.
 *
 * Bu yüzden istemci kopyası elle yazılmıyor, bu betik tarafından kaynağın
 * kendisinden üretiliyor. `--check` ile çalıştırıldığında dosyayı yazmaz,
 * yalnızca diskteki kopyanın güncel olup olmadığını söyler; son işlem
 * zinciri ve `scripts/test-match-timeline.mjs` bu kapıyı kullanıyor.
 *
 * Eşi: `scripts/build-match-hub-client.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SOURCE = path.join(root, "services", "matchTimeline.js");
const OUTPUTS = [path.join(root, "match-timeline.js"), path.join(root, "public", "match-timeline.js")];

const banner = "/* ÜRETİLMİŞ DOSYA — kaynak: services/matchTimeline.js. Elle düzenlemeyin;\n" +
  "   `node scripts/build-match-timeline-client.mjs` ile yeniden üretilir. */\n";

const bundle = `${banner}${fs.readFileSync(SOURCE, "utf8")}`;

if (process.argv.includes("--check")) {
  const stale = OUTPUTS.filter((file) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== bundle);
  if (stale.length) {
    console.error(`[match-timeline-client] istemci kopyası güncel değil: ${stale.map((file) => path.relative(root, file)).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[match-timeline-client] istemci kopyası güncel.");
  }
} else {
  for (const file of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle, "utf8");
  }
  console.log(`[match-timeline-client] çekirdek ${OUTPUTS.length} konuma yazıldı (${bundle.length} bayt).`);
}
