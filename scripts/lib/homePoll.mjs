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

export const HOME_POLL_STRINGS = STRINGS;
