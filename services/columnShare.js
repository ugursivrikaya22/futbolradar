/**
 * Köşe yazısı paylaşım bağlantıları.
 *
 * X:  https://twitter.com/intent/tweet?url=<kanonik>&text=<başlık>
 * Facebook: https://www.facebook.com/sharer/sharer.php?u=<kanonik>
 * WhatsApp: https://wa.me/?text=<başlık + boşluk + kanonik>
 *
 * `encodeURIComponent` kesme işaretini kodlamaz; HTML kaçışı da onu `&#39;`
 * yapınca tarayıcı adreste ham `'` bırakır. Sorgu değerleri bu yüzden
 * RFC 3986'ya göre yüzde kodlanır, sonra HTML özniteliğine kaçırılır.
 */
const DOMAIN = "https://www.futbolradar.com";

const COPY = {
  tr: {
    label: "Paylaş",
    sectionLabel: "Bu sayfayı paylaş",
    columnSectionLabel: "Yazıyı paylaş",
    facebook: "Facebook'ta paylaş",
    x: "X'te paylaş",
    whatsapp: "WhatsApp'ta paylaş",
    shareAria: (title) => `${title} paylaş`,
    columnShareAria: (title) => `${title} yazısını paylaş`
  },
  en: {
    label: "Share",
    sectionLabel: "Share this page",
    columnSectionLabel: "Share this column",
    facebook: "Share on Facebook",
    x: "Share on X",
    whatsapp: "Share on WhatsApp",
    shareAria: (title) => `Share ${title}`,
    columnShareAria: (title) => `Share the column ${title}`
  }
};

const ICONS = {
  x: `<svg class="column-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.7 3h3.1l-6.8 7.8L19 21h-5.2l-4.1-5.3L5.2 21H2.1l7.3-8.3L2 3h5.3l3.7 4.9L14.7 3Zm-1.1 16.2h1.7L7.5 4.7H5.7l7.9 14.5Z"/></svg>`,
  facebook: `<svg class="column-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 8.5V6.2c0-.7.5-1.2 1.2-1.2H17V2h-2.2C12.1 2 10 4.1 10 6.8v1.7H8V12h2v10h4v-10h2.6l.4-3.5H14Z"/></svg>`,
  whatsapp: `<svg class="column-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 3a8.5 8.5 0 0 0-7.3 12.8L3.5 20.5l4.8-1.2A8.5 8.5 0 1 0 12 3Zm4.7 12.1c-.2.6-1.1 1-1.6 1.1-.4 0-.9.2-1.5 0-.3-.1-.8-.2-1.4-.5-2.4-1-3.9-3.5-4-3.7-.1-.2-.9-1.2-.9-2.3s.6-1.6.8-1.8c.2-.2.4-.3.6-.3h.4c.2 0 .3 0 .5.4.2.4.6 1.5.6 1.6.1.1.1.3 0 .4-.1.2-.2.3-.3.4l-.2.2c-.1.1-.2.2-.1.4.2.3.7 1.1 1.5 1.8.8.7 1.5.9 1.7 1 .2.1.3.1.4 0 .2-.2.6-.6.7-.8.2-.2.3-.2.5-.1l1.3.6c.2.1.3.2.4.3.1.2 0 .6-.2.9Z"/></svg>`
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeShareParam(value) {
  return encodeURIComponent(String(value ?? "")).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function shareUrls(url, title) {
  const encodedUrl = encodeShareParam(url);
  const encodedTitle = encodeShareParam(title);
  return {
    x: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    whatsapp: `https://wa.me/?text=${encodeShareParam(`${title} ${url}`)}`
  };
}

/** Maç, takım, istatistik ve köşe yazısı sayfaları bu yüzeyi paylaşır. */
function shareSurface(pathname) {
  const path = String(pathname || "");
  if (/^\/(?:kose-yazilari|en\/columns)\/[^/]+$/.test(path)) return "column";
  if (/^\/mac\/[^/]+$/.test(path) || /^\/en\/match\/[^/]+$/.test(path)) return "match";
  if (/^\/takimlar\/[^/]+$/.test(path) || /^\/en\/team\/[^/]+$/.test(path)) return "team";
  if (/^\/(?:istatistik-merkezi|gol-kralligi|asist-kralligi)(?:\.html)?$/.test(path)) return "stats";
  if (/^\/en\/(?:stats-hub|top-scorers|top-assists)(?:\.html)?$/.test(path)) return "stats";
  return "";
}

/** Yazı sayfasının uzantısız kanonik adresi (`/kose-yazilari/<slug>`). */
function canonicalFromPath(filePath) {
  const clean = String(filePath || "").replace(/^\.?\//, "").replace(/\.html$/i, "");
  return `${DOMAIN}/${clean}`;
}

function pageShareHtml({ url, title, locale = "tr", variant = "page" } = {}, { compact = false } = {}) {
  const copy = COPY[locale === "en" ? "en" : "tr"];
  const urls = shareUrls(url, title);
  const xLabel = escapeHtml(copy.x);
  const facebookLabel = escapeHtml(copy.facebook);
  const whatsappLabel = escapeHtml(copy.whatsapp);
  const xHref = escapeHtml(urls.x);
  const facebookHref = escapeHtml(urls.facebook);
  const whatsappHref = escapeHtml(urls.whatsapp);
  const groupLabel = variant === "column" ? copy.columnShareAria(title) : copy.shareAria(title);

  if (compact) {
    return `<div class="column-card-share-actions" aria-label="${escapeHtml(groupLabel)}">
          <a class="column-card-share column-card-share-x" href="${xHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${xLabel}" title="${xLabel}">${ICONS.x}</a>
          <a class="column-card-share column-card-share-facebook" href="${facebookHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${facebookLabel}" title="${facebookLabel}">${ICONS.facebook}</a>
          <a class="column-card-share column-card-share-whatsapp" href="${whatsappHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="whatsapp" aria-label="${whatsappLabel}" title="${whatsappLabel}">${ICONS.whatsapp}</a>
        </div>`;
  }

  const sectionLabel = variant === "column" ? copy.columnSectionLabel : copy.sectionLabel;
  return `<section class="column-share" aria-label="${escapeHtml(sectionLabel)}">
          <span class="column-share-label">${escapeHtml(copy.label)}</span>
          <div class="column-share-actions">
            <a class="column-share-button column-share-x" href="${xHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${xLabel}"><span class="column-share-symbol" aria-hidden="true">${ICONS.x}</span><span>${xLabel}</span></a>
            <a class="column-share-button column-share-facebook" href="${facebookHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${facebookLabel}"><span class="column-share-symbol" aria-hidden="true">${ICONS.facebook}</span><span>${facebookLabel}</span></a>
            <a class="column-share-button column-share-whatsapp" href="${whatsappHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="whatsapp" aria-label="${whatsappLabel}"><span class="column-share-symbol" aria-hidden="true">${ICONS.whatsapp}</span><span>${whatsappLabel}</span></a>
          </div>
        </section>`;
}

function columnShareHtml(options = {}, flags) {
  return pageShareHtml({ ...options, variant: "column" }, flags);
}

function shareBlockReady(html, { url, title, locale = "tr" } = {}) {
  const copy = COPY[locale === "en" ? "en" : "tr"];
  const urls = shareUrls(url, title);
  const start = html.indexOf('<section class="column-share"');
  if (start < 0) return null;
  const end = html.indexOf("</section>", start);
  if (end < 0) return null;
  const block = html.slice(start, end);
  if (!block.includes(`href="${escapeHtml(urls.x)}"`)) return null;
  if (!block.includes(`href="${escapeHtml(urls.facebook)}"`)) return null;
  if (!block.includes(`href="${escapeHtml(urls.whatsapp)}"`)) return null;
  if (!block.includes(escapeHtml(copy.x)) || !block.includes(escapeHtml(copy.facebook)) || !block.includes(escapeHtml(copy.whatsapp))) return null;
  if (html.includes('class="page-share"')) return null;
  return start;
}

function columnShareIsReady(html, options = {}) {
  const start = shareBlockReady(html, options);
  if (start == null) return false;
  const articleClose = html.indexOf("</article>");
  return articleClose >= 0 && start > articleClose;
}

function contentShareIsReady(html, options = {}) {
  const start = shareBlockReady(html, options);
  if (start == null) return false;
  const mainClose = html.indexOf("</main>");
  return mainClose >= 0 && start < mainClose;
}

function stripShareSections(html) {
  return html
    .replace(/<section class="page-share"\s+data-page-share[\s\S]*?<\/section>\s*/g, "")
    .replace(/<section class="column-share"[\s\S]*?<\/section>\s*/g, "");
}

function decodeHtml(value) {
  return String(value ?? "").replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([0-9a-f]+));/gi, (all, decimal, hex) => {
    if (decimal || hex) {
      const point = parseInt(decimal || hex, hex ? 16 : 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : all;
    }
    return ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">" })[all.toLowerCase()] || all;
  });
}

/** Kanonik adres ve ilk h1'den içeriğin altına paylaşım bloğu basar. */
function installContentShareFromDocument(html) {
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
  if (!canonical) return html;
  let parsed;
  try { parsed = new URL(decodeHtml(canonical)); } catch { return html; }
  const surface = parsed.origin === DOMAIN ? shareSurface(parsed.pathname) : "";
  if (!surface || surface === "column") return html;
  const heading = html.match(/<h1\b[^>]*>([^<]*)<\/h1>/i)?.[1];
  const title = decodeHtml(heading || html.match(/<title>([^<]*)<\/title>/i)?.[1] || "").trim();
  if (!title) return html;
  const locale = /<html\b[^>]*lang="en/i.test(html) ? "en" : "tr";
  return installContentShare(html, { url: parsed.href, title, locale });
}

/** Sayfa içeriğinin hemen altına, `</main>` kapanmadan önce. */
function installContentShare(html, options) {
  if (contentShareIsReady(html, options)) return html;
  const section = pageShareHtml(options);
  const next = stripShareSections(html);
  if (!next.includes("</main>")) return html;
  return next.replace("</main>", `${section}\n</main>`);
}

/**
 * Yazı sayfasında paylaşım bloğunu yazının hemen altına koyar.
 * Doğru blok zaten oradaysa metin olduğu gibi kalır (derleme ikinci kez
 * koşunca düğmeleri yeniden yazıp geri almasın).
 */
function installColumnShare(html, options) {
  if (columnShareIsReady(html, options)) return html;
  const section = columnShareHtml(options);
  const next = stripShareSections(html);
  if (next.includes("</article>")) {
    return next.replace("</article>", `</article>\n      ${section}\n`);
  }
  if (next.includes("</main>")) return next.replace("</main>", `${section}\n</main>`);
  return html;
}

module.exports = {
  COPY,
  canonicalFromPath,
  columnShareHtml,
  columnShareIsReady,
  contentShareIsReady,
  encodeShareParam,
  escapeHtml,
  installColumnShare,
  installContentShare,
  installContentShareFromDocument,
  pageShareHtml,
  shareSurface,
  shareUrls
};
