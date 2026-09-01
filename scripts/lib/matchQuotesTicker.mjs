/**
 * MAÇ SONU AÇIKLAMALARI ŞERİDİ.
 *
 * Kural burada DEĞİL: hangi alıntının yayımlanabileceğine
 * services/managerQuotes.js karar veriyor (kaynak zorunlu, zaman damgası
 * zorunlu, tanınmayan rol reddedilir, uydurma asla üretilmez). Bu dosya
 * yalnızca o kararın sonucunu çiziyor.
 *
 * BOŞ HÂL GİZLENMİYOR. Doğrulanmış alıntı yoksa şerit kaldırılmaz,
 * "Kaynaklardan bekleniyor" yazar. Sessiz boşluk okuyucuya "kimse konuşmadı"
 * diye okunur; doğrusu "biz henüz doğrulamadık".
 *
 * Biçim her iki yüzeyde de aynı: kişi adı · rolü · takımı, ardından alıntı.
 * Rol dekoratif değil — aynı cümle teknik direktörden gelince kadro/plan
 * beyanı, futbolcudan gelince kişisel değerlendirme olur.
 *
 * TAM LİSTE BURADA DEĞİL. Maç raporu sayfasındaki tam liste, çekirdek
 * raporun `manager-comment` bölümü tarafından (`core-quote` figürleri)
 * çiziliyor ve test-post-match-core tarafından sınanıyor. Burada ikinci bir
 * liste işaretlemesi tutmak, aynı veriyi iki farklı biçimde gösterme riski
 * yaratırdı; şerit kısa hâli, çekirdek bölüm tam hâli veriyor.
 */

/** Okuyucuya gösterilecek tek bekleme ifadesi. */
export const QUOTES_AWAITING_LABEL = "Kaynaklardan bekleniyor";

const LABEL = "Maç Sonu Açıklamaları";

/** Şeritte alıntı bu uzunlukta kesilir; tam metin maç sayfasında durur. */
const TICKER_QUOTE_LIMIT = 120;

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Şerit alıntısını kısaltır. KELİME ORTASINDAN kesmez: yarım bir kelime
 * okunmaz ve alıntı hâlâ tırnak içinde görünür.
 */
export function shortenQuote(value, limit = TICKER_QUOTE_LIMIT) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  const stem = lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${stem.replace(/\s+$/, "")}…`;
}

/** "Joao Pereira · Teknik direktör · Alanyaspor" */
export function quoteAttribution(quote) {
  return [quote.speaker, quote.roleLabel, quote.team].filter(Boolean).join(" · ");
}

function awaitingHtml(note) {
  return `<p class="match-quotes__awaiting" data-quotes-state="awaiting">
        <strong>${escapeHtml(QUOTES_AWAITING_LABEL)}</strong>
        <span>${escapeHtml(note || "Doğrulanmış bir maç sonu açıklaması yayımlandığında burada gösterilecek.")}</span>
      </p>`;
}

function tickerItemHtml(quote, options) {
  const href = typeof options.href === "function" ? options.href(quote) : null;
  const attribution = `<span class="match-quotes__who">${escapeHtml(quoteAttribution(quote))}</span>`;
  const text = `<span class="match-quotes__text">${escapeHtml(`“${shortenQuote(quote.quote)}”`)}</span>`;
  const body = `${attribution}${text}`;

  // Maç sayfası bağlantısı varsa oraya, yoksa doğrudan kaynağa. Kaynağa
  // çıkan bağlantı dış bağlantıdır ve öyle işaretlenir.
  if (href) {
    return `<a class="match-quotes__item" href="${escapeHtml(href)}">${body}</a>`;
  }
  return `<a class="match-quotes__item" href="${escapeHtml(quote.source.url)}" target="_blank" rel="nofollow noopener noreferrer">${body}</a>`;
}

/**
 * Kayan şerit.
 *
 * Şerit iki kez basılır (ikincisi aria-hidden): CSS animasyonu kesintisiz
 * dönsün diye. Aynı desen haber, canlı skor ve transfer şeritlerinde de var.
 *
 * @param {{status: string, quotes: Array, reason?: string}} verdict
 *   services/managerQuotes.js çıktısı.
 */
export function matchQuotesTickerBlock(verdict, options = {}) {
  const quotes = (verdict && Array.isArray(verdict.quotes) ? verdict.quotes : []).filter(Boolean);

  const inner = quotes.length
    ? (() => {
      const track = quotes.map((quote) => tickerItemHtml(quote, options)).join(
        '<span class="match-quotes__sep" aria-hidden="true"></span>'
      );
      return `<div class="match-quotes__track">
            <div class="match-quotes__group">${track}</div>
            <div class="match-quotes__group" aria-hidden="true">${track}</div>
          </div>`;
    })()
    : awaitingHtml(options.awaitingNote || (verdict && verdict.reason));

  return `<div class="match-quotes-ticker" data-component="MatchQuotesTicker" role="region" aria-label="${escapeHtml(LABEL)}">
      <div class="container-wide match-quotes-ticker__inner">
        <span class="match-quotes-ticker__label">${escapeHtml(LABEL)}</span>
        <div class="match-quotes-ticker__viewport"${quotes.length ? "" : ' data-empty="true"'}>
          ${inner}
        </div>
      </div>
    </div>`;
}

export { escapeHtml, LABEL };
