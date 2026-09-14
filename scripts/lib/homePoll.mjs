/**
 * ANA SAYFA TAHMİN ANKETİNİN TEK İŞARETLEME KAYNAĞI.
 *
 * Seçim buraya AİT DEĞİL: hangi anketin açık olduğu ve seçeneklerin nereden
 * geldiği `services/homePoll.js`te. Burası yalnızca "seçilmiş anket nasıl
 * çizilir" sorusunu cevaplar.
 *
 * BLOK ARTIK DOLU DOĞUYOR — VE BUNUN SEBEBİ MOBİL.
 *
 * Önce boş bir kabuk basılıyor, soru ve seçenekler istemcide `/api/home-poll`
 * yanıtından dolduruluyordu. Sonuç: mobilde ilk ekranda anket YERİNE boşluk
 * vardı; kutu ancak JavaScript yüklenip istek dönünce beliriyordu. Yavaş
 * bağlantıda bu saniyeler demek ve "ilk ekranda görünsün" gereksinimi
 * karşılanmıyordu.
 *
 * Artık soru, alt başlık ve 18 kulübün tamamı derleme anında basılıyor:
 * ilk boyamada kutu tam, seçenekler tıklanabilir. İstemci sonra yalnızca
 * SAYIMI ekliyor ve gerekirse düzeltiyor.
 *
 * TAKVİM KAYMASI NASIL ELE ALINIYOR. Derleme anındaki açık anket ile istek
 * anındaki açık anket ayrışabilir (site saatte bir yeniden derleniyor, yani
 * pencere en fazla bir saat). İstemci `/api/home-poll` yanıtını SON SÖZ
 * sayar: sunucu başka bir anket bildirirse blok yeniden çizilir, "anket yok"
 * derse blok gizlenir. Basılı işaretleme bir HIZLANDIRMADIR, bir iddia
 * değil.
 *
 * GÖNDER DÜĞMESİ KAPALI DOĞAR. Oyun sayılabilmesi için depo gerekiyor ve
 * bunu ancak istemci öğrenebilir. Açık bir düğme basıp oyu sessizce
 * kaybetmektense düğme kapalı doğar; istemci depoyu hazır bulunca açar.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
/**
 * ÇERÇEVE METİNLERİ SERVİSTEN GELİR, BURADA İKİNCİ KEZ YAZILMAZ.
 *
 * Aynı cümleler bir süre iki sözlükte birden durdu (burada ve
 * `services/homePoll.js` → `COPY`). İki kopyanın bilinen sonu, Türkçesi
 * düzeltilip İngilizcesi unutulan bir satırdır — ve anket iki dilde birebir
 * aynı olmak zorunda. Servis kaynak, burası yalnızca çizim.
 */
const { COPY } = require("../../services/homePoll.js");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Servisten gelen çerçeve metinleri + yalnızca çizime ait olanlar. */
function framed(locale, extras) {
  const base = COPY[locale];
  return {
    kicker: base.kicker,
    button: base.button,
    thanks: base.thanks,
    closed: base.closed,
    community: base.communityNote,
    local: base.localNote,
    offline: base.offline,
    disclaimer: base.disclaimer,
    region: base.region,
    ...extras
  };
}

const STRINGS = {
  tr: framed("tr", {
    shareTitle: "Sonucu Paylaş",
    shareLead: "Paylaşım metni senin oyuna ve anketin güncel sonucuna göre oluşur.",
    shareNative: "Paylaş",
    shareCopy: "Bağlantıyı Kopyala",
    shareInstagram: "Instagram'da Paylaş",
    cardTitle: "Paylaşılabilir kart",
    cardSquare: "Kare · 1080×1080",
    cardStory: "Story · 1080×1920",
    cardShare: "Görseli Paylaş",
    cardDownload: "Görseli İndir",
    cardAlt: "Anket sonucunun paylaşılabilir görsel kartı",
    podiumLabel: "Anket liderleri"
  }),
  en: framed("en", {
    shareTitle: "Share the Result",
    shareLead: "The share text is built from your pick and the poll's live result.",
    shareNative: "Share",
    shareCopy: "Copy Link",
    shareInstagram: "Share on Instagram",
    cardTitle: "Shareable card",
    cardSquare: "Square · 1080×1080",
    cardStory: "Story · 1080×1920",
    cardShare: "Share Image",
    cardDownload: "Download Image",
    cardAlt: "Shareable social card of the poll result",
    podiumLabel: "Poll leaders"
  })
};

const PROMO_STRINGS = {
  tr: { kicker: "Anket", cta: "Oyunu Ver", label: "Anket vitrin kartı" },
  en: { kicker: "Poll", cta: "Cast Your Vote", label: "Homepage poll promo" }
};

const STICKY_STRINGS = {
  tr: { kicker: "Anket", cta: "Şimdi Oy Ver", dismiss: "Anket kutusunu kapat", label: "Sabit anket kutusu" },
  en: { kicker: "Poll", cta: "Vote Now", dismiss: "Dismiss poll widget", label: "Sticky poll widget" }
};

/** Tek seçenek: kulüp arması + resmi ad. Arma yoksa baş harfler. */
function optionRow(option, pollId) {
  const inputId = `home-poll-${pollId}-${option.id}`;
  const crest = option.logo
    ? `<img class="home-poll__crest" src="${escapeHtml(option.logo)}" alt="" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="home-poll__crest is-initials" aria-hidden="true">${escapeHtml(option.initials || "?")}</span>`;

  return `<li class="home-poll__option">` +
    `<input class="home-poll__radio" type="radio" name="home-poll-choice" ` +
    `id="${escapeHtml(inputId)}" value="${escapeHtml(option.id)}">` +
    `<label class="home-poll__label" for="${escapeHtml(inputId)}">${crest}` +
    `<span class="home-poll__option-name">${escapeHtml(option.label)}</span></label></li>`;
}

/**
 * PAYLAŞIM PANELİ — OY VERİLDİKTEN SONRA AÇILIR.
 *
 * `hidden` DOĞAR ve metinsiz doğar. Sebebi tek cümle: PAYLAŞIM METNİ SABİT
 * OLAMAZ. "Ben Fenerbahçe'yi seçtim, şu anda %34 oy alıyor" cümlesi ancak
 * seçim ve sayım bilindiğinde kurulabilir; ikisi de derleme anında yok.
 * Şablonlar uç noktadan geliyor (`services/homePoll.js` → `SHARE_COPY`),
 * istemci yalnızca yer tutucuları dolduruyor — metni tarayıcıda ikinci kez
 * yazmak, bir gün Türkçenin düzeltilip İngilizcenin unutulması demekti.
 *
 * KANALLAR `<a>` DEĞİL `<button>`. Paylaşım adresi ancak seçim ve sayım
 * bilinince kurulabiliyor; derleme anında yazılabilecek bir `href` yok.
 * Boş bırakılan bir `<a>` ise iki kere bozuk: hedefsiz bir bağlantı klavye
 * sırasına girmez, üstelik "her `<a>` bir yere gitmeli" denetimi
 * (`scripts/audit-interaction-routes.mjs`) onu haklı olarak kırık sayar.
 * Düğme, JavaScript olmadan hiçbir vaatte bulunmuyor — panel zaten JavaScript
 * olmadan hiç açılmıyor.
 *
 * NATIVE PAYLAŞIM DÜĞMESİ DE GİZLİ DOĞAR: `navigator.share` yalnızca bazı
 * tarayıcılarda var ve yalnızca güvenli bağlamda çalışıyor. Desteklenmeyen
 * yerde düğmeyi göstermek, basınca hiçbir şey olmayan bir düğme demektir.
 */
function shareBlockHtml(copy) {
  const channel = (platform, label) =>
    `<button class="poll-share__button is-${platform}" type="button" ` +
    `data-poll-share-link="${platform}">${escapeHtml(label)}</button>`;

  return `
            <div class="poll-share" data-poll-share hidden>
              <p class="poll-share__title">${escapeHtml(copy.shareTitle)}</p>
              <p class="poll-share__lead">${escapeHtml(copy.shareLead)}</p>
              <p class="poll-share__text" data-poll-share-text></p>
              <div class="poll-share__buttons">
                <button class="poll-share__button is-native" type="button" data-poll-share-native hidden>${escapeHtml(copy.shareNative)}</button>
                ${channel("x", "X")}
                ${channel("whatsapp", "WhatsApp")}
                ${channel("facebook", "Facebook")}
                ${channel("telegram", "Telegram")}
                <button class="poll-share__button is-instagram" type="button" data-poll-share-instagram>${escapeHtml(copy.shareInstagram)}</button>
                <button class="poll-share__button is-copy" type="button" data-poll-share-copy>${escapeHtml(copy.shareCopy)}</button>
              </div>
              <div class="poll-card" data-poll-card hidden>
                <p class="poll-card__title">${escapeHtml(copy.cardTitle)}</p>
                <div class="poll-card__formats" role="group" aria-label="${escapeHtml(copy.cardTitle)}">
                  <button class="poll-card__format" type="button" data-poll-card-format="square" aria-pressed="true">${escapeHtml(copy.cardSquare)}</button>
                  <button class="poll-card__format" type="button" data-poll-card-format="story" aria-pressed="false">${escapeHtml(copy.cardStory)}</button>
                </div>
                <img class="poll-card__preview" data-poll-card-preview alt="${escapeHtml(copy.cardAlt)}" hidden>
                <div class="poll-card__actions">
                  <button class="poll-share__button is-card-share" type="button" data-poll-card-share hidden>${escapeHtml(copy.cardShare)}</button>
                  <button class="poll-share__button is-card-download" type="button" data-poll-card-download>${escapeHtml(copy.cardDownload)}</button>
                </div>
              </div>
              <p class="poll-share__status" data-poll-share-status role="status" hidden></p>
            </div>`;
}

/**
 * Anket bloğu. `poll` yoksa BOŞ DÖNER — takvimde yayında anket olmadığında
 * ana sayfada boş bir kutu bırakmak, yer tutucu uydurmanın sessiz biçimidir.
 *
 * @param poll `localizePoll()` çıktısı (tek dile indirgenmiş)
 * @param options.locale "tr" | "en"
 * @param options.status "open" | "closed"
 * @param options.heading başlık etiketi ("h2" varsayılan; anket sayfasında "h1")
 * @param options.pinned true ise blok BU anketi ister (`?pollId=`), "şu an açık
 *        olanı" değil — anket sayfası kapanmış bir anketi de göstermek zorunda
 * @param options.containerClass dış kapsayıcı sınıfı (ana sayfada "container section")
 * @param options.regionLabel bölgenin ekran okuyucu etiketi (varsayılan: ana sayfa metni)
 */
export function homePollBlock(poll, options = {}) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return "";

  const locale = options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  const closed = options.status === "closed";
  const heading = options.heading === "h1" ? "h1" : "h2";
  const containerClass = typeof options.containerClass === "string" ? options.containerClass : "container section";
  // Bölge etiketi sayfaya göre değişir: "ana sayfa tahmin anketi" cümlesi
  // anketin KENDİ sayfasında ekran okuyucuya yanlış yeri söylerdi.
  const regionLabel = typeof options.regionLabel === "string" && options.regionLabel
    ? options.regionLabel
    : copy.region;
  const rows = poll.options.map((option) => optionRow(option, poll.id)).join("");

  // ANKET SAYFASI BU ANKETİ İSTER, "ŞU AN AÇIK OLANI" DEĞİL.
  //
  // Ana sayfa takvimin açık anketini gösterir ve takvim kayarsa yeniden
  // çizilir. `/anket/<slug>` bunu YAPAMAZ: adres belli bir anketi
  // adlandırıyor ve o anket kapanmış olabilir. Uç nokta bu yüzden kimlikle
  // sabitleniyor — sunucu yine takvimden doğruluyor, yani kimlik bir iddia
  // olmaktan çıkmıyor, sadece hangi anketin sorulduğunu söylüyor.
  const source = options.pinned
    ? `/api/home-poll?pollId=${encodeURIComponent(poll.id)}`
    : "/api/home-poll";

  // Kapanmış ankette form HİÇ basılmaz: oy alınmıyor, sonuç gösteriliyor.
  const form = closed
    ? ""
    : `
            <form class="home-poll__form" data-home-poll-form>
              <ul class="home-poll__options" data-home-poll-options>${rows}</ul>
              <button class="home-poll__submit" type="submit" data-home-poll-submit disabled>${escapeHtml(copy.button)}</button>
            </form>`;

  return `<section class="${escapeHtml(containerClass)} home-poll" id="tahmin-anketi" aria-labelledby="home-poll-title" ` +
    `data-home-poll data-home-poll-source="${escapeHtml(source)}" data-home-poll-locale="${locale}" ` +
    `data-home-poll-id="${escapeHtml(poll.id)}"${options.pinned ? " data-home-poll-pinned" : ""} ` +
    `data-home-poll-path="${escapeHtml(poll.path || "")}" role="region" aria-label="${escapeHtml(regionLabel)}">
          <div class="home-poll__inner">
            <div class="home-poll__head">
              <span class="home-poll__kicker" data-home-poll-kicker>${escapeHtml(copy.kicker)}</span>
              <${heading} class="home-poll__title" id="home-poll-title" data-home-poll-question>${escapeHtml(poll.question)}</${heading}>
              ${poll.subtitle ? `<p class="home-poll__subtitle" data-home-poll-subtitle>${escapeHtml(poll.subtitle)}</p>` : `<p class="home-poll__subtitle" data-home-poll-subtitle hidden></p>`}
              <p class="home-poll__deadline" data-home-poll-deadline hidden></p>
            </div>${form}
            <p class="home-poll__thanks" data-home-poll-thanks hidden>${escapeHtml(copy.thanks)}</p>
            <ol class="poll-podium" data-home-poll-podium aria-label="${escapeHtml(copy.podiumLabel)}" hidden></ol>
            <ol class="home-poll__results" data-home-poll-results aria-live="polite" hidden></ol>
            <p class="home-poll__total" data-home-poll-total hidden></p>${shareBlockHtml(copy)}
            <p class="home-poll__note" data-home-poll-note="closed"${closed ? "" : " hidden"}>${escapeHtml(copy.closed)}</p>
            <p class="home-poll__note" data-home-poll-note="offline" hidden>${escapeHtml(copy.offline)}</p>
            <p class="home-poll__note" data-home-poll-note="community" hidden>${escapeHtml(copy.community)}</p>
            <p class="home-poll__note" data-home-poll-note="local" hidden>${escapeHtml(copy.local)}</p>
            <p class="home-poll__disclaimer">${escapeHtml(copy.disclaimer)}</p>
          </div>
        </section>`;
}

/**
 * ANKET VİTRİN KARTI — tam form DEĞİL, mevcut ankete çağrı.
 *
 * Sayfada birden fazla yere basılabildiği için (maç önü/maç sonrası arası,
 * transfer-gündem kümesinin yanı, haber akışında her 6-8 karttan sonra) tam
 * oy formunu tekrarlamıyor: aynı `name="home-poll-choice"` radyo grubunu
 * birden çok yerde basmak geçersiz işaretleme ve karışık klavye gezinmesi
 * demek olurdu. Katılım sayısı derleme anında bilinmiyor (gerçek sayaç
 * veritabanından geliyor) — bu yüzden `data-poll-promo-total` boş ve
 * `hidden` doğar, istemci dolduruyor. Kapanmış ankete "oy ver" çağrısı
 * yapılmaz; bu yüzden `status === "closed"` iken boş dize döner.
 *
 * @param poll `localizePoll()` çıktısı
 * @param options.locale "tr" | "en"
 * @param options.status "open" | "closed"
 * @param options.href kart tıklanınca gidilecek yer (varsayılan: ana sayfadaki `#tahmin-anketi`)
 */
export function pollPromoCardHtml(poll, options = {}) {
  if (!poll) return "";
  if (options.status === "closed") return "";
  const locale = options.locale === "en" ? "en" : "tr";
  const copy = PROMO_STRINGS[locale];
  const href = options.href || "#tahmin-anketi";

  return `<aside class="poll-promo" data-poll-promo data-poll-promo-locale="${locale}" data-poll-promo-id="${escapeHtml(poll.id)}" aria-label="${escapeHtml(copy.label)}">
    <div class="poll-promo-body">
      <span class="poll-promo-kicker">${escapeHtml(copy.kicker)}</span>
      <p class="poll-promo-question" data-poll-promo-question>${escapeHtml(poll.question)}</p>
      <span class="poll-promo-total" data-poll-promo-total hidden></span>
    </div>
    <a class="poll-promo-cta" href="${escapeHtml(href)}" data-poll-promo-cta>${escapeHtml(copy.cta)}</a>
  </aside>`;
}

/**
 * SABİT/YAPIŞKAN ANKET KUTUSU — yalnızca ana sayfada.
 *
 * `hidden` DOĞAR: görünürlüğü istemci yönetir (ana anket ekrandan çıkınca
 * belirir, geri gelince kaybolur; kapatılırsa 24 saat gösterilmez). `position:
 * fixed` olduğu için sayfa akışına girmez — açılıp kapanması bir düzen
 * kayması (CLS) yaratmaz.
 */
export function pollStickyWidgetHtml(poll, options = {}) {
  if (!poll) return "";
  if (options.status === "closed") return "";
  const locale = options.locale === "en" ? "en" : "tr";
  const copy = STICKY_STRINGS[locale];

  return `<div class="poll-sticky" data-poll-sticky data-poll-sticky-locale="${locale}" hidden aria-label="${escapeHtml(copy.label)}">
    <button class="poll-sticky-dismiss" type="button" data-poll-sticky-dismiss aria-label="${escapeHtml(copy.dismiss)}">&times;</button>
    <a class="poll-sticky-link" href="#tahmin-anketi" data-poll-sticky-cta>
      <span class="poll-sticky-kicker">${escapeHtml(copy.kicker)}</span>
      <p class="poll-sticky-question" data-poll-sticky-question>${escapeHtml(poll.question)}</p>
      <span class="poll-sticky-total" data-poll-sticky-total hidden></span>
      <span class="poll-sticky-cta-label">${escapeHtml(copy.cta)}</span>
    </a>
  </div>`;
}

/**
 * KART LİSTESİNE ANKET VİTRİN KARTINI SERPİŞTİR.
 *
 * Yalnızca TAM listeyi basan sayfalarda kullanılır (`haberler.html` /
 * `en/news.html`); ana sayfanın 3 kartlık önizlemesinde kullanılmaz — 3 kart
 * "her 6-8 karttan sonra" kuralına giremeyecek kadar az. `every` aralığın
 * ortası olan 7. Son kart grubundan sonra kart kalmıyorsa vitrin kartı hiç
 * eklenmez — listenin en altına asılı kalan, hiçbir şeyi takip etmeyen bir
 * kart eklemenin anlamı yok.
 */
export function interleavePollPromo(cardsHtml, promoHtml, every = 7) {
  const cards = Array.isArray(cardsHtml) ? cardsHtml : [];
  if (!promoHtml || !cards.length) return cards.join("");
  const out = [];
  cards.forEach((card, index) => {
    out.push(card);
    const position = index + 1;
    if (position % every === 0 && position < cards.length) out.push(promoHtml);
  });
  return out.join("");
}

export const HOME_POLL_STRINGS = STRINGS;
