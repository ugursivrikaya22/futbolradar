#!/usr/bin/env node
/**
 * TARAYICIYA GİDEN MAÇ MERKEZİ ÇEKİRDEĞİ.
 *
 * `services/matchHub.js` hem Node'da (testler) hem tarayıcıda çalışacak
 * biçimde (UMD) yazıldı. Aynı kararları istemci için İKİNCİ KEZ yazmak —
 * hangi olay VAR kaydıdır, hangi istatistik çizilebilir, bu skorla tablo
 * nasıl değişir — testlerin doğruladığı kuralla okuyucunun gördüğü ekranın
 * zamanla ayrışması demekti.
 *
 * Bu yüzden istemci kopyası elle yazılmıyor, bu betik tarafından kaynağın
 * kendisinden üretiliyor. `--check` ile çalıştırıldığında dosyayı yazmaz,
 * yalnızca diskteki kopyanın güncel olup olmadığını söyler; derleme zinciri
 * ve `scripts/test-match-hub.mjs` bu kapıyı kullanıyor.
 *
 * Eşi: `scripts/build-live-standings-client.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SOURCE = path.join(root, "services", "matchHub.js");
const OUTPUTS = [path.join(root, "match-hub-core.js"), path.join(root, "public", "match-hub-core.js")];

const banner = "/* ÜRETİLMİŞ DOSYA — kaynak: services/matchHub.js. Elle düzenlemeyin;\n" +
  "   `node scripts/build-match-hub-client.mjs` ile yeniden üretilir. */\n";

const bundle = `${banner}${fs.readFileSync(SOURCE, "utf8")}`;

if (process.argv.includes("--check")) {
  const stale = OUTPUTS.filter((file) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== bundle);
  if (stale.length) {
    console.error(`[match-hub-client] istemci kopyası güncel değil: ${stale.map((file) => path.relative(root, file)).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[match-hub-client] istemci kopyası güncel.");
  }
} else {
  for (const file of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle, "utf8");
  }
  console.log(`[match-hub-client] çekirdek ${OUTPUTS.length} konuma yazıldı (${bundle.length} bayt).`);
}
