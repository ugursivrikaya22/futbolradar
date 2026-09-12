/**
 * MAÇ ADRESİ BİRLEŞTİRME — TEK KANONİK ADRES: `/mac/<takimlar>-<gun>-<ay>-<yil>`
 *
 * Sorun: aynı karşılaşma sitede üç ayrı adreste yayındaydı ve üçü de
 * indekslenebilirdi.
 *
 *   • `/mac/trabzonspor-genclerbirligi-6-eylul-2026`      (maç öncesi, dolu)
 *   • `/mac/trabzonspor-genclerbirligi-2026-2027-r04.html` (fikstür turu)
 *   • `/mac-raporu/trabzonspor-genclerbirligi-2026-09-06.html` (maç sonu)
 *
 * Üçü de "trabzonspor gençlerbirliği maç" sorgusunu hedefliyor. Google bunu
 * kanibalizasyon olarak okuyup üçünü birden geriye itiyor; otorite üç adrese
 * bölünüyor ve hiçbiri eşiği geçemiyor.
 *
 * KARAR: tarih slug'lı `/mac/...` sayfası TEK kanonik adres. Maç öncesi de
 * maç sonrası da aynı URL'de yaşar; arama trafiği maç öncesinde birikmeye
 * başlar ve maç bitince de aynı sayfaya iner.
 *
 * Bu betik kanonikleştirmeyi ÜRETİMDEN SONRA, tek geçişte yapar. Neden
 * üreticilerin içinde değil: hedef sayfayı `generate-match-seo-pages.mjs`
 * üretiyor ve derleme sırasında hem `generate-match-pages.mjs` (tur
 * sayfaları) hem `generate-post-match-pages.mjs` (raporlar) ondan ÖNCE
 * koşuyor. İkisi de kendi kanoniğini yazarken hedefin var olup olmadığını
 * bilemez. Zincirin sonunda ise disk gerçeği bellidir: hangi maçın tarih
 * slug'lı sayfası varsa yalnızca onun kopyaları birleştirilir.
 *
 * KİMLİK JSON-LD'DEN OKUNUR, dosya adından değil. Tur sayfasının slug'ında
 * tarih yoktur (`...-2026-2027-r04`), rapor sayfasınınkinde ise ISO tarih
 * vardır (`...-2026-09-06`); ikisini de aynı kimliğe indirgeyen tek ortak
 * veri sayfanın `SportsEvent` düğümüdür (ev sahibi, deplasman, başlangıç).
 * Slug üretimi `services/matchSeoPages.js` ile AYNI fonksiyondan geçer —
 * ikinci bir slug lehçesi doğmasın diye.
 *
 * Hedefi olmayan sayfaya DOKUNULMAZ. Tarihi henüz kesinleşmemiş tur
 * sayfasının (`SportsEvent` düğümü yoktur) ve `/mac/` karşılığı hiç
 * üretilmemiş raporun tek adresi kendisidir; onu başka bir yere işaret
 * ettirmek sayfayı indeksten düşürür, kimseyi kurtarmaz.
 *
 * Hiçbir dosya silinmez: kopyalar diskte kalır, yalnızca arama motoruna
 * "asıl adres şu" der ve site haritasından çıkar.
 *
 * `--check` yazarsa hiçbir şey yazmaz; birleştirilmemiş kopya kalmışsa
 * sıfırdan farklı kodla çıkar (CI kapısı).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { trSlugFor } = require("../services/matchSeoPages.js");

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const CHECK_ONLY = process.argv.includes("--check");

/** Kanonik aile: tarih slug'lı maç sayfası. */
const DATE_SLUG_RE = /-\d{1,2}-[a-zçğıöşü]+-\d{4}\.html$/;
/** Kopya aile 1: sezon + tur numaralı fikstür sayfası. */
const ROUND_SLUG_RE = /-\d{4}-\d{4}-r\d{2}\.html$/;
/** Kopya aile 2: kök dizindeki eski `<takimlar>-mac-analizi.html` deseni. */
const LEGACY_ANALYSIS_RE = /^[a-z0-9-]+-mac-analizi\.html$/;

/** Tarama dışı: bağımlılıklar, git, üretilmeyen kaynaklar. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "work", "outputs"]);

function walkHtml(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkHtml(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.name.endsWith(".html")) out.push(path.join(dir, entry.name));
  }
  return out;
}

/**
 * Sayfanın `<head>` JSON-LD'sinden `SportsEvent` düğümü.
 *
 * Üreticiler şemayı bazen tek nesne, bazen `@graph` dizisi olarak basıyor;
 * ikisi de okunur. Ayrıştırılamayan blok sessizce atlanır — burada amaç
 * doğrulama değil kimlik çıkarmak; bozuk JSON-LD'yi `test-seo-integrity`
 * zaten yakalıyor.
 */
function sportsEventOf(html) {
  for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed["@graph"]) ? parsed["@graph"] : [parsed];
    for (const node of nodes) {
      if (node && node["@type"] === "SportsEvent") return node;
    }
  }
  return null;
}

const teamName = (value) => (value && typeof value === "object" ? value.name : (typeof value === "string" ? value : null));

/** Sayfanın temsil ettiği maçın kanonik slug'ı — çıkaramazsa `null`. */
function slugOf(html) {
  const event = sportsEventOf(html);
  if (!event) return null;
  const home = teamName(event.homeTeam);
  const away = teamName(event.awayTeam);
  if (!home || !away || !event.startDate) return null;
  return trSlugFor(home, away, event.startDate);
}

const relative = (file) => path.relative(root, file).split(path.sep).join("/");

// ── 1. HEDEF DİZİNİ ───────────────────────────────────────────────────────
//
// Yalnızca kök `mac/` taranır. `public/` bir AYNA: aynı maçı ikinci kez
// hedef diye kaydetmek kimliği çakıştırır, kaynağı belirsizleştirir.
const targets = new Map();
for (const file of walkHtml(path.join(root, "mac"))) {
  if (!DATE_SLUG_RE.test(path.basename(file))) continue;
  const slug = slugOf(fs.readFileSync(file, "utf8"));
  if (slug) targets.set(slug, `mac/${slug}.html`);
}

// ── 2. KOPYALARIN EŞLEŞTİRİLMESİ ──────────────────────────────────────────
//
// `duplicates`: kopya sayfanın kök-göreli yolu → hedef slug.
// `orphans`: hedefi olmayan kopyalar; rapor edilir, DOKUNULMAZ.
const duplicates = new Map();
const orphans = { reports: [], rounds: [], legacy: [] };

for (const dirName of ["mac-raporu", "mac"]) {
  for (const file of walkHtml(path.join(root, dirName))) {
    const base = path.basename(file);
    const isReport = dirName === "mac-raporu";
    if (!isReport && !ROUND_SLUG_RE.test(base)) continue;

    const slug = slugOf(fs.readFileSync(file, "utf8"));
    const target = slug ? targets.get(slug) : null;
    if (!target) {
      (isReport ? orphans.reports : orphans.rounds).push(relative(file));
      continue;
    }
    duplicates.set(relative(file), slug);
  }
}

// Kök dizindeki eski desen: `<takimlar>-mac-analizi.html`. `/mac/` ve
// `/mac-raporu/` doğmadan önce maç sayfaları buraya basılıyordu. Dosyalar
// silinmiyor; adresleri kalıcı yönlendirmeye bağlanacağı için (bkz.
// `legacyRedirects`) iç bağlantıları ve site haritası kaydı da taşınır.
const legacyRedirects = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isFile() || !LEGACY_ANALYSIS_RE.test(entry.name)) continue;
  const slug = slugOf(fs.readFileSync(path.join(root, entry.name), "utf8"));
  const target = slug ? targets.get(slug) : null;
  if (!target) {
    orphans.legacy.push(entry.name);
    continue;
  }
  duplicates.set(entry.name, slug);
  legacyRedirects.push({ source: `/${entry.name}`, destination: `/mac/${slug}`, permanent: true });
}

// ── 3. ADRES DEĞİŞTİRME TABLOSU ───────────────────────────────────────────
//
// Kopyanın adresi metinde üç biçimde geçiyor ve ÜÇÜ DE değişmeli, yoksa
// sayfa kendi kanoniğiyle çelişir:
//
//   a) mutlak       — canonical, og:url, JSON-LD `url`, `data-share-text`
//   b) göreli href  — iç bağlantılar (`./`, `../`, `/` önekleriyle)
//   c) yüzde kodlu  — paylaş bağlantılarındaki `?url=` parametresi
//
// Hedef adres UZANTISIZ yazılır: sitenin kendi konvansiyonu bu — tarih
// slug'lı sayfalara giden iç bağlantıların tamamı uzantısız — ve
// `vercel.json` rewrite'ı `/mac/:slug` → `/mac/:slug.html` çözüyor.
const DOMAIN_ENCODED = encodeURIComponent(`${DOMAIN}/`);

/** Kopya yolundan hedef adres; kopya değilse `null`. */
function targetUrlFor(duplicatePath) {
  const slug = duplicates.get(duplicatePath);
  return slug ? `${DOMAIN}/mac/${slug}` : null;
}

/**
 * Mutlak adres: canonical, `og:url`, JSON-LD `url` ve `data-share-text`.
 * Uzantı isteğe bağlı — site haritası uzantısız, sayfa içi uzantılı yazıyor.
 */
const ABSOLUTE_RE = new RegExp(`${DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/((?:mac-raporu|mac)/[a-z0-9-]+|[a-z0-9-]+-mac-analizi)(\\.html)?`, "g");

/** Paylaş bağlantısının `?url=` parametresindeki yüzde kodlu hâli. */
const ENCODED_RE = new RegExp(`${DOMAIN_ENCODED.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}((?:mac-raporu|mac)%2F[a-z0-9-]+|[a-z0-9-]+-mac-analizi)(\\.html)?`, "gi");

/**
 * Göreli iç bağlantı: `href="./mac-raporu/x.html"` → `href="./mac/y"`.
 *
 * Önek (`./`, `../`, `../../`, `/`) korunur; sayfanın derinliği bilinmeden
 * doğru göreli adres yazılamaz. Kendine giden bağlantı üretilmez: hedefin
 * kendisi olan sayfada bağlantı olduğu gibi bırakılır.
 */
const HREF_RE = /href="((?:\.{1,2}\/)*|\/)((?:mac-raporu|mac)\/[a-z0-9-]+|[a-z0-9-]+-mac-analizi)\.html"/g;

/**
 * `hreflang` bildirimleri BU GEÇİŞİN DIŞINDA.
 *
 * hreflang canonical'dan ayrı bir mekanizma ve tek kuralı KARŞILIKLILIK:
 * TR sayfası EN eşini gösteriyorsa EN sayfası da aynı TR adresini geri
 * göstermeli. Kopya sayfanın tr-TR bildirimini kanonik hedefe çevirmek bu
 * halkayı tek yönlü kırıyor — EN eşi hâlâ kopyanın adresini gösteriyor,
 * kopya ise artık başka bir adresi. Google tek yönlü bildirimi yok sayar ve
 * o maçın İngilizce sayfası da indekslenmez.
 *
 * Kopyada hreflang'in olduğu gibi kalması zararsız: Google kanonik olmayan
 * bir sayfanın hreflang bildirimlerini zaten okumuyor. Kırık halka ise
 * zararlı. Bu yüzden etiketler maskelenip geçişten sonra aynen geri konur.
 */
const HREFLANG_TAG_RE = /<link\s+rel="alternate"\s+hreflang="[^"]*"\s+href="[^"]*"\s*\/?>/g;
const HREFLANG_MASK = "\u0000hreflang\u0000";

function rewrite(html, selfRelative) {
  const preserved = [];
  let next = html.replace(HREFLANG_TAG_RE, (tag) => {
    preserved.push(tag);
    return HREFLANG_MASK;
  });

  next = next.replace(ABSOLUTE_RE, (match, body) => targetUrlFor(`${body}.html`) || match);

  next = next.replace(ENCODED_RE, (match, body) => {
    const decoded = body.replace(/%2F/gi, "/");
    const target = targetUrlFor(`${decoded}.html`);
    return target ? encodeURIComponent(target) : match;
  });

  next = next.replace(HREF_RE, (match, prefix, body) => {
    const slug = duplicates.get(`${body}.html`);
    if (!slug) return match;
    if (`mac/${slug}.html` === selfRelative) return match;
    return `href="${prefix}mac/${slug}"`;
  });

  let restored = 0;
  return next.replace(new RegExp(HREFLANG_MASK, "g"), () => preserved[restored++]);
}

// ── 4. UYGULAMA ───────────────────────────────────────────────────────────
const changed = [];
for (const file of walkHtml(root)) {
  const html = fs.readFileSync(file, "utf8");
  const next = rewrite(html, relative(file));
  if (next === html) continue;
  changed.push(relative(file));
  if (!CHECK_ONLY) fs.writeFileSync(file, next, "utf8");
}

// ── 5. SİTE HARİTASI ──────────────────────────────────────────────────────
//
// Kanonik olmayan adres site haritasında durmamalı: Google'a "bunu indeksle"
// derken sayfanın kendisi "asıl adres başka" diyor; iki sinyal çelişiyor.
// Yalnızca BİRLEŞTİRİLMİŞ kopyalar çıkarılır — hedefi olmayan tur sayfası
// hâlâ o maçın tek adresi, site haritasında kalır.
const prunedUrls = [...duplicates.keys()].flatMap((file) => [
  `${DOMAIN}/${file}`,
  `${DOMAIN}/${file.replace(/\.html$/, "")}`
]);

let prunedCount = 0;
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const xml = fs.readFileSync(sitemapPath, "utf8");
  let next = xml;
  for (const url of prunedUrls) {
    const pattern = new RegExp(`[ \\t]*<url>\\s*<loc>${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?</url>\\n?`, "g");
    next = next.replace(pattern, () => {
      prunedCount += 1;
      return "";
    });
  }
  if (next === xml) continue;
  if (!CHECK_ONLY) fs.writeFileSync(sitemapPath, next, "utf8");
}

// ── 6. RAPOR ──────────────────────────────────────────────────────────────
const reportDuplicates = [...duplicates.keys()].filter((file) => file.startsWith("mac-raporu/"));
const roundDuplicates = [...duplicates.keys()].filter((file) => file.startsWith("mac/"));

console.log(`[mac-canonical] hedef (tarih slug'lı /mac/ sayfası): ${targets.size}`);
console.log(`[mac-canonical] birleştirilen rapor sayfası: ${reportDuplicates.length}`);
console.log(`[mac-canonical] birleştirilen tur sayfası: ${roundDuplicates.length}`);
console.log(`[mac-canonical] hedefi olmayan rapor (dokunulmadı): ${orphans.reports.length}`);
console.log(`[mac-canonical] hedefi olmayan tur sayfası (dokunulmadı): ${orphans.rounds.length}`);
console.log(`[mac-canonical] eski kök deseni yönlendirmeye bağlandı: ${legacyRedirects.length}`);
if (orphans.legacy.length > 0) {
  console.log(`[mac-canonical] karşılığı olmayan eski kök sayfası (yönlendirme YAZILMADI): ${orphans.legacy.join(", ")}`);
}
console.log(`[mac-canonical] güncellenen dosya: ${changed.length}`);
console.log(`[mac-canonical] site haritasından çıkarılan adres: ${prunedCount}`);

if (!CHECK_ONLY) {
  const reportPath = path.join(root, "data", "match-canonical-report.json");
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        targets: targets.size,
        unified: { reports: reportDuplicates.length, rounds: roundDuplicates.length },
        legacyRedirects,
        withoutTarget: orphans
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

if (CHECK_ONLY && (changed.length > 0 || prunedCount > 0)) {
  console.error(`[mac-canonical] birleştirilmemiş kopya var: ${changed.slice(0, 5).join(", ")}`);
  process.exit(1);
}
