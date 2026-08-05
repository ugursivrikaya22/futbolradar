import fs from "node:fs";
import path from "node:path";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function newsSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih açıklanmadı";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date) + " TSİ";
}

export function readVerifiedTeamNews(root, team, limit = 3) {
  const payload = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
  const articles = Array.isArray(payload) ? payload : payload.items || payload.news || [];

  return articles
    .filter((article) =>
      article &&
      article.team === team &&
      String(article.status || "").toLowerCase() === "verified" &&
      newsSlug(article.slug || article.id || article.title))
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")))
    .slice(0, limit);
}

export function renderTeamNewsSection(articles, { team, base = "./" }) {
  if (!Array.isArray(articles) || !articles.length) return "";

  const sectionId = `${newsSlug(team)}-haberleri`;
  const cards = articles.map((article) => {
    const slug = newsSlug(article.slug || article.id || article.title);
    const href = `${base}haber/${slug}`;
    return `<article class="news-card" data-card="news" data-news="${escapeHtml(article.id || slug)}">
      <div class="news-card-meta"><span class="tag green">${escapeHtml(article.category || team)}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(formatDate(article.publishedAt))}</time></div>
      <div><span class="card-kicker">${escapeHtml(team)}</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.summary || article.spot || "")}</p></div>
      <div class="news-card-footer"><span>${escapeHtml(article.sourceName || "FutbolRadar")}</span><a class="detail-link" href="${escapeHtml(href)}">Haberi oku</a></div>
    </article>`;
  }).join("");

  return `<section class="team-news-section" data-team-news="${escapeHtml(newsSlug(team))}" aria-labelledby="${escapeHtml(sectionId)}">
    <div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(team)} gündemi</span><h2 id="${escapeHtml(sectionId)}">${escapeHtml(team)} haberleri</h2><p>Doğrulanmış kulüp gündemi ve kaynaklı açıklamalar.</p></div><a class="section-link" href="${escapeHtml(base)}haberler.html">Tüm haberler</a></div>
    <div class="news-grid">${cards}</div>
  </section>`;
}
