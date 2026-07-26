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
import { buildTickerFeed } from "./lib/tickerFeed.mjs";

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

// Bant doğrulanmış kaynaklardan beslenir (maç sonuçları, onaylı transferler,
// doğrulanmış editoryal haberler) ve tazelik denetiminden geçer: rozet ancak
// gerçekten taze bir öğe varsa "Son Dakika" olur.
const tickerFeed = buildTickerFeed();
const tickerItems = tickerFeed.items;
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
  const ticker = newsTicker({ base, items: rebaseItems(tickerItems, base), badge: tickerFeed.badge });
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

console.log(
  `Shared layout applied: ${updated} updated, ${skipped} without layout blocks, ` +
  `${tickerItems.length} ticker items (${tickerFeed.badge}` +
  `${tickerFeed.usedFallback ? ", son doğrulanmış içerik korundu" : ""})`
);
