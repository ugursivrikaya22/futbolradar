/**
 * İÇ BAĞLANTI DENETİM ÇEKİRDEĞİ (EMİR 1B).
 *
 * Tarayıcı + Vercel davranışını (cleanUrls=false) taklit eder:
 *  1. Sayfanın SUNULDUĞU adres(ler) bulunur (`/en/x.html` ve rewrite ile
 *     `/en/x`; `en/index.html` için `/en`).
 *  2. Göreli href o ADRESE göre çözülür (dosya yoluna göre değil). Klasik
 *     hata: `/en` (eğik çizgisiz) adresinde `./todays-matches.html`
 *     `/todays-matches.html`'e (404) gider.
 *  3. Hedef Vercel sırasıyla denenir: redirects → dosya sistemi → rewrites.
 */
import fs from "node:fs";
import path from "node:path";

export const DOMAIN = "https://www.futbolradar.com";
const SKIP_DIRS = new Set(["public", "node_modules", ".git", ".vercel", ".claude", "reports"]);

export function loadConfig(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const compile = (rule) => {
    const params = [];
    const escaped = String(rule.source)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:([A-Za-z0-9_]+)(\\\*)?/g, (_, name, star) => {
        params.push(name);
        return star ? "(.*)" : "([^/]+)";
      });
    return { regex: new RegExp(`^${escaped}$`), params, destination: String(rule.destination || ""), source: rule.source };
  };
  // Koşullu (host) kurallar kanonik konakta çalışmaz.
  const redirects = (config.redirects || []).filter((r) => r.source && r.destination && !r.has && !r.missing).map(compile);
  const rewrites = (config.rewrites || []).filter((r) => r.source && r.destination && !r.has && !r.missing).map(compile);
  // Parametresiz kurallar Map ile (binlerce kural var); parametreliler sırayla.
  const index = (rules) => ({
    exact: rules.reduce((map, r) => (r.params.length || map.has(r.source) ? map : map.set(r.source, r)), new Map()),
    patterns: rules.filter((r) => r.params.length || /[*()]/.test(r.source))
  });
  return { redirects, rewrites, redirectIndex: index(redirects), rewriteIndex: index(rewrites) };
}

function findRule(idx, urlPath) {
  const hit = idx.exact.get(urlPath);
  if (hit) return { rule: hit, match: [] };
  for (const rule of idx.patterns) {
    const match = rule.regex.exec(urlPath);
    if (match) return { rule, match };
  }
  return null;
}

function applyRule(rule, match) {
  const values = new Map(rule.params.map((name, i) => [name, match[i + 1] || ""]));
  return rule.destination.replace(/:([A-Za-z0-9_]+)\*?/g, (whole, name) => (values.has(name) ? values.get(name) : whole));
}

export function* htmlFiles(root, dir = root) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) && dir === root) continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(root, full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

export function createResolver(root, config = loadConfig(root)) {
  const existsCache = new Map();
  const isFile = (p) => {
    if (!existsCache.has(p)) {
      const full = path.join(root, decodeURIComponent(p));
      let ok = false;
      try { ok = fs.statSync(full).isFile(); } catch { ok = false; }
      existsCache.set(p, ok);
    }
    return existsCache.get(p);
  };
  const isDirWithIndex = (p) => isFile(`${p.replace(/\/$/, "")}/index.html`);

  /**
   * @returns {{status:"ok"|"redirect-ok"|"external"|"404", final:string, file?:string, hops:string[]}}
   */
  function resolve(urlPath) {
    let current = urlPath;
    const hops = [];
    for (let i = 0; i < 10; i += 1) {
      const found = findRule(config.redirectIndex, current);
      if (!found) break;
      const next = applyRule(found.rule, found.match);
      if (/^https?:\/\//i.test(next)) {
        if (next.startsWith(DOMAIN)) { hops.push(current); current = next.slice(DOMAIN.length) || "/"; continue; }
        return { status: "external", final: next, hops };
      }
      hops.push(current);
      current = next.split(/[?#]/)[0];
    }
    const base = { final: current, hops };
    // Vercel sunucusuz işlevleri: /api/<ad> (api/<ad>.js ya da api/[...route].js).
    if (/^\/api\/[^/]+$/.test(current) && (isFile(`${current}.js`) || isFile("/api/[...route].js"))) {
      return { ...base, status: hops.length ? "redirect-ok" : "ok", file: `${current}.js` };
    }
    if (current === "/" && isFile("/index.html")) return { ...base, status: hops.length ? "redirect-ok" : "ok", file: "/index.html" };
    if (isFile(current)) return { ...base, status: hops.length ? "redirect-ok" : "ok", file: current };
    if (isDirWithIndex(current)) return { ...base, status: hops.length ? "redirect-ok" : "ok", file: `${current.replace(/\/$/, "")}/index.html` };
    {
      const found = findRule(config.rewriteIndex, current);
      const dest = found ? applyRule(found.rule, found.match) : null;
      if (!dest) return { ...base, status: "404" };
      if (dest.startsWith("/api/") || /^https?:/i.test(dest)) return { ...base, status: hops.length ? "redirect-ok" : "ok", file: dest };
      if (isFile(dest)) return { ...base, status: hops.length ? "redirect-ok" : "ok", file: dest };
    }
    return { ...base, status: "404" };
  }
  return { resolve, isFile };
}

/** Sayfanın sunulduğu URL yolları (yönlendirme tarafından başka yere alınmayanlar). */
export function servingUrls(relFile, resolver) {
  const file = `/${relFile}`;
  const candidates = new Set([file]);
  if (file.endsWith("/index.html")) {
    const dir = file.slice(0, -"/index.html".length);
    // trailingSlash:false → `/dir/` 308 ile `/dir`e gider; yalnızca kökün eğik çizgisi kalır.
    if (!dir) candidates.add("/");
    else candidates.add(dir);
  } else candidates.add(file.slice(0, -5));
  const urls = [];
  for (const url of candidates) {
    const result = resolver.resolve(url);
    if ((result.status === "ok") && result.file === file) urls.push(url);
    else if (result.status === "redirect-ok") continue;
  }
  return urls.length ? urls : [file];
}

const SKIP_SCHEME = /^(mailto:|tel:|javascript:|data:|blob:|sms:|whatsapp:|#)/i;

/** href'i sayfanın sunulduğu adrese göre kök yoluna çevirir; iç bağlantı değilse null. */
export function toRootPath(href, pageUrl) {
  let value = String(href || "").trim().replace(/&amp;/g, "&");
  if (!value || SKIP_SCHEME.test(value)) return null;
  if (value.startsWith(DOMAIN)) value = value.slice(DOMAIN.length) || "/";
  else if (/^(https?:)?\/\//i.test(value)) return null;
  const clean = value.split(/[?#]/)[0];
  if (!clean) return null;
  const resolved = new URL(clean, `https://x.invalid${pageUrl}`);
  return decodeURI(resolved.pathname);
}

export function extractAnchors(html) {
  const out = [];
  const stripped = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of stripped.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) out.push(m[1] ?? m[2]);
  return out;
}

export function audit(root, { filter = () => true } = {}) {
  const resolver = createResolver(root);
  const broken = [];      // {page, url, href, target, final}
  const redirected = [];
  const stats = { pages: 0, links: 0, unique: new Set() };
  for (const full of htmlFiles(root)) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (!filter(rel)) continue;
    stats.pages += 1;
    const html = fs.readFileSync(full, "utf8");
    const anchors = extractAnchors(html);
    for (const pageUrl of servingUrls(rel, resolver)) {
      for (const href of anchors) {
        const target = toRootPath(href, pageUrl);
        if (target == null) continue;
        stats.links += 1;
        stats.unique.add(target);
        const result = resolver.resolve(target);
        if (result.status === "404") broken.push({ page: rel, pageUrl, href, target });
        else if (result.status === "redirect-ok") redirected.push({ page: rel, pageUrl, href, target, final: result.final });
      }
    }
  }
  return { broken, redirected, stats, resolver };
}

const META_TAG = /<link\b[^>]*>/gi;
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]) : null;
};

/** Sayfanın <head> canonical + hreflang bildirimleri. */
export function extractSeoLinks(html) {
  const head = html.split(/<\/head>/i)[0] || html;
  let canonical = null;
  const alternates = [];
  for (const tag of head.match(META_TAG) || []) {
    const rel = (attr(tag, "rel") || "").toLowerCase();
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel === "canonical") canonical = href;
    else if (rel === "alternate" && attr(tag, "hreflang")) alternates.push({ lang: attr(tag, "hreflang"), href });
  }
  const robots = /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i.exec(head);
  return { canonical, alternates, noindex: Boolean(robots && /noindex/i.test(robots[1])) };
}

/**
 * Canonical / hreflang denetimi.
 *  - canonical bir iç sayfaya çıkmalı ve (yönlendirmesiz) AYNI dosyaya çözülmeli;
 *  - her hreflang hedefi 200 olmalı;
 *  - /en sayfası bir tr-TR eşi bildiriyorsa eş de /en sayfasına geri bildirmeli.
 */
export function auditSeo(root, { filter = () => true } = {}) {
  const resolver = createResolver(root);
  const problems = [];
  const info = new Map(); // file -> seo
  info.canonicalElsewhere = 0;
  const files = [];
  for (const full of htmlFiles(root)) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (!filter(rel)) continue;
    const html = fs.readFileSync(full, "utf8");
    const seo = extractSeoLinks(html);
    info.set(`/${rel}`, seo);
    files.push(rel);
  }
  const toPath = (u) => (u.startsWith(DOMAIN) ? u.slice(DOMAIN.length) || "/" : null);
  for (const rel of files) {
    const seo = info.get(`/${rel}`);
    if (seo.noindex) continue;
    const self = `/${rel}`;
    if (seo.canonical) {
      const p = toPath(seo.canonical);
      if (p == null) problems.push({ page: rel, kind: "canonical-external", href: seo.canonical });
      else {
        const res = resolver.resolve(p);
        if (res.status === "404") problems.push({ page: rel, kind: "canonical-404", href: seo.canonical });
        else if (res.status === "redirect-ok") problems.push({ page: rel, kind: "canonical-redirects", href: seo.canonical, final: res.final });
        else if (res.file !== self) info.canonicalElsewhere = (info.canonicalElsewhere || 0) + 1; // çoğaltılmış sayfanın asıl sayfaya kanoniği: geçerli
      }
    }
    for (const alt of seo.alternates) {
      const p = toPath(alt.href);
      if (p == null) { problems.push({ page: rel, kind: "hreflang-external", lang: alt.lang, href: alt.href }); continue; }
      const res = resolver.resolve(p);
      if (res.status === "404") problems.push({ page: rel, kind: "hreflang-404", lang: alt.lang, href: alt.href });
      else if (res.status === "redirect-ok") problems.push({ page: rel, kind: "hreflang-redirects", lang: alt.lang, href: alt.href, final: res.final });
      else if (/^(en|tr)/i.test(alt.lang) && res.file && res.file !== self) {
        // Karşılıklılık: eşin hreflang listesi bu sayfanın canonical'ını içermeli.
        const peer = info.get(res.file);
        const mine = seo.canonical;
        // Eş, bu sayfanın ADRESİNİ değil bu sayfanın DOSYASINI göstermeli
        // (kanonik uzantısız, hreflang uzantılı yazılmış olsa da aynı sayfa).
        const points = peer && peer.alternates.some((a) => {
          const target = toPath(a.href);
          if (target == null) return false;
          const hit = resolver.resolve(target);
          return hit.file === self || a.href === mine;
        });
        if (peer && mine && !points) {
          problems.push({ page: rel, kind: "hreflang-not-reciprocal", lang: alt.lang, href: alt.href, peer: res.file });
        }
      }
    }
  }
  return { problems, pages: files.length, canonicalElsewhere: info.canonicalElsewhere };
}

/** sitemap.xml <loc> adreslerinin hepsi 200 olmalı. */
export function auditSitemap(root, file = "sitemap.xml") {
  const resolver = createResolver(root);
  const xml = fs.readFileSync(path.join(root, file), "utf8");
  const bad = [];
  let total = 0;
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    total += 1;
    const url = m[1].trim();
    if (!url.startsWith(DOMAIN)) continue;
    const p = decodeURI(url.slice(DOMAIN.length) || "/").split(/[?#]/)[0];
    const res = resolver.resolve(p);
    if (res.status !== "ok") bad.push({ url, status: res.status, final: res.final });
  }
  return { total, bad };
}

/**
 * Dil değiştirici (data-lang-switch) bağlantısı, sayfanın hreflang eşiyle AYNI
 * dosyaya gitmeli; aksi hâlde kullanıcı bir dile geçerken başka içeriğe düşer.
 */
export function auditLangSwitch(root) {
  const resolver = createResolver(root);
  const problems = [];
  let checked = 0;
  for (const full of htmlFiles(root)) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    const html = fs.readFileSync(full, "utf8");
    const switches = [...html.matchAll(/<a\b[^>]*\bdata-lang-switch="([a-z-]+)"[^>]*>/gi)];
    if (!switches.length) continue;
    const seo = extractSeoLinks(html);
    for (const [tag, lang] of switches) {
      const href = attr(tag, "href");
      if (!href) continue;
      checked += 1;
      const pageUrl = servingUrls(rel, resolver)[0];
      const target = toRootPath(href, pageUrl);
      const hit = target == null ? null : resolver.resolve(target);
      if (!hit || hit.status === "404") { problems.push({ page: rel, kind: "switch-404", lang, href }); continue; }
      const alt = seo.alternates.find((a) => a.lang.toLowerCase().startsWith(lang.toLowerCase()));
      if (!alt) continue; // hreflang yoksa ayrı denetimler yakalar
      const altPath = alt.href.startsWith(DOMAIN) ? alt.href.slice(DOMAIN.length) || "/" : null;
      const altHit = altPath ? resolver.resolve(altPath) : null;
      const finalOf = (r) => r && (r.file || r.final);
      if (altHit && finalOf(altHit) !== finalOf(hit)) problems.push({ page: rel, kind: "switch-differs-from-hreflang", lang, href, hreflang: alt.href });
    }
  }
  return { checked, problems };
}
