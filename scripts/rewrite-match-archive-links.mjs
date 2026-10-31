/**
 * İÇ BAĞLANTI DÜZELTME — eski maç adreslerine (/mac/<slug>, /mac-raporu/<slug>)
 * giden href ve hreflang bağlantılarını kalıcı arşiv adresine çevirir; böylece
 * hafta sayfaları, hub'lar ve EN sayfaların TR hreflang'i 301'e dayanmaz.
 * Kaynak tablo middleware.js ile aynıdır (tek doğruluk kaynağı).
 * Üretilmiş HTML'i elle değil, build adımı olarak işler. --check: yazmadan say.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveLegacyMatchPath } from "../middleware.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CHECK = process.argv.includes("--check");
const SKIP = new Set(["node_modules", ".git", ".worktrees", ".vercel", "data", "scripts", "services", "api", "supabase"]);
const ATTR_RE = /(href|content)="((?:https:\/\/www\.futbolradar\.com)?[^"#?]*?)(\bmac(?:-raporu)?\/[^"#?/]+?)(\.html)?((?:[?#][^"]*)?)"/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
      yield* walk(path.join(dir, entry.name));
    } else if (entry.name.endsWith(".html")) yield path.join(dir, entry.name);
  }
}

let files = 0;
let links = 0;
for (const file of walk(root)) {
  // 301 veren eski sayfanın kendisi hiç sunulmuyor: dokunma.
  const own = path.relative(root, file).split(path.sep).join("/").replace(/^public\//, "");
  if (resolveLegacyMatchPath(own)) continue;
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("mac")) continue;
  let changed = 0;
  const out = html.replace(ATTR_RE, (whole, attr, prefix, rel, ext, tail) => {
    if (!/(^|\/)$/.test(prefix)) return whole; // "...xmac/" gibi parçaları atla
    const target = resolveLegacyMatchPath(rel);
    if (!target) return whole;
    changed += 1;
    const absolute = prefix.startsWith("https://") ? `https://www.futbolradar.com${target}` : target;
    return `${attr}="${absolute}${tail}"`;
  });
  if (!changed) continue;
  files += 1;
  links += changed;
  if (!CHECK) fs.writeFileSync(file, out);
}
console.log(`[match-archive-links] ${links} bağlantı, ${files} dosya ${CHECK ? "(yazılmadı)" : "güncellendi"}`);
