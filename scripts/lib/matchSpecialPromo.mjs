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
    kicker: "Detaylı Maç Analizi",
    lineupChip: "Muhtemel 11",
    cta: "Detaylı analizi aç",
    modulesTitle: "Dosyadan bölümler",
    live: "Canlı skor ve resmî 11'ler bu sayfada",
    aria: "Öne çıkan maç analizi"
  },
  en: {
    kicker: "In-Depth Match Analysis",
    lineupChip: "Probable XI",
    cta: "Open the full analysis",
    modulesTitle: "Inside the analysis",
    live: "Live score and official XIs land on this page",
    aria: "Featured match analysis"
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

/** Ana sayfada aynı anda en çok bu kadar dosya kutusu görünür. */
export const PROMO_MAX_CARDS = 2;

/**
 * ÖNCELİK: BÜYÜK MAÇ ÖNDE.
 *
 * Aynı gün iki dosya yayındaysa sıralamayı yalnızca saat belirlerse, 19:00'daki
 * maç 21:30'dakinin önüne geçiyor — oysa okuyucunun aradığı büyük maç
 * çoğunlukla ikincisi. Öncelik açıkça yazılır; listede olmayan takım 0 alır ve
 * sıralama saate düşer. Liste editoryal bir tercih, gizli bir kural değil.
 */
const TEAM_PRIORITY = [
  { match: /fenerbah/i, weight: 3 },
  { match: /galatasaray/i, weight: 3 },
  { match: /beşiktaş|besiktas/i, weight: 3 },
  { match: /trabzonspor/i, weight: 2 }
];

function priorityOf(entry) {
  const teams = `${(entry && entry.homeTeam) || ""} ${(entry && entry.awayTeam) || ""}`;
  return TEAM_PRIORITY.reduce((best, rule) => (rule.match.test(teams) ? Math.max(best, rule.weight) : best), 0);
}

/**
 * Yayına uygun dosyalar, öncelik sırasıyla. Pencere kuralı değişmedi: maçtan
 * 10 gün önce açılır, bitiminden 24 saat sonra kapanır.
 */
export function selectPromos(entries, nowMs) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry && entry.homepagePromo !== false)
    .map((entry) => ({ entry, kickoff: Date.parse(entry && entry.kickoff), priority: priorityOf(entry) }))
    .filter((row) => Number.isFinite(row.kickoff))
    .filter((row) => now >= row.kickoff - PROMO_OPENS_BEFORE_MS && now <= row.kickoff + PROMO_CLOSES_AFTER_MS)
    .sort((left, right) => (right.priority - left.priority)
      || (Math.abs(left.kickoff - now) - Math.abs(right.kickoff - now)))
    .slice(0, PROMO_MAX_CARDS)
    .map((row) => row.entry);
}

/** Tek dosya bekleyen çağıranlar için; en öncelikli kayıt. */
export function selectPromo(entries, nowMs) {
  const open = selectPromos(entries, nowMs);
  return open.length ? open[0] : null;
}

/**
 * Kutunun işaretlemesi. Modül kartlarının hepsi GERÇEK sayfalara gider;
 * hedefi olmayan kart basılmaz.
 */
export function matchSpecialPromoBlock(entry, options) {
  const locale = options && options.locale === "en" ? "en" : "tr";
  const copy = STRINGS[locale];
  // İkinci kart biraz daha sakin: aynı ağırlıkta iki kutu yan yana durunca
  // hangisinin öne çıktığı okunmuyor ve ikisi de kayboluyor.
  const secondary = Boolean(options && options.index);
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

  // Başlama saati kartın kendisinde. Okuyucunun kartta aradığı ilk bilgi
  // "ne zaman"; bunun için sayfayı açmak zorunda kalmamalı. Saat, kayıttaki
  // ISO damgasının kendi saat diliminden okunuyor (…T19:00:00+03:00), yeniden
  // hesaplanmıyor — hesaplamak derleme makinesinin saat dilimine bağlı
  // olurdu ve Vercel'de UTC'ye kayardı.
  const kickoffTime = /T(\d{2}:\d{2})/.exec(String(entry.kickoff || ""));
  const meta = [
    entry.league,
    entry.round ? `${locale === "en" ? "Week" : "Hafta"} ${entry.round}` : "",
    kickoffTime ? kickoffTime[1] : "",
    entry.venue
  ].filter(Boolean).join(" · ");

  const probable = localized.probableLineup;
  const probableCard = probable && probable.href ? `<a class="match-special-promo__breaking" href="${escapeHtml(hrefFor(probable.href, locale))}" data-lineup-promo data-match-id="${escapeHtml(entry.matchId)}">
            <span class="match-special-promo__breaking-badge" data-lineup-promo-badge>${escapeHtml(probable.badge)}</span>
            <strong data-lineup-promo-title>${escapeHtml(probable.title)}</strong>
            <span data-lineup-promo-spot>${escapeHtml(probable.spot)}</span>
          </a>` : "";

  // Başlık kimliği sayfada BENZERSİZ olmalı: iki kart aynı id'yi taşıyınca
  // aria-labelledby ikisini de ilkine bağlıyor ve ekran okuyucu iki kartı
  // aynı maç sanıyor.
  const suffix = secondary ? `-${options.index + 1}` : "";
  const titleId = `match-special-promo-title${suffix}`;

  return `
<section class="container section match-special-promo${secondary ? " is-secondary" : ""}" id="mac-dosyasi${suffix}" aria-labelledby="${titleId}" role="region" aria-label="${escapeHtml(copy.aria)}">
          ${probableCard}
          <a class="match-special-promo__hero" href="${escapeHtml(hrefFor(localized.hub, locale))}">
            <span class="match-special-promo__kicker">${escapeHtml(copy.kicker)}</span>
            <span class="match-special-promo__teams">
              ${logo(entry.homeTeamLogo, entry.homeTeam)}
              <strong id="${titleId}">${escapeHtml(entry.homeTeam)} – ${escapeHtml(entry.awayTeam)}</strong>
              ${logo(entry.awayTeamLogo, entry.awayTeam)}
            </span>
            ${meta ? `<span class="match-special-promo__meta">${escapeHtml(meta)}</span>` : ""}
            <span class="match-special-promo__chips">
              <span class="match-special-promo__chip">${escapeHtml(copy.kicker)}</span>
              <span class="match-special-promo__chip is-lineup">${escapeHtml(copy.lineupChip)}</span>
            </span>
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
