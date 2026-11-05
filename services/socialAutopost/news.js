/**
 * SOSYAL PAYLAŞIM — HABER ADAYLARI VE METİNLER (saf fonksiyonlar; ağ/saat yok).
 *
 * KAYNAK: `data/news.json` (kayan yazı / "son dakika" bandı bu dosyadaki
 * doğrulanmış haberlerden türetilir; bkz. data/news-ticker.json `_comment`).
 * Yalnızca `status: "verified"`, `includeInTicker !== false`, sitede kalıcı
 * `/haber/<slug>` adresi olan ve son `windowHours` saatte yayımlanmış haberler.
 *
 * HASHTAG: YALNIZCA haberin kendi `team`, `category` ve `tags` alanlarından
 * türetilir (en fazla 3). Hiçbir takım/turnuva adı uydurulmaz; genel
 * kategori adları (ör. "Transfer Gündemi") etiket yapılmaz.
 */
const { SITE, MAX_WEIGHT, weightedLength, fitText } = require("../xAutopost/compose");

const NEWS_FILE = "data/news.json";
const DEFAULT_WINDOW_HOURS = 24;
const MAX_HASHTAGS = 3;
// Takım/turnuva olmayan, sitenin kendi bölüm adları: etiket yapılmaz.
const GENERIC = new Set([
  "futbolradar", "son dakika", "son dakika transfer", "transfer", "transfer gündemi", "transfer haberleri",
  "kulüp gündemi", "maç dosyası", "maç sonucu", "hazırlık maçı", "kamp programı", "hakemler dosyası",
  "avrupa futbolu", "dünya futbolu", "futbol gündemi", "teknik direktör"
]);

function trLower(s) { return String(s || "").toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim(); }

/** "Türkiye Milli Takımı" → "#TürkiyeMilliTakımı". Harf/rakam dışı her şey atılır. */
function toHashtag(label) {
  const clean = String(label || "").normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");
  if (clean.length < 2 || clean.length > 30 || /^\d+$/.test(clean)) return null;
  return `#${clean}`;
}

/**
 * Takım/turnuva sözlüğü: haber listesinin kendi `team` + `category` değerleri
 * (genel bölüm adları hariç). `tags` içinden yalnızca bu sözlükte geçenler
 * etiket olur → kişi adları ya da serbest etiketler hashtag yapılmaz.
 */
function vocabularyOf(list) {
  const v = new Set();
  for (const n of list) for (const label of [n && n.team, n && n.category]) {
    if (typeof label === "string" && label.trim() && !GENERIC.has(trLower(label))) v.add(trLower(label));
  }
  return v;
}

function hashtagsFor(item, max = MAX_HASHTAGS, vocabulary = null) {
  const out = []; const seen = new Set();
  const tags = ((item && Array.isArray(item.tags)) ? item.tags : []).filter((t) => !vocabulary || vocabulary.has(trLower(t)));
  const labels = [item && item.team, item && item.category, ...tags];
  for (const label of labels) {
    if (typeof label !== "string" || !label.trim() || GENERIC.has(trLower(label))) continue;
    if (label.trim().split(/\s+/).length > 3) continue;
    const tag = toHashtag(label);
    if (!tag || seen.has(trLower(tag))) continue;
    seen.add(trLower(tag)); out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

function newsUrl(item) {
  const url = String(item && item.url || "");
  const slug = item && item.slug;
  if (slug && /^[a-z0-9-]+$/i.test(slug)) {
    const expected = `${SITE}/haber/${slug}`;
    // Haber kaydında yazılı adres sitenin kendi /haber/ adresi değilse paylaşılmaz.
    if (!url || url === expected) return expected;
  }
  return null;
}

function newsList(data) {
  return Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
}

/** Paylaşılabilir haberler, eskiden yeniye. `key` = `news:<slug>`. */
function newsCandidates(news, { now = new Date(), windowHours = DEFAULT_WINDOW_HOURS } = {}) {
  const t = now.getTime();
  const all = newsList(news);
  const vocabulary = vocabularyOf(all);
  return all
    .filter((n) => n && n.status === "verified" && n.includeInTicker !== false && n.title)
    // Kayan yazıda "kesinleşmemiş" işaretli haber (iddia/söylenti) paylaşılmaz.
    .filter((n) => !(n.ticker && n.ticker.confidence && n.ticker.confidence !== "confirmed"))
    .map((n) => ({ n, at: Date.parse(n.publishedAt), url: newsUrl(n) }))
    .filter(({ at, url }) => url && Number.isFinite(at) && at <= t && t - at <= windowHours * 3600e3)
    .sort((a, b) => a.at - b.at)
    .map(({ n, at, url }) => ({ key: `news:${n.slug}`, kind: "news", at, url, title: String(n.title).trim(), summary: String(n.summary || n.spot || "").trim(), hashtags: hashtagsFor(n, MAX_HASHTAGS, vocabulary), item: n }));
}

/** Tweet: başlık + site bağlantısı + 2-3 etiket. 280 ağırlığı aşarsa başlık kısaltılır. */
function composeNewsTweet(c) {
  const tags = c.hashtags.join(" ");
  const build = (title) => [title, c.url, tags].filter(Boolean).join("\n\n");
  let text = fitText(build, c.title);
  if (weightedLength(text) > MAX_WEIGHT) text = fitText((title) => [title, c.url].join("\n\n"), c.title);
  return text;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Telegram (parse_mode HTML): kalın başlık, özet, bağlantı, etiketler. 4096 sınırı. */
function composeNewsTelegram(c) {
  const summary = c.summary.length > 600 ? `${c.summary.slice(0, 597).replace(/\s+\S*$/, "")}…` : c.summary;
  return [
    `📰 <b>${escapeHtml(c.title)}</b>`,
    summary ? escapeHtml(summary) : null,
    `<a href="${escapeHtml(c.url)}">FutbolRadar'da oku →</a>`,
    c.hashtags.length ? escapeHtml(c.hashtags.join(" ")) : null
  ].filter(Boolean).join("\n\n");
}

/** Maç sonucu (X otomatik paylaşımının düz metni) → Telegram HTML. */
function plainToTelegram(text) {
  return escapeHtml(text).replace(/(https:\/\/www\.futbolradar\.com\/\S+)/g, (u) => `<a href="${u}">${u}</a>`);
}

module.exports = { vocabularyOf, NEWS_FILE, DEFAULT_WINDOW_HOURS, MAX_HASHTAGS, GENERIC, toHashtag, hashtagsFor, newsUrl, newsCandidates, composeNewsTweet, composeNewsTelegram, plainToTelegram, escapeHtml };
