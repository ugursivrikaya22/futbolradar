import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
for (const file of [
  "page.css",
  "app.js",
  "site.js",
  "site.webmanifest",
  "404.html",
  "index.html",
  "canli-skor.html",
  "bugunun-maclari.html",
  "haberler.html",
  "istatistik-merkezi.html"
]) {
  fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
for (const file of [
  "analyses.json",
  "competitions.json",
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
