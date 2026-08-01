/**
 * DIŞ BAĞLANTI POLİTİKASI — sitenin kendi URL'leri futbolradar.com, dışarı
 * yalnızca KAYNAK KÜNYESİ çıkar.
 *
 * Bant, haber kartı ve transfer kartı bir iddianın arkasındaki kaynağa
 * bağlanıyor; bu bağlantı doğrulanabilirliğin taşıyıcısı ve kaldırılamaz.
 * Ama "dışarı bağlantı serbest" demek de değil. İki kural:
 *
 *   1. BEYAZ LİSTE. Kaynak yalnızca burada sayılan alan adlarından olabilir:
 *      resmî kulüp siteleri, federasyon, UEFA ve doğrulanmış spor medyası.
 *      Listede olmayan bir alan adı sessizce sızamaz — test kapıda durur
 *      (scripts/test-source-links.mjs). Liste dar tutuluyor: yeni bir kaynak
 *      eklemek bilinçli bir karar olmalı, kopyala-yapıştırın yan etkisi değil.
 *
 *   2. KÜNYE BAĞLANTISI `nofollow` TAŞIR. Kaynağı göstermek bir alıntıdır,
 *      bir tavsiye değil; arama motoruna da böyle söylenir.
 *
 * SİTENİN KENDİ HESAPLARI BU KURALIN DIŞINDA. Alt bilgideki X/Instagram/
 * YouTube bağlantıları FutbolRadar'ın kendi profilleri — onlara `nofollow`
 * koymak kendi markasını inkâr etmek olurdu. Paylaşım bağlantıları da
 * (WhatsApp, Telegram) alıntı değil, kullanıcı eylemidir.
 */

/** Sitenin kendi alan adı. Buna giden bağlantı "dış" sayılmaz. */
const SITE_HOST = "futbolradar.com";

/**
 * KAYNAK BEYAZ LİSTESİ.
 *
 * Alt alan adları da geçerli: `fenerbahce.org` yazıldığında
 * `media.fenerbahce.org` de kabul edilir.
 */
const ALLOWED_SOURCE_HOSTS = Object.freeze({
  // Federasyon ve organizasyonlar
  federation: Object.freeze([
    "tff.org",
    "uefa.com",
    "fifa.com"
  ]),

  // Resmî kulüp siteleri
  club: Object.freeze([
    "galatasaray.org",
    "fenerbahce.org",
    "bjk.com.tr",
    "trabzonspor.org.tr",
    "ibfk.com.tr",
    "konyaspor.org.tr",
    "caykurrizespor.org.tr",
    "acmonza.com",
    "mancity.com",
    "raal.be"
  ]),

  // Lig ve turnuva siteleri
  league: Object.freeze([
    "premierleague.com",
    "laliga.com",
    "legaseriea.it",
    "bundesliga.com",
    "ligue1.com"
  ]),

  // Doğrulanmış spor medyası
  media: Object.freeze([
    "hurriyet.com.tr",
    "fanatik.com.tr",
    "sporx.com",
    "sozcu.com.tr",
    "yenisafak.com",
    "sabah.com.tr",
    "aspor.com.tr",
    "trtspor.com.tr",
    "aa.com.tr",
    "gzt.com",
    "gercekgundem.com",
    "ntvspor.net",
    "fotomac.com.tr",
    "beinsports.com.tr"
  ]),

  // İstatistik ve maç verisi sağlayıcıları
  data: Object.freeze([
    "mackolik.com",
    "sahadan.com",
    "sofascore.com",
    "fotmob.com",
    "ssportplus.com"
  ])
});

/**
 * SİTENİN KENDİ HESAPLARI. Alıntı değil, kimlik: `nofollow` ALMAZLAR.
 */
const OWN_PROFILE_HOSTS = Object.freeze([
  "x.com",
  "twitter.com",
  "instagram.com",
  "youtube.com"
]);

/**
 * PAYLAŞIM HEDEFLERİ. Kullanıcının içeriği kendi kanalına göndermesi için;
 * bir kaynak iddiası taşımazlar.
 */
const SHARE_HOSTS = Object.freeze([
  "api.whatsapp.com",
  "wa.me",
  "t.me",
  "telegram.me"
]);

/** Tüm beyaz liste, tek düz dizi. */
function allowedSourceHosts() {
  return Object.values(ALLOWED_SOURCE_HOSTS).flat();
}

/** URL'den alan adı; okunamayan URL'de boş dize. */
function hostOf(url) {
  const raw = String(url === null || url === undefined ? "" : url).trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** `entry` ya da onun alt alan adı mı? */
function matchesHost(host, entry) {
  return host === entry || host.endsWith(`.${entry}`);
}

function isSiteHost(host) {
  return Boolean(host) && matchesHost(host, SITE_HOST);
}

/** Siteden çıkan bir bağlantı mı? Göreli yollar dış sayılmaz. */
function isExternalUrl(url) {
  const host = hostOf(url);
  return Boolean(host) && !isSiteHost(host);
}

/** Kaynak olarak kullanılabilir mi? */
function isAllowedSourceHost(host) {
  const normalized = String(host || "").replace(/^www\./i, "").toLowerCase();
  if (!normalized) return false;
  return allowedSourceHosts().some((entry) => matchesHost(normalized, entry));
}

function isAllowedSourceUrl(url) {
  return isAllowedSourceHost(hostOf(url));
}

function isOwnProfileHost(host) {
  const normalized = String(host || "").replace(/^www\./i, "").toLowerCase();
  return OWN_PROFILE_HOSTS.some((entry) => matchesHost(normalized, entry));
}

function isShareHost(host) {
  const normalized = String(host || "").replace(/^www\./i, "").toLowerCase();
  return SHARE_HOSTS.some((entry) => matchesHost(normalized, entry));
}

/**
 * Kaynak künyesi bağlantısının `rel` değeri.
 *
 * `noopener`/`noreferrer` güvenlik (yeni sekmenin `window.opener` üzerinden
 * sayfaya erişmesini engeller); `nofollow` ise editoryal: alıntı, tavsiye
 * değildir.
 */
const SOURCE_LINK_REL = "nofollow noopener noreferrer";

/** Kendi hesap ve paylaşım bağlantıları: yalnızca güvenlik. */
const PLAIN_EXTERNAL_REL = "noopener noreferrer";

/** Şablonlara hazır öznitelik dizesi. */
function sourceLinkAttrs() {
  return ` target="_blank" rel="${SOURCE_LINK_REL}"`;
}

module.exports = {
  ALLOWED_SOURCE_HOSTS,
  OWN_PROFILE_HOSTS,
  PLAIN_EXTERNAL_REL,
  SHARE_HOSTS,
  SITE_HOST,
  SOURCE_LINK_REL,
  allowedSourceHosts,
  hostOf,
  isAllowedSourceHost,
  isAllowedSourceUrl,
  isExternalUrl,
  isOwnProfileHost,
  isShareHost,
  isSiteHost,
  sourceLinkAttrs
};
