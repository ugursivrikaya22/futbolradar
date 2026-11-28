/**
 * RADAR YORUMU SAYFALARI.
 *
 * Üretilenler:
 *   • Her YAYIMLANMIŞ yazı için kalıcı sayfa (kose-yazilari/<slug>.html)
 *   • Her yazar için arşiv sayfası (yazarlar/<slug>.html)
 *   • Liste sayfasının içeriği (kose-yazilari.html slot'u)
 *   • Ana sayfadaki son üç yazı bloğu
 *   • Ana sayfadaki öne çıkan (en yeni) köşe yazısı vitrini
 *
 * TASLAK SAYFA ÜRETMEZ. `draft` ve `review` durumundaki yazılar için hiçbir
 * dosya yazılmaz — yazılsaydı, yayına alınmamış bir kanaat adresi bilen
 * herkese açık olurdu ve arama motorları da bulurdu.
 *
 * YORUM/HABER AYRIMI HER SAYFADA. Künye ve "Köşe Yazısı" rozeti servisten geliyor
 * (services/columnService.js), yani her yüzeyde aynı ve unutulması mümkün
 * değil. Yazı sayfaları ayrıca `noindex` DEĞİL ama JSON-LD'de `Article`
 * olarak işaretleniyor; yorum niteliği `additionalType` ile korunuyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { columnTeams, matchPageFor, teamStandingsLink } from "./lib/clusterLinks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const siteLinks = require("../services/siteLinks.js").defaultSiteLinks();

const {
  OPINION_BADGE,
  OPINION_DISCLAIMER,
  SECTION_NAME,
  logRejected,
  publishedColumns
} = require("../services/columnService.js");
// Dış kaynak künyesi `nofollow` taşır; kural services/sourceLinks.js.
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const { FEATURED_MAX_AGE_MS } = require("../services/homeFreshness.js");
const { columnShareHtml } = require("../services/columnShare.js");
// Yayıncı düğümü (logo dahil) haber sayfalarıyla aynı tek tanımdan gelir.
const { publisherNode } = require("../services/newsArticleSchema.js");

const STORE = path.join(root, "data", "columns.json");
const OUT_DIR = path.join(root, "kose-yazilari");
const AUTHOR_DIR = path.join(root, "yazarlar");
const DOMAIN = "https://www.futbolradar.com";
const SHARE_IMAGE = `${DOMAIN}/assets/og-image.png`;
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * YAZI GÖVDESİNDE **KALIN** VURGU.
 *
 * Gövde satırları düz metin olarak saklanıyor ve tamamı kaçırılıyor; yazar
 * bir cümleyi `**...**` ile vurguladığında okuyucu ekranda yıldızları
 * görüyordu. Vurgu yazarın sesinin parçası — yıldızları silmek vurguyu
 * götürür, olduğu gibi basmak metni bozar.
 *
 * SIRA ÖNEMLİ: önce kaçırılır, sonra işaretleme uygulanır. Tersi olsaydı
 * gövdeye HTML enjekte edilebilirdi. Bu yüzden desen, kaçırma sonrası
 * metinde kalan yıldızlara bakar; `<` ve `>` çoktan zararsızlaştırılmıştır.
 */
/**
 * İÇ BAĞLANTI NOTASYONU: `[metin](hedef.html)`.
 *
 * Yalnızca site içi, göreli hedeflere izin verilir: harf/rakamla başlar,
 * `:` taşımaz (böylece `javascript:`/`http:` gibi şemalar giremez) ve `.html`
 * ile biter. `base` derinliğe göre önekleniyor — aynı `base` her <a> için
 * zaten kullanılıyor. Eşleşmeyen köşeli parantez metni olduğu gibi kalır.
 */
/** Kök göreli hedefi 301 zincirinin son adresine çevirir (#çapa korunur). */
function canonicalTarget(href) {
  const [file, hash] = href.split("#");
  const final = siteLinks.resolveFinalPath(`/${file}`).replace(/^\//, "");
  return hash ? `${final}#${hash}` : final;
}

function inlineText(value, base = "", sources = []) {
  const bold = escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const linked = bold.replace(
    /\[([^\]]+)\]\(((?:\.\.\/)*)([a-zA-Z0-9][a-zA-Z0-9_\-./]*\.html(?:#[a-zA-Z0-9_-]+)?)\)/g,
    (match, label, relativePrefix, href) => `<a href="${relativePrefix || base}${canonicalTarget(href)}">${label}</a>`
  );
  return linked.replace(/\[(\d+)\](?!\()/g, (marker, number) => {
    const source = sources[Number(number) - 1];
    if (!source || !/^https:\/\//.test(source.url)) return marker;
    return `<a href="${escapeHtml(source.url)}" target="_blank" rel="${SOURCE_LINK_REL}" aria-label="${escapeHtml(source.label)}">${marker}</a>`;
  });
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function cleanPublicPath(filePath) {
  return String(filePath || "").replace(/\.html$/i, "");
}

function publicUrl(filePath) {
  return `${DOMAIN}/${cleanPublicPath(filePath)}`;
}

function publicAssetUrl(filePath) {
  return `${DOMAIN}/${String(filePath || "").replace(/^\.?\//, "")}`;
}

function relativeAssetUrl(filePath, base = "./") {
  return `${base}${String(filePath || "").replace(/^\.?\//, "")}`;
}

/** Kart ve yazı sayfası aynı kanonik adresi ve aynı düğme metnini kullanır. */
function columnShare(column, options) {
  return columnShareHtml({
    url: publicUrl(column.path),
    title: column.title,
    locale: column.locale
  }, options);
}

function readStore() {
  if (!fs.existsSync(STORE)) return { columns: [] };
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch (error) {
    console.warn(`[columns] columns.json okunamadı: ${error.message}`);
    return { columns: [] };
  }
}

/**
 * Tarih — SAYFANIN DİLİNDE.
 *
 * Biçim dili sabit "tr-TR" idi; İngilizce yazı sayfasında künye tarihi
 * "14 Ağustos 2026" olarak basılıyordu. Ay adı da metindir.
 */
function formatDate(value, locale = "tr") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

function formatDateTime(value, locale = "tr") {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/** Kart: liste sayfasında ve ana sayfada aynı işaretleme. */
export function columnCard(column, base = "./", { showShareControls = false } = {}) {
  const tags = column.tags.slice(0, 3)
    .map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("");
  const href = escapeHtml(base + column.path);
  const badge = column.contentType || column.badge;
  const cardImage = column.featuredImage
    ? `<a class="column-card-image" href="${href}" aria-label="${escapeHtml(column.title)} yazısını oku"><img src="${escapeHtml(relativeAssetUrl(column.featuredImage, base))}" alt="${escapeHtml(column.featuredImageAlt || column.title)}" loading="lazy" decoding="async" /></a>`
    : "";
  const actions = showShareControls
    ? `<div class="column-card-actions">
        <a class="column-card-detail" href="${href}">Yazıyı Oku</a>
        ${columnShare(column, { compact: true })}
      </div>`
    : `<div class="column-card-actions"><a class="column-card-detail" href="${href}">Yazıyı Oku</a></div>`;

  return `<article class="column-card" data-card="column">
      ${cardImage}
      <div class="column-card-head">
        <span class="column-badge">${escapeHtml(badge)}</span>
        <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
      </div>
      <h3><a href="${href}">${escapeHtml(column.title)}</a></h3>
      ${column.excerpt ? `<p>${escapeHtml(column.excerpt)}</p>` : ""}
      <div class="column-card-meta">
        <a class="column-author" href="${escapeHtml(base + column.authorPath)}">${escapeHtml(column.author)}</a>
        <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date, column.locale))}</time>
      </div>
      ${tags ? `<div class="column-tags">${tags}</div>` : ""}
      ${actions}
    </article>`;
}

/** Liste sayfası içeriği. Yazı yoksa boş durum — uydurma yazı üretilmez. */
function listingHtml(columns) {
  if (!columns.length) {
    return `<article class="column-empty" data-card="empty-state">
      <h3>Henüz yayımlanmış yazı yok</h3>
      <p>${escapeHtml(SECTION_NAME)} yazıları taslak olarak hazırlanır ve yayına elle alınır. Yayına alınan yazılar burada listelenecek.</p>
    </article>
      ${columnShareHtml({ url: `${DOMAIN}/kose-yazilari.html`, title: "Köşe yazıları", locale: "tr" })}`;
  }

  return columns.map((column) => columnCard(column, "./", { showShareControls: true })).join("");
}

/** Ana sayfadaki son üç yazı. Yazı yoksa BOŞ DİZE — bölüm gizlenir. */
function homeHtml(columns) {
  if (!columns.length) return "";
  return columns.slice(0, 3).map((column) => columnCard(column, "./")).join("");
}

/**
 * ANA SAYFA ÖNE ÇIKAN KÖŞE YAZISI (hero).
 *
 * Elle seçilmez, kodda sabit değildir: her derlemede yayımlanmış yazılar
 * arasından TARİHİ EN YENİ olan seçilir. Tarihler farklı UTC ofsetleriyle
 * yazılabildiği için metin karşılaştırması yerine zaman damgası kullanılır.
 * Gelecek tarihli kayıt (zamanlanmış yayın) vitrine çıkmaz.
 *
 * Bağlantı uzantısız kanonik adrese gider (`/kose-yazilari/<slug>`);
 * vercel.json'daki `/kose-yazilari/:slug` yeniden yazımı sayfayı sunar.
 * Yazı yoksa BOŞ DİZE döner ve bölüm `hidden` olur.
 */
export function pickFeaturedColumn(columns, now = Date.now()) {
  const dated = (columns || [])
    .map((column) => ({ column, time: Date.parse(column && column.date) }))
    .filter(({ column, time }) => column && column.path && Number.isFinite(time) && time <= now);
  dated.sort((left, right) => right.time - left.time);
  return dated.length ? dated[0].column : null;
}

export function featuredColumnHtml(columns, now = Date.now(), { maxAgeMs = Infinity } = {}) {
  const column = pickFeaturedColumn(columns, now);
  if (!column) return "";
  // Ana sayfa vitrini 48 saatten eski yazıyı "öne çıkan" diye sunmaz (services/homeFreshness.js).
  const published = Date.parse(column.date);
  if (now - published >= maxAgeMs) return "";
  const href = escapeHtml(`./${cleanPublicPath(column.path)}`);
  const badge = column.contentType || column.badge || OPINION_BADGE;
  const expires = Number.isFinite(maxAgeMs) ? ` data-expires="${new Date(published + maxAgeMs).toISOString()}"` : "";
  return `<article class="home-featured-column__card" data-card="featured-column"${expires}>
            <div class="home-featured-column__meta">
              <span class="column-badge">${escapeHtml(badge)}</span>
              ${column.categoryLabel ? `<span class="column-category">${escapeHtml(column.categoryLabel)}</span>` : ""}
              <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date, column.locale))}</time>
            </div>
            <h2 class="home-featured-column__title" id="home-featured-column-title"><a href="${href}">${escapeHtml(column.title)}</a></h2>
            ${column.excerpt ? `<p class="home-featured-column__excerpt">${escapeHtml(column.excerpt)}</p>` : ""}
            <div class="home-featured-column__foot">
              <span class="home-featured-column__author">${escapeHtml(column.author)}</span>
              <a class="home-featured-column__cta" href="${href}" aria-label="Devamını Oku: ${escapeHtml(column.title)}">Devamını Oku <span aria-hidden="true">→</span></a>
            </div>
          </article>`;
}

export function groupAuthors(columns) {
  const authors = new Map();

  for (const column of columns) {
    if (!authors.has(column.authorPath)) {
      authors.set(column.authorPath, {
        name: column.author,
        path: column.authorPath,
        profile: column.authorProfile || null,
        columns: [],
        nameCounts: new Map()
      });
    }
    const group = authors.get(column.authorPath);
    group.columns.push(column);
    group.nameCounts.set(column.author, (group.nameCounts.get(column.author) || 0) + 1);
  }

  for (const group of authors.values()) {
    let best = group.name;
    let bestCount = -1;
    for (const [name, count] of group.nameCounts) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    group.name = best;
    delete group.nameCounts;
  }

  return [...authors.values()].sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

/**
 * SAYFA METNİ İKİ DİLDE — ŞABLON TEK.
 *
 * İngilizce köşe yazısı için ayrı bir şablon yazmak, aynı sayfanın iki
 * kopyasını bakımda tutmak demekti; biri değişince diğeri geride kalırdı.
 * Çerçeve metinleri buradan seçiliyor, işaretleme aynı kalıyor.
 */
const PAGE_STRINGS = {
  tr: {
    lang: "tr", ogLocale: "tr_TR", inLanguage: "tr-TR",
    breadcrumbLabel: "Sayfa yolu", home: "Ana Sayfa",
    indexPath: "kose-yazilari.html", backAll: "Tüm Köşe Yazıları",
    updateLabel: "Güncelleme", sources: "Kaynaklar",
    byline: (author, title) => `${author} yazdı: ${title}`
  },
  en: {
    lang: "en", ogLocale: "en_GB", inLanguage: "en-GB",
    breadcrumbLabel: "Breadcrumb", home: "Home",
    indexPath: "en/columns.html", backAll: "All columns",
    updateLabel: "Update", sources: "Sources",
    byline: (author, title) => `${author} wrote: ${title}`
  }
};

function schemaAuthorType(name) {
  return String(name || "").trim().toLocaleLowerCase("tr") === "futbolradar" ? "Organization" : "Person";
}

/**
 * schema.org yazar düğümü (Article `author` ve ProfilePage `mainEntity`).
 * Kayıtlı profil varsa (data/authors.json) ad, sayfa adresi, unvan, kısa
 * biyografi ve kişinin kendi profil bağlantıları (`sameAs`) eklenir; alanı
 * boş olan hiç basılmaz. Profil yoksa eski davranış: ad + sayfa adresi.
 */
function authorSchemaNode(profile, fallbackName, fallbackPath) {
  const name = (profile && profile.name) || fallbackName;
  const pagePath = (profile && profile.path) || fallbackPath;
  const node = {
    "@type": profile ? profile.type : schemaAuthorType(name),
    name,
    url: `${DOMAIN}/${pagePath}`
  };
  if (profile && profile.jobTitle && profile.type === "Person") node.jobTitle = profile.jobTitle;
  if (profile && profile.bio) node.description = profile.bio;
  if (profile && profile.sameAs && profile.sameAs.length) node.sameAs = profile.sameAs;
  return node;
}

/** Yazı sonundaki yazar kutusu: ad (yazar sayfasına bağlı) + kısa biyografi. */
function authorBoxHtml(column, base, locale) {
  const profile = column.authorProfile;
  if (!profile || !profile.bio || locale === "en") return "";
  const role = profile.jobTitle ? `<span class="column-author-box-role">${escapeHtml(profile.jobTitle)}</span>` : "";
  return `<aside class="column-author-box" aria-label="Yazar hakkında"><span class="column-author-box-label">Yazar</span><a class="column-author-box-name" href="${base}${escapeHtml(profile.path)}">${escapeHtml(profile.name)}</a>${role}<p>${escapeHtml(profile.bio)}</p></aside>`;
}

/** Tek yazı sayfası. */
/**
 * KÜME BAĞLANTILARI (yalnızca Türkçe): yazının etiketlediği Süper Lig
 * takımlarının maç sayfası (iki takım varsa, yazı tarihine ±4 gün) ve
 * takım puan durumu sayfaları + lig tablosu. Hepsi diskte var olan,
 * veriyle eşleşen sayfalar (bkz. scripts/lib/clusterLinks.mjs).
 */
function clusterLinksHtml(column, locale, base) {
  if (locale === "en") return "";
  const teams = columnTeams(column);
  if (!teams.length) return "";
  const links = [];
  if (teams.length >= 2) {
    const match = matchPageFor(teams[0].name, teams[1].name, column.date);
    if (match) links.push({ href: `${base}${match.path}`, text: `${match.title}: skor, istatistikler ve kadrolar` });
  }
  for (const team of teams.slice(0, 3)) {
    const standing = teamStandingsLink(team.name);
    if (standing) links.push({ href: `${base}${standing.path}`, text: `${standing.title} ve kalan maçlar` });
  }
  if (fs.existsSync(path.join(process.cwd(), "super-lig-puan-durumu.html"))) links.push({ href: `${base}super-lig-puan-durumu`, text: "Süper Lig puan durumu (tam tablo)" });
  if (!links.length) return "";
  return `<nav class="article-sources column-cluster-links" aria-labelledby="column-cluster-title"><h2 id="column-cluster-title">Bu yazıyla ilgili maç ve puan durumu</h2><ul>${links.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.text)}</a></li>`).join("")}</ul></nav>`;
}

/**
 * TABLO SATIRI: `|` ile başlayan gövde satırı bir istatistik tablosudur.
 * Satırlar `\n` ile, hücreler `|` ile ayrılır; ilk satır başlıktır. İsteğe
 * bağlı ilk satır `|! Başlık` tablo başlığını (caption) verir. Hücreler aynı
 * satır içi işaretlemeden (kalın, iç bağlantı, [n] kaynak) geçer. Dar
 * ekranlarda tablo kendi kabında yatay kayar; sayfa taşmaz.
 */
function tableHtml(line, base, sources) {
  const rows = line.split("\n").map((row) => row.trim()).filter(Boolean);
  let caption = "";
  if (rows[0] && rows[0].startsWith("|!")) caption = rows.shift().slice(2).trim();
  const cells = (row) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  const [head, ...bodyRows] = rows.map(cells);
  if (!head) return "";
  const th = head.map((cell) => `<th scope="col">${inlineText(cell, base, sources)}</th>`).join("");
  const tr = bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${inlineText(cell, base, sources)}</td>`).join("")}</tr>`).join("");
  return `<div class="column-table-wrap" style="overflow-x:auto"><table class="column-table">${caption ? `<caption>${escapeHtml(caption)}</caption>` : ""}<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/**
 * MAÇ ÖNÜ/SONU YAZISI İÇİN SportsEvent — yalnızca yazı `sportsEvent` alanı
 * taşıyorsa. Tarih, saha ve durum elle doğrulanıp yazılır; alan yoksa hiçbir
 * şey basılmaz (uydurma etkinlik verisi üretilmez).
 */
function pullQuoteHtml(quote) {
  if (!quote || !quote.text) return "";
  const cite = quote.attribution
    ? `<footer><cite>${escapeHtml(quote.attribution)}</cite></footer>`
    : "";
  return `<blockquote class="column-pullquote"><p>${escapeHtml(quote.text)}</p>${cite}</blockquote>`;
}

// Vitrin kutularının ÇERÇEVE METNİ dile göre seçilir. Kutunun içeriği
// (`en.stats`, `en.matchCard`) çevrilmiş olsa bile etiketler sabit Türkçe
// kalırsa İngilizce sayfaya "Stadyum / Yayın / Teknik direktör" sızar.
const SHOWCASE_LABELS = {
  tr: { stats: "Öne çıkan rakamlar", match: "Maç bilgisi", kickoff: "Başlama", venue: "Stadyum", broadcast: "Yayın", coach: "Teknik direktör" },
  en: { stats: "Key numbers", match: "Match information", kickoff: "Kick-off", venue: "Stadium", broadcast: "Broadcast", coach: "Head coach" }
};

function statsHtml(stats, locale = "tr") {
  const labels = SHOWCASE_LABELS[locale === "en" ? "en" : "tr"];
  if (!Array.isArray(stats) || !stats.length) return "";
  const items = stats.map((row) => `<li class="column-stat"><span class="column-stat-value">${escapeHtml(row.value)}</span><span class="column-stat-label">${escapeHtml(row.label)}</span>${row.note ? `<span class="column-stat-note">${escapeHtml(row.note)}</span>` : ""}</li>`).join("");
  return `<aside class="column-stats" aria-label="${escapeHtml(labels.stats)}"><ul>${items}</ul></aside>`;
}

function matchFact(label, value, datetime) {
  if (!value) return "";
  const body = datetime
    ? `<time datetime="${escapeHtml(datetime)}">${escapeHtml(value)}</time>`
    : escapeHtml(value);
  return `<div><dt>${escapeHtml(label)}</dt><dd>${body}</dd></div>`;
}

function matchCardHtml(card, locale = "tr") {
  const labels = SHOWCASE_LABELS[locale === "en" ? "en" : "tr"];
  if (!card || !card.home || !card.away) return "";
  const kicker = [card.competition, card.round].filter(Boolean).join(" · ");
  const facts = [
    matchFact(labels.kickoff, card.kickoffLabel || card.kickoff, card.kickoff),
    matchFact(labels.venue, [card.venue, card.city].filter(Boolean).join(", ")),
    matchFact(labels.broadcast, card.broadcast),
    matchFact(labels.coach, card.coach)
  ].filter(Boolean).join("");
  return `<section class="column-match-card" aria-label="${escapeHtml(labels.match)}">${kicker ? `<p class="column-match-kicker">${escapeHtml(kicker)}</p>` : ""}<div class="column-match-teams"><span>${escapeHtml(card.home)}</span><span class="column-match-vs">v</span><span>${escapeHtml(card.away)}</span></div>${facts ? `<dl class="column-match-facts">${facts}</dl>` : ""}${card.note ? `<p class="column-match-note">${escapeHtml(card.note)}</p>` : ""}</section>`;
}

function sportsEventJsonLd(event) {
  if (!event || !event.name || !event.startDate || !event.home || !event.away) return null;
  const status = { scheduled: "EventScheduled", postponed: "EventPostponed", cancelled: "EventCancelled", rescheduled: "EventRescheduled" }[event.status] || "EventScheduled";
  const ld = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: event.name,
    startDate: event.startDate,
    eventStatus: `https://schema.org/${status}`,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: event.home },
    awayTeam: { "@type": "SportsTeam", name: event.away },
    competitor: [{ "@type": "SportsTeam", name: event.home }, { "@type": "SportsTeam", name: event.away }]
  };
  if (event.venue) ld.location = { "@type": "Place", name: event.venue, address: { "@type": "PostalAddress", addressLocality: event.city || "", addressCountry: event.country || "" } };
  if (event.competition) ld.superEvent = { "@type": "SportsEvent", name: event.competition };
  if (event.description) ld.description = event.description;
  return ld;
}

export function columnPageHtml(column, locale = "tr") {
  const copy = PAGE_STRINGS[locale === "en" ? "en" : "tr"];
  const url = publicUrl(column.path);
  // İngilizce yazı iki kat derinlikte (`en/columns/`), Türkçe bir kat.
  const base = "../".repeat(column.path.split("/").length - 1);
  const pageTitle = column.seoTitle || `${column.title} | FutbolRadar`;
  const pageDescription = column.metaDescription || column.excerpt || copy.byline(column.author, column.title);
  const standfirst = column.hideStandfirst ? "" : (column.spot || column.excerpt);
  const shareDescription = `${pageDescription} — futbolradar.com`;
  // PAYLAŞIM GÖRSELİ SAYFA İÇİ GÖRSELDEN AYRI.
  //
  // `featuredImage` iki yerde kullanılıyor ve ikisinin gereksinimi zıt:
  //
  //   • SAYFA İÇİNDE <img> — SVG burada daha iyi: her ekran yoğunluğunda
  //     keskin ve 2,7 KB (PNG karşılığı ~160 KB).
  //   • PAYLAŞIMDA og:image — SVG burada HİÇ çalışmıyor: X, Facebook,
  //     WhatsApp ve Telegram önizleme üretirken SVG çözmez, bağlantı
  //     görselsiz çıkar.
  //
  // Bu yüzden kapak SVG kalıyor, paylaşıma PNG eşi veriliyor. PNG'ler
  // `scripts/generate-og-images.mjs` ile aynı SVG'den rasterlenip depoya
  // işleniyor; `scripts/test-og-image.mjs` ikisinin de yerinde olduğunu
  // ve 1200×630 bildirimine uyduğunu denetliyor.
  const shareImage = column.featuredImage
    ? publicAssetUrl(column.featuredImage.replace(/\.svg$/i, ".png"))
    : SHARE_IMAGE;
  const badge = column.contentType || column.badge;
  const updatesHtml = column.updates.length
    ? `<aside class="article-update-note column-updates" role="note">${column.updates.map((row) => `<strong>${escapeHtml(copy.updateLabel)} · <time datetime="${escapeHtml(row.date)}">${escapeHtml(formatDateTime(row.date, column.locale))}</time></strong><p>${inlineText(row.text, base)}</p>`).join("")}</aside>`
    : "";
  const sourcesHtml = column.sources.length
    ? `<section class="article-sources" aria-labelledby="column-sources-title"><h2 id="column-sources-title">${escapeHtml(copy.sources)}</h2><ul>${column.sources.map((row) => `<li><a href="${escapeHtml(row.url)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(row.label)}</a></li>`).join("")}</ul></section>`
    : "";
  // "## " önekli satır ara başlıktır: yazının kendi bölüm başlıkları
  // (ör. "Olumlu Yanlar") paragraf değil <h2> olarak basılır.
  const body = column.body.map((paragraph) => {
    const line = String(paragraph ?? "");
    // Markdown H1 sayfanın kendi <h1> başlığıdır; gövdede ikinci kez basılmaz.
    if (line.startsWith("# ") && !line.startsWith("## ")) {
      const heading = line.slice(2).trim();
      if (heading === column.title) return "";
      return `<h2>${inlineText(heading, base)}</h2>`;
    }
    if (line.startsWith("## ")) {
      return `<h2>${inlineText(line.slice(3).trim(), base)}</h2>`;
    }
    if (line.startsWith("|")) return tableHtml(line, base, column.sources);
    return `<p>${inlineText(line, base, column.sources)}</p>`;
  }).filter(Boolean).join("\n        ");

  // Article ana tipi SEO sözleşmesini taşır; additionalType yorum niteliğini korur.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    additionalType: "https://schema.org/OpinionNewsArticle",
    headline: column.title,
    datePublished: column.date,
    // Depo ayrı bir düzenleme tarihi TUTMUYOR. Düzenlenmemiş bir yazının
    // değişiklik tarihi yayım tarihidir; uydurulmuş bir "bugün" damgası
    // tazelik sinyalini yalanlar. Tarihli bir güncelleme notu varsa
    // değişiklik tarihi en yeni notun tarihidir.
    dateModified: column.updates.length ? column.updates[0].date : column.date,
    author: authorSchemaNode(column.authorProfile, column.author, column.authorPath),
    publisher: publisherNode(),
    articleSection: column.categoryLabel,
    keywords: (column.keywords && column.keywords.length ? column.keywords : column.tags).join(", "),
    mainEntityOfPage: url,
    image: shareImage,
    inLanguage: copy.inLanguage
  };

  const eventLd = locale === "en" ? null : sportsEventJsonLd(column.sportsEvent);
  const showcaseBlocks = [
    pullQuoteHtml(column.pullQuote),
    matchCardHtml(column.matchCard, locale),
    statsHtml(column.stats, locale)
  ].filter(Boolean);
  const showcaseHtml = showcaseBlocks.length ? `\n        ${showcaseBlocks.join("\n        ")}` : "";
  // Sayfa yolu (Ana Sayfa > Köşe Yazıları > yazı) görünür breadcrumb ile aynı
  // sırayı yapısal veriye taşır; liste adresi kanonik (uzantısız) biçimdedir.
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: copy.home, item: locale === "en" ? `${DOMAIN}/en` : `${DOMAIN}/` },
      { "@type": "ListItem", position: 2, name: locale === "en" ? "Columns" : "Köşe Yazıları", item: `${DOMAIN}/${locale === "en" ? "en/columns" : "kose-yazilari"}` },
      { "@type": "ListItem", position: 3, name: column.title, item: url }
    ]
  };


  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(pageDescription)}" />${column.keywords && column.keywords.length ? `\n    <meta name="keywords" content="${escapeHtml(column.keywords.join(", "))}" />` : ""}
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${copy.ogLocale}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(shareDescription)}" />
    <meta property="og:image" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(shareDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(shareImage)}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />${(column.pullQuote || (column.stats && column.stats.length) || column.matchCard) ? `\n    <link rel="stylesheet" href="${base}column-showcase.css" />` : ""}
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
    ${eventLd ? `<script type="application/ld+json">${JSON.stringify(eventLd)}</script>` : ""}
  </head>
  <body class="subpage column-page">
    ${siteHeader({ base, locale })}
    <main class="container">
      <nav class="breadcrumb" aria-label="${copy.breadcrumbLabel}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(copy.home)}</a><span>/</span><a href="${base}${copy.indexPath}">${escapeHtml(locale === "en" ? "Columns" : SECTION_NAME)}</a><span>/</span><span>${escapeHtml(column.title)}</span></nav>

      <article class="column-article">
        <header class="column-article-head">
          <div class="column-card-head">
            <span class="column-badge">${escapeHtml(badge)}</span>
            <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
          </div>
          <h1>${escapeHtml(column.title)}</h1>
          <div class="column-article-meta">
            <a class="column-author" href="${base}${escapeHtml(column.authorPath)}">${escapeHtml(column.author)}</a>
            <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date, column.locale))}</time>
          </div>
        </header>

        ${column.featuredImage ? `<figure class="column-featured-image"><img src="${escapeHtml(relativeAssetUrl(column.featuredImage, base))}" alt="${escapeHtml(column.featuredImageAlt || column.title)}" loading="eager" decoding="async" /></figure>` : ""}
        ${standfirst ? `<p class="column-standfirst">${escapeHtml(standfirst)}</p>` : ""}${showcaseHtml}
        <p class="column-disclaimer">${escapeHtml(column.disclaimer)}</p>
        ${updatesHtml}

        <div class="column-body">
        ${body}
        </div>

        ${sourcesHtml}

        ${authorBoxHtml(column, base, locale)}

        ${clusterLinksHtml(column, locale, base)}

        ${column.tags.length ? `<div class="column-tags">${column.tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </article>
      ${columnShare(column)}

      <section class="column-back">
        <a class="detail-link" href="${base}${copy.indexPath}">${escapeHtml(copy.backAll)}</a>
      </section>
    </main>
    ${siteFooter({ base, locale })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

export function authorPageHtml(author) {
  const base = "../";
  const url = `${DOMAIN}/${author.path}`;
  const profile = author.profile && author.profile.registered ? author.profile : null;
  const description = profile && profile.bio
    ? `${profile.bio} ${author.name} tarafından FutbolRadar'da yayımlanan köşe yazıları.`
    : `${author.name} tarafından FutbolRadar'da yayımlanan köşe yazıları, futbol yorumları ve analizler.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${author.name} Yazıları`,
    inLanguage: "tr-TR",
    mainEntity: authorSchemaNode(profile, author.name, author.path)
  };
  const bioHtml = profile && profile.bio
    ? `<p class="column-author-bio">${escapeHtml(profile.bio)}</p>${profile.jobTitle ? `<span class="column-author-role">${escapeHtml(profile.jobTitle)}</span>` : ""}${profile.sameAs.length ? `<ul class="column-author-links">${profile.sameAs.map((link) => `<li><a href="${escapeHtml(link)}" rel="me noopener noreferrer" target="_blank">${escapeHtml(link.replace(/^https:\/\/(?:www\.)?/, ""))}</a></li>`).join("")}</ul>` : ""}`
    : "";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${author.name} Yazıları | FutbolRadar`)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(`${author.name} Yazıları`)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(`${author.name} Yazıları`)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body class="subpage column-author-page">
    ${siteHeader({ base })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${base}index.html">Ana Sayfa</a><span>/</span><a href="${base}kose-yazilari.html">Köşe Yazıları</a><span>/</span><span>${escapeHtml(author.name)}</span></nav>

      <header class="hero column-author-hero">
        <span class="eyebrow">Yazar</span>
        <h1>${escapeHtml(author.name)} Yazıları</h1>
        ${bioHtml || `<p>${escapeHtml(description)}</p>`}
        <span class="column-author-summary">${author.columns.length} yayımlanmış yazı</span>
      </header>

      <section class="column-grid" aria-label="${escapeHtml(author.name)} köşe yazıları">
        ${author.columns.map((column) => columnCard(column, base)).join("")}
      </section>
    </main>
    ${siteFooter({ base })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

function replaceSlot(html, target, content) {
  const start = `<!-- prerender:${target}:start -->`;
  const end = `<!-- prerender:${target}:end -->`;
  if (!html.includes(start)) return html;
  const expression = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return html.replace(expression, `${start}\n${content}\n${end}`);
}

function writeBoth(relativePath, html) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeGeneratedFile(target, html);

  const publicTarget = path.join(root, "public", relativePath);
  fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
  writeGeneratedFile(publicTarget, html);
}

function sitemapEntry(column) {
  // Güncelleme notu taşıyan yazının son değişikliği en yeni nottur.
  const modified = (column.updates && column.updates.length) ? column.updates[0].date : column.date;
  const lastmod = String(modified || "").slice(0, 10) || "2026-08-02";
  return `  <url>
    <loc>${publicUrl(column.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.64</priority>
  </url>`;
}

/**
 * hreflang ÇİFTİ — TEK YERDE.
 *
 * `data/en-route-map.json`a yazılır; `inject-hreflang.mjs` haritadaki HER
 * türü kapsıyor (tür süzgeci PR #54'te kaldırıldı), yani buraya kayıt
 * düşmesi iki tarafa da alternate etiketi basılması için yeterli.
 */
function writeRouteMap(englishColumns) {
  const mapPath = path.join(root, "data", "en-route-map.json");
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch { existing = []; }
  const kept = (Array.isArray(existing) ? existing : []).filter((row) => row && row.kind !== "column");
  const pairs = englishColumns
    .filter((column) => column.counterpartPath)
    .map((column) => ({ kind: "column", tr: column.counterpartPath, en: column.path }));
  const serialized = `${JSON.stringify([...kept, ...pairs], null, 2)}\n`;
  if (!fs.existsSync(mapPath) || fs.readFileSync(mapPath, "utf8") !== serialized) {
    fs.writeFileSync(mapPath, serialized, "utf8");
  }
}

function updateSitemap(columns) {
  const entries = columns.map(sitemapEntry);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    // İki dizin de temizlenir: Türkçe yazı ve İngilizce karşılığı.
    xml = xml.replace(/  <url>\r?\n    <loc>https:\/\/www\.futbolradar\.com\/(?:kose-yazilari|en\/columns)\/[^<]+(?:\.html)?<\/loc>[\s\S]*?  <\/url>\r?\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    writeGeneratedFile(sitemapPath, xml);
  }
}

// ── Koşu ───────────────────────────────────────────────────────────────────

/** Liste yuvasını yeniden yazar; yazı sayfalarına ve site haritasına dokunmaz. */
export function renderListingSlot() {
  const { columns } = publishedColumns(readStore());
  return listingHtml(columns);
}

export function generateColumnPages() {
  const store = readStore();
  const { columns, rejected } = publishedColumns(store);
  const authors = groupAuthors(columns);
  logRejected("columns", rejected);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(AUTHOR_DIR, { recursive: true });

  for (const column of columns) {
    writeBoth(column.path, columnPageHtml(column, "tr"));
  }

  // ── İNGİLİZCE KARŞILIKLAR ────────────────────────────────────────────────
  //
  // Yalnızca gövdesi GERÇEKTEN İngilizce yazılmış yazılar. Makine çevirisi
  // yok: `hasEnglish` başlık ve gövdeyi birlikte arıyor, biri eksikse
  // İngilizce sayfa hiç üretilmez ve İngilizce yüzey eskisi gibi Türkçe
  // yazıya bağlanır.
  const { columns: englishColumns } = publishedColumns(store, { locale: "en" });
  const translated = englishColumns.filter((column) => column.hasEnglish && column.path);
  for (const column of translated) {
    writeBoth(column.path, columnPageHtml(column, "en"));
  }
  writeRouteMap(translated);

  for (const author of authors) {
    writeBoth(author.path, authorPageHtml(author));
  }

  // Yayından kaldırılan yazı ve yazarlara ait eski sayfaları da kaldır.
  const expected = new Set(columns.map((column) => path.basename(column.path)));
  for (const file of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (!file.endsWith(".html") || expected.has(file)) continue;
    fs.unlinkSync(path.join(OUT_DIR, file));
    const publicCopy = path.join(root, "public", "kose-yazilari", file);
    if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
    console.log(`[columns] yayından kaldırılan yazının sayfası silindi: ${file}`);
  }

  const expectedAuthors = new Set(authors.map((author) => path.basename(author.path)));
  for (const file of fs.existsSync(AUTHOR_DIR) ? fs.readdirSync(AUTHOR_DIR) : []) {
    if (!file.endsWith(".html") || expectedAuthors.has(file)) continue;
    fs.unlinkSync(path.join(AUTHOR_DIR, file));
    const publicCopy = path.join(root, "public", "yazarlar", file);
    if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
    console.log(`[columns] yayımdan kaldırılan yazar sayfası silindi: ${file}`);
  }

  const listingPath = path.join(root, "kose-yazilari.html");
  if (fs.existsSync(listingPath)) {
    const html = replaceSlot(fs.readFileSync(listingPath, "utf8"), "columns-page", listingHtml(columns));
    writeGeneratedFile(listingPath, html);
    writeGeneratedFile(path.join(root, "public", "kose-yazilari.html"), html);
  }

  const homePath = path.join(root, "index.html");
  if (fs.existsSync(homePath)) {
    let html = fs.readFileSync(homePath, "utf8");
    // `hideFromHome: true` olan yazılar ana sayfanın hiçbir köşe alanında görünmez.
    const homeColumns = columns.filter((column) => !column.hideFromHome);
    const content = homeHtml(homeColumns);
    html = replaceSlot(html, "home-columns", content);
    // İstemci tarafı Supabase yenilemesi (home-columns.js) aynı yazıları atlasın.
    const hiddenSlugs = columns.filter((column) => column.hideFromHome).map((column) => path.basename(String(column.path || column.id), ".html")).join(" ");
    html = html.replace(/(<div class="column-grid column-grid-home" data-api-target="home-columns")( data-hide-slugs="[^"]*")?/, (_, head) => hiddenSlugs ? `${head} data-hide-slugs="${escapeHtml(hiddenSlugs)}"` : head);

    // Öne çıkan köşe yazısı: en yeni yayımlanmış yazı, her derlemede yeniden seçilir.
    const featured = featuredColumnHtml(homeColumns, Date.now(), { maxAgeMs: FEATURED_MAX_AGE_MS });
    html = replaceSlot(html, "home-featured-column", featured);
    const featuredTag = (html.match(/<section\b[^>]*\bdata-featured-column\b[^>]*>/) || [])[0];
    if (featuredTag) {
      const hasHidden = /\s+hidden(?=[\s>])/.test(featuredTag);
      const nextTag = featured.trim()
        ? featuredTag.replace(/\s+hidden(?=[\s>])/, "")
        : (hasHidden ? featuredTag : featuredTag.replace(/>$/, " hidden>"));
      html = html.replace(featuredTag, nextTag);
    }
    html = html.replace(
      /(<a class="section-link" href="\.\/kose-yazilari\.html">)[^<]*(<\/a>)/,
      "$1Tüm Köşe Yazıları$2"
    );

    const openTag = (html.match(/<section\b[^>]*\bdata-api-section="columns"[^>]*>/) || [])[0];
    if (openTag) {
      const next = content.trim()
        ? openTag.replace(/\s+hidden(?=[\s>])/, "")
        : (/\s+hidden(?=[\s>])/.test(openTag) ? openTag : openTag.replace(/>$/, " hidden>"));
      html = html.replace(openTag, next);
    }

    writeGeneratedFile(homePath, html);
    writeGeneratedFile(path.join(root, "public", "index.html"), html);
  }

  updateSitemap([...columns, ...translated]);

  console.log(
    `[columns] ${columns.length} yayımlanmış yazı ve ${authors.length} yazar sayfası üretildi` +
    `${rejected.length ? ` · ${rejected.length} kayıt elendi` : ""}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateColumnPages();
}
