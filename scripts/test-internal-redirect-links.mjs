/**
 * İÇ BAĞLANTI → 301 KORUYUCUSU (Görev 5, 1. aşama).
 *
 * Üretilmiş ağaçta (public/ aynası hariç) koşulsuz bir vercel.json
 * yönlendirmesinin KAYNAĞINA giden her <a href> sayılır ve kategori
 * başına `data/internal-redirect-link-baseline.json` üst sınırıyla
 * karşılaştırılır. Sayı YALNIZCA AZALABİLİR: bir kategori sınırı aşarsa
 * test kırılır. Sayı düştüğünde sınır `--update` ile aşağı çekilir;
 * `--update` sınırı hiçbir zaman YUKARI taşımaz.
 *
 * Ayrıca services/siteLinks.js#internalHref ve
 * playerUrl#playerCanonicalHref birim denetimleri.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { createSiteLinks, relativeFrom } = require("../services/siteLinks.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const BASELINE_PATH = path.join(root, "data", "internal-redirect-link-baseline.json");
const DOMAIN = "https://www.futbolradar.com";
const update = process.argv.includes("--update");

console.log("internal-redirect-links");

// ── 1. Birim denetimleri ──────────────────────────────────────────────────
{
  const links = createSiteLinks({
    redirects: [
      { source: "/futbolcu/:slug.html", destination: "/futbolcu/:slug", permanent: true },
      { source: "/oyuncular/eski.html", destination: "/futbolcu/eski.html", permanent: true },
      { source: "/a.html", destination: "/b.html", permanent: true },
      { source: "/b.html", destination: "/a.html", permanent: true },
      { source: "/:path*", has: [{ type: "host", value: "futbolradar.com" }], destination: "https://www.futbolradar.com/:path*", permanent: true }
    ]
  });
  assert.equal(links.internalHref("futbolcu/x.html", { from: "mac/m.html" }), "../futbolcu/x");
  assert.equal(links.internalHref("/oyuncular/eski.html", { from: "index.html" }), "./futbolcu/eski", "zincir sonuna kadar izlenmeli");
  assert.equal(links.internalHref("mac/m.html", { from: "mac/n.html" }), "./m.html", "yönlendirmesiz yol değişmez");
  assert.equal(links.internalHref(`${DOMAIN}/futbolcu/x.html?a=1#b`, { from: "haber/h.html" }), "../futbolcu/x?a=1#b");
  assert.equal(links.internalHref("https://example.com/x.html"), "https://example.com/x.html");
  assert.ok(["/a.html", "/b.html"].includes(links.resolveFinalPath("/a.html")), "döngüde durmalı");
  assert.equal(links.isRedirected("/z.html"), false, "koşullu (host) kural her yolu eşleştirmemeli");
  assert.equal(relativeFrom("a/b/c.html", "/x"), "../../x");
  console.log("  ok  internalHref: zincir, göreli önek, döngü, koşullu kural");
}
{
  const resolver = createPlayerUrlResolver({ entries: [{ id: "k-akturkoglu", slug: "kerem-akturkoglu" }], aliases: [{ id: "kopya", canonicalId: "k-akturkoglu" }] });
  assert.equal(resolver.playerCanonicalHref("k-akturkoglu", "../"), "../futbolcu/kerem-akturkoglu");
  assert.equal(resolver.playerCanonicalHref("kopya"), "./futbolcu/kerem-akturkoglu");
  assert.equal(resolver.playerCanonicalHref("tasinmamis"), "./oyuncular/tasinmamis.html");
  assert.equal(resolver.playerHref("k-akturkoglu"), "./futbolcu/kerem-akturkoglu.html", "playerHref bu aşamada değişmez");
  console.log("  ok  playerCanonicalHref uzantısız kanonik adres veriyor");
}

// ── 2. Üretilmiş ağaçta 301'e giden bağlantı sayımı ──────────────────────
const links = createSiteLinks();
const SKIP = new Set(["public", "node_modules", ".git", ".vercel", ".claude"]);
function* htmlFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}
function category(rootPath, rule) {
  if (/^\/futbolcu\/[^/]+\.html$/.test(rootPath)) return "futbolcu-html";
  if (/^\/oyuncular\//.test(rootPath)) return "oyuncular-tasinan";
  if (/-puan-durumu\.html$/.test(rootPath)) return "puan-durumu-html";
  return `diger:${rule.source.split("/")[1] || "/"}`;
}
const counts = {};
const pages = new Set();
let total = 0;
for (const file of htmlFiles(root)) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/gi)) {
    let href = match[1].replace(/&amp;/g, "&");
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let rootPath;
    if (href.startsWith(DOMAIN)) rootPath = href.slice(DOMAIN.length) || "/";
    else if (/^https?:\/\//i.test(href) || href.startsWith("//")) continue;
    else if (href.startsWith("/")) rootPath = href;
    else rootPath = path.posix.join("/", path.posix.dirname(relative), href);
    rootPath = rootPath.split(/[?#]/)[0];
    const found = links.matchRedirect(rootPath);
    if (!found) continue;
    const key = category(rootPath, found.rule);
    counts[key] = (counts[key] || 0) + 1;
    total += 1;
    pages.add(relative);
  }
}
console.log(`  ..  301'e giden iç bağlantı: ${total} (${pages.size} sayfa) — ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);

const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) : null;
if (!baseline) {
  if (!update) assert.fail("data/internal-redirect-link-baseline.json yok: node scripts/test-internal-redirect-links.mjs --update");
} else {
  const over = Object.entries(counts).filter(([key, value]) => value > (baseline.max[key] ?? 0));
  assert.equal(over.length, 0, `301'e giden iç bağlantı ARTTI (yalnızca azalabilir): ${over.map(([k, v]) => `${k} ${v} > ${baseline.max[k] ?? 0}`).join(", ")}. Yeni bağlantıyı services/siteLinks.js#internalHref ya da playerUrl#playerCanonicalHref ile üretin.`);
  const lower = Object.entries(baseline.max).filter(([key, value]) => (counts[key] || 0) < value);
  if (lower.length) console.log(`  ..  azalan kategori(ler): ${lower.map(([k, v]) => `${k} ${counts[k] || 0}/${v}`).join(", ")} — sınırı indirmek için --update`);
}
if (update) {
  const max = {};
  for (const key of new Set([...Object.keys(counts), ...Object.keys((baseline && baseline.max) || {})])) {
    const now = counts[key] || 0;
    const prev = baseline ? (baseline.max[key] ?? 0) : now;
    // Sınır asla yükselmez; yeni kategori yalnızca ilk kurulumda eklenir.
    max[key] = baseline ? Math.min(prev, now) : now;
  }
  for (const key of Object.keys(max)) if (max[key] === 0) delete max[key];
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ _comment: "Üst sınır: üretilmiş ağaçta (public/ hariç) 301 kaynağına giden <a href> sayısı. Yalnızca azalabilir; bkz. scripts/test-internal-redirect-links.mjs", max }, null, 2)}\n`);
  console.log("  ..  sınır yazıldı");
}
console.log("internal-redirect-links OK");
