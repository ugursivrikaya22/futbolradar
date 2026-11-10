/**
 * Ana sayfadaki Son dakika yuvasını data/ticker-news.json'dan doldurur.
 * Tam site derlemesi çalıştırmaz ve dış API çağırmaz. Saatlik derleme
 * aynı işi scripts/prerender-core-pages.mjs içinden de yapar.
 */
import fs from "node:fs";
import path from "node:path";
import { sonDakikaTickerHtml } from "./lib/sonDakikaTicker.mjs";

const root = process.cwd();
const start = "<!-- prerender:son-dakika-ticker:start -->";
const end = "<!-- prerender:son-dakika-ticker:end -->";
const content = sonDakikaTickerHtml({ base: "./" });
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const expression = new RegExp(`${escape(start)}[\\s\\S]*?${escape(end)}`);
const wrapped = `${start}\n${content}\n${end}`;

for (const rel of ["index.html", "public/index.html"]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  if (!expression.test(html)) {
    console.warn(`[son-dakika] yuva yok, atlandı: ${rel}`);
    continue;
  }
  fs.writeFileSync(file, html.replace(expression, wrapped));
  console.log(`[son-dakika] ${rel} güncellendi (${content ? "bant basıldı" : "bant gizli"}).`);
}
