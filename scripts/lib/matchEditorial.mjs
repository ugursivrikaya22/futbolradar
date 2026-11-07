/** Source-keyed editorial notes on the EXISTING permanent match URL. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function readMatchEditorial(root, entry) {
  const file = path.join(root, "data/match-editorials", `${entry.slug}.json`);
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.slug !== entry.slug || String(entry.providerIds?.apiFootball) !== data.fixtureId) throw new Error("Editorial fixture identity mismatch");
  for (const s of Object.values(data.sources)) {
    if (!isAllowedSourceUrl(s.url) || /wikipedia|thesportsdb/i.test(s.url)) throw new Error(`Invalid editorial source: ${s.url}`);
  }
  for (const fact of [...data.facts, data.recentHome]) {
    if (!data.sources[fact.source]) throw new Error(`Missing editorial source: ${fact.source}`);
  }
  return data;
}
export function matchEditorialHtml(data) {
  if (!data) return "";
  const cite = (key) => {
    const s = data.sources[key];
    return `<a href="${esc(s.url)}" rel="nofollow noopener noreferrer" target="_blank">${esc(s.name)}</a>`;
  };
  const matches = data.recentHome.matches;
  const totals = matches.reduce((a, m) => {
    const [gf, ga] = m.score.split("-").map(Number);
    if (!Number.isInteger(gf) || !Number.isInteger(ga)) throw new Error("Invalid editorial score");
    return { wins: a.wins + Number(gf > ga), gf: a.gf + gf, ga: a.ga + ga };
  }, { wins: 0, gf: 0, ga: 0 });
  return `<section class="msp-section" id="mac-oncesi-notlar" aria-labelledby="editorial-title"><h2 id="editorial-title" class="msp-section-title">Galatasaray - Amedspor: doğrulanmış maç öncesi notları</h2>
<p class="muted-copy">Maç öncesi bilgi notu · ${esc(data.updatedAt)} · Saatler TSİ (Europe/Istanbul).</p>
${data.facts.map(f => `<h3>${esc(f.heading)}</h3><p>${esc(f.text)} <small>Kaynak: ${cite(f.source)}</small></p>`).join("\n")}
<h3>Galatasaray’ın son 5 resmî maçı</h3><p>Lig ve Avrupa kupaları birlikte: ${totals.wins} galibiyet, ${totals.gf} gol atıp ${totals.ga} gol yeme. Skorlar Galatasaray açısından verilmiştir. <small>Kaynak: ${cite(data.recentHome.source)}</small></p>
<ul>${matches.map(m => `<li>${esc(m.opponent)}: ${esc(m.score)} — ${cite(data.recentHome.source)}</li>`).join("")}</ul>
<p>Puan durumu aşağıdaki mevcut lig tablosundan alınır. <a href="https://www.api-football.com/" rel="nofollow noopener noreferrer" target="_blank">Veri: API-Football</a>. Galatasaray ve Amedspor’un sırası ve puanı bu tablodadır.</p>
</section>`;
}
