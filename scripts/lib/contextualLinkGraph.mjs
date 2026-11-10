/**
 * BAĞLAM İÇ BAĞLANTI SEÇİMİ.
 *
 * Yeni cümle veya skor uydurulmaz. Çağıran, diskte var olan sayfaları ve
 * kayıtlı başlık/tarih/takım adlarını verir; bu modül sırayı, tavanı ve
 * görünür işaretlemeyi seçer.
 *
 * Lig sırası: Şampiyonlar Ligi, Avrupa Ligi, La Liga, Premier Lig,
 * Bundesliga, Serie A, Ligue 1, kalanlar ada göre.
 * Takım sırası: mevcut editoryal popülerlik listesi (homeMatchPriority),
 * listede olmayanlar ada göre.
 */
import fs from "node:fs";
import path from "node:path";

export const CAP = Object.freeze({
  block: 12,
  comparisons: 4,
  recent: 1,
  upcoming: 1,
  files: 3,
  playerComparisons: 3,
  leagueRelated: 8,
  footerLeagues: 7,
  news: 4,
  summerHub: 8
});

/** Kullanıcının istediği önem sırası. Kalan ligler bu listenin ardında alfabetik. */
export const LEAGUE_PRIORITY = Object.freeze([
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "la-liga",
  "premier-league",
  "bundesliga",
  "serie-a",
  "ligue-1"
]);

/** services/homeMatchPriority.js POPULAR_TEAMS + Türk büyükleri. Yeni sıra uydurulmaz. */
export const POPULAR_SLUGS = Object.freeze([
  "galatasaray",
  "fenerbahce",
  "besiktas",
  "trabzonspor",
  "real-madrid",
  "barcelona",
  "manchester-city",
  "liverpool",
  "arsenal",
  "manchester-united",
  "chelsea",
  "bayern-munchen",
  "bayern-munich",
  "borussia-dortmund",
  "juventus",
  "inter",
  "ac-milan",
  "paris-saint-germain",
  "atletico-madrid"
]);

export const UEFA_LEAGUE_IDS = new Set([
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi",
  "uefa-uluslar-ligi"
]);

export const WEAK_LEAGUE_IDS = Object.freeze([
  "arjantin-primera",
  "belcika-pro-ligi",
  "brasileirao",
  "championship",
  "eredivisie",
  "mls",
  "primeira-liga",
  "scottish-premiership",
  "tff-2-lig"
]);

const TR_MAP = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", Ç: "c", Ğ: "g", İ: "i", Ö: "o", Ş: "s", Ü: "u" };

export function slugify(value) {
  let text = String(value || "");
  for (const [from, to] of Object.entries(TR_MAP)) text = text.split(from).join(to);
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function popularityRank(slug) {
  const index = POPULAR_SLUGS.indexOf(slug);
  return index === -1 ? POPULAR_SLUGS.length : index;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Kısa slug'lar kelimenin ortasına yapışmasın: `inter` `internazionale` sayılmaz. */
export function hasSlugToken(filename, slug) {
  const stem = String(filename || "").replace(/\.html$/, "");
  if (!slug) return false;
  return stem === slug || stem.startsWith(`${slug}-`) || stem.endsWith(`-${slug}`) || stem.includes(`-${slug}-`);
}

export function orderLeagues(leagues, nameKey = "nameTr") {
  const rank = new Map(LEAGUE_PRIORITY.map((id, index) => [id, index]));
  const locale = nameKey === "nameEn" ? "en" : "tr";
  return [...leagues].sort((a, b) => {
    const ar = rank.has(a.id) ? rank.get(a.id) : 1000;
    const br = rank.has(b.id) ? rank.get(b.id) : 1000;
    if (ar !== br) return ar - br;
    return String(a[nameKey] || a.id).localeCompare(String(b[nameKey] || b.id), locale);
  });
}

/**
 * İlgili ligler. Komşular (sıradaki 3, liste sonunda başa sarar) tavan
 * yüzünden düşmez; kalan yer önce öncelikli liglere, sonra ada göre
 * sıradakilere gider. Böylece listenin sonundaki ligler de en az üç
 * kardeş sayfadan bağlantı alır.
 */
export function relatedLeagues(ordered, selfId, cap = CAP.leagueRelated) {
  const idx = ordered.findIndex((league) => league.id === selfId);
  const neighbors = [];
  if (idx >= 0 && ordered.length > 1) {
    for (let step = 1; step <= 3; step += 1) {
      const item = ordered[(idx + step) % ordered.length];
      if (item && item.id !== selfId) neighbors.push(item);
    }
  }
  const out = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || item.id === selfId || seen.has(item.id) || out.length >= cap) return;
    seen.add(item.id);
    out.push(item);
  };
  for (const item of neighbors) push(item);
  for (const item of ordered) {
    if (out.length >= cap) break;
    if (LEAGUE_PRIORITY.includes(item.id)) push(item);
  }
  for (const item of ordered) {
    if (out.length >= cap) break;
    push(item);
  }
  return out.sort((a, b) => ordered.findIndex((item) => item.id === a.id) - ordered.findIndex((item) => item.id === b.id));
}

export function selectTeamLinks({ comparisons = [], recent = [], upcoming = [], files = [], playerComparisons = [] } = {}) {
  const groups = [
    comparisons.slice(0, CAP.comparisons),
    recent.slice(0, CAP.recent),
    upcoming.slice(0, CAP.upcoming),
    files.slice(0, CAP.files),
    playerComparisons.slice(0, CAP.playerComparisons)
  ];
  const out = [];
  const seen = new Set();
  for (const group of groups) {
    for (const item of group) {
      if (!item || !item.href || seen.has(item.href) || out.length >= CAP.block) continue;
      seen.add(item.href);
      out.push(item);
    }
  }
  return out;
}

function byDate(a, b) {
  return String(a.publishedAt || "").localeCompare(String(b.publishedAt || ""));
}

export function isSummer2026(article) {
  const stamp = String(article && article.publishedAt || "");
  return stamp.startsWith("2026-08") || stamp.startsWith("2026-09");
}

/**
 * Aynı takımın tarih komşuları önce. Takımı tek haber olan Ağustos–Eylül
 * kayıtları, o pencerenin kronolojik komşusuna bağlanır. Tavan 4.
 */
export function selectNewsLinks(articles, article, cap = CAP.news) {
  if (!article) return [];
  const sameKey = articles
    .filter((item) => item && item.id !== article.id && item.teamKey && item.teamKey === article.teamKey)
    .sort(byDate);
  const mine = articles
    .filter((item) => item && item.teamKey && item.teamKey === article.teamKey)
    .sort(byDate);
  const index = mine.findIndex((item) => item.id === article.id);
  const picks = [];
  const seen = new Set();
  const push = (item) => {
    if (!item || item.id === article.id || seen.has(item.id) || picks.length >= cap) return;
    seen.add(item.id);
    picks.push(item);
  };
  if (index > 0) push(mine[index - 1]);
  if (index >= 0 && index < mine.length - 1) push(mine[index + 1]);
  // Yaz penceresinde komşuluk karşılıklı kalsın: takım komşusu olan kayıt
  // da Ağustos–Eylül komşusuna bağlanır, tek haberlik takımlar kopmaz.
  if (isSummer2026(article)) {
    const summer = articles.filter(isSummer2026).sort(byDate);
    const summerIndex = summer.findIndex((item) => item.id === article.id);
    if (summerIndex > 0) push(summer[summerIndex - 1]);
    if (summerIndex >= 0 && summerIndex < summer.length - 1) push(summer[summerIndex + 1]);
  }
  const dated = [...sameKey].sort((a, b) => {
    const da = Math.abs(Date.parse(a.publishedAt || 0) - Date.parse(article.publishedAt || 0));
    const db = Math.abs(Date.parse(b.publishedAt || 0) - Date.parse(article.publishedAt || 0));
    return da - db;
  });
  for (const item of dated) push(item);
  return picks;
}

/** Ağustos–Eylül penceresinin iki ucu da bir merkez sayfadan görünsün. */
export function summerHubLinks(articles, cap = CAP.summerHub) {
  const summer = articles.filter(isSummer2026).sort(byDate);
  if (summer.length <= cap) return summer;
  const head = Math.ceil(cap / 2);
  const tail = cap - head;
  const picked = [...summer.slice(0, head), ...summer.slice(-tail)];
  const seen = new Set();
  return picked.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function renderStrip({ marker = "context-links", aria, items }) {
  const links = (items || []).filter((item) => item && item.href && item.label);
  if (!links.length) return "";
  const cells = links.map((item) => {
    const kicker = item.kicker ? `<span>${escapeHtml(item.kicker)}</span>` : "";
    return `<div>${kicker}<b><a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a></b></div>`;
  }).join("");
  return `<!-- ${marker}:start -->\n<section class="source-strip" data-context-links="${escapeHtml(marker)}" aria-label="${escapeHtml(aria || "İlgili sayfalar")}">${cells}</section>\n<!-- ${marker}:end -->\n`;
}

export function upsertMarked(html, marker, block, insertAt, options = {}) {
  const source = String(html || "");
  const re = new RegExp(`<!-- ${marker}:start -->[\\s\\S]*?<!-- ${marker}:end -->\\n?`);
  if (re.test(source)) return source.replace(re, block || "");
  if (!block) return source;
  if (!insertAt) return source;
  const at = source.indexOf(insertAt);
  if (at < 0) return null;
  const pos = options.placement === "before" ? at : at + insertAt.length;
  return `${source.slice(0, pos)}\n${block}${source.slice(pos)}`;
}

const SKIP_DIRS = new Set(["public", "node_modules", ".git", ".vercel", "coverage"]);

export function normalizeHref(href, pageFile) {
  if (!href) return null;
  const raw = String(href).trim();
  if (!raw || raw.startsWith("#") || /^(?:mailto|javascript|tel):/i.test(raw) || raw.startsWith("//")) return null;
  let pathname;
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try { url = new URL(raw); } catch { return null; }
    const host = url.hostname.replace(/^www\./i, "");
    if (host !== "futbolradar.com") return null;
    pathname = url.pathname;
  } else if (raw.startsWith("/")) {
    pathname = raw.split(/[?#]/)[0];
  } else {
    const dir = path.posix.dirname(String(pageFile || "index.html").split(path.sep).join("/"));
    pathname = path.posix.normalize(path.posix.join(dir === "." ? "/" : `/${dir}`, raw.split(/[?#]/)[0]));
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  pathname = pathname.replace(/\/+/g, "/");
  if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
  pathname = pathname.replace(/\.html$/i, "");
  return pathname || "/";
}

/** Hedef yolların kaç FARKLI sayfadan `<a href>` aldığını sayar. `public/` aynası çift sayılmaz. */
export function scanInbound(root, targets) {
  const want = new Map();
  for (const target of targets) {
    const key = normalizeHref(target.startsWith("/") ? target : `/${target}`, "index.html");
    if (key) want.set(key, new Set());
  }
  const files = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) files.push(full);
    }
  };
  walk(root);
  const hrefRe = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    let html = "";
    try { html = fs.readFileSync(file, "utf8"); } catch { continue; }
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    const pageKey = normalizeHref(`/${rel}`, "index.html");
    hrefRe.lastIndex = 0;
    let match;
    while ((match = hrefRe.exec(html))) {
      const key = normalizeHref(match[1] || match[2], rel);
      if (!key || key === pageKey) continue;
      const bucket = want.get(key);
      if (bucket) bucket.add(rel);
    }
  }
  const counts = {};
  for (const [key, sources] of want) counts[key] = sources.size;
  return { counts, pagesScanned: files.length };
}
