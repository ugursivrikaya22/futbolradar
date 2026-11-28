/**
 * GOOGLE DISCOVER GÖRSEL VE META KURALI — TEK TANIM.
 *
 * Discover bir yazıyı akışa almadan önce üç şeye bakıyor:
 *
 *   1. BÜYÜK GÖRSEL. En az 1200 px genişliğinde ve `max-image-preview:large`
 *      ile kullanılmasına izin verilmiş bir görsel. Haber ve köşe yazısı
 *      sayfalarının hepsi `og:image` olarak 1200×630 marka görselini
 *      (`assets/og-image.png`) bildiriyordu: 1,9:1 oranlı ve 2.000 sayfada
 *      aynı dosya. Discover akış kartı 16:9 kırpıyor ve "site logosu"nu
 *      görsel olarak kabul etmiyor.
 *   2. YAPISAL VERİ. `NewsArticle`/`Article` içinde `headline`,
 *      `datePublished`, `dateModified`, `author`, `publisher` (+ `logo`) ve
 *      `image`. `publisher.logo` olarak da 1200×630 paylaşım görseli
 *      bildiriliyordu — logo değil, kapak.
 *   3. ROBOTS. `max-image-preview:large` olmadan büyük önizleme hiç
 *      değerlendirilmiyor.
 *
 * ── GÖRSEL SEÇİMİ (ilk bulunan kazanır) ──────────────────────────────────
 *
 *   a. Yazıya özel kart  `assets/discover/<tür>/<slug>.jpg` — sayfanın
 *      kendi H1 başlığıyla üretilmiş 1200×675 kart, ya da köşe yazısının
 *      kendi kapağından 16:9 kırpım. İndekslenebilir (Discover'a girebilen)
 *      her sayfa için `scripts/generate-discover-images.mjs` üretir.
 *   b. Konu kartı `assets/discover/konu/<takım>[-en].jpg` — takım/konu
 *      renkleriyle 1200×675. Yeni bir haber, kartı üretilene kadar bununla
 *      yayınlanır: hiçbir sayfa 16:9 görselsiz kalmaz.
 *   c. Varsayılan `assets/discover/konu/futbolradar.jpg`.
 *
 * ── DOKUNULMAYANLAR ──────────────────────────────────────────────────────
 *
 * URL, canonical, <title>, H1–H3, gövde metni ve mevcut başlık alanları
 * (`headline` dahil) DEĞİŞMEZ. Yalnızca eksik ya da yanlış görsel/meta
 * alanları tamamlanır. Dönüşüm idempotent: işlenmiş sayfada ikinci koşu
 * sıfır değişiklik üretir (`scripts/test-discover-media.mjs`).
 */
import fs from "node:fs";
import path from "node:path";

export const DOMAIN = "https://www.futbolradar.com";
export const DISCOVER_WIDTH = 1200;
export const DISCOVER_HEIGHT = 675;
/**
 * Sayfa içi görselin küçük varyantı (WebP). Paylaşım ve yapısal veri
 * 1200×675 JPEG'i bildirir; sayfanın kendisi `srcset` ile ekran
 * genişliğine uygun olanı indirir. Mobilde LCP görseli böylece ~4 kat
 * küçülür ve engelleyici CSS ile bant genişliği yarışmaz.
 */
export const DISCOVER_SMALL_WIDTH = 768;
export const DISCOVER_SIZES = "(max-width: 800px) calc(100vw - 24px), 760px";
export const DISCOVER_DIR = "assets/discover";
export const TOPIC_DIR = `${DISCOVER_DIR}/konu`;
export const DEFAULT_TOPIC = "futbolradar";
export const ROBOTS_LARGE_IMAGE = "max-image-preview:large";
export const PUBLISHER_NAME = "FutbolRadar";
export const PUBLISHER_LOGO = {
  "@type": "ImageObject",
  url: `${DOMAIN}/favicon-512x512.png`,
  width: 512,
  height: 512
};

/**
 * Haber ve köşe yazısı sayfalarının bulunduğu dizinler. `kind`, yazıya özel
 * kartın alt dizini; `depth`, sayfadan köke göreli yol.
 */
export const ARTICLE_SECTIONS = [
  { dir: "haber", kind: "haber", locale: "tr", type: "news", base: "../" },
  { dir: "kose-yazilari", kind: "kose-yazilari", locale: "tr", type: "column", base: "../" },
  { dir: "en/news", kind: "en-news", locale: "en", type: "news", base: "../../" },
  { dir: "en/columns", kind: "en-columns", locale: "en", type: "column", base: "../../" }
];

/**
 * KONULAR. `label` kartta basılan ad, `labelEn` İngilizce sayfadaki karşılığı
 * (yalnızca ad dile göre değişiyorsa). `match` sayfada takımı tanımak için
 * aranan yazımlar; `colors` kart vurgusu [ana, ikincil].
 */
export const TOPICS = [
  { slug: "galatasaray", label: "Galatasaray", colors: ["#a90432", "#fdb912"] },
  { slug: "fenerbahce", label: "Fenerbahçe", match: ["Fenerbahce"], colors: ["#163b8c", "#ffed00"] },
  { slug: "besiktas", label: "Beşiktaş", match: ["Besiktas"], colors: ["#e9e9e9", "#1a1a1a"] },
  { slug: "trabzonspor", label: "Trabzonspor", colors: ["#7a1f4f", "#5cb8e6"] },
  { slug: "turkiye", label: "Türkiye", labelEn: "Türkiye", match: ["A Millî Takım", "Milli Takım", "Turkey", "Turkiye"], colors: ["#e30a17", "#ffffff"] },
  { slug: "avrupa-futbolu", label: "Avrupa Futbolu", labelEn: "European Football", match: ["European Football"], colors: ["#1f4fd1", "#ffcc00"] },
  { slug: "super-lig", label: "Süper Lig", match: ["Super Lig"], colors: ["#0b8f5a", "#80ff9b"] },
  { slug: "basaksehir", label: "Başakşehir", match: ["Basaksehir"], colors: ["#ef7d00", "#1b2a4a"] },
  { slug: "samsunspor", label: "Samsunspor", colors: ["#e30a17", "#ffffff"] },
  { slug: "caykur-rizespor", label: "Çaykur Rizespor", match: ["Rizespor"], colors: ["#00843d", "#2b7fd1"] },
  { slug: "gaziantep-fk", label: "Gaziantep FK", match: ["Gaziantep"], colors: ["#e30613", "#1a1a1a"] },
  { slug: "antalyaspor", label: "Antalyaspor", colors: ["#e30613", "#ffffff"] },
  { slug: "kayserispor", label: "Kayserispor", colors: ["#ffd200", "#c8102e"] },
  { slug: "kasimpasa", label: "Kasımpaşa", match: ["Kasimpasa"], colors: ["#2a4fa0", "#ffffff"] },
  { slug: "eyupspor", label: "Eyüpspor", match: ["Eyupspor"], colors: ["#7b2fa8", "#ffd700"] },
  { slug: "alanyaspor", label: "Alanyaspor", colors: ["#f68b1f", "#00843d"] },
  { slug: "genclerbirligi", label: "Gençlerbirliği", match: ["Genclerbirligi"], colors: ["#e30613", "#1a1a1a"] },
  { slug: "kocaelispor", label: "Kocaelispor", colors: ["#00843d", "#1a1a1a"] },
  { slug: "konyaspor", label: "Konyaspor", colors: ["#00843d", "#ffffff"] },
  { slug: "sivasspor", label: "Sivasspor", colors: ["#e30613", "#ffffff"] },
  { slug: "goztepe", label: "Göztepe", match: ["Goztepe"], colors: ["#ffcc00", "#e30613"] },
  { slug: "corum-fk", label: "Çorum FK", match: ["Corum FK"], colors: ["#e30613", "#1a1a1a"] },
  { slug: "fatih-karagumruk", label: "Fatih Karagümrük", match: ["Karagümrük", "Karagumruk"], colors: ["#e30613", "#1a1a1a"] },
  { slug: "amed-sk", label: "Amed SK", match: ["Amed"], colors: ["#00843d", "#e30613"] },
  { slug: "erzurumspor", label: "Erzurumspor", colors: ["#1f5fbf", "#ffffff"] },
  { slug: "real-madrid", label: "Real Madrid", colors: ["#febe10", "#00529f"] },
  { slug: "barcelona", label: "Barcelona", colors: ["#a50044", "#004d98"] },
  { slug: "milan", label: "Milan", colors: ["#fb090b", "#1a1a1a"] },
  { slug: "inter", label: "Inter", colors: ["#1e3fbf", "#1a1a1a"] },
  { slug: "napoli", label: "Napoli", colors: ["#12a0d7", "#003c82"] },
  { slug: "lazio", label: "Lazio", colors: ["#87d8f7", "#15366f"] },
  { slug: "manchester-united", label: "Manchester United", colors: ["#da291c", "#fbe122"] },
  { slug: "manchester-city", label: "Manchester City", colors: ["#6cabdd", "#1c2c5b"] },
  { slug: "chelsea", label: "Chelsea", colors: ["#1f5fd1", "#dba111"] },
  { slug: "arsenal", label: "Arsenal", colors: ["#ef0107", "#ffffff"] },
  { slug: "liverpool", label: "Liverpool", colors: ["#c8102e", "#00b2a9"] },
  { slug: "tottenham", label: "Tottenham", colors: ["#e9e9e9", "#132257"] },
  { slug: "newcastle-united", label: "Newcastle United", colors: ["#e9e9e9", "#1a1a1a"] },
  { slug: "aston-villa", label: "Aston Villa", colors: ["#95bfe5", "#670e36"] },
  { slug: "borussia-dortmund", label: "Borussia Dortmund", match: ["Dortmund"], colors: ["#fde100", "#1a1a1a"] },
  { slug: "rb-leipzig", label: "RB Leipzig", colors: ["#dd0741", "#ffffff"] },
  { slug: "monaco", label: "Monaco", colors: ["#e30613", "#ffffff"] },
  { slug: "lyon", label: "Lyon", colors: ["#1f4fd1", "#e30613"] },
  { slug: "ajax", label: "Ajax", colors: ["#d2122e", "#ffffff"] },
  { slug: "olympiakos", label: "Olympiakos", match: ["Olympiacos"], colors: ["#e30613", "#ffffff"] },
  { slug: "shakhtar-donetsk", label: "Shakhtar Donetsk", colors: ["#f68b1f", "#1a1a1a"] },
  { slug: "villarreal", label: "Villarreal", colors: ["#ffe667", "#005187"] },
  { slug: "sevilla", label: "Sevilla", colors: ["#e30613", "#ffffff"] },
  { slug: "real-betis", label: "Real Betis", colors: ["#00954c", "#ffffff"] },
  { slug: "al-nassr", label: "Al Nassr", match: ["Al-Nassr"], colors: ["#ffd700", "#1f4fd1"] },
  { slug: DEFAULT_TOPIC, label: "FutbolRadar", colors: ["#80ff9b", "#4de5ff"] }
];

const TOPIC_BY_SLUG = new Map(TOPICS.map((topic) => [topic.slug, topic]));

export function topicBySlug(slug) {
  return TOPIC_BY_SLUG.get(slug) || TOPIC_BY_SLUG.get(DEFAULT_TOPIC);
}

/** Konu kartının dosyası; İngilizce adı farklı olan konunun ayrı kartı var. */
export function topicImagePath(slug, locale = "tr") {
  const topic = topicBySlug(slug);
  const localized = locale === "en" && topic.labelEn && topic.labelEn !== topic.label;
  return `${TOPIC_DIR}/${topic.slug}${localized ? "-en" : ""}.jpg`;
}

/** Konu kartları: her konu + adı İngilizcede değişenlerin İngilizce eşi. */
export function topicImageJobs() {
  const jobs = [];
  for (const topic of TOPICS) {
    jobs.push({ file: topicImagePath(topic.slug, "tr"), topic, label: topic.label });
    if (topic.labelEn && topic.labelEn !== topic.label) {
      jobs.push({ file: topicImagePath(topic.slug, "en"), topic, label: topic.labelEn });
    }
  }
  return jobs;
}

/** 1200 px JPEG'in küçük WebP eşi (`…-768.webp`). */
export function smallVariantPath(relative) {
  return relative.replace(/\.jpg$/i, `-${DISCOVER_SMALL_WIDTH}.webp`);
}

export function articleImagePath(section, slug) {
  return `${DISCOVER_DIR}/${section.kind}/${slug}.jpg`;
}

export function sectionForFile(relative) {
  const normalized = relative.split(path.sep).join("/").replace(/^public\//, "");
  const dir = path.posix.dirname(normalized);
  return ARTICLE_SECTIONS.find((section) => section.dir === dir) || null;
}

/** Bir dizindeki haber/köşe yazısı sayfaları (kök ve `public/` aynası). */
export function listArticlePages(root, { includePublic = true } = {}) {
  const out = [];
  for (const prefix of includePublic ? ["", "public/"] : [""]) {
    for (const section of ARTICLE_SECTIONS) {
      const dir = path.join(root, prefix + section.dir);
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) {
        if (!name.endsWith(".html")) continue;
        out.push({ relative: `${prefix}${section.dir}/${name}`, section, slug: name.slice(0, -5) });
      }
    }
  }
  return out;
}

// ── HTML yardımcıları ────────────────────────────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#039": "'", nbsp: " " };

export function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    const lower = code.toLowerCase();
    if (ENTITIES[lower] !== undefined) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return match;
  });
}

export function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Sayfanın görünen H1 metni (etiketler ayıklanmış, varlıklar çözülmüş). */
export function pageHeadline(html) {
  const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? decodeEntities(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
}

export function robotsContent(head) {
  return (head.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1] || "";
}

export function isIndexable(html) {
  const head = html.split(/<\/head>/i)[0];
  return !/noindex/i.test(robotsContent(head));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForMatch(value) {
  return ` ${String(value || "").toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ")} `;
}

function topicIn(text) {
  const haystack = normalizeForMatch(text);
  let best = null;
  for (const topic of TOPICS) {
    if (topic.slug === DEFAULT_TOPIC) continue;
    for (const name of [topic.label, topic.labelEn, ...(topic.match || [])].filter(Boolean)) {
      const index = haystack.indexOf(normalizeForMatch(name));
      if (index >= 0 && (!best || index < best.index)) best = { topic, index };
    }
  }
  return best ? best.topic : null;
}

/**
 * Sayfanın konusu. Öncelik sayfanın kendi beyanında: haber şeridindeki
 * takım bağlantısı, sonra köşe yazısının etiketleri, sonra H1, sonra
 * yapısal verideki anahtar kelimeler. Hiçbiri tanınmazsa varsayılan.
 */
export function detectTopic(html) {
  const strip = html.match(/<span>(?:Takım|Team)<\/span><b><a[^>]*>([^<]+)<\/a>/);
  const tags = [...html.matchAll(/<span class="column-tag">([^<]+)<\/span>/g)].map((m) => m[1]).join(" | ");
  const keywords = (html.match(/"keywords":"([^"]*)"/) || [])[1] || "";
  for (const text of [strip && strip[1], tags, pageHeadline(html), keywords]) {
    if (!text) continue;
    const topic = topicIn(decodeEntities(text));
    if (topic) return topic.slug;
  }
  return DEFAULT_TOPIC;
}

/** Sayfa için seçilen öne çıkan görsel (bkz. dosya başı: a → b → c). */
export function resolveFeaturedImage(root, page, html) {
  const own = articleImagePath(page.section, page.slug);
  const relative = fs.existsSync(path.join(root, own))
    ? own
    : topicImagePath(detectTopic(html), page.section.locale);
  const small = smallVariantPath(relative);
  const srcset = fs.existsSync(path.join(root, small))
    ? `/${small} ${DISCOVER_SMALL_WIDTH}w, /${relative} ${DISCOVER_WIDTH}w`
    : "";
  return {
    relative,
    srcset,
    url: `${DOMAIN}/${relative}`,
    // Kök-mutlak yol: sayfa hem `/haber/<slug>` hem `.html` ile sunuluyor;
    // göreli yol ikisinde farklı dizine çözülürdü.
    src: `/${relative}`,
    width: DISCOVER_WIDTH,
    height: DISCOVER_HEIGHT
  };
}

// ── Dönüşüm ──────────────────────────────────────────────────────────────

const ARTICLE_TYPES = new Set(["NewsArticle", "Article", "OpinionNewsArticle", "ReportageNewsArticle", "AnalysisNewsArticle", "BlogPosting"]);

function isArticleNode(node) {
  return node && typeof node === "object" && [].concat(node["@type"] || []).some((type) => ARTICLE_TYPES.has(type));
}

function setMeta(head, attr, name, content, afterPattern) {
  const tag = `<meta ${attr}="${name}" content="${escapeAttr(content)}" />`;
  // Aynı etiket birden çok kez basılmışsa (ör. iki `twitter:image`) hepsi
  // aynı değere çekilir; biri eski görseli göstermeye devam etmesin.
  const re = new RegExp(`<meta\\s+${attr}="${escapeRegExp(name)}"\\s+content="[^"]*"\\s*\\/?>`, "gi");
  if (re.test(head)) return head.replace(re, tag);
  const anchor = head.match(afterPattern);
  if (anchor) {
    const at = anchor.index + anchor[0].length;
    const indent = (head.slice(0, anchor.index).match(/\n([ \t]*)$/) || [])[1] ?? "    ";
    return `${head.slice(0, at)}\n${indent}${tag}${head.slice(at)}`;
  }
  return head.replace(/(\n?[ \t]*)$/, `\n    ${tag}$1`);
}

function firstTimeDatetime(html) {
  return (html.match(/<time\s+datetime="([^"]+)"/) || [])[1] || "";
}

function completeArticleNode(node, { image, headline, html }) {
  node.image = { "@type": "ImageObject", url: image.url, width: image.width, height: image.height };
  if (!node.headline && headline) node.headline = headline.length > 110 ? `${headline.slice(0, 109).trimEnd()}…` : headline;
  if (!node.datePublished) {
    const published = firstTimeDatetime(html);
    if (published) node.datePublished = published;
  }
  if (!node.dateModified && node.datePublished) node.dateModified = node.datePublished;

  const author = node.author;
  const authors = [].concat(author || []);
  if (!authors.length || authors.some((entry) => !entry || !entry.name)) {
    node.author = { "@type": "Organization", name: PUBLISHER_NAME, url: `${DOMAIN}/` };
  }

  const publisher = node.publisher && typeof node.publisher === "object" ? node.publisher : {};
  node.publisher = {
    ...publisher,
    "@type": "Organization",
    name: publisher.name || PUBLISHER_NAME,
    url: publisher.url || `${DOMAIN}/`,
    logo: { ...PUBLISHER_LOGO }
  };
  return node;
}

function transformJsonLd(head, context) {
  let found = 0;
  const out = head.replace(/(<script\b[^>]*type="application\/ld\+json"[^>]*>)([\s\S]*?)(<\/script>)/g, (whole, open, body, close) => {
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return whole;
    }
    const nodes = Array.isArray(data) ? data : Array.isArray(data["@graph"]) ? data["@graph"] : [data];
    const articles = nodes.filter(isArticleNode);
    if (!articles.length) return whole;
    found += articles.length;
    for (const node of articles) completeArticleNode(node, context);
    return `${open}${JSON.stringify(data).replace(/</g, "\\u003c")}${close}`;
  });
  return { head: out, found };
}

function transformHead(head, context) {
  const { image } = context;
  let out = head;

  // ROBOTS: mevcut yönerge (index/noindex) KORUNUR. Büyük önizleme izni
  // zaten varsa dokunulmaz; yoksa ayrı bir etiketle eklenir — Google aynı
  // sayfadaki robots etiketlerini birleştirir.
  if (!/max-image-preview:large/i.test(out)) {
    const robots = out.match(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i);
    const tag = `<meta name="robots" content="${ROBOTS_LARGE_IMAGE}" />`;
    if (robots) {
      const at = robots.index + robots[0].length;
      const indent = (out.slice(0, robots.index).match(/\n([ \t]*)$/) || [])[1] ?? "    ";
      out = `${out.slice(0, at)}\n${indent}${tag}${out.slice(at)}`;
    } else {
      out = setMeta(out, "name", "robots", ROBOTS_LARGE_IMAGE, /<link\s+rel="canonical"[^>]*>/i);
    }
  }

  out = setMeta(out, "property", "og:image", image.url, /<meta\s+property="og:description"[^>]*>/i);
  out = setMeta(out, "property", "og:image:width", String(image.width), /<meta\s+property="og:image"[^>]*>/i);
  out = setMeta(out, "property", "og:image:height", String(image.height), /<meta\s+property="og:image:width"[^>]*>/i);
  if (/<meta\s+property="og:image:type"/i.test(out)) {
    out = setMeta(out, "property", "og:image:type", "image/jpeg", /<meta\s+property="og:image:height"[^>]*>/i);
  }
  out = setMeta(out, "name", "twitter:card", "summary_large_image", /<meta\s+property="og:image:height"[^>]*>/i);
  out = setMeta(out, "name", "twitter:image", image.url, /<meta\s+name="twitter:description"[^>]*>/i);

  const { head: withLd } = transformJsonLd(out, context);
  return withLd;
}

function featuredImgTag(image, alt) {
  const responsive = image.srcset ? ` srcset="${escapeAttr(image.srcset)}" sizes="${DISCOVER_SIZES}"` : "";
  return `<img src="${escapeAttr(image.src)}"${responsive} alt="${escapeAttr(alt)}" width="${image.width}" height="${image.height}" loading="eager" fetchpriority="high" />`;
}

function transformBody(body, context) {
  const { image, headline } = context;
  let out = body;
  const figureRe = /<figure class="column-featured-image">\s*(<img\b[^>]*>)\s*<\/figure>/i;
  const existing = out.match(figureRe);
  let featuredStart = -1;

  if (existing) {
    const alt = decodeEntities((existing[1].match(/\balt="([^"]*)"/i) || [])[1] || "") || headline;
    const figure = `<figure class="column-featured-image">${featuredImgTag(image, alt)}</figure>`;
    featuredStart = existing.index;
    out = out.slice(0, existing.index) + figure + out.slice(existing.index + existing[0].length);
  } else {
    // Öne çıkan görsel yazının başlık bloğunun (<article> içindeki ilk
    // <header>) hemen ardına gelir: başlık, spot ve etiketlerden sonra,
    // gövde metninden önce.
    const article = out.search(/<article\b/i);
    const head = article >= 0 ? out.indexOf("<header", article) : -1;
    const close = head >= 0 ? out.indexOf("</header>", head) : -1;
    if (close >= 0) {
      const at = close + "</header>".length;
      const indent = (out.slice(0, head).match(/\n([ \t]*)$/) || [])[1] ?? "        ";
      const figure = `<figure class="column-featured-image">${featuredImgTag(image, headline)}</figure>`;
      out = `${out.slice(0, at)}\n${indent}${figure}${out.slice(at)}`;
      featuredStart = at;
    }
  }

  // Öne çıkan görsel DIŞINDAKİ gövde görselleri tembel yüklenir. İlk (öne
  // çıkan) görsel `fetchpriority="high"` ile öncelikli: LCP adayı odur.
  const featuredEnd = featuredStart >= 0 ? out.indexOf("</figure>", featuredStart) : -1;
  out = out.replace(/<img\b[^>]*>/gi, (tag, offset) => {
    if (featuredStart >= 0 && offset >= featuredStart && offset < featuredEnd) return tag;
    if (/\bloading=/i.test(tag)) return tag;
    return tag.replace(/<img\b/i, /\bdecoding=/i.test(tag) ? '<img loading="lazy"' : '<img loading="lazy" decoding="async"');
  });
  return out;
}

/**
 * Tek bir haber/köşe yazısı sayfasını Discover kuralına getirir.
 * Dönen `html` girişle aynıysa sayfa zaten uyumludur.
 */
export function applyDiscoverMedia(html, { root, page }) {
  const split = html.search(/<\/head>/i);
  if (split < 0) return { html, changed: false, image: null };
  const image = resolveFeaturedImage(root, page, html);
  const headline = pageHeadline(html);
  const context = { image, headline, html };
  const head = transformHead(html.slice(0, split), context);
  const body = transformBody(html.slice(split), context);
  const next = head + body;
  return { html: next, changed: next !== html, image };
}

/**
 * Üreticilerin yazma adımı için: dosya bir haber/köşe yazısı sayfasıysa
 * Discover dönüşümünü uygular, değilse HTML'i olduğu gibi döndürür.
 *
 * Son işlem zinciri (`inject-discover-media`) zaten her derlemede geçiyor;
 * bu kanca, zinciri koşturmadan sayfa üretip commit eden iş akışlarının
 * (Sporx keşfi, İngilizce haber tazelemesi, maç sonu köşe yazısı) depoya
 * eski görselli HTML yazmasını önler.
 */
export function withDiscoverMedia(root, relative, html) {
  const section = sectionForFile(relative);
  if (!section) return html;
  const slug = path.posix.basename(relative.split(path.sep).join("/"), ".html");
  return applyDiscoverMedia(html, { root, page: { relative, section, slug } }).html;
}
