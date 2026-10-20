/**
 * KONU KÜMESİ İÇ BAĞLANTILARI — köşe yazısı ↔ maç sayfası ↔ puan durumu.
 *
 * Tek kaynak: üç üretici (generate-column-pages, generate-match-seo-pages,
 * generate-team-standings-pages) aynı eşleştirmeyi buradan okur ki bir
 * yönde verilen bağlantının karşı yönü de aynı kurala dayansın.
 *
 * KURALLAR
 *   • Yalnızca diskte VAR OLAN sayfaya bağlanılır (404'e bağlantı yok).
 *   • Eşleştirme veriden gelir: köşe yazısının `tags` alanındaki takım adı,
 *     fikstürdeki ev/deplasman adı (`sameClub`), maç adresi
 *     `services/matchSeoPages.js#slugForMatch` sicilinden. Tahmin yok.
 *   • Bağlantı metni açıklayıcıdır ("Trabzonspor puan durumu", yazı başlığı,
 *     "Ev - Deplasman maçı (tarih)"); "tıkla/buraya" yok.
 *   • Yeni API isteği yok: yalnızca repodaki data/*.json dosyaları okunur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sameClub } = require("../../services/superLigTeams.js");
const { superLigTeamPages } = require("../../services/superLigTeamPages.js");
const { publishedColumns } = require("../../services/columnService.js");
const { slugForMatch } = require("../../services/matchSeoPages.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const readJson = (relative, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8")); } catch { return fallback; }
};

let cache = null;
function load() {
  if (cache) return cache;
  const teams = superLigTeamPages({ root }).map(({ slug, name }) => ({ slug, name }));
  const { columns } = publishedColumns(readJson("data/columns.json", { columns: [] }), { locale: "tr" });
  const calendar = readJson("data/fixture-calendar.json", { matches: [] });
  const fixtures = (Array.isArray(calendar.matches) ? calendar.matches : [])
    .filter((row) => row && row.homeTeam && row.awayTeam && row.kickoff);
  cache = { teams, columns, fixtures, slugMemo: new Map() };
  return cache;
}

function matchSlug(row) {
  const { slugMemo } = load();
  const key = `${row.id || ""}|${row.providerId || ""}|${row.kickoff}`;
  if (!slugMemo.has(key)) {
    let slug = null;
    try {
      slug = slugForMatch({
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        kickoff: row.kickoff,
        providerIds: row.providerId ? { apiFootball: row.providerId } : (row.providerIds || {})
      });
    } catch { slug = null; }
    slugMemo.set(key, slug && exists(`mac/${slug}.html`) ? slug : null);
  }
  return slugMemo.get(key);
}

const trDate = (iso) => new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

/** Takım adının Süper Lig takım puan durumu sayfası (varsa). */
export function teamStandingsLink(teamName) {
  const team = load().teams.find((row) => sameClub(row.name, teamName));
  if (!team || !exists(`${team.slug}-puan-durumu.html`)) return null;
  return { path: `${team.slug}-puan-durumu`, team: team.name, title: `${team.name} puan durumu` };
}

/** Bir köşe yazısının etiketlerinden Süper Lig takımları. */
export function columnTeams(column) {
  const { teams } = load();
  const tags = Array.isArray(column && column.tags) ? column.tags : [];
  const found = [];
  for (const tag of tags) {
    const team = teams.find((row) => sameClub(row.name, tag));
    if (team && !found.some((row) => row.slug === team.slug)) found.push(team);
  }
  return found;
}

/** Takım(lar)ı etiketleyen yayımlanmış köşe yazıları (yeniden eskiye). */
export function columnsForTeams(teamNames, { excludeId = null, limit = 3 } = {}) {
  const names = (Array.isArray(teamNames) ? teamNames : [teamNames]).filter(Boolean);
  return load().columns
    .filter((column) => column.id !== excludeId && column.path)
    .filter((column) => (column.tags || []).some((tag) => names.some((name) => sameClub(tag, name))))
    .slice(0, limit)
    .map((column) => ({ path: column.path, title: column.title, date: column.date, id: column.id, matchId: column.generated && column.generated.matchId }));
}

/** İki takımın verilen tarihe en yakın (±4 gün) maç sayfası. */
export function matchPageFor(homeOrA, awayOrB, aroundIso) {
  const target = new Date(aroundIso).getTime();
  if (!Number.isFinite(target)) return null;
  const rows = load().fixtures
    .filter((row) => (sameClub(row.homeTeam, homeOrA) && sameClub(row.awayTeam, awayOrB)) || (sameClub(row.homeTeam, awayOrB) && sameClub(row.awayTeam, homeOrA)))
    .map((row) => ({ row, gap: Math.abs(new Date(row.kickoff).getTime() - target) }))
    .filter((item) => item.gap <= 4 * 86400000)
    .sort((a, b) => a.gap - b.gap);
  for (const { row } of rows) {
    const slug = matchSlug(row);
    if (slug) return { path: `mac/${slug}.html`, title: `${row.homeTeam} - ${row.awayTeam} maçı (${trDate(row.kickoff)})` };
  }
  return null;
}

/** Takımın son oynanmış ve sıradaki maç sayfaları (varsa). */
export function teamMatchPages(teamName, now = Date.now()) {
  const rows = load().fixtures
    .filter((row) => sameClub(row.homeTeam, teamName) || sameClub(row.awayTeam, teamName))
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  const past = rows.filter((row) => new Date(row.kickoff).getTime() <= now).reverse();
  const next = rows.filter((row) => new Date(row.kickoff).getTime() > now);
  const pick = (list, label) => {
    for (const row of list.slice(0, 6)) {
      const slug = matchSlug(row);
      if (slug) return { path: `mac/${slug}.html`, kicker: label, title: `${row.homeTeam} - ${row.awayTeam} (${trDate(row.kickoff)})` };
    }
    return null;
  };
  return [pick(past, "Son maç"), pick(next, "Sıradaki maç")].filter(Boolean);
}
