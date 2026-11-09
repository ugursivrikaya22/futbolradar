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
 *   - Stadyum adı YALNIZCA kayıtlıysa `location.name` olur. Olmayan bir
 *     stat yazılmaz. Google `location` istediği için, stat yokken eldeki
 *     gerçek şehir veya yurt içi ülke adresi yazılır; o da yoksa alan düşer.
 *   - Bitmiş maçın skoru işaretlemeye YAZILMAZ; skor doğrulama kuralı ayrı
 *     bir kapıdan geçer (isVerifiedFinalMatch) ve doğrulanmamış skoru
 *     makineye vermek insana vermekten daha kötüdür.
 *   - `aggregateRating`, `offers`, izleyici sayısı gibi elimizde OLMAYAN
 *     alanlar hiç yazılmaz.
 *
 * `eventStatus` gerçek durumdan türer ve YALNIZCA schema.org
 * `EventStatusType` üyelerine yazılır (9 Kasım 2026, schema.org):
 * EventScheduled, EventCancelled, EventPostponed, EventRescheduled,
 * EventMovedOnline. `EventCompleted` diye bir üye YOKTUR (adres 404);
 * yazılırsa Google ayrışmayan / geçersiz alan sayar. Bitmiş, hükmen
 * veya yarıda kalmış maça bu yüzden durum uydurulmaz: alan hiç yazılmaz.
 * Google, alan yokken yaklaşan etkinliği EventScheduled sayar; geçmiş
 * `startDate` maçın oynanmış olduğunu tarihten okur. Canlı ve
 * başlamamış maç EventScheduled, erteleme EventPostponed, iptal ve
 * tatil EventCancelled olur.
 *
 * `location` stadyum adı kayıtlıysa Place.name olur. Şehir, ev sahibi
 * kulübün doğrulanmış iç saha kaydı bu statla birebir örtüşüyorsa
 * adrese yazılır. Ülke, yalnızca yurt içi lig/kupa kaydından ISO koda
 * çevrilir (UEFA/FIFA bir yer değildir). Stat bilinmiyorsa ad
 * UYDURULMAZ; Google'ın zorunlu `location` alanı için eldeki gerçek
 * ülke/şehir PostalAddress olarak yazılır. Hiçbiri yoksa alan düşer.
 */
const { canonicalStatus } = require("./matchStatus.js");
const { venueLabel } = require("./displayLabels.js");
const { sameClub } = require("./superLigTeams.js");
const { findCompetition } = require("./competitionCatalog.js");

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

const EVENT_STATUS = Object.freeze({
  SCHEDULED: "https://schema.org/EventScheduled",
  LIVE: "https://schema.org/EventScheduled",
  HALFTIME: "https://schema.org/EventScheduled",
  POSTPONED: "https://schema.org/EventPostponed",
  CANCELLED: "https://schema.org/EventCancelled",
  ABANDONED: "https://schema.org/EventCancelled"
});

/**
 * Sayfa hâli (`pageStateOf`) → resmi durum.
 * `post` / `pending` / `interrupted` için resmi bir "bitti" değeri yoktur.
 */
function eventStatusForPageState(state) {
  if (state === "postponed") return EVENT_STATUS.POSTPONED;
  if (state === "cancelled") return EVENT_STATUS.CANCELLED;
  if (state === "pre" || state === "tbd" || state === "live") return EVENT_STATUS.SCHEDULED;
  return null;
}

function eventStatusOf(match) {
  const status = canonicalStatus(match && (match.status || match.providerStatus));
  return Object.prototype.hasOwnProperty.call(EVENT_STATUS, status) ? EVENT_STATUS[status] : null;
}

const PLACEHOLDER_VENUES = new Set([
  "", "-", "–", "—", "aciklanmadi", "belirlenmedi", "bilinmiyor", "unknown", "tbd", "n/a", "na", "yok"
]);

function placeKey(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholderVenue(value) {
  return PLACEHOLDER_VENUES.has(placeKey(value));
}

/** Katalogdaki ülke adı → ISO 3166-1 alpha-2. Eşleşmeyen ad yazılmaz. */
const COUNTRY_ISO = Object.freeze({
  turkiye: "TR", turkey: "TR",
  ispanya: "ES", spain: "ES",
  italya: "IT", italy: "IT",
  almanya: "DE", germany: "DE",
  fransa: "FR", france: "FR",
  ingiltere: "GB", england: "GB",
  hollanda: "NL", netherlands: "NL",
  portekiz: "PT", portugal: "PT",
  belcika: "BE", belgium: "BE",
  iskocya: "GB", scotland: "GB",
  "suudi arabistan": "SA", "saudi arabia": "SA",
  abd: "US", usa: "US", "united states": "US",
  brezilya: "BR", brazil: "BR",
  arjantin: "AR", argentina: "AR"
});

const NOT_A_PLACE = new Set([
  "uefa", "fifa", "concacaf", "conmebol", "caf", "afc", "ofc",
  "uluslararasi", "international", "avrupa"
]);

function countryCode(value) {
  const key = placeKey(value);
  if (!key || NOT_A_PLACE.has(key)) return "";
  if (COUNTRY_ISO[key]) return COUNTRY_ISO[key];
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  return "";
}

function competitionCountryCode(match) {
  const direct = countryCode(match && (match.country || match.venueCountry || match.leagueCountry));
  if (direct) return direct;
  const competition = findCompetition(match && match.competitionId) || findCompetition(match && match.league);
  if (!competition || (competition.type !== "domestic" && competition.type !== "cup")) return "";
  return countryCode(competition.country);
}

let groundCache = null;
function homeGroundCity(match, venue) {
  const home = text(match && match.homeTeam);
  const ground = text(venue);
  if (!home || !ground) return "";
  if (!groundCache) {
    try {
      const teams = require("../data/super-lig-fixtures.json").teams || [];
      groundCache = teams.filter((team) => team && team.status === "confirmed" && team.venue && team.city);
    } catch {
      groundCache = [];
    }
  }
  const wanted = placeKey(ground);
  const row = groundCache.find((team) => {
    if (!sameClub(team.name, home)) return false;
    const known = placeKey(team.venue);
    if (!wanted || !known) return false;
    if (wanted === known) return true;
    // "Rams Park" ile "Rams Park Stadyumu" aynı tesis. Kısa parçalar
    // ("park") yetmez; iki ad da en az 8 karakter olmalı.
    return wanted.length >= 8 && known.length >= 8 && (wanted.includes(known) || known.includes(wanted));
  });
  return row ? text(row.city) : "";
}

/**
 * ISO 8601 başlangıç. Saat varsa Europe/Istanbul ofseti (+03:00) yazılır.
 * Yalnızca gün verilmişse saat UYDURULMAZ; takvim günü olduğu gibi kalır.
 */
function startDateOf(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(parsed).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}+03:00`;
}

/**
 * Place. Stat adı yoksa name yazılmaz. Adres yalnızca gerçek şehir/ülke
 * varsa eklenir. İkisi de yoksa null.
 */
function locationOf(match, options = {}) {
  const source = match && typeof match === "object" ? match : {};
  const locale = options.locale || "tr";
  const venueRaw = text(options.venue !== undefined ? options.venue : source.venue);
  const venue = venueRaw && !isPlaceholderVenue(venueRaw) ? venueLabel(venueRaw, locale) : "";
  const cityRaw = text(options.city || source.city || source.venueCity) || homeGroundCity(source, venueRaw);
  const city = cityRaw && !isPlaceholderVenue(cityRaw) ? cityRaw : "";
  const country = countryCode(options.country) || competitionCountryCode(source);
  if (!venue && !city && !country) return null;

  const place = { "@type": "Place" };
  if (venue) place.name = venue;
  if (city || country) {
    const address = { "@type": "PostalAddress" };
    if (city) address.addressLocality = city;
    if (country) address.addressCountry = country;
    place.address = address;
  }
  return place;
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
  const startDate = startDateOf(match.kickoff);
  if (!home || !away || !startDate) return null;

  const node = {
    "@type": "SportsEvent",
    name: `${home} - ${away}`,
    startDate,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: home },
    awayTeam: { "@type": "SportsTeam", name: away },
    competitor: [
      { "@type": "SportsTeam", name: home },
      { "@type": "SportsTeam", name: away }
    ]
  };

  const eventStatus = eventStatusOf(match);
  if (eventStatus) node.eventStatus = eventStatus;

  const league = text(match.league);
  if (league) {
    node.superEvent = { "@type": "SportsEvent", name: league };
  }

  // Konum: stat, örtüşen iç saha şehri veya yurt içi ülke. Stat adı uydurulmaz.
  const place = locationOf(match, { locale: options.locale, country: options.country, city: options.city });
  if (place) node.location = place;

  const url = absoluteUrl(options.url);
  if (url) node.url = url;

  // Yayın kanalı: YALNIZCA çağıran gerçek bir kanal adı verdiyse eklenir.
  // Opsiyonel — mevcut çağıranlar `options.broadcast` göndermez, davranışları
  // değişmez. Uydurma yok: kanal bilinmiyorsa bu alan hiç yazılmaz.
  // Dizi verilirse (ör. ["beIN SPORTS 1", "beIN SPORTS 1 4K"]) her kanal
  // ayrı bir BroadcastEvent olur; adı "4K" ile biten beslemenin biçimi 4K.
  const broadcasts = (Array.isArray(options.broadcast) ? options.broadcast : [options.broadcast])
    .map(text)
    .filter((name, index, list) => name && list.indexOf(name) === index);
  const publicationFor = (broadcast) => ({
    "@type": "BroadcastEvent",
    isLiveBroadcast: true,
    videoFormat: /\b4K$/i.test(broadcast) ? "4K" : "HD",
    publishedOn: {
      "@type": "BroadcastService",
      name: broadcast,
      broadcastDisplayName: broadcast
    }
  });
  if (broadcasts.length === 1) {
    node.publication = publicationFor(broadcasts[0]);
  } else if (broadcasts.length > 1) {
    node.publication = broadcasts.map(publicationFor);
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
    const node = sportsEventNode(match, {
      url: urlFor(match),
      broadcast: broadcastFor(match),
      locale: options.locale
    });
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
  eventStatusForPageState,
  eventStatusOf,
  faqSchema,
  isPlaceholderVenue,
  locationOf,
  matchListSchema,
  sportsEventNode,
  startDateOf
};
