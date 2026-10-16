#!/usr/bin/env node
/**
 * SIK KULLANILAN SAYFALAR ŞERİDİ — her hedef sayfada tek blok, kırık bağlantı yok,
 * kendine bağlantı yok, yeniden çalıştırmak çıktıyı değiştirmez, JavaScript/form yok.
 */
import fs from "node:fs";
import path from "node:path";
import { injectQuickLinks, quickLinksBlock, QUICK_LINK_PAGES } from "./inject-quick-links.mjs";

const root = process.cwd();
let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

for (const page of QUICK_LINK_PAGES) {
  const html = fs.readFileSync(path.join(root, page), "utf8");
  const blocks = html.match(/<!-- quick-links:start -->/g) || [];
  check(blocks.length === 1, `${page}: tek şerit bloğu`);
  const block = (/<!-- quick-links:start -->([\s\S]*?)<!-- quick-links:end -->/.exec(html) || [])[1] || "";
  const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  check(hrefs.length >= 8, `${page}: ${hrefs.length} bağlantı`);
  const missing = hrefs.filter((href) => {
    const target = href.replace(/^\.\//, "").replace(/[?#].*$/, "");
    return !fs.existsSync(path.join(root, target.endsWith(".html") ? target : `${target}.html`));
  });
  check(missing.length === 0, `${page}: bağlantıların hepsi var olan sayfaya gidiyor${missing.length ? " (" + missing.join(", ") + ")" : ""}`);
  check(!hrefs.some((href) => href.replace(/^\.\//, "") === page), `${page}: kendine bağlantı yok`);
  check(!/<script|<form|<button|popup|modal/i.test(block), `${page}: şerit düz bağlantıdan ibaret (script/form/pencere yok)`);
  check(injectQuickLinks(html, page) === html, `${page}: yeniden çalıştırmak çıktıyı değiştirmiyor`);
  check(html.indexOf("quick-links:start") < html.indexOf("<footer"), `${page}: şerit altlığın üstünde`);
}

check(quickLinksBlock("x.html", () => false) === "", "hiçbir hedef yoksa blok yazılmaz");
if (failures) { console.error(`quick-links: ${failures} hata`); process.exit(1); }
console.log("quick-links: tamam");
