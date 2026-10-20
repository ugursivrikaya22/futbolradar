/**
 * UEFA ülke puanı tablosu — TEK KAYNAK: data/uefa-country-coefficients.json.
 * Hem tam derleme (generate-trend-seo-pages.mjs) hem saatlik zincir
 * (inject-uefa-country-table.mjs) bu blok üreticisini kullanır.
 * Veri elle uydurulmaz; satırlar UEFA resmî sıralamasından alınır.
 */
import fs from "node:fs";
import path from "node:path";

export const UEFA_BLOCK_START = "<!--uefa-country-table:start-->";
export const UEFA_BLOCK_END = "<!--uefa-country-table:end-->";

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const TR_NAMES = { England: "İngiltere", Italy: "İtalya", Spain: "İspanya", Germany: "Almanya", France: "Fransa", Portugal: "Portekiz", Belgium: "Belçika", Netherlands: "Hollanda", "Türkiye": "Türkiye", Greece: "Yunanistan", Poland: "Polonya", Czechia: "Çekya", Norway: "Norveç", Denmark: "Danimarka", Cyprus: "Kıbrıs", Austria: "Avusturya", Switzerland: "İsviçre", Scotland: "İskoçya", Sweden: "İsveç", Israel: "İsrail", Croatia: "Hırvatistan", Serbia: "Sırbistan", Ukraine: "Ukrayna", Hungary: "Macaristan", Romania: "Romanya", Slovenia: "Slovenya", Azerbaijan: "Azerbaycan", Bulgaria: "Bulgaristan", Slovakia: "Slovakya" };

export function readUefaCoefficients(root) {
  const file = path.join(root, "data", "uefa-country-coefficients.json");
  if (!fs.existsSync(file)) return null;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.rows) || !data.rows.length || !data.asOf) return null;
  return data;
}

function formatAsOf(iso) {
  const d = new Date(`${iso}T12:00:00+03:00`);
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(d);
}

export function renderUefaCountryBlock(data, { limit = 20 } = {}) {
  if (!data) return `${UEFA_BLOCK_START}${UEFA_BLOCK_END}`;
  const tr = data.rows.find((r) => r.countryCode === "TUR");
  const asOf = formatAsOf(data.asOf);
  const rows = data.rows.filter((r) => r.position <= limit || r.countryCode === "TUR");
  const fmt = (n) => (typeof n === "number" ? n.toFixed(3).replace(".", ",") : "—");
  const table = rows.map((r) => `<div class="trend-table-row${r.countryCode === "TUR" ? " is-highlight" : ""}"><span>${esc(r.position)}</span><span>${esc(TR_NAMES[r.country] || r.country)}</span><span>${fmt(r.coefficient)}</span><span>${fmt(r.seasonCoefficient2026_27)}</span></div>`).join("");
  const summary = tr ? `<p class="uefa-tr-summary"><strong>Türkiye ${esc(tr.position)}. sırada, ${fmt(tr.coefficient)} puan</strong> (UEFA, ${esc(asOf)}).</p>` : "";
  return `${UEFA_BLOCK_START}<section class="trend-section" id="uefa-ulke-siralamasi" data-uefa-as-of="${esc(data.asOf)}"><div class="section-head"><div class="section-title"><span class="section-kicker">UEFA resmî veri</span><h2>UEFA ülke puanı sıralaması (${esc(asOf)})</h2><p>Beş sezonluk ülke katsayısı ve 2026-27 sezon katsayısı. İlk ${esc(limit)} ülke gösterilir.</p></div></div>${summary}<div class="trend-data-table"><div class="trend-table-row head"><span>Sıra</span><span>Ülke</span><span>5 sezon</span><span>2026-27</span></div>${table}</div><p class="trend-source">Kaynak: <a href="${esc(data.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">UEFA ülke katsayıları</a> · Veri tarihi: ${esc(asOf)}</p></section>${UEFA_BLOCK_END}`;
}
