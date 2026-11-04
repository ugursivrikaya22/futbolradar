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
    /\[([^\]]+)\]\(([a-zA-Z0-9][a-zA-Z0-9_\-./]*\.html(?:#[a-zA-Z0-9_-]+)?)\)/g,
    (match, label, href) => `<a href="${base}${canonicalTarget(href)}">${label}</a>`
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

const SHARE_STRINGS = {
  tr: {
    label: "Bu yazıyı paylaş",
    sectionLabel: "Yazıyı paylaş",
    facebook: "Facebook'ta Paylaş",
    x: "X'te Paylaş",
    shareAria: (title) => `${title} yazısını paylaş`,
    facebookAria: (title) => `${title} yazısını Facebook'ta paylaş`,
    xAria: (title) => `${title} yazısını X'te paylaş`
  },
  en: {
    label: "Share this column",
    sectionLabel: "Share the column",
    facebook: "Share on Facebook",
    x: "Share on X",
    shareAria: (title) => `Share the column ${title}`,
    facebookAria: (title) => `Share the column ${title} on Facebook`,
    xAria: (title) => `Share the column ${title} on X`
  }
};

function shareUrls(column) {
  const url = publicUrl(column.path);
  const xText = `${column.title} — FutbolRadar | futbolradar.com`;

  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(url)}`
  };
}

/**
 * Paylaşım bağlantıları — ERİŞİLEBİLİRLİK ETİKETLERİ DE ÇEVRİLİR.
 *
 * `aria-label` ekranda görünmez ama ekran okuyucusu onu OKUR. İngilizce
 * sayfada Türkçe bir aria-label, ekran okuyucusu kullanan okuyucu için
 * sayfanın görünen kısmının Türkçe kalmasıyla aynı şey.
 */
function shareLinks(column, { compact = false } = {}) {
  const urls = shareUrls(column);
  const title = escapeHtml(column.title);
  const locale = column.locale === "en" ? "en" : "tr";
  const copy = SHARE_STRINGS[locale];

  if (compact) {
    return `<div class="column-card-share-actions" aria-label="${copy.shareAria(title)}">
          <a class="column-card-share column-card-share-facebook" href="${escapeHtml(urls.facebook)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${copy.facebookAria(title)}" title="${escapeHtml(copy.facebook)}"><span aria-hidden="true">f</span></a>
          <a class="column-card-share column-card-share-x" href="${escapeHtml(urls.x)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${copy.xAria(title)}" title="${escapeHtml(copy.x)}"><span aria-hidden="true">X</span></a>
        </div>`;
  }

  return `<section class="column-share" aria-label="${escapeHtml(copy.sectionLabel)}">
          <span class="column-share-label">${escapeHtml(copy.label)}</span>
          <div class="column-share-actions">
            <a class="column-share-button column-share-facebook" href="${escapeHtml(urls.facebook)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${copy.facebookAria(title)}"><span class="column-share-symbol" aria-hidden="true">f</span><span>${escapeHtml(copy.facebook)}</span></a>
            <a class="column-share-button column-share-x" href="${escapeHtml(urls.x)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${copy.xAria(title)}"><span class="column-share-symbol" aria-hidden="true">X</span><span>${escapeHtml(copy.x)}</span></a>
          </div>
        </section>`;
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
        ${shareLinks(column, { compact: true })}
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
    </article>`;
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

export function featuredColumnHtml(columns, now = Date.now()) {
  const column = pickFeaturedColumn(columns, now);
  if (!column) return "";
  const href = escapeHtml(`./${cleanPublicPath(column.path)}`);
  const badge = column.contentType || column.badge || OPINION_BADGE;
  return `<article class="home-featured-column__card" data-card="featured-column">
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

/**
 * ANA SAYFA EN ÜST "KÖŞE YAZISI · MAÇ ANALİZLERİ" ŞERİDİ.
 *
 * Yalnızca yayımlanmış MAÇ yazıları (kategori `mac-yorumu` ya da slug'da
 * maç önü/sonu): Süper Lig veya Türk takımlarının Avrupa kupası maçları
 * (etiketlerde lig/kupa adı). En yeni önce, en fazla 6 kart. Gelecek tarihli
 * kayıt çıkmaz. Maç bilgisi YALNIZCA veriden: `sportsEvent` varsa ev–deplasman
 * ve organizasyon, yoksa etiketlerdeki organizasyon ve aşama (Maç önü/sonu,
 * Canlı Analiz). Uydurma alan yok; veri yoksa satır basılmaz.
 */
const MATCH_COMPETITION_TAGS = ["Süper Lig", "Şampiyonlar Ligi", "Avrupa Ligi", "Konferans Ligi", "Türkiye Kupası"];
const MATCH_PHASE_TAGS = ["maç önü", "maç önü analiz", "maç sonu", "canlı analiz"];

export function pickMatchColumns(columns, now = Date.now(), limit = 6) {
  return (columns || [])
    .map((column) => ({ column, time: Date.parse(column && column.date) }))
    .filter(({ column, time }) => column && column.path && Number.isFinite(time) && time <= now)
    .filter(({ column }) => {
      const slug = String(column.slug || column.id || "");
      const isMatch = column.category === "mac-yorumu" || /(^|-)mac-(onu|sonu)(-|$)/.test(slug) || Boolean(column.sportsEvent);
      const tags = column.tags || [];
      return isMatch && tags.some((tag) => MATCH_COMPETITION_TAGS.includes(tag));
    })
    .sort((left, right) => right.time - left.time)
    .slice(0, limit)
    .map(({ column }) => column);
}

function matchInfo(column) {
  const event = column.sportsEvent;
  const tags = column.tags || [];
  const parts = [];
  if (event && event.home && event.away) parts.push(`${event.home} – ${event.away}`);
  const competition = (event && event.competition) || tags.find((tag) => MATCH_COMPETITION_TAGS.includes(tag));
  if (competition) parts.push(competition);
  const phase = tags.find((tag) => MATCH_PHASE_TAGS.includes(String(tag).toLocaleLowerCase("tr")));
  if (phase) parts.push(phase);
  return parts;
}

export function matchColumnsHtml(columns, now = Date.now()) {
  const picked = pickMatchColumns(columns, now);
  if (!picked.length) return "";
  return picked.map((column) => {
    const href = escapeHtml(`./${cleanPublicPath(column.path)}`);
    const info = matchInfo(column);
    return `<article class="column-card home-match-columns__card" data-card="match-column">
              <div class="column-card-head">
                <span class="column-badge">${escapeHtml(column.contentType || column.badge || OPINION_BADGE)}</span>
                <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date, column.locale))}</time>
              </div>
              ${info.length ? `<p class="home-match-columns__match">${info.map(escapeHtml).join(" · ")}</p>` : ""}
              <h3><a href="${href}">${escapeHtml(column.title)}</a></h3>
              ${column.excerpt ? `<p class="home-match-columns__excerpt">${escapeHtml(column.excerpt)}</p>` : ""}
              <div class="column-card-actions"><a class="column-card-detail" href="${href}" aria-label="Yazıyı Oku: ${escapeHtml(column.title)}">Yazıyı Oku</a></div>
            </article>`;
  }).join("\n");
}

export function groupAuthors(columns) {
  const authors = new Map();

  for (const column of columns) {
    if (!authors.has(column.authorPath)) {
      authors.set(column.authorPath, {
        name: column.author,
        path: column.authorPath,
        columns: []
      });
    }
    authors.get(column.authorPath).columns.push(column);
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
    if (line.startsWith("## ")) {
      return `<h2>${inlineText(line.slice(3).trim(), base)}</h2>`;
    }
    if (line.startsWith("|")) return tableHtml(line, base, column.sources);
    return `<p>${inlineText(line, base, column.sources)}</p>`;
  }).join("\n        ");

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
    author: { "@type": column.author === "FutbolRadar" ? "Organization" : "Person", name: column.author, url: `${DOMAIN}/${column.authorPath}` },
    publisher: {
      "@type": "Organization",
      name: "FutbolRadar",
      url: `${DOMAIN}/`,
      logo: `${DOMAIN}/favicon-512x512.png`
    },
    articleSection: column.categoryLabel,
    keywords: column.tags.join(", "),
    mainEntityOfPage: url,
    image: shareImage,
    inLanguage: copy.inLanguage
  };

  const eventLd = locale === "en" ? null : sportsEventJsonLd(column.sportsEvent);
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
    <meta name="description" content="${escapeHtml(pageDescription)}" />
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
    <link rel="stylesheet" href="${base}page.css" />
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
        ${standfirst ? `<p class="column-standfirst">${escapeHtml(standfirst)}</p>` : ""}
        ${shareLinks(column)}
        <p class="column-disclaimer">${escapeHtml(column.disclaimer)}</p>
        ${updatesHtml}

        <div class="column-body">
        ${body}
        </div>

        ${sourcesHtml}

        ${clusterLinksHtml(column, locale, base)}

        ${column.tags.length ? `<div class="column-tags">${column.tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </article>

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
  const description = `${author.name} tarafından FutbolRadar'da yayımlanan köşe yazıları, futbol yorumları ve analizler.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${author.name} Yazıları`,
    inLanguage: "tr-TR",
    mainEntity: {
      "@type": author.name === "FutbolRadar" ? "Organization" : "Person",
      name: author.name,
      url
    }
  };

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
        <p>${escapeHtml(description)}</p>
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

    // En üst maç köşe yazıları şeridi.
    const matchStrip = matchColumnsHtml(homeColumns);
    html = replaceSlot(html, "home-match-columns", matchStrip);
    html = html.replace(/<section\b[^>]*\bdata-match-columns\b[^>]*>/, (tag) => matchStrip.trim()
      ? tag.replace(/\s+hidden(?=[\s>])/, "")
      : (/\s+hidden(?=[\s>])/.test(tag) ? tag : tag.replace(/>$/, " hidden>")));

    // Öne çıkan köşe yazısı: en yeni yayımlanmış yazı, her derlemede yeniden seçilir.
    const featured = featuredColumnHtml(homeColumns);
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
