/**
 * ANA SAYFA MAÇ DOSYASI TANITIM KUTUSU — TEK KAYNAK.
 *
 * Türkçe ve İngilizce ana sayfa aynı kutuyu alıyor; iki ayrı yerde iki ayrı
 * işaretleme tutmak, birinin diğerinden sessizce ayrılmasıyla biter (aynı
 * gerekçe `scripts/lib/homePoll.mjs` başında yazılı).
 *
 * ── ADRESLER TÜRETİLMEZ, OKUNUR ──────────────────────────────────────────
 * Kutudaki her bağlantı `data/match-special-pages.json`dan geliyor; o dosyayı
 * da sayfaları GERÇEKTEN yazan üretici yazıyor. Burada slug kurmak, üretici
 * bir adres değiştirdiğinde ana sayfayı 404'e bağlamak demekti.
 *
 * ── KUTU KENDİ KENDİNİ KALDIRIR ──────────────────────────────────────────
 * Maç dosyası bir maça bağlı: maç bittikten bir gün sonra ana sayfada
 * "dev maç dosyası" diye durması, okuyucuya bayat içeriği güncel gibi
 * göstermek olur. Pencere kapandığında blok hiç basılmaz.
 */

/** Kutu maçtan ne kadar önce açılır ve maçtan ne kadar sonra kapanır. */
export const PROMO_OPENS_BEFORE_MS = 10 * 24 * 60 * 60 * 1000;
export const PROMO_CLOSES_AFTER_MS = 24 * 60 * 60 * 1000;

/** Ana sayfada gösterilecek modül kartı sayısı. */
export const PROMO_MODULE_LIMIT = 6;

const STRINGS = {
  tr: {
    kicker: "Dev Maç Dosyası",
    cta: "Maç dosyasını aç",
    modulesTitle: "Dosyadan bölümler",
    live: "Canlı skor ve resmî 11'ler bu sayfada",
    aria: "Öne çıkan maç dosyası"
  },
  en: {
    kicker: "Match Special",
    cta: "Open the match special",
    modulesTitle: "Inside the special",
    live: "Live score and official XIs land on this page",
    aria: "Featured match special"
  }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Ana sayfadan modül sayfasına göreli adres. */
function hrefFor(target, locale) {
  return locale === "en" ? `../${target}` : `./${target}`;
}

/**
 * Yayına uygun tek dosya. Birden fazlası penceredeyse başlama saati en yakın
 * olan seçilir: ana sayfada iki "dev maç dosyası" kutusu olmaz.
 */
export function selectPromo(entries, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const open = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ entry, kickoff: Date.parse(entry && entry.kickoff) }))
    .filter((row) => Number.isFinite(row.kickoff))
    .filter((row) => now >= row.kickoff - PROMO_OPENS_BEFORE_MS && now <= row.kickoff + PROMO_CLOSES_AFTER_MS)
    .sort((left, right) => Math.abs(left.kickoff - now) - Math.abs(right.kickoff - now));

  return open.length ? open[0].entry : null;
}

/**
 * Kutunun işaretlemesi. Modül kartlarının hepsi GERÇEK sayfalara gider;
 * hedefi olmayan kart basılmaz.
 */
export function matchSpecialPromoBlock(entry, options) {
  const locale = options && options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  const localized = entry && entry.locales && entry.locales[locale];
  if (!localized || !localized.hub) return "";

  const modules = (localized.modules || [])
    .filter((module) => module && module.href && module.title)
    .slice(0, PROMO_MODULE_LIMIT);

  const cards = modules.map((module) => `<a class="match-special-promo__module" href="${escapeHtml(hrefFor(module.href, locale))}">
              <span class="match-special-promo__module-kicker">${escapeHtml(module.kicker || "")}</span>
              <strong>${escapeHtml(module.title)}</strong>
            </a>`).join("\n            ");

  const logo = (url, name) => (url
    ? `<img src="${escapeHtml(url)}" alt="" width="44" height="44" loading="lazy" decoding="async" referrerpolicy="no-referrer" />`
    : "");

  const meta = [entry.league, entry.round ? `${locale === "en" ? "Week" : "Hafta"} ${entry.round}` : "", entry.venue]
    .filter(Boolean).join(" · ");

  return `
<section class="container section match-special-promo" id="mac-dosyasi" aria-labelledby="match-special-promo-title" role="region" aria-label="${escapeHtml(copy.aria)}">
          <a class="match-special-promo__hero" href="${escapeHtml(hrefFor(localized.hub, locale))}">
            <span class="match-special-promo__kicker">${escapeHtml(copy.kicker)}</span>
            <span class="match-special-promo__teams">
              ${logo(entry.homeTeamLogo, entry.homeTeam)}
              <strong id="match-special-promo-title">${escapeHtml(entry.homeTeam)} – ${escapeHtml(entry.awayTeam)}</strong>
              ${logo(entry.awayTeamLogo, entry.awayTeam)}
            </span>
            ${meta ? `<span class="match-special-promo__meta">${escapeHtml(meta)}</span>` : ""}
            <span class="match-special-promo__lead">${escapeHtml(localized.lead || "")}</span>
            <span class="match-special-promo__cta">${escapeHtml(copy.cta)} →</span>
          </a>
          <div class="match-special-promo__body">
            <h3 class="match-special-promo__modules-title">${escapeHtml(copy.modulesTitle)}</h3>
            <div class="match-special-promo__modules">
            ${cards}
            </div>
            <p class="match-special-promo__note">${escapeHtml(copy.live)}</p>
          </div>
        </section>
`;
}
