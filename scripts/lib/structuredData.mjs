/**
 * YAPISAL VERİ (JSON-LD) DOĞRULAYICI — SAF İŞLEVLER.
 *
 * `scripts/test-structured-data.mjs` üretilmiş ağaçtaki her sayfaya bunu
 * uygular. Kurallar Google'ın zengin sonuç belgelerinden ve schema.org
 * tanımlarından alınan ZORUNLU alanlardır; "tavsiye edilen" alanlar hata
 * değil, `warnings` olarak sayılır (örn. NewsArticle.image).
 *
 * Bu modül dosya sistemine dokunmaz: girdi ayrıştırılmış düğümlerdir, çıktı
 * `{ errors, warnings }` listesidir. Böylece birim testleri bozuk örnekleri
 * doğrudan besleyebilir.
 */

export const DOMAIN = "https://www.futbolradar.com";

/** schema.org EventStatusType — başka değer tanınmaz ("EventCompleted" yoktur). */
export const EVENT_STATUS = new Set([
  "https://schema.org/EventScheduled",
  "https://schema.org/EventCancelled",
  "https://schema.org/EventPostponed",
  "https://schema.org/EventRescheduled",
  "https://schema.org/EventMovedOnline"
]);

/** Google'ın istediği ISO 8601: tarih ya da saat dilimli tarih-saat. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoDate(value) {
  if (typeof value !== "string") return false;
  if (!ISO_DATE.test(value) && !ISO_DATETIME.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

/** Elimizde OLMAYAN verinin vaadi: bu alanlar hiçbir düğümde bulunmamalı. */
export const FORBIDDEN_PROPS = ["aggregateRating", "review", "offers", "interactionStatistic", "ratingValue"];

const PLACEHOLDER = /(^|[^\w])(undefined|null|NaN|\[object Object\])([^\w]|$)/;

/** Skor kalıbı: "3-1", "0 - 0", "2–2" (saat 20:00 ve 4 haneli yıl hariç). */
export const SCORE_PATTERN = /(?<![\d:.\/-])\d{1,2}\s?[-–]\s?\d{1,2}(?![\d:.\/-])/;

export function typesOf(node) {
  return [].concat((node && node["@type"]) || []).map(String);
}

/** Üst düzey blokları (tek nesne, dizi, @graph) düz düğüm listesine açar. */
export function flattenNodes(block) {
  const out = [];
  const visit = (value, top) => {
    if (Array.isArray(value)) { value.forEach((v) => visit(v, top)); return; }
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value["@graph"])) { value["@graph"].forEach((v) => visit(v, false)); return; }
    out.push({ node: value, top });
  };
  visit(block, true);
  return out;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSiteUrl(value) {
  return typeof value === "string" && value.startsWith(`${DOMAIN}/`) || value === DOMAIN;
}

/** Düğüm içinde (derin) boş değer / yer tutucu / yasaklı alan arar. */
function scanGeneric(value, pointer, issues) {
  if (Array.isArray(value)) {
    if (!value.length) issues.push(`${pointer}: boş dizi`);
    value.forEach((v, i) => scanGeneric(v, `${pointer}[${i}]`, issues));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_PROPS.includes(key)) issues.push(`${pointer}.${key}: desteklenmeyen/doğrulanamayan alan`);
      if (v === null || v === undefined) { issues.push(`${pointer}.${key}: null`); continue; }
      if (typeof v === "string") {
        if (!v.trim()) issues.push(`${pointer}.${key}: boş dize`);
        else if (PLACEHOLDER.test(v)) issues.push(`${pointer}.${key}: yer tutucu metin "${v.slice(0, 40)}"`);
        else if (/^(url|item|mainEntityOfPage|@id|image|logo|sameAs)$/.test(key) && !/^https?:\/\//.test(v) && !v.startsWith("#")) issues.push(`${pointer}.${key}: mutlak adres değil "${v.slice(0, 60)}"`);
      } else if (typeof v === "number" && !Number.isFinite(v)) issues.push(`${pointer}.${key}: sayı geçersiz`);
      else scanGeneric(v, `${pointer}.${key}`, issues);
    }
  }
}

function nameOf(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") return String(value.name || "").trim();
  return "";
}

const RULES = {
  SportsEvent(node, ctx, e, w) {
    if (!isNonEmptyString(node.name)) e.push("SportsEvent.name yok");
    if (!isIsoDate(node.startDate)) e.push(`SportsEvent.startDate geçersiz: ${JSON.stringify(node.startDate)}`);
    else if (typeof node.startDate === "string" && node.startDate.length > 10 && !/(Z|[+-]\d{2}:\d{2})$/.test(node.startDate)) e.push("SportsEvent.startDate saat dilimsiz");
    if (node.eventStatus !== undefined && !EVENT_STATUS.has(node.eventStatus)) e.push(`SportsEvent.eventStatus tanınmayan değer: ${node.eventStatus}`);
    const competitors = Array.isArray(node.competitor) ? node.competitor : [];
    if (!(nameOf(node.homeTeam) && nameOf(node.awayTeam)) && competitors.length < 2) e.push("SportsEvent iki takımı bildirmiyor (homeTeam/awayTeam ya da competitor)");
    if (node.location !== undefined) {
      const address = node.location && typeof node.location === "object" ? node.location.address : null;
      const locality = address && typeof address === "object" ? String(address.addressLocality || "").trim() : "";
      const country = address && typeof address === "object" ? String(address.addressCountry || "").trim() : (typeof address === "string" ? address.trim() : "");
      if (!nameOf(node.location) && !locality && !country) e.push("SportsEvent.location adı veya adresi yok");
      if (node.location && typeof node.location === "object" && "address" in node.location && !(isNonEmptyString(node.location.address) || (address && typeof address === "object" && (locality || country)))) e.push("SportsEvent.location.address boş");
    } else {
      w.push("SportsEvent.location yok (Google Event zengin sonucu için önerilir; stat ve ülke bilinmiyorsa uydurulmaz)");
    }
    if (node.url !== undefined && !isSiteUrl(node.url)) e.push(`SportsEvent.url site dışı: ${node.url}`);
  },
  Article(node, ctx, e, w) {
    if (!isNonEmptyString(node.headline)) e.push(`${typesOf(node)[0]}.headline yok`);
    else if (node.headline.length > 110) w.push(`${typesOf(node)[0]}.headline 110 karakteri aşıyor (${node.headline.length})`);
    if (!isIsoDate(node.datePublished)) e.push(`${typesOf(node)[0]}.datePublished geçersiz: ${JSON.stringify(node.datePublished)}`);
    else if (Date.parse(node.datePublished) > Date.now() + 36 * 3600000) e.push("datePublished gelecekte");
    if (node.dateModified !== undefined) {
      if (!isIsoDate(node.dateModified)) e.push(`dateModified geçersiz: ${JSON.stringify(node.dateModified)}`);
      else if (isIsoDate(node.datePublished) && Date.parse(node.dateModified) < Date.parse(node.datePublished)) e.push("dateModified datePublished'tan önce");
    }
    const author = Array.isArray(node.author) ? node.author[0] : node.author;
    if (!nameOf(author)) e.push("author.name yok");
    if (!nameOf(node.publisher)) e.push("publisher.name yok");
    if (!(isNonEmptyString(node.mainEntityOfPage) || (node.mainEntityOfPage && node.mainEntityOfPage["@id"]) || isNonEmptyString(node.url))) e.push("mainEntityOfPage/url yok");
    if (!node.image) w.push("image yok (Article zengin sonucu için önerilir)");
  },
  BreadcrumbList(node, ctx, e) {
    const items = node.itemListElement;
    if (!Array.isArray(items) || !items.length) { e.push("BreadcrumbList.itemListElement boş"); return; }
    items.forEach((item, index) => {
      if (!item || item["@type"] !== "ListItem") e.push(`Breadcrumb[${index}] ListItem değil`);
      else {
        if (item.position !== index + 1) e.push(`Breadcrumb[${index}].position ${item.position} (beklenen ${index + 1})`);
        if (!isNonEmptyString(item.name) && !nameOf(item.item)) e.push(`Breadcrumb[${index}].name yok`);
        const target = typeof item.item === "string" ? item.item : item.item && item.item["@id"];
        if (!target && index !== items.length - 1) e.push(`Breadcrumb[${index}].item yok (yalnızca son basamak adressiz olabilir)`);
        if (target && !isSiteUrl(target)) e.push(`Breadcrumb[${index}].item site dışı: ${target}`);
      }
    });
  },
  Person(node, ctx, e) { if (!isNonEmptyString(node.name)) e.push("Person.name yok"); },
  SportsTeam(node, ctx, e) { if (!isNonEmptyString(node.name)) e.push("SportsTeam.name yok"); },
  SportsOrganization(node, ctx, e) { if (!isNonEmptyString(node.name)) e.push("SportsOrganization.name yok"); },
  WebPage(node, ctx, e) {
    if (!isNonEmptyString(node.name)) e.push(`${typesOf(node)[0]}.name yok`);
    if (!isNonEmptyString(node.url)) e.push(`${typesOf(node)[0]}.url yok`);
  },
  ProfilePage(node, ctx, e) { if (!isNonEmptyString(node.name) && !node.mainEntity) e.push("ProfilePage.name/mainEntity yok"); },
  Dataset(node, ctx, e) {
    if (!isNonEmptyString(node.name)) e.push("Dataset.name yok");
    if (!isNonEmptyString(node.description)) e.push("Dataset.description yok");
  },
  ItemList(node, ctx, e) {
    const items = node.itemListElement;
    if (!Array.isArray(items) || !items.length) { e.push("ItemList.itemListElement boş"); return; }
    if (node.numberOfItems !== undefined && node.numberOfItems !== items.length) e.push(`ItemList.numberOfItems ${node.numberOfItems} ≠ ${items.length}`);
    items.forEach((item, index) => { if (item && item.position !== index + 1) e.push(`ItemList[${index}].position ${item.position}`); });
  },
  FAQPage(node, ctx, e) {
    const entities = node.mainEntity;
    if (!Array.isArray(entities) || !entities.length) { e.push("FAQPage.mainEntity boş"); return; }
    for (const [index, q] of entities.entries()) {
      if (!q || q["@type"] !== "Question" || !isNonEmptyString(q.name)) e.push(`FAQ[${index}] Question.name yok`);
      else if (!q.acceptedAnswer || !isNonEmptyString(q.acceptedAnswer.text)) e.push(`FAQ[${index}] acceptedAnswer.text yok`);
      else if (ctx.visibleText && !ctx.visibleText.includes(normalize(q.name))) e.push(`FAQ[${index}] soru sayfada görünmüyor: "${q.name.slice(0, 50)}"`);
    }
  }
};
RULES.NewsArticle = RULES.Article;
RULES.CollectionPage = RULES.WebPage;

export function normalize(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");
}

/**
 * Tek sayfanın düğümlerini doğrular.
 *
 * @param {object[]} blocks   ayrıştırılmış JSON-LD blokları
 * @param {{visibleText?: string, verifyScore?: (node:object)=>string|null}} ctx
 *   `verifyScore(node)`: düğümün skor içeren metni doğrulanmış bir bitmiş maça
 *   dayanmıyorsa hata metni döndürür (aksi hâlde null).
 */
export function validateBlocks(blocks, ctx = {}) {
  const errors = [];
  const warnings = [];
  const types = [];
  // Üst düzey dizi geçerli JSON-LD: her öğe kendi bloğudur.
  const list = blocks.flatMap((block) => (Array.isArray(block) ? block : [block]));
  list.forEach((block, blockIndex) => {
    if (!block || typeof block !== "object" || Array.isArray(block)) { errors.push(`blok ${blockIndex}: nesne değil`); return; }
    const context = String(block["@context"] || "");
    if (!/^https?:\/\/schema\.org\/?$/.test(context)) errors.push(`blok ${blockIndex}: @context schema.org değil`);
    for (const { node, top } of flattenNodes(block)) {
      const nodeTypes = typesOf(node);
      if (!nodeTypes.length) { errors.push(`blok ${blockIndex}: @type yok`); continue; }
      types.push(...nodeTypes);
      const nodeErrors = [];
      const nodeWarnings = [];
      for (const type of nodeTypes) {
        const rule = RULES[type];
        if (rule) rule(node, ctx, nodeErrors, nodeWarnings);
      }
      scanGeneric(node, nodeTypes[0], nodeErrors);
      if (ctx.verifyScore && nodeTypes.some((t) => ["SportsEvent", "NewsArticle", "Article"].includes(t))) {
        const complaint = ctx.verifyScore(node);
        if (complaint) nodeErrors.push(complaint);
      }
      errors.push(...nodeErrors.map((m) => `${nodeTypes[0]}: ${m}`));
      warnings.push(...nodeWarnings.map((m) => `${nodeTypes[0]}: ${m}`));
    }
  });
  return { errors, warnings, types };
}

/** Düğümün skor taşıyan metin alanları (ad, başlık, açıklama). */
export function scoreTexts(node) {
  return [node.name, node.headline, node.description]
    .filter((v) => typeof v === "string")
    .filter((v) => SCORE_PATTERN.test(v));
}
