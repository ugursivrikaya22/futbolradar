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
    // Fenerbahçe'nin kendi medya kolu; kulüp duyurularını fenerbahce.org
    // ile aynı yetkiyle yayımlıyor.
    "fenermedia.com",
    "bjk.com.tr",
    "trabzonspor.org.tr",
    "genclerbirligi.org.tr",
    "ibfk.com.tr",
    "konyaspor.org.tr",
    "caykurrizespor.org.tr",
    "acmonza.com",
    "mancity.com",
    // Official match reports used to verify historical fixture identities.
    "liverpoolfc.com",
    "atleticobaleares.com",
    "raal.be",
    // El Clásico (25 Ekim 2026) yazısı: kadro, sakatlık ve resmî transfer
    // duyuruları iki kulübün kendi sitelerinden doğrulandı.
    "fcbarcelona.com",
    "realmadrid.com",
    // Atlético de Madrid resmî sitesi (en.atleticodemadrid.com alt alanı dahil).
    "atleticodemadrid.com",
    // VfB Stuttgart resmî sitesi: Galatasaray'ın UCL rakibi Stuttgart takım
    // sayfasında kadro, kulüp künyesi/başarılar ve maç programı buradan.
    "vfb.de",
    // 2026-11-05 tarihçe kaynakları — sahip onayı bekliyor:
    "samsunspor.org.tr",
    "goztepe.org.tr",
    "alanyaspor.org.tr",
    "kasimpasa.com.tr",
    "erzurumsporfk.org",
    "gaziantepfk.org",
    "amedspor.com.tr",
    "eyupspor.org.tr",
    "corumfk.com.tr"
  ]),

  // Existing calendar provider: retain its event citation when archiving a match.
  dataProvider: Object.freeze([
    "thesportsdb.com",
    // Kadro/maç verisinin sağlayıcısı (anahtar kelime sayfalarında kaynak olarak gösteriliyor).
    "api-football.com"
  ]),

  // Ansiklopedik kaynak: yalnızca belirli revizyon (oldid) bağlantıları,
  // tarihçe / gol krallığı / derbi geçmişi sayfalarında.
  encyclopedia: Object.freeze([
    "en.wikipedia.org"
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
    // Championat: Rusya'nın en büyük spor yayınlarından biri. Batrakov
  // sürecinde birincil kaynak; .com ve .ru ayrı alan adları olarak yayın yapıyor.
  "championat.com",
  "championat.ru",
  // NTV Spor: ulusal spor yayıncısı, listedeki hurriyet.com.tr ile aynı sınıf.
  "ntvspor.net",
  "hurriyet.com.tr",
    "fanatik.com.tr",
    // Ajansspor: yerleşik Türk spor haber ajansı; maç sonu açıklamalarını
    // konuşmacı bazında ayrı haberlerde, zaman damgalı yayımlıyor. Listeye
    // BİLİNÇLİ eklendi — data/manager-quotes.json'daki alıntılar bu sayfalar
    // açılıp harfi harfine karşılaştırılarak girildi.
    "ajansspor.com",
    "sporx.com",
    // Dated starting-XI report cross-checked against beIN SPORTS.
    "dunya.com",
    "sozcu.com.tr",
    "yenisafak.com",
    "sabah.com.tr",
    "aspor.com.tr",
    "milligazete.com.tr", // Dated El Clásico broadcast-time report (S Sport) used on the El Clásico guide.
    "trtspor.com.tr",
    "trt1.com.tr", // The broadcaster's own dated programme, checked for match-specific TV information.
    "tabii.com", // TRT's official streaming platform for the match broadcast.
    // Exxen: yayın hakkı sahibi platform. Yayın akışı taraması (bkz.
    // services/broadcastRights.js) kanal adını buradan doğruladığında
    // künye bu adrese bağlanır; listede olmaması o kaynağı gösterilemez
    // kılıyordu.
    "exxen.com",
    "aa.com.tr",
    // Reviewed Hakemler Dosyasi archive citations; publication still requires editorial review.
    "trthaber.com",
    "dha.com.tr",
    "haberler.com",
    "ntvspor.net",
    "ntv.com.tr",
    "fotomac.com.tr",
    "fotospor.com.tr",
    "beinsports.com.tr",
    "milliyet.com.tr",
    "haberturk.com",
    // CNN Türk: ulusal haber yayıncısı; listedeki ntv.com.tr ve haberturk.com
    // ile aynı sınıf. Saatlik haber taraması bu alan adından künye üretmeye
    // başlayınca üretim kapısı haklı olarak durdurdu — kaynak gerçekten
    // güvenilir olduğu için BİLİNÇLİ eklendi.
    "cnnturk.com",
    "ahaber.com.tr",
    "takvim.com.tr",
    "t24.com.tr",
    // 7 Kasım 2026 ana sayfa Son dakika bandı: doğrulanmış Türk kaynakları.
    "tgrthaber.com",
    "haber7.com",
    "abcgazetesi.com.tr",
    "turkiyegazetesi.com.tr"
  ]),

  // Yurt dışı yayın organları. Türk basınında karşılığı olmayan haberlerde
  // (yabancı oyuncunun kendi ülkesindeki gazete, Avrupa kupası özetleri)
  // birincil yayına atıf yapılabilsin diye ayrı tutuluyor.
  international: Object.freeze([
    "reuters.com",
    "espn.com",
    "aljazeera.com",
    "vanguardngr.com",
    // Şampiyonlar Ligi açılış haftası kapsamında (2026-09) eklendi: dünya
    // futbolu gündemi için birincil/köklü uluslararası yayın organları.
    "cnn.com",
    "npr.org",
    "goal.com",
    "skysports.com",
    "si.com",
    "nbcnews.com",
    "nbcsports.com",
    "sports.yahoo.com",
    "corrieredellosport.it",
    // İspanya'nın köklü spor gazeteleri; El Clásico ikili rekabet tablosu
    // (AS) ve kadro listesi (Marca) için BİLİNÇLİ eklendi (25 Ekim 2026).
    "as.com",
    "marca.com",
    // Galatasaray 2-1 Fenerbahçe (26 Ekim 2026) maç sonu yazısı: BBC Sport
    // (sonuç, istatistik), Cumhuriyet (dakika dakika anlatım) ve Transfermarkt
    // (puan durumu) BİLİNÇLİ eklendi (26 Ekim 2026).
    "bbc.com",
    "cumhuriyet.com.tr",
    "transfermarkt.com.tr",
    // Yle: Finlandiya kamu yayıncısı; Avrupa kupası maçlarında (ör.
    // KuPS–Trabzonspor) Fin tarafının birincil maç raporu için BİLİNÇLİ
    // eklendi (19 Ekim 2026).
    "yle.fi",
    // 7 Kasım 2026 ana sayfa Son dakika bandı: doğrulanmış yabancı kaynaklar.
    "gazzetta.it",
    "sport.sky.it",
    "fussballnationalmannschaft.net",
    "psg.fr",
    "englishmatchday.co.uk",
    "franceinfo.fr",
    "teamtalk.com",
    "standard.co.uk"
  ]),

  // BİRİNCİL KAYIT PLATFORMU — diğer gruplardan farkı bilinçli.
  //
  // youtube.com bir YAYIN ORGANI DEĞİL; oraya herkes yükleme yapabilir. Bu
  // yüzden listedeki en zayıf halka ve bilerek tek başına bırakılmadı:
  // depoda yalnızca kulüp divan toplantılarının zaman damgalı kaydına atıf
  // için kullanılıyor ve her kullanımda YANINDA resmî kulüp bağlantısı da
  // veriliyor (galatasaray.org, fenermedia.com). Bir video tek kaynak olarak
  // kalıyorsa o haber gözden geçirilmeli.
  record: Object.freeze([
    "kap.org.tr",
    "youtube.com"
  ]),

  // İstatistik ve maç verisi sağlayıcıları
  data: Object.freeze([
    "mackolik.com",
    "sahadan.com",
    "sofascore.com",
    "fotmob.com",
    // Galatasaray–Kasımpaşa haberindeki geçmiş karşılaşma kayıtları için
    // sayfası açılıp doğrulanan istatistik kaynağı (9 Ekim 2026).
    "sporzip.com",
    "ssportplus.com",
    // Transfermarkt: ikili rekabet geçmişi (son 10 karşılaşma) için
    // BİLİNÇLİ eklendi (19 Ekim 2026 köşe yazısı).
    "transfermarkt.us"
  ]),

  // TOPLAYICI — kendisi yayın organı değil, yayın organına GİDEN yol.
  //
  // `scripts/sync-football-news.mjs` gündem bandını kulüplerin resmî
  // sitelerine daraltılmış Google Haberler beslemelerinden besliyor
  // ("site:galatasaray.org" gibi). Besleme, haberin kendi adresini vermiyor;
  // yalnızca bir news.google.com bağlantısı ve yayıncının alan adını
  // (`<source url>`) döndürüyor. Yani seçenekler: okuyucuyu yazının kendisine
  // götüren toplayıcı bağlantısı ya da yazıya HİÇ götürmeyen kurum ana
  // sayfası. Birincisi tercih edildi.
  //
  // Bu alan adı buraya EKLENMEDİĞİ için otomatik bant kayıtları kaynak
  // denetiminden geçemiyordu ve `npm test` bu yüzden kırmızıydı. Kural
  // gevşetilmiyor: bant kayıtları yalnızca beyaz listedeki resmî kulüp
  // beslemelerinden geliyor, yayıncının adı da kayıtta ayrıca duruyor
  // (`source.name`, `source.publisher`).
  aggregator: Object.freeze([
    "news.google.com"
  ])
});

/**
 * SİTENİN KENDİ HESAPLARI. Alıntı değil, kimlik: `nofollow` ALMAZLAR.
 *
 * Ana bilgisayar adı tek başına YETMİYOR. "youtube.com" bütünüyle kendi
 * hesabımız sayıldığında, kaynak olarak ALINTILANAN bir üçüncü taraf videosu
 * da (kulüp divan toplantısının kaydı gibi) kimlik bağlantısı muamelesi
 * görüyor ve hak ettiği `nofollow`u kaybediyordu. Kendi kanalımız yol
 * kısmıyla ayrışıyor: youtube.com/@futbolradar.
 *
 * Girdi ya salt ana bilgisayar ya da "ana bilgisayar/yol öneki" biçiminde
 * yazılır; yol verilmişse adresin yolu o önekle başlamak zorundadır.
 * Kaynak: scripts/lib/layout.mjs#SOCIAL.
 */
const OWN_PROFILE_HOSTS = Object.freeze([
  "x.com/futbolradar",
  "twitter.com/futbolradar",
  "instagram.com/futbolradar",
  "youtube.com/@futbolradar"
]);

/**
 * PAYLAŞIM HEDEFLERİ. Kullanıcının içeriği kendi kanalına göndermesi için;
 * bir kaynak iddiası taşımazlar.
 */
const SHARE_HOSTS = Object.freeze([
  "api.whatsapp.com",
  "wa.me",
  "t.me",
  "telegram.me",
  "facebook.com/sharer",
  // "X'te paylaş" düğmesi. Daha önce kendi hesap listesindeki çıplak
  // "twitter.com" girdisi sayesinde KAZAYLA geçiyordu; hesap kontrolü tam
  // adrese bağlanınca ortaya çıktı. Doğru yeri burası: paylaşım hedefi bir
  // kaynak iddiası taşımaz.
  "twitter.com/intent",
  "x.com/intent"
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

/**
 * "ana bilgisayar" ya da "ana bilgisayar/yol öneki" biçimindeki bir girdiye
 * karşı adres eşleştirir.
 *
 * Tam adres bekler. Yalnızca ana bilgisayar verilirse (eski çağrı biçimi)
 * yol kısıtı olmayan girdilerle eşleşir — yol taşıyan girdiler eşleşmez,
 * çünkü bir hesabı ya da paylaşım hedefini yolu olmadan doğrulayamayız.
 */
function matchesHostEntry(value, entries) {
  const raw = String(value || "").trim();
  if (!raw) return false;

  const host = hostOf(raw) || raw.replace(/^www\./i, "").toLowerCase();
  let pathname = "";
  try {
    pathname = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).pathname;
  } catch {
    pathname = "";
  }

  return entries.some((entry) => {
    const slash = entry.indexOf("/");
    if (slash === -1) return matchesHost(host, entry);
    const entryHost = entry.slice(0, slash);
    const entryPath = entry.slice(slash).toLowerCase();
    return matchesHost(host, entryHost) && pathname.toLowerCase().startsWith(entryPath);
  });
}

/** Bu adres SİTENİN KENDİ hesabı mı? */
function isOwnProfileHost(value) {
  return matchesHostEntry(value, OWN_PROFILE_HOSTS);
}

/** Bu adres bir PAYLAŞIM hedefi mi? */
function isShareHost(value) {
  return matchesHostEntry(value, SHARE_HOSTS);
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
