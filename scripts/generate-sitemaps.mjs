import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const outputDir = path.join(root, "sitemaps");
const publicOutputDir = path.join(root, "public", "sitemaps");
const excludedDirectories = new Set([".git", ".agents", ".codex", ".vercel", "node_modules", "public", "work", "outputs", "widgets"]);

function walk(directory, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, output);
    else if (entry.isFile() && entry.name.endsWith(".html")) output.push(fullPath);
  }
  return output;
}

function readMeta(file) {
  const html = fs.readFileSync(file, "utf8");
  const robots = (html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i) || [])[1] || "";
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i) || [])[1] || "";
  return { robots, canonical };
}

function categoryFor(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("mac/") || normalized.startsWith("maclar/")) return "matches";
  if (normalized.startsWith("turnuva/") || /(sampiyonlar|avrupa-ligi|konferans|super-lig-fikstur)/.test(normalized)) return "competitions";
  if (normalized.startsWith("takim/") || /(^takimlar|form-durumu|oyuncu-radari\.html$)/.test(normalized)) return "teams";
  return "editorial";
}

const groups = { matches: [], teams: [], competitions: [], editorial: [] };
for (const file of walk(root)) {
  const relativePath = path.relative(root, file);
  if (relativePath === "404.html") continue;
  const meta = readMeta(file);
  if (meta.robots.includes("noindex") || !meta.canonical.startsWith(domain)) continue;
  groups[categoryFor(relativePath)].push(meta.canonical);
}

for (const key of Object.keys(groups)) {
  groups[key] = Array.from(new Set(groups[key])).sort();
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function urlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url>\n    <loc>${xmlEscape(url)}</loc>\n  </url>`).join("\n")}\n</urlset>\n`;
}

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(publicOutputDir, { recursive: true });
const sitemapFiles = [];
for (const [name, urls] of Object.entries(groups)) {
  const fileName = `${name}.xml`;
  const xml = urlset(urls);
  fs.writeFileSync(path.join(outputDir, fileName), xml, "utf8");
  fs.writeFileSync(path.join(publicOutputDir, fileName), xml, "utf8");
  sitemapFiles.push(fileName);
}

const indexXml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapFiles.map((file) => `  <sitemap>\n    <loc>${domain}/sitemaps/${file}</loc>\n  </sitemap>`).join("\n")}\n</sitemapindex>\n`;
for (const file of ["sitemap.xml", "sitemap-index.xml"]) {
  fs.writeFileSync(path.join(root, file), indexXml, "utf8");
  fs.writeFileSync(path.join(root, "public", file), indexXml, "utf8");
}

const robots = `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /mac-detay.html\nDisallow: /*?*\n\nSitemap: ${domain}/sitemap.xml\n`;
fs.writeFileSync(path.join(root, "robots.txt"), robots, "utf8");
fs.writeFileSync(path.join(root, "public", "robots.txt"), robots, "utf8");

console.log(`Generated sitemap index: ${Object.entries(groups).map(([name, urls]) => `${name}=${urls.length}`).join(", ")}`);
