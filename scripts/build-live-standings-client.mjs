#!/usr/bin/env node
/**
 * TARAYICIYA GİDEN CANLI PUAN DURUMU ÇEKİRDEĞİ.
 *
 * `services/liveStandings.js` hem Node'da hem tarayıcıda çalışacak biçimde
 * (UMD) yazıldı. Aynı aritmetiği istemci için İKİNCİ KEZ yazmak, testlerin
 * doğruladığı kuralla kullanıcının gördüğü tablonun zamanla ayrışması
 * demekti — puan tablosu gibi bir yerde bu sessiz bir yanlışlık üretir.
 *
 * Bu yüzden istemci kopyası elle yazılmıyor, bu betik tarafından kaynağın
 * kendisinden üretiliyor. `--check` ile çalıştırıldığında dosyayı yazmaz,
 * yalnızca diskteki kopyanın güncel olup olmadığını söyler; derleme
 * zinciri ve `scripts/test-live-standings.mjs` bu kapıyı kullanıyor.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SOURCE = path.join(root, "services", "liveStandings.js");
const OUTPUTS = [path.join(root, "live-standings-core.js"), path.join(root, "public", "live-standings-core.js")];

const banner = "/* ÜRETİLMİŞ DOSYA — kaynak: services/liveStandings.js. Elle düzenlemeyin;\n" +
  "   `node scripts/build-live-standings-client.mjs` ile yeniden üretilir. */\n";

const bundle = `${banner}${fs.readFileSync(SOURCE, "utf8")}`;

if (process.argv.includes("--check")) {
  const stale = OUTPUTS.filter((file) => !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== bundle);
  if (stale.length) {
    console.error(`[live-standings-client] istemci kopyası güncel değil: ${stale.map((file) => path.relative(root, file)).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log("[live-standings-client] istemci kopyası güncel.");
  }
} else {
  for (const file of OUTPUTS) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle, "utf8");
  }
  console.log(`[live-standings-client] çekirdek ${OUTPUTS.length} konuma yazıldı (${bundle.length} bayt).`);
}
