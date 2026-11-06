/**
 * Haftalık bülten içeriği — YALNIZCA mevcut veriden derlenir (uydurma yok, LLM yok,
 * API-Football isteği yok):
 *   - Son 7 günün Süper Lig sonuçları: data/fixture-calendar.json + data/historical-match-archive.json
 *   - Güncel puan durumu: data/league-standings.json ["super-lig"]
 *   - Son köşe yazıları: Supabase `columns` tablosu (varsa) + data/columns.json (Köşe botu)
 */
const DAY = 24 * 3600 * 1000;
const FINISHED = new Set(["FINISHED", "FT", "AET", "PEN"]);

function isSuperLig(row) {
  if (!row) return false;
  if (row.competitionId) return row.competitionId === "super-lig";
  const league = String(row.league || row.competition || "").toLocaleLowerCase("tr-TR");
  return league === "süper lig" || league === "trendyol süper lig";
}
function num(v) {
  return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}
function istanbulDay(iso) {
  return new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function normTeam(v) {
  return String(v || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").replace(/[^a-z0-9]/g, "");
}

/** Bitmiş, tam skorlu Süper Lig maçları [from, to) aralığında; takım+gün ile tekilleştirilir. */
function weeklyResults({ calendar, archive }, { from, to }) {
  const rows = [];
  for (const m of (calendar && Array.isArray(calendar.matches) ? calendar.matches : [])) rows.push(m);
  for (const r of (archive && Array.isArray(archive.records) ? archive.records : [])) if (r && r.match) rows.push(r.match);
  const seen = new Map();
  for (const m of rows) {
    if (!isSuperLig(m)) continue;
    const status = String(m.status || "").toUpperCase();
    const provider = String(m.providerStatus || "").toUpperCase();
    if (!FINISHED.has(status) && !FINISHED.has(provider)) continue;
    const t = Date.parse(m.kickoff);
    if (!Number.isFinite(t) || t < from || t >= to) continue;
    const home = num(m.score && m.score.home);
    const away = num(m.score && m.score.away);
    if (home === null || away === null) continue;
    const key = `${normTeam(m.homeTeam)}|${normTeam(m.awayTeam)}|${istanbulDay(m.kickoff)}`;
    if (!seen.has(key)) seen.set(key, { homeTeam: m.homeTeam, awayTeam: m.awayTeam, home, away, kickoff: m.kickoff, round: m.round || null });
  }
  return [...seen.values()].sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
}

function standingsTable(store) {
  const block = store && store["super-lig"];
  const table = block && Array.isArray(block.table) ? block.table : [];
  const rows = table
    .filter((r) => r && (r.team || r.name) && Number.isFinite(Number(r.rank)) && Number.isFinite(Number(r.points)) && !r.needsReview)
    .map((r) => ({ rank: Number(r.rank), team: r.team || r.name, played: num(r.played), won: num(r.won), drawn: num(r.drawn), lost: num(r.lost), goalDifference: num(r.goalDifference), points: Number(r.points) }))
    .sort((a, b) => a.rank - b.rank);
  return { rows, updatedAt: (block && block.updatedAt) || null };
}

function columnUrl(site, col) {
  if (col.url && /^https?:\/\//.test(col.url)) return col.url;
  if (col.url && col.url.startsWith("/")) return `${site}${col.url}`;
  return `${site}/kose-yazilari/${encodeURIComponent(col.slug)}.html`;
}

/** Supabase satırları ve columns.json birleştirilir (slug tekil), en yeni ilk. */
function latestColumns({ columnsJson, supabaseColumns }, { site, now, limit = 3, maxAgeDays = 14 }) {
  const map = new Map();
  for (const c of Array.isArray(supabaseColumns) ? supabaseColumns : []) {
    if (!c || !c.slug || !c.title) continue;
    map.set(c.slug, { slug: c.slug, title: c.title, excerpt: c.excerpt || "", date: c.published_at || c.date, url: c.url || null });
  }
  for (const c of (columnsJson && Array.isArray(columnsJson.columns) ? columnsJson.columns : [])) {
    if (!c || !c.slug || !c.title || (c.status && c.status !== "published")) continue;
    if (!map.has(c.slug)) map.set(c.slug, { slug: c.slug, title: c.title, excerpt: c.excerpt || c.spot || c.metaDescription || "", date: c.date, author: c.author, url: null });
  }
  const list = [...map.values()].filter((c) => Number.isFinite(Date.parse(c.date)) && Date.parse(c.date) <= now)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const fresh = list.filter((c) => now - Date.parse(c.date) <= maxAgeDays * DAY);
  return (fresh.length ? fresh : list).slice(0, limit).map((c) => ({ ...c, href: columnUrl(site, c), excerpt: String(c.excerpt).slice(0, 220) }));
}

/** ISO hafta anahtarı (İstanbul saatine göre): ör. "2026-W45". */
function issueKey(now) {
  const d = new Date(Date.parse(istanbulDay(new Date(now).toISOString()) + "T00:00:00Z"));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `superlig-${year}-W${String(week).padStart(2, "0")}`;
}

function buildIssue(sources, { now = Date.now(), site = "https://www.futbolradar.com" } = {}) {
  const to = now;
  const from = now - 7 * DAY;
  const results = weeklyResults(sources, { from, to });
  const standings = standingsTable(sources.standings);
  const columns = latestColumns(sources, { site, now });
  return {
    key: issueKey(now),
    generatedAt: new Date(now).toISOString(),
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    site,
    results,
    standings,
    columns,
    empty: !results.length && !standings.rows.length && !columns.length
  };
}

/** Kaynak yükleyici: yerel dosyalar (kuru çalışma) ya da SITE_URL/data/... (cron). */
async function loadSourcesFromSite(site, { fetcher = fetch, supabaseColumns = null } = {}) {
  const get = async (file) => {
    try {
      const r = await fetcher(`${site}/data/${file}`, { headers: { Accept: "application/json" } });
      return r.ok ? await r.json() : null;
    } catch (error) { return null; }
  };
  // Arşiv (~30 MB) bilerek indirilmez: son 7 günün maçları takvim penceresinde.
  const [calendar, standings, columnsJson] = await Promise.all([
    get("fixture-calendar.json"), get("league-standings.json"), get("columns.json")
  ]);
  return { calendar, archive: null, standings, columnsJson, supabaseColumns };
}

module.exports = { isSuperLig, weeklyResults, standingsTable, latestColumns, issueKey, buildIssue, loadSourcesFromSite };
