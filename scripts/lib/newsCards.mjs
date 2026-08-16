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
      hasPublishedPage(article) &&
      newsSlug(article.slug || article.id || article.title))
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")))
    .slice(0, limit);
}

/**
 * SAYFASI ÜRETİLMEYECEK HABERE BAĞLANTI VERİLMEZ.
 *
 * `status: "verified"` tek başına "bu haberin sayfası var" demek değil.
 * `scripts/generate-news-pages.mjs` sayfayı yalnızca DOLU BİR GÖVDE varsa
 * üretiyor; gövdesi olmayan kayıtlar başlıktan ibaret taslaklar ve haklı
 * olarak atlanıyor. Bu süzgeç ise yalnızca `status`'a bakıyordu, dolayısıyla
 * takım haber bölümleri hiç var olmayan `haber/<slug>` sayfalarına bağlantı
 * basıyordu — 24 doğrulanmış kaydın 9'unun sayfası yok.
 *
 * Kural artık üreticinin kuralıyla AYNI: gövdesi olmayan kayıt listelenmez.
 * Kayıt silinmez, gövdesi yazıldığında kendiliğinden geri gelir.
 */
function hasPublishedPage(article) {
  return Array.isArray(article.body) &&
    article.body.some((paragraph) => String(paragraph || "").trim());
}

export function renderTeamNewsSection(articles, { team, base = "./" }) {
  if (!Array.isArray(articles) || !articles.length) return "";

  const sectionId = `${newsSlug(team)}-haberleri`;
  const cards = articles.map((article) => {
    const slug = newsSlug(article.slug || article.id || article.title);
    const href = `${base}haber/${slug}`;
    const isTransfer = /transfer/i.test(String(article.category || ""));
    const badgeLabel = isTransfer ? "Transfer" : String(article.category || team);
    return `<a class="news-card" data-card="news" data-news="${escapeHtml(article.id || slug)}" href="${escapeHtml(href)}">
      <div class="news-card-meta"><span class="mega-badge ${isTransfer ? "mega-badge--transfer" : "mega-badge--radar"}">${escapeHtml(badgeLabel)}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(formatDate(article.publishedAt))}</time></div>
      <div><span class="card-kicker">${escapeHtml(team)}</span><h3>${escapeHtml(article.title)}</h3><p>${escapeHtml(article.summary || article.spot || "")}</p></div>
      <div class="news-card-footer"><span>${escapeHtml(article.sourceName || "FutbolRadar")}</span><span class="detail-link">Haberi oku</span></div>
    </a>`;
  }).join("");

  return `<section class="team-news-section" data-team-news="${escapeHtml(newsSlug(team))}" aria-labelledby="${escapeHtml(sectionId)}">
    <div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(team)} gündemi</span><h2 id="${escapeHtml(sectionId)}">${escapeHtml(team)} haberleri</h2><p>Doğrulanmış kulüp gündemi ve kaynaklı açıklamalar.</p></div><a class="section-link" href="${escapeHtml(base)}haberler.html">Tüm haberler</a></div>
    <div class="news-grid">${cards}</div>
  </section>`;
}
