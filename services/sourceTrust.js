/**
 * KAYNAK GÜVEN KADEMESİ — "RESMÎ" KİMİN SÖZÜYLE RESMÎDİR?
 *
 * PROBLEM. Transfer durumu kaydın METNİNDEN çıkarılıyordu: "resmi", "kesin",
 * "official", "signed" gibi bir kelime geçiyorsa transfer "Resmî" sayılıyordu.
 * Kaynağın kim olduğuna hiç bakılmıyordu.
 *
 * Depoda sonucu görünür: 20 transfer "Resmî" rozetiyle gösteriliyor ve
 * bunların beşinin kaynağı kulübün kendisi değil, bir haber kuruluşu —
 * TRT Spor (2), Anadolu Ajansı (2), Sporx (1). Hepsi saygın yayın organı;
 * ama bir gazetenin "imzalandı" yazması, kulübün imzayı duyurması değildir.
 * "Resmî" rozeti okuyucuya kulübün konuştuğunu söyler.
 *
 * KADEME SIRASI:
 *
 *   1  RESMÎ    — kulübün kendi sitesi, federasyon, UEFA/FIFA, lig kurumu
 *   2  YÜKSEK   — ulusal ajans ve saygın spor basını (AA, TRT, Reuters, BBC…)
 *   3  MUHABİR  — güvenilirliği bilinen transfer muhabirleri
 *   4  DÜŞÜK    — tanınmayan kaynak, toplayıcı, anonim hesap
 *
 * TANINMAYAN KAYNAK KADEME 4'TÜR, KADEME 2 DEĞİL. Varsayılan iyimser olsaydı
 * listeye eklenmemiş her site otomatik güvenilir sayılırdı; kaynak listesinin
 * amacı tam da bunu engellemek. Bir kaynağın kademesini yükseltmek editoryal
 * bir karardır ve bu dosyada, açıkça yazılır.
 *
 * BU MODÜL BİR KAYNAĞIN DOĞRU SÖYLEYİP SÖYLEMEDİĞİNİ BİLMEZ. Yalnızca
 * "bu iddianın arkasında kim var?" sorusunu yanıtlar. Doğruluk kararı —
 * hangi kademenin neyi yayımlamaya yettiği — çağıranın işidir.
 */

/** Kademeler. Küçük sayı daha güvenilir. */
const TRUST_TIER = Object.freeze({
  OFFICIAL: 1,
  HIGH: 2,
  REPORTER: 3,
  LOW: 4
});

/**
 * KADEME 1 — RESMÎ AĞIZ.
 *
 * Yalnızca kurumun KENDİ yayın organı. Kulübün resmî sitesi, federasyon,
 * konfederasyon, lig kurumu. Bir kulübün medya alt alanı da kulübündür
 * (`media.fenerbahce.org`), o yüzden eşleşme alan adının sonuna bakar.
 */
const OFFICIAL_DOMAINS = Object.freeze([
  // Türkiye — Süper Lig kulüpleri
  "galatasaray.org",
  "fenerbahce.org",
  "bjk.com.tr",
  "trabzonspor.org.tr",
  "ibfk.com.tr",
  "goztepe.com.tr",
  "samsunspor.org.tr",
  "kasimpasa.com.tr",
  "eyupspor.com.tr",
  "antalyaspor.com.tr",
  "konyaspor.com.tr",
  "alanyaspor.com.tr",
  "rizespor.org.tr",
  "genclerbirligi.com.tr",
  "kocaelispor.org.tr",
  "gaziantepfk.com.tr",
  "corumfk.org.tr",
  "erzurumspor.org.tr",
  "genclerbirligi.org.tr",
  "caykurrizespor.org.tr",

  // Türkiye — federasyon ve lig
  "tff.org",
  // Halka açık kulüpler transferin bedelini ÖNCE Kamuyu Aydınlatma
  // Platformu'na bildirir. KAP bildirimi kulübün imzalı beyanıdır —
  // gazete aktarımından değil, kulüptendir.
  "kap.org.tr",
  // Kulüplerin kendi medya kolları: fenermedia.com Fenerbahçe'nin yayın
  // organıdır, alan adı farklı diye kademe düşmemeli.
  "fenermedia.com",
  "gsstore.org",

  // Uluslararası kurumlar
  "uefa.com",
  "fifa.com",
  "theifab.com",
  "cas-cci.org",

  // Lig kurumları — ligin kendi duyurusu da resmîdir (fikstür, ceza, kural).
  "premierleague.com",
  "bundesliga.com",
  "laliga.com",
  "legaseriea.it",
  "ligue1.com",
  "ligue1.fr",
  "efl.com",

  // Avrupa kulüpleri (kaynak olarak geçenler)
  "mancity.com",
  "realmadrid.com",
  "fcbarcelona.com",
  "manutd.com",
  "liverpoolfc.com",
  "arsenal.com",
  "chelseafc.com",
  "juventus.com",
  "acmilan.com",
  "inter.it",
  "fcbayern.com",
  "bvb.de",
  "psg.fr",
  "acffiorentina.com",
  "atleticodemadrid.com",
  "sscnapoli.it",
  "asroma.com",
  "sslazio.it",
  "atalanta.it",
  "rbleipzig.com",
  "bayer04.de",
  "olympiquelyonnais.com",
  "om.fr",
  "asmonaco.com",
  "sevillafc.es",
  "valenciacf.com",
  "realbetisbalompie.es",
  "athletic-club.eus",
  "realsociedad.eus",
  "villarrealcf.es",
  "tottenhamhotspur.com",
  "nufc.co.uk",
  "avfc.co.uk",
  "wolves.co.uk",
  "brightonandhovealbion.com",
  "westhamunited.com",
  "evertonfc.com",
  "cfc.co.uk",
  "benfica.pt",
  "fcporto.pt",
  "sporting.pt",
  "ajax.nl",
  "psv.nl",
  "feyenoord.nl",
  "rscanderlecht.be",
  "clubbrugge.be",
  "celticfc.com",
  "rangers.co.uk",
  "shakhtar.com",
  "fcdynamo.kyiv.ua",
  "olympiacos.org",
  "paofc.gr",
  "aekfc.gr",
  "reddevils.com",
  "crvenazvezdafk.com",
  "alnassr.sa",
  "alhilal.com",
  "alittihadclub.sa"
]);

/**
 * KADEME 2 — YÜKSEK GÜVEN.
 *
 * Haber doğrulama sorumluluğu olan ulusal ajanslar, kamu yayıncıları ve
 * uluslararası saygın spor basını. Bu kaynaklar bir transferi DOĞRU
 * bildirebilir — ama "resmî açıklama" yerine geçmezler.
 */
const HIGH_TRUST_DOMAINS = Object.freeze([
  "aa.com.tr",
  "trtspor.com.tr",
  "trthaber.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "skysports.com",
  "espn.com",
  "theathletic.com",
  "nytimes.com",
  "lequipe.fr",
  "kicker.de",
  "gazzetta.it",
  "marca.com",
  "as.com",

  /*
   * TÜRKİYE'NİN ULUSAL YAYINCILARI.
   *
   * Bunlar listede YOKTU. Sonuç depoda ölçüldü: Hürriyet, Fanatik,
   * Fotomaç, Milliyet gibi yayın kurulu olan ulusal gazetelerin haberleri
   * "kaynağı zayıf" sayılıp İDDİA rozetiyle gösteriliyordu. Kaynaksızlık
   * güvenilirlik değildir — ama ulusal bir gazete de kaynaksız değildir.
   * Bu kurumlar bir haberi DOĞRU verebilir; yine de kulübün resmî
   * açıklamasının yerine geçmezler, o yüzden kademe 1 değil kademe 2.
   */
  "hurriyet.com.tr",
  "milliyet.com.tr",
  "sabah.com.tr",
  "fotomac.com.tr",
  "fanatik.com.tr",
  "ntv.com.tr",
  "ntvspor.net",
  "haberturk.com",
  "sozcu.com.tr",
  "aspor.com.tr",
  "beinsports.com.tr",
  "sporx.com",
  "fotospor.com.tr",
  "cnnturk.com",
  "dha.com.tr",
  "iha.com.tr",

  // Avrupa spor basını — ulusal ölçekte yayın kurulu olan kurumlar.
  "sport.es",
  "mundodeportivo.com",
  "corrieredellosport.it",
  "tuttosport.com",
  "sport1.de",
  "bild.de",
  "rmcsport.bfmtv.com",
  "guardian.com",
  "theguardian.com",
  "telegraph.co.uk",
  "goal.com",
  "record.pt",
  "abola.pt"
]);

/**
 * KADEME 3 — MUHABİR.
 *
 * Transfer haberciliğinde sicili bilinen isimler. Kurum değil kişi
 * olduklarından ayrı kademe: doğru çıkma oranları yüksek olabilir ama
 * arkalarında bir yayın kurulu yoktur.
 */
const REPORTER_DOMAINS = Object.freeze([]);

function hostOf(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch (error) {
    return "";
  }
}

/**
 * Alan adı listedeki bir alana ait mi? Alt alanlar dahildir
 * (`media.fenerbahce.org` → `fenerbahce.org`), ama sonek benzerliği
 * yetmez: `notfenerbahce.org` eşleşmez.
 */
function matchesDomain(host, domains) {
  if (!host) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * KAYNAĞIN KADEMESİ. Adres yoksa ya da okunamıyorsa kademe 4 — kaynaksızlık
 * güvenilirlik değildir.
 */
function trustTierOf(sourceUrl) {
  const host = hostOf(sourceUrl);
  if (!host) return TRUST_TIER.LOW;
  if (matchesDomain(host, OFFICIAL_DOMAINS)) return TRUST_TIER.OFFICIAL;
  if (matchesDomain(host, HIGH_TRUST_DOMAINS)) return TRUST_TIER.HIGH;
  if (matchesDomain(host, REPORTER_DOMAINS)) return TRUST_TIER.REPORTER;
  return TRUST_TIER.LOW;
}

/**
 * Bu kaynak "resmî açıklama" sayılır mı? Yalnızca kurumun kendi ağzı.
 *
 * Kayıt birden fazla kaynak taşıyorsa herhangi birinin resmî olması yeter:
 * kulüp duyurmuşsa, haberi ayrıca bir ajansın da vermiş olması durumu
 * zayıflatmaz.
 */
function hasOfficialSource(record) {
  return sourceUrlsOf(record).some((url) => trustTierOf(url) === TRUST_TIER.OFFICIAL);
}

/** Kaydın taşıdığı bütün kaynak adresleri. */
function sourceUrlsOf(record) {
  if (!record) return [];
  const candidates = [
    record.sourceUrl,
    record.url,
    record.source && record.source.url,
    ...(Array.isArray(record.sourceUrls) ? record.sourceUrls : []),
    ...(Array.isArray(record.sources) ? record.sources.map((item) => item && (item.url || item.sourceUrl)) : [])
  ];
  return candidates.filter((value) => typeof value === "string" && value.trim());
}

/** Kaydın en güvenilir kaynağının kademesi. */
function bestTrustTierOf(record) {
  const urls = sourceUrlsOf(record);
  if (!urls.length) return TRUST_TIER.LOW;
  return urls.reduce((best, url) => Math.min(best, trustTierOf(url)), TRUST_TIER.LOW);
}

module.exports = {
  HIGH_TRUST_DOMAINS,
  OFFICIAL_DOMAINS,
  REPORTER_DOMAINS,
  TRUST_TIER,
  bestTrustTierOf,
  hasOfficialSource,
  hostOf,
  sourceUrlsOf,
  trustTierOf
};
