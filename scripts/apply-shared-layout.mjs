/**
 * PAYLAŞILAN İSKELETİ TÜM SAYFALARA UYGULA
 * ----------------------------------------------------------------------------
 * Neden: başlık/alt bilgi işaretlemesi 6 üretici script ve 61 kök HTML dosyası
 * içinde kopyalanmıştı; sayfalar arasında menü farklılaşmıştı. Bu adım derleme
 * sırasında `scripts/lib/layout.mjs` çıktısını üretilmiş tüm HTML'e yazar,
 * böylece ~900 sayfa tek tasarım diline sahip olur.
 *
 * Yalnızca `<header class="topbar">…</header>` ve `<footer class="footer">…
 * </footer>` blokları değiştirilir; sayfa içeriğine dokunulmaz.
 */

import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter, newsTicker } from "./lib/layout.mjs";

const root = process.cwd();

const HEADER_RE = /<header\b[^>]*class="[^"]*\btopbar\b[^"]*"[^>]*>[\s\S]*?<\/header>/i;
const FOOTER_RE = /<footer\b[^>]*class="[^"]*\bfooter\b[^"]*"[^>]*>[\s\S]*?<\/footer>/i;
const TICKER_RE = /[\t ]*<!-- shared-layout:ticker:start -->[\s\S]*?<!-- shared-layout:ticker:end -->\n?/g;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return null;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) {
    return payload;
  }
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) {
      return payload[key];
    }
  }
  return [];
}

function istanbulToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date());
}

/**
 * Banttaki içerik: önce günün tamamlanan/canlı maç sonuçları (en taze bilgi),
 * ardından doğrulanmış haber akışı. Uydurma başlık üretilmez; yalnızca
 * veri dosyalarında zaten doğrulanmış kayıtlar kullanılır.
 */
function buildTickerItems() {
  const items = [];
  const today = istanbulToday();

  const matches = asArray(readJson("matches.json"), "matches");
  const todays = matches
    .filter((match) => String(match.kickoff || "").slice(0, 10) === today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)));

  for (const match of todays) {
    const status = String(match.status || "").toUpperCase();
    const hasScore =
      match.score && match.score.home !== null && match.score.home !== undefined
        && match.score.away !== null && match.score.away !== undefined;
    const slug = `${match.id}`;

    if (status === "LIVE" && hasScore) {
      items.push({
        label: "Canlı",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: `canli-skor.html#${slug}`
      });
    } else if (hasScore) {
      items.push({
        label: "Sonuç",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: `canli-skor.html#${slug}`
      });
    } else if (match.time) {
      items.push({
        label: match.time,
        text: `${match.homeTeam} - ${match.awayTeam}`,
        href: "bugunun-maclari.html"
      });
    }
  }

  const news = asArray(readJson("news.json"), "news", "items")
    .filter((item) => item && item.title && item.status !== "draft")
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")))
    .slice(0, 8);

  for (const item of news) {
    items.push({ label: item.category || "Gündem", text: item.title, href: item.url || "haberler.html" });
  }

  return items.slice(0, 12);
}

/** Bant öğelerinin göreli bağlantıları sayfa derinliğine göre yeniden yazılır. */
function rebaseItems(items, base) {
  return items.map((item) => ({
    ...item,
    href: /^https?:/i.test(item.href) ? item.href : `${base}${item.href}`
  }));
}

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      found.push(full);
    }
  }

  return found;
}

function siteRootFor(file) {
  const relative = path.relative(root, file);
  return relative.startsWith(`public${path.sep}`) ? path.join(root, "public") : root;
}

/** Kökte "./", bir klasör altta "../" gibi göreli önek üretir. */
function baseFor(file) {
  const depth = path.relative(siteRootFor(file), file).split(path.sep).length - 1;
  return depth <= 0 ? "./" : "../".repeat(depth);
}

const tickerItems = buildTickerItems();
const files = [...collectHtmlFiles(root), ...collectHtmlFiles(path.join(root, "public"))]
  .filter((file) => !path.relative(root, file).startsWith("node_modules"));

let updated = 0;
let skipped = 0;

for (const file of files) {
  const original = fs.readFileSync(file, "utf8");

  if (!HEADER_RE.test(original) && !FOOTER_RE.test(original)) {
    skipped += 1;
    continue;
  }

  const base = baseFor(file);
  const ticker = newsTicker({ base, items: rebaseItems(tickerItems, base) });
  const headerBlock = ticker
    ? `${siteHeader({ base })}\n      <!-- shared-layout:ticker:start -->${ticker}<!-- shared-layout:ticker:end -->`
    : siteHeader({ base });

  let next = original.replace(TICKER_RE, "");
  next = next.replace(HEADER_RE, () => headerBlock);
  next = next.replace(FOOTER_RE, () => siteFooter({ base }));

  if (next !== original) {
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

console.log(`Shared layout applied: ${updated} updated, ${skipped} without layout blocks, ${tickerItems.length} ticker items`);
