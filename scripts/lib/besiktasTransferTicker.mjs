/**
 * BEŞİKTAŞ TRANSFER GÜNDEMİ BANDININ TEK İŞARETLEME KAYNAĞI.
 *
 * Seçim buraya AİT DEĞİL: hangi kaydın banda gireceği, durumu ve sırası
 * services/besiktasTransferTicker.js'te. Burası yalnızca "seçilmiş kayıtlar
 * nasıl çizilir" sorusunu cevaplar — transfer radarı bandındaki ayrımın
 * aynısı (scripts/lib/transferTicker.mjs).
 *
 * Kayan animasyon saf CSS; bant JavaScript olmadan da çalışır. İkinci grup
 * (aria-hidden) kaymanın kesintisiz görünmesi için birebir kopyadır — ekran
 * okuyucu onu atlar, klavye `tabindex="-1"` ile içinden geçmez.
 *
 * BANT TÜRKÇEDİR VE TÜRKÇE KALIR. İngilizce sayfalara basılmaz: başlık
 * ("Beşiktaş Transfer Gündemi"), durum etiketleri ve küratörlü başlıklar
 * Türkçe serbest metindir, çevrilmeden İngilizce sayfaya giremez (kural
 * scripts/lib/enTicker.mjs'te yazılı ve test-en-dynamic-pages onu sınıyor).
 */

/**
 * BANT HANGİ SAYFALARDA ÇIKAR.
 *
 * Tek kulüplü bir bant her sayfaya ait değildir. Galatasaray maç sayfasına
 * ya da genel puan durumuna Beşiktaş transfer şeridi koymak, okuyucunun
 * aradığı şeyi ekranın dışına iten editoryal bir gürültüdür.
 *
 * Bu yüzden liste dar ve ELLE tutulur: Beşiktaş yüzeyleri, transfer
 * yüzeyleri ve ana sayfa. Hem enjeksiyon hem test aynı listeyi buradan
 * okur; "tüm Beşiktaş sayfaları" gibi bir kural yazmak, ileride eklenen her
 * sayfanın habersizce bant kazanmasına yol açardı.
 */
export const BESIKTAS_TICKER_PAGES = [
  "index.html",
  "besiktas-maclari.html",
  "besiktas-form-durumu.html",
  "besiktas-oyuncu-radari.html",
  "besiktas-yeni-transferleri-2026-2027.html",
  "transfer-radari.html",
  "transfer-izleme.html"
];

/**
 * BOŞ DURUMDA MESAJ GÖSTEREN SAYFALAR.
 *
 * Genel kural: doğrulanmış öğe yoksa bant HİÇ ÇİZİLMEZ. Sayfanın tepesinde
 * hiçbir şey söylemeyen bir çubuk bırakmak, yer tutucu uydurmanın sessiz
 * biçimidir (haber bandı ve transfer radarı da öğe yoksa çizilmiyor).
 *
 * İSTİSNA, bandın sayfanın KONUSU olduğu yerler. Beşiktaş transfer
 * sayfasına gelen okuyucu için bandın yokluğu bir cevaptır ve o cevabın
 * yazılı olması gerekir: "şu an doğrulanmış bir gelişme yok" demek,
 * hiçbir şey göstermemekten dürüsttür. Uydurma yer tutucu ise HİÇBİR
 * KOŞULDA basılmaz — mesaj bir haber değil, bir durum bildirimidir.
 */
export const BESIKTAS_TICKER_MESSAGE_PAGES = [
  "besiktas-yeni-transferleri-2026-2027.html",
  "transfer-radari.html"
];

const STRINGS = {
  label: "Beşiktaş Transfer Gündemi",
  region: "Beşiktaş transfer gündemi bandı",
  breaking: "SON DAKİKA",
  fallbackLead: "TRANSFER",
  empty: "Şu an doğrulanmış bir Beşiktaş transfer gelişmesi yok."
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Bant öğesi. Bağlantısı olmayan kayıt `<span>` olur — tıklanacak bir yeri
 * yokken `<a>` yazmak kullanıcıya olmayan bir söz vermektir.
 *
 * Özet başlığın yanında görünür ama ekranda kısaltılır: bant bir liste
 * değil. Tam metin `title` ve `aria-label` içinde durur, yani hem fareyle
 * üzerine gelen hem ekran okuyucu tamamını alır.
 */
export function besiktasTickerItem(item, options = {}) {
  const { duplicate = false, sourceRel = "nofollow noopener noreferrer" } = options;
  const external = /^https?:/i.test(item.url || "");
  const tag = item.url ? "a" : "span";
  const attributes = item.url
    ? ` href="${escapeHtml(item.url)}"${external ? ` target="_blank" rel="${sourceRel}"` : ""}${duplicate ? ' tabindex="-1"' : ""}`
    : "";

  const lead = item.isBreaking ? STRINGS.breaking : (item.dateLabel || STRINGS.fallbackLead);
  // Atıf ZORUNLU görünür: bir iddianın arkasında kimin olduğu, iddianın
  // kendisi kadar önemli.
  const attribution = item.sourceName ? ` — kaynak: ${item.sourceName}` : "";
  const aria = `${lead} | ${item.headline} | ${item.statusLabel}${attribution}` +
    (item.summary ? ` | ${item.summary}` : "");

  return `<${tag} class="besiktas-ticker__item"${attributes} aria-label="${escapeHtml(aria)}" title="${escapeHtml(`${item.headline}${item.summary ? ` — ${item.summary}` : ""}${attribution}`)}">` +
    `<span class="besiktas-ticker__lead${item.isBreaking ? "" : " is-dated"}">${escapeHtml(lead)}</span>` +
    `<span class="besiktas-ticker__separator" aria-hidden="true">|</span>` +
    `<strong class="besiktas-ticker__headline">${escapeHtml(item.headline)}</strong>` +
    (item.summary
      ? `<span class="besiktas-ticker__separator" aria-hidden="true">|</span>` +
        `<span class="besiktas-ticker__summary">${escapeHtml(item.summary)}</span>`
      : "") +
    `<span class="besiktas-ticker__separator" aria-hidden="true">|</span>` +
    `<span class="besiktas-ticker__source">${escapeHtml(item.sourceName)}</span>` +
    // Sınıf anahtarı İngilizce kalır (CSS onunla renklendiriyor).
    `<span class="besiktas-ticker__status is-${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>` +
    `</${tag}>`;
}

/** Kayan şerit. Veri yoksa çağıran karar verir; burada uydurma yapılmaz. */
export function besiktasTickerTrack(items, options = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!list.length) {
    return `<div class="besiktas-ticker__track is-static" data-besiktas-ticker-track>
            <div class="besiktas-ticker__group"><span class="besiktas-ticker__empty">${escapeHtml(STRINGS.empty)}</span></div>
          </div>`;
  }

  // Süre transfer radarı bandıyla aynı formülden: öğe başına 9 sn, 34-80 sn.
  const duration = Math.max(34, Math.min(80, list.length * 9));
  const primary = list.map((item) => besiktasTickerItem(item, { ...options, duplicate: false })).join("");
  const duplicate = list.map((item) => besiktasTickerItem(item, { ...options, duplicate: true })).join("");

  return `<div class="besiktas-ticker__track" style="--besiktas-ticker-duration:${duration}s" data-besiktas-ticker-track>
            <div class="besiktas-ticker__group">${primary}</div>
            <div class="besiktas-ticker__group" aria-hidden="true">${duplicate}</div>
          </div>`;
}

/**
 * Şeridi saran tam blok.
 *
 * Öğe yoksa ve sayfa mesaj sayfalarından değilse BOŞ DÖNER — bant hiç
 * basılmaz. `keepEmpty` yalnızca bandın sayfanın konusu olduğu yerlerde
 * verilir.
 */
export function besiktasTickerBlock(items, options = {}) {
  const { sourceRel, keepEmpty = false } = options;
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  if (!list.length && !keepEmpty) return "";

  return `<div class="besiktas-ticker" data-component="BesiktasTransferTicker" data-source="static" role="region" aria-label="${escapeHtml(STRINGS.region)}">
      <div class="container-wide besiktas-ticker__inner">
        <span class="besiktas-ticker__label">${escapeHtml(STRINGS.label)}</span>
        <div class="besiktas-ticker__viewport">
          ${besiktasTickerTrack(list, { sourceRel })}
        </div>
      </div>
    </div>`;
}

export const BESIKTAS_TICKER_STRINGS = STRINGS;
