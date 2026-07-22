import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { featureFlags } = require("../services/featureFlags.js");
const domain = "https://www.futbolradar.com";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function write(relativePath, content) {
  for (const base of [root, path.join(root, "public")]) {
    const destination = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, "utf8");
  }
}

function removeGenerated(relativePath) {
  for (const base of [root, path.join(root, "public")]) {
    const destination = path.join(base, relativePath);
    if (fs.existsSync(destination)) fs.unlinkSync(destination);
  }
}

if (!featureFlags().widgets) {
  removeGenerated("widgets/gunun-maclari.html");
  removeGenerated("widgets/turk-takimlari-avrupada.html");
  console.log("Widget publishing disabled by FEATURE_WIDGETS");
  process.exit(0);
}

function widgetHtml({ id, title, description, turkishOnly }) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${title} | FutbolRadar Widget</title><meta name="description" content="${description}" /><meta name="robots" content="noindex,nofollow" /><link rel="canonical" href="${domain}/widgets/${id}.html" /><link rel="stylesheet" href="../page.css" /></head><body class="widget-page" data-match-date="${today}"${turkishOnly ? ' data-match-turkish="true"' : ""}><main class="widget-shell"><header class="widget-header"><a href="${domain}/maclar/${today}/" target="_blank" rel="noopener noreferrer"><span class="brand-mark">FR</span><strong>FutbolRadar</strong></a><span>${title}</span></header><section class="widget-match-list" data-api-section="today-matches" data-api-target="matches-page" data-static-fallback="true" aria-live="polite"><article class="data-empty compact"><strong>Program kontrol ediliyor</strong><span>Doğrulanmış maç kayıtları kısa süre içinde gösterilecek.</span></article></section><footer class="widget-footer"><span data-match-data-status>Program kontrol ediliyor</span><a href="${domain}/maclar/${today}/" target="_blank" rel="noopener noreferrer">FutbolRadar'da aç</a></footer></main><script src="../widget.js" defer></script><script src="../app.js" defer></script></body></html>`;
}

write("widgets/gunun-maclari.html", widgetHtml({
  id: "gunun-maclari",
  title: "Günün Maçları",
  description: "Günün doğrulanmış futbol maçları, saatleri ve skor durumu.",
  turkishOnly: false
}));
write("widgets/turk-takimlari-avrupada.html", widgetHtml({
  id: "turk-takimlari-avrupada",
  title: "Türk Takımları Avrupa'da",
  description: "Türk takımlarının doğrulanmış UEFA maçları ve skor durumu.",
  turkishOnly: true
}));

console.log("Generated 2 embeddable match widgets");
