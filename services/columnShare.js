/**
 * Köşe yazısı paylaşım bağlantıları.
 *
 * X:  https://twitter.com/intent/tweet?url=<kanonik>&text=<başlık>
 * Facebook: https://www.facebook.com/sharer/sharer.php?u=<kanonik>
 *
 * `encodeURIComponent` kesme işaretini kodlamaz; HTML kaçışı da onu `&#39;`
 * yapınca tarayıcı adreste ham `'` bırakır. Sorgu değerleri bu yüzden
 * RFC 3986'ya göre yüzde kodlanır, sonra HTML özniteliğine kaçırılır.
 */
const DOMAIN = "https://www.futbolradar.com";

const COPY = {
  tr: {
    label: "Paylaş",
    sectionLabel: "Yazıyı paylaş",
    facebook: "Facebook'ta paylaş",
    x: "X'te paylaş",
    shareAria: (title) => `${title} yazısını paylaş`
  },
  en: {
    label: "Share",
    sectionLabel: "Share this column",
    facebook: "Share on Facebook",
    x: "Share on X",
    shareAria: (title) => `Share the column ${title}`
  }
};

const ICONS = {
  x: `<svg class="column-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14.7 3h3.1l-6.8 7.8L19 21h-5.2l-4.1-5.3L5.2 21H2.1l7.3-8.3L2 3h5.3l3.7 4.9L14.7 3Zm-1.1 16.2h1.7L7.5 4.7H5.7l7.9 14.5Z"/></svg>`,
  facebook: `<svg class="column-share-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 8.5V6.2c0-.7.5-1.2 1.2-1.2H17V2h-2.2C12.1 2 10 4.1 10 6.8v1.7H8V12h2v10h4v-10h2.6l.4-3.5H14Z"/></svg>`
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
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
  };
}

/** Yazı sayfasının uzantısız kanonik adresi (`/kose-yazilari/<slug>`). */
function canonicalFromPath(filePath) {
  const clean = String(filePath || "").replace(/^\.?\//, "").replace(/\.html$/i, "");
  return `${DOMAIN}/${clean}`;
}

function columnShareHtml({ url, title, locale = "tr" } = {}, { compact = false } = {}) {
  const copy = COPY[locale === "en" ? "en" : "tr"];
  const urls = shareUrls(url, title);
  const xLabel = escapeHtml(copy.x);
  const facebookLabel = escapeHtml(copy.facebook);
  const xHref = escapeHtml(urls.x);
  const facebookHref = escapeHtml(urls.facebook);

  if (compact) {
    return `<div class="column-card-share-actions" aria-label="${escapeHtml(copy.shareAria(title))}">
          <a class="column-card-share column-card-share-x" href="${xHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${xLabel}" title="${xLabel}">${ICONS.x}</a>
          <a class="column-card-share column-card-share-facebook" href="${facebookHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${facebookLabel}" title="${facebookLabel}">${ICONS.facebook}</a>
        </div>`;
  }

  return `<section class="column-share" aria-label="${escapeHtml(copy.sectionLabel)}">
          <span class="column-share-label">${escapeHtml(copy.label)}</span>
          <div class="column-share-actions">
            <a class="column-share-button column-share-x" href="${xHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${xLabel}"><span class="column-share-symbol" aria-hidden="true">${ICONS.x}</span><span>${xLabel}</span></a>
            <a class="column-share-button column-share-facebook" href="${facebookHref}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${facebookLabel}"><span class="column-share-symbol" aria-hidden="true">${ICONS.facebook}</span><span>${facebookLabel}</span></a>
          </div>
        </section>`;
}

function columnShareIsReady(html, { url, title, locale = "tr" } = {}) {
  const copy = COPY[locale === "en" ? "en" : "tr"];
  const urls = shareUrls(url, title);
  const start = html.indexOf('<section class="column-share"');
  if (start < 0) return false;
  const end = html.indexOf("</section>", start);
  if (end < 0) return false;
  const block = html.slice(start, end);
  if (!block.includes(`href="${escapeHtml(urls.x)}"`)) return false;
  if (!block.includes(`href="${escapeHtml(urls.facebook)}"`)) return false;
  if (!block.includes(escapeHtml(copy.x)) || !block.includes(escapeHtml(copy.facebook))) return false;
  if (html.includes('class="page-share"')) return false;
  const articleClose = html.indexOf("</article>");
  return articleClose >= 0 && start > articleClose;
}

/**
 * Yazı sayfasında paylaşım bloğunu yazının hemen altına koyar.
 * Doğru blok zaten oradaysa metin olduğu gibi kalır (derleme ikinci kez
 * koşunca düğmeleri yeniden yazıp geri almasın).
 */
function installColumnShare(html, options) {
  if (columnShareIsReady(html, options)) return html;
  const section = columnShareHtml(options);
  let next = html.replace(/<section class="page-share"\s+data-page-share[\s\S]*?<\/section>\s*/g, "");
  next = next.replace(/<section class="column-share"[\s\S]*?<\/section>\s*/g, "");
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
  encodeShareParam,
  escapeHtml,
  installColumnShare,
  shareUrls
};
