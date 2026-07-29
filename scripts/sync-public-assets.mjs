/**
 * PUBLIC KOPYALARI KÖKÜ İZLER.
 *
 * Sayfa listesi elle tutuluyordu ve 20 dosyada kalmıştı; sonradan eklenen
 * ya da elle düzenlenen her sayfa (haftanin-maclari, analizler,
 * takim-trendleri, gol-kralligi …) public tarafında ESKİ hâliyle kalıyordu.
 * İki kopya sessizce ayrışıyor ve hangisinin doğru olduğu görünmüyordu —
 * lig adı güncellendiğinde kökte "Trendyol Süper Lig", public'te "Süper Lig"
 * yazıyordu.
 *
 * Artık kökteki HTML dosyalarının tamamı taranıyor. Liste bakımı gerekmiyor,
 * dolayısıyla geride kalması da mümkün değil.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");

const STATIC_ASSETS = ["page.css", "app.js", "site.js", "site.webmanifest"];
const rootPages = fs.readdirSync(root).filter((file) => file.endsWith(".html"));

fs.mkdirSync(publicDir, { recursive: true });
for (const file of [...STATIC_ASSETS, ...rootPages]) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(publicDir, file));
}
for (const file of [
  "analyses.json",
  "competitions.json",
  "fixture-calendar.json",
  "match-analyses.json",
  "matches.json",
  "momentum.json",
  "news.json",
  "players.json",
  "signals.json",
  "super-lig-fixtures.json",
  "teams.json",
  "transfers.json"
]) {
  fs.copyFileSync(path.join(root, "data", file), path.join(publicDir, "data", file));
}
console.log("Synced public assets");
