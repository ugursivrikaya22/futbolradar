/**
 * İlgili içerik: köşe yazısı ve haber sayfalarındaki "İlgili yazılar" /
 * "Devamını oku" modülleri. Yalnızca derleme anındaki veriden seçer;
 * eşleşme yoksa boş liste döner ve modül basılmaz.
 */
function normKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function keySet(values) {
  return new Set((values || []).map(normKey).filter(Boolean));
}

function time(value) {
  const t = Date.parse(value || "");
  return Number.isNaN(t) ? 0 : t;
}

function byScoreThenDate(a, b) {
  return b.score - a.score || b.date - a.date;
}

/** Aynı etiket (x2), kategori, yazar; kendisi hariç, aynı dil. */
function relatedColumns(column, allColumns, { limit = 4 } = {}) {
  if (!column) return [];
  const tags = keySet(column.tags);
  return (allColumns || [])
    .filter((other) => other && other.path && other.path !== column.path && (other.locale || "tr") === (column.locale || "tr"))
    .map((other) => {
      const shared = (other.tags || []).filter((tag) => tags.has(normKey(tag))).length;
      const score = shared * 2
        + (other.categoryLabel && other.categoryLabel === column.categoryLabel ? 1 : 0)
        + (other.author && other.author === column.author ? 1 : 0);
      return { item: other, score, date: time(other.date) };
    })
    .filter((row) => row.score > 0)
    .sort(byScoreThenDate)
    .slice(0, limit)
    .map((row) => row.item);
}

/** Takımın en yakın gelecekteki maçı, yoksa en son oynanmışı. */
function teamMatchPage(team, matchPages, { now = Date.now(), exists = () => true } = {}) {
  const key = normKey(team);
  if (!key) return null;
  const rows = (matchPages || [])
    .filter((page) => page && page.slug && (normKey(page.homeTeam) === key || normKey(page.awayTeam) === key))
    .filter((page) => exists(`mac/${page.slug}.html`))
    .map((page) => ({ page, t: time(page.kickoff) }))
    .filter((row) => row.t);
  const upcoming = rows.filter((row) => row.t >= now - 3 * 3600e3).sort((a, b) => a.t - b.t)[0];
  const past = rows.filter((row) => row.t < now - 3 * 3600e3).sort((a, b) => b.t - a.t)[0];
  const hit = upcoming || past;
  return hit ? hit.page : null;
}

/**
 * Haber için ilgili öğeler: { kind, path, title, date, label }.
 * path kök göreli dosya yoludur (ör. "haber/x.html", "mac/a-b.html").
 */
function relatedForNews(article, { news = [], columns = [], matchPages = [], now = Date.now(), exists, articlePath, limit = 5 } = {}) {
  if (!article) return [];
  const team = normKey(article.team);
  const tags = keySet(article.tags);
  const selfPath = articlePath ? articlePath(article) : null;
  const out = [];
  const seen = new Set(selfPath ? [selfPath] : []);
  const push = (row) => {
    if (!row || !row.path || seen.has(row.path)) return;
    seen.add(row.path);
    out.push(row);
  };

  const match = team ? teamMatchPage(article.team, matchPages, { now, exists }) : null;
  if (match) {
    push({ kind: "match", path: `mac/${match.slug}.html`, title: `${match.homeTeam} - ${match.awayTeam}`, date: match.kickoff, label: match.league || "" });
  }

  const newsRows = (news || [])
    .filter((other) => other && other !== article && other.id !== article.id && other.title)
    .map((other) => {
      const sameTeam = team && normKey(other.team) === team ? 3 : 0;
      const shared = (other.tags || []).filter((tag) => tags.has(normKey(tag))).length;
      return { item: other, score: sameTeam + Math.min(shared, 3), date: time(other.publishedAt) };
    })
    .filter((row) => row.score >= (team ? 3 : 2))
    .sort(byScoreThenDate);

  const columnRows = (columns || [])
    .filter((column) => column && column.path)
    .map((column) => {
      const colTags = keySet(column.tags);
      const sameTeam = team && colTags.has(team) ? 3 : 0;
      const shared = [...colTags].filter((tag) => tags.has(tag)).length;
      return { item: column, score: sameTeam + Math.min(shared, 3), date: time(column.date) };
    })
    .filter((row) => row.score >= 3)
    .sort(byScoreThenDate);

  const col = columnRows[0];
  if (col) push({ kind: "column", path: col.item.path, title: col.item.title, date: col.item.date, label: col.item.categoryLabel || "" });
  const titles = new Set([normKey(String(article.title || "").replace(/\s*\([^)]*\)\s*$/, ""))]);
  for (const row of newsRows) {
    if (out.length >= limit) break;
    if (!articlePath) break;
    const titleKey = normKey(String(row.item.title).replace(/\s*\([^)]*\)\s*$/, ""));
    if (titles.has(titleKey)) continue;
    titles.add(titleKey);
    push({ kind: "news", path: articlePath(row.item), title: row.item.title, date: row.item.publishedAt, label: row.item.category || "" });
  }
  return out.length >= 3 ? out.slice(0, limit) : [];
}

module.exports = { normKey, relatedColumns, relatedForNews, teamMatchPage };
