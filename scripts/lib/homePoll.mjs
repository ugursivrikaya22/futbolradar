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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const STRINGS = {
  tr: {
    kicker: "Okuyucu Anketi",
    button: "Oyunu Ver",
    thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
    closed: "Bu anket kapandı; sonuçlar kesinleşti.",
    community: "Sonuçlar tüm okuyucuların oylarından hesaplanıyor. Her tarayıcı bir kez oy verebilir.",
    local: "Oy deposuna ulaşılamadı; aşağıdaki sonuç topluluk ortalaması değil, yalnızca bu tarayıcıda saklanan oydur.",
    offline: "Oylama şu anda kullanılamıyor. Soru ve seçenekler görünür; oylar açıldığında bu kutudan oy verebilirsin.",
    disclaimer: "Bu bölüm okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrıdır.",
    region: "Ana sayfa tahmin anketi"
  },
  en: {
    kicker: "Reader Poll",
    button: "Cast Your Vote",
    thanks: "Thanks! Live results are below.",
    closed: "This poll has closed; the results are final.",
    community: "Results are calculated from all readers' votes. Each browser can vote once.",
    local: "The vote store could not be reached; the result below is not a community average, only the vote stored in this browser.",
    offline: "Voting is unavailable right now. The question and options are shown; you will be able to vote from this box once voting opens.",
    disclaimer: "This section is a reader prediction, separate from the site's verified match data.",
    region: "Homepage prediction poll"
  }
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
 * Anket bloğu. `poll` yoksa BOŞ DÖNER — takvimde yayında anket olmadığında
 * ana sayfada boş bir kutu bırakmak, yer tutucu uydurmanın sessiz biçimidir.
 *
 * @param poll `localizePoll()` çıktısı (tek dile indirgenmiş)
 * @param options.locale "tr" | "en"
 * @param options.status "open" | "closed"
 */
export function homePollBlock(poll, options = {}) {
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return "";

  const locale = options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  const closed = options.status === "closed";
  const rows = poll.options.map((option) => optionRow(option, poll.id)).join("");

  // Kapanmış ankette form HİÇ basılmaz: oy alınmıyor, sonuç gösteriliyor.
  const form = closed
    ? ""
    : `
            <form class="home-poll__form" data-home-poll-form>
              <ul class="home-poll__options" data-home-poll-options>${rows}</ul>
              <button class="home-poll__submit" type="submit" data-home-poll-submit disabled>${escapeHtml(copy.button)}</button>
            </form>`;

  return `<section class="container section home-poll" id="tahmin-anketi" aria-labelledby="home-poll-title" ` +
    `data-home-poll data-home-poll-source="/api/home-poll" data-home-poll-locale="${locale}" ` +
    `data-home-poll-id="${escapeHtml(poll.id)}" role="region" aria-label="${escapeHtml(copy.region)}">
          <div class="home-poll__inner">
            <div class="home-poll__head">
              <span class="home-poll__kicker" data-home-poll-kicker>${escapeHtml(copy.kicker)}</span>
              <h2 class="home-poll__title" id="home-poll-title" data-home-poll-question>${escapeHtml(poll.question)}</h2>
              ${poll.subtitle ? `<p class="home-poll__subtitle" data-home-poll-subtitle>${escapeHtml(poll.subtitle)}</p>` : `<p class="home-poll__subtitle" data-home-poll-subtitle hidden></p>`}
              <p class="home-poll__deadline" data-home-poll-deadline hidden></p>
            </div>${form}
            <p class="home-poll__thanks" data-home-poll-thanks hidden>${escapeHtml(copy.thanks)}</p>
            <ol class="home-poll__results" data-home-poll-results aria-live="polite" hidden></ol>
            <p class="home-poll__total" data-home-poll-total hidden></p>
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
