/**
 * FIFA/Coca-Cola erkek dünya sıralaması — TEK KAYNAK: data/fifa-men-world-ranking.json.
 * Tam derleme (generate-trend-seo-pages.mjs) ve son-işlem zinciri
 * (inject-fifa-men-ranking.mjs) bu bloğu kullanır. API çağrısı yok.
 * Ülke adı, FIFA listesindeki resmî addır.
 */
import fs from "node:fs";
import path from "node:path";

export const FIFA_BLOCK_START = "<!--fifa-men-ranking:start-->";
export const FIFA_BLOCK_END = "<!--fifa-men-ranking:end-->";

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function readFifaMenRanking(root) {
  const file = path.join(root, "data", "fifa-men-world-ranking.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.rows) || !data.rows.length || !data.asOf) return null;
  return data;
}

function formatAsOf(data) {
  if (data.asOfLabel) return data.asOfLabel;
  const d = new Date(`${data.asOf}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(d);
}

function points(n) {
  return typeof n === "number" ? n.toFixed(2).replace(".", ",") : "—";
}

function change(n) {
  if (typeof n !== "number") return "—";
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

export function renderFifaMenRankingBlock(data, { limit = 20 } = {}) {
  if (!data) return `${FIFA_BLOCK_START}${FIFA_BLOCK_END}`;
  const tur = data.rows.find((r) => r.countryCode === "TUR");
  const asOf = formatAsOf(data);
  const rows = data.rows.filter((r) => r.rank <= limit || r.countryCode === "TUR");
  const table = rows.map((r) => `<div class="trend-table-row${r.countryCode === "TUR" ? " is-highlight" : ""}"><span>${esc(r.rank)}</span><span>${esc(r.country)}</span><span>${points(r.points)}</span><span>${change(r.rankChange)}</span></div>`).join("");
  const summary = tur
    ? `<p class="uefa-tr-summary"><strong>Türkiye ${esc(tur.rank)}. sırada, ${points(tur.points)} puan</strong> (${change(tur.rankChange)} sıra, FIFA, ${esc(asOf)}).</p>`
    : "";
  const next = data.nextUpdateLabel
    ? ` Sonraki resmî güncelleme: ${esc(data.nextUpdateLabel)}.`
    : "";
  const columns = `<style>#fifa-erkek-dunya-siralamasi .trend-table-row{grid-template-columns:3rem minmax(0,1.6fr) 5.2rem 3.2rem;gap:8px}#fifa-erkek-dunya-siralamasi .trend-table-row span{min-width:0}@media (max-width:720px){#fifa-erkek-dunya-siralamasi .trend-table-row{grid-template-columns:1.6rem minmax(0,1fr) 4.3rem 2rem;gap:6px;padding:8px 10px;font-size:.8rem}}</style>`;
  return `${FIFA_BLOCK_START}${columns}<section class="trend-section" id="fifa-erkek-dunya-siralamasi" data-fifa-as-of="${esc(data.asOf)}"><div class="section-head"><div class="section-title"><span class="section-kicker">FIFA resmî veri</span><h2>FIFA erkek dünya sıralaması (${esc(asOf)})</h2><p>FIFA/Coca-Cola Men's World Ranking. İlk ${esc(limit)} ülke ve Türkiye. Ülke adları FIFA listesindeki resmî adlardır. Değişim, bir önceki resmî yayına (${esc(data.previousAsOfLabel || "önceki yayın")}) göredir.</p></div></div>${summary}<div class="trend-data-table"><div class="trend-table-row head"><span>Sıra</span><span>Ülke</span><span>Puan</span><span>Değişim</span></div>${table}</div><p class="trend-source">Kaynak: <a href="${esc(data.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">FIFA/Coca-Cola erkek dünya sıralaması</a> · Veri tarihi: ${esc(asOf)}.${next}</p></section>${FIFA_BLOCK_END}`;
}
