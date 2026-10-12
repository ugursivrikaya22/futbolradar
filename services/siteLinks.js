/**
 * İÇ BAĞLANTI — TEK ÇÖZÜCÜ (Görev 5, 1. aşama).
 *
 * Sitede ~24 bin iç bağlantı 301 ile yönlendirilen bir adrese gidiyordu
 * (`/futbolcu/<slug>.html`, `/super-lig-puan-durumu.html` …). Sebep:
 * üreticiler dosya yolunu (uzantılı) href olarak basıyor, kanonik adres
 * ise uzantısız ve `vercel.json` aradaki farkı 301 ile kapatıyor.
 *
 * Bu modül bağlantının SON adresini `vercel.json`'daki koşulsuz
 * `redirects` kurallarından hesaplar ve üreten sayfanın dizinine göre
 * göreli href döndürür. Yeni bir 301 eklendiğinde bu fonksiyonu kullanan
 * her üretici kendiliğinden yeni adrese bağlanır.
 *
 * 1. aşamada yalnızca yardımcı ve koruma testi eklenir; üreticiler sonraki
 * aşamalarda (bkz. reports/plan-gorev5.md) tek tek bu fonksiyona geçer.
 */
const fs = require("node:fs");
const path = require("node:path");

const MAX_HOPS = 5;
const DOMAIN = "https://www.futbolradar.com";

function compileRule(rule) {
  const params = [];
  const escaped = String(rule.source)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([A-Za-z0-9_]+)(\\\*)?/g, (_, name, star) => {
      params.push(name);
      return star ? "(.+)" : "([^/]+)";
    });
  return { regex: new RegExp(`^${escaped}$`), params, source: rule.source, destination: String(rule.destination || "") };
}

/**
 * @param {object} [vercelConfig] vercel.json içeriği; verilmezse kökten okunur.
 */
function createSiteLinks(vercelConfig) {
  const config = vercelConfig || JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  // Koşullu kurallar (has/missing — ör. apex → www) kanonik konakta
  // çalışmaz; hesaba katılmaz.
  const rules = (config.redirects || [])
    .filter((rule) => rule && rule.source && rule.destination && !rule.has && !rule.missing)
    .map(compileRule);
  const exact = new Map(rules.filter((rule) => !rule.params.length).map((rule) => [rule.source, rule]));
  const patterns = rules.filter((rule) => rule.params.length);

  /** Bu kök yolu (/x/y) için ilk eşleşen koşulsuz yönlendirme kuralı. */
  function matchRedirect(urlPath) {
    const hit = exact.get(urlPath);
    if (hit) return { rule: hit, match: [] };
    for (const rule of patterns) {
      const match = rule.regex.exec(urlPath);
      if (match) return { rule, match };
    }
    return null;
  }

  function applyRule(found) {
    const { rule, match } = found;
    const values = new Map(rule.params.map((name, index) => [name, match[index + 1] || ""]));
    return rule.destination.replace(/:([A-Za-z0-9_]+)\*?/g, (whole, name) => (values.has(name) ? values.get(name) : whole));
  }

  /** Yol bir 301 kaynağı mı? */
  function isRedirected(urlPath) {
    return Boolean(matchRedirect(splitPath(urlPath).pathname));
  }

  /**
   * Zinciri izleyip son adresi döndürür (kök göreli, `/` ile başlar).
   * Döngü ya da site dışı hedefte en son iç adreste durur.
   */
  function resolveFinalPath(urlPath) {
    const { pathname, suffix } = splitPath(urlPath);
    let current = pathname;
    const seen = new Set([current]);
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const found = matchRedirect(current);
      if (!found) break;
      const next = applyRule(found);
      if (/^https?:\/\//i.test(next) || seen.has(next)) break;
      seen.add(next);
      current = next;
    }
    return current + suffix;
  }

  /**
   * Göreli href.
   *
   * @param {string} target kök göreli yol ya da dosya yolu ("futbolcu/x.html",
   *   "/super-lig-puan-durumu.html"); mutlak site adresi de kabul edilir.
   * @param {{from?: string}} [options] bağlantıyı basan sayfanın kök göreli
   *   dosya yolu ("mac/a-b.html"); verilmezse kök ("index.html") varsayılır.
   */
  function internalHref(target, options = {}) {
    const raw = String(target || "");
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw) && !raw.startsWith(DOMAIN)) return raw;
    const rootPath = raw.startsWith(DOMAIN) ? raw.slice(DOMAIN.length) || "/" : `/${raw.replace(/^\.?\//, "")}`;
    const finalPath = resolveFinalPath(rootPath);
    return relativeFrom(options.from || "index.html", finalPath);
  }

  return { internalHref, isRedirected, resolveFinalPath, matchRedirect, ruleCount: rules.length };
}

function splitPath(urlPath) {
  const value = String(urlPath || "");
  const index = value.search(/[?#]/);
  return index === -1 ? { pathname: value, suffix: "" } : { pathname: value.slice(0, index), suffix: value.slice(index) };
}

/** Kök göreli hedefi, `from` sayfasının dizinine göre "./" ya da "../" önekli yola çevirir. */
function relativeFrom(fromFile, rootTarget) {
  const fromDir = path.posix.dirname(String(fromFile).replace(/^\.?\//, ""));
  const { pathname, suffix } = splitPath(rootTarget);
  const target = pathname.replace(/^\//, "");
  if (!target) return `${fromDir === "." ? "./" : "../".repeat(fromDir.split("/").length)}${suffix}`;
  let relative = path.posix.relative(fromDir === "." ? "" : fromDir, target);
  if (!relative.startsWith("../")) relative = `./${relative}`;
  return relative + suffix;
}

let defaultInstance = null;
function defaultSiteLinks() {
  if (!defaultInstance) defaultInstance = createSiteLinks();
  return defaultInstance;
}

module.exports = {
  createSiteLinks,
  defaultSiteLinks,
  relativeFrom,
  internalHref: (target, options) => defaultSiteLinks().internalHref(target, options)
};
