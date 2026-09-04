/**
 * MAÇ YAPILANDIRILMIŞ VERİSİ (schema.org SportsEvent).
 *
 * NEDEN. "Bugünün Maçları" sayfası, sitenin bir numaralı hedef sorgusu
 * ("bugünkü maçlar") için yarışıyor ama statik HTML'inde tek bir
 * `SportsEvent` işaretlemesi yoktu: Google sayfada maç listesi olduğunu
 * ancak metinden ÇIKARARAK anlayabiliyordu. Aynı sayfa CollectionPage
 * olarak işaretliydi, yani "burada bir derlem var" deniyor ama derlemin
 * NE olduğu söylenmiyordu.
 *
 * NE UYDURULMAZ:
 *
 *   - `location` YALNIZCA sağlayıcı stadyum adı verdiyse yazılır. Google'ın
 *     Event zengin sonucu `location` ister; ama olmayan bir stadyumu yazmak
 *     "zengin sonuç alalım" diye veri uydurmaktır. 12 Ağustos 2026'da günün
 *     25 maçının 7'sinde stadyum adı vardı — o yedisi konumlu, on sekizi
 *     konumsuz çıkar.
 *   - Bitmiş maçın skoru işaretlemeye YAZILMAZ; skor doğrulama kuralı ayrı
 *     bir kapıdan geçer (isVerifiedFinalMatch) ve doğrulanmamış skoru
 *     makineye vermek insana vermekten daha kötüdür.
 *   - `aggregateRating`, `offers`, izleyici sayısı gibi elimizde OLMAYAN
 *     alanlar hiç yazılmaz.
 *
 * `eventStatus` gerçek durumdan türer: ertelenen maç `EventPostponed`,
 * iptal edilen `EventCancelled` olur. Bu alan olmadan ertelenmiş bir maç
 * Google tarafında hâlâ oynanacakmış gibi görünür.
 */
const { canonicalStatus } = require("./matchStatus.js");

const SITE = "https://www.futbolradar.com";

function text(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return "";
}

/** Göreli site yolunu mutlak adrese çevirir; zaten mutlaksa dokunmaz. */
function absoluteUrl(href) {
  const clean = text(href);
  if (!clean) return "";
  if (/^https?:\/\//i.test(clean)) return clean;
  return `${SITE}/${clean.replace(/^\.\//, "").replace(/^\//, "")}`;
}

const EVENT_STATUS = {
  POSTPONED: "https://schema.org/EventPostponed",
  CANCELLED: "https://schema.org/EventCancelled"
};

function eventStatusOf(match) {
  const status = canonicalStatus(match && (match.status || match.providerStatus));
  return EVENT_STATUS[status] || "https://schema.org/EventScheduled";
}

/**
 * Tek maçın `SportsEvent` düğümü.
 *
 * Zorunlu alan başlama zamanıdır: ISO damgası yoksa düğüm HİÇ üretilmez
 * (`null` döner). Zamansız bir etkinlik işaretlemesi, doğrulanamayan bir
 * iddiadır — Google da onu reddeder.
 */
function sportsEventNode(match, options = {}) {
  if (!match || typeof match !== "object") return null;

  const home = text(match.homeTeam);
  const away = text(match.awayTeam);
  const kickoff = text(match.kickoff);
  if (!home || !away || !kickoff) return null;

  const parsed = new Date(kickoff);
  if (Number.isNaN(parsed.getTime())) return null;

  const node = {
    "@type": "SportsEvent",
    name: `${home} - ${away}`,
    startDate: kickoff,
    eventStatus: eventStatusOf(match),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: home },
    awayTeam: { "@type": "SportsTeam", name: away },
    competitor: [
      { "@type": "SportsTeam", name: home },
      { "@type": "SportsTeam", name: away }
    ]
  };

  const league = text(match.league);
  if (league) {
    node.superEvent = { "@type": "SportsEvent", name: league };
  }

  // Konum: sağlayıcı verdiyse. Uydurulmaz.
  const venue = text(match.venue);
  if (venue) {
    node.location = { "@type": "Place", name: venue };
    const city = text(match.city);
    if (city) {
      node.location.address = { "@type": "PostalAddress", addressLocality: city };
    }
  }

  const url = absoluteUrl(options.url);
  if (url) node.url = url;

  // Yayın kanalı: YALNIZCA çağıran gerçek bir kanal adı verdiyse eklenir.
  // Opsiyonel — mevcut çağıranlar `options.broadcast` göndermez, davranışları
  // değişmez. Uydurma yok: kanal bilinmiyorsa bu alan hiç yazılmaz.
  const broadcast = text(options.broadcast);
  if (broadcast) {
    node.publication = {
      "@type": "BroadcastEvent",
      isLiveBroadcast: true,
      videoFormat: "HD",
      publishedOn: {
        "@type": "BroadcastService",
        name: broadcast,
        broadcastDisplayName: broadcast
      }
    };
  }

  return node;
}

/**
 * Sayfanın maç listesi için `ItemList`.
 *
 * Sıra, sayfada BASILAN sırayla aynıdır: işaretleme ekranda görünmeyen bir
 * sıralama iddia edemez. Üretilemeyen maç (zamansız kayıt) listeden düşer ve
 * `numberOfItems` düşen hâli sayar — sayı ile içerik ayrışmaz.
 */
function matchListSchema(matches, options = {}) {
  const list = Array.isArray(matches) ? matches : [];
  const urlFor = typeof options.urlFor === "function" ? options.urlFor : () => "";
  const broadcastFor = typeof options.broadcastFor === "function" ? options.broadcastFor : () => "";

  const items = [];
  for (const match of list) {
    const node = sportsEventNode(match, { url: urlFor(match), broadcast: broadcastFor(match) });
    if (!node) continue;
    items.push({ "@type": "ListItem", position: items.length + 1, item: node });
  }

  if (!items.length) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: items.length,
    itemListElement: items
  };

  const name = text(options.name);
  if (name) schema.name = name;

  return schema;
}

/**
 * SSS işaretlemesi. Cevap metinleri sayfanın GÖRÜNEN metniyle aynıdır;
 * ayrışırlarsa bu, Google'ın "yapılandırılmış veri sayfayla eşleşmiyor"
 * ihlali olur. Soru yoksa işaretleme de yoktur.
 */
function faqSchema(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && text(entry.question) && text(entry.answer)
  );
  if (!list.length) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: list.map((entry) => ({
      "@type": "Question",
      name: text(entry.question),
      acceptedAnswer: { "@type": "Answer", text: text(entry.answer) }
    }))
  };
}

module.exports = {
  SITE,
  absoluteUrl,
  eventStatusOf,
  faqSchema,
  matchListSchema,
  sportsEventNode
};
