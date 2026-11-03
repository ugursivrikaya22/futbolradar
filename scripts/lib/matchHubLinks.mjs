/**
 * MAÇ MERKEZİ (data/match-hubs/*.json) İÇ BAĞLANTILARI.
 * Takım maç sayfaları ve turnuva puan durumu sayfaları, ilgili kalıcı maç
 * merkezine buradan bağlanır. Yalnızca hub dosyasında `file` olan ve
 * kickoff'u geçerli kayıtlar listelenir; metin hub verisinden gelir.
 */
import fs from "node:fs";
import path from "node:path";

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function loadMatchHubs(root) {
  const dir = path.join(root, "data", "match-hubs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; }
  }).filter((h) => h && h.file && Number.isFinite(Date.parse(h.kickoff)));
}

function trDate(iso) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

export function hubsForTeam(hubs, teamName) {
  const n = String(teamName || "").toLocaleLowerCase("tr");
  return hubs.filter((h) => [h.home, h.away].some((t) => String(t || "").toLocaleLowerCase("tr") === n));
}

export function hubsForCompetition(hubs, needle) {
  return hubs.filter((h) => String(h.competition || "").includes(needle));
}

export function matchHubLinksSection(hubs, { base = "./", heading = "Maç merkezleri" } = {}) {
  if (!hubs.length) return "";
  const items = hubs.map((h) => `<li><a href="${esc(base + h.file)}">${esc(`${h.home} - ${h.awayShort || h.away}`)}</a> <span class="muted">· ${esc(trDate(h.kickoff))} · ${esc(h.competition || "")}</span></li>`).join("");
  return `<section class="evergreen-section match-hub-links" aria-label="${esc(heading)}"><h2>${esc(heading)}</h2><ul>${items}</ul></section>`;
}
