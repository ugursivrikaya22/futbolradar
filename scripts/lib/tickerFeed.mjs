/**
 * SON DAKİKA BANDI — beslenme kuralı
 *
 * Bant DÖRT doğrulanmış kaynaktan beslenir ve elle güncelleme gerektirmez:
 *
 *   1. Sitenin kendi doğrulanmış maç kaydı (data/matches.json). Bu kayıtlar
 *      yayın politikasından (services/matchEligibility.js) geçmiştir ve CI'ın
 *      beş dakikalık döngüsünde tazelenir; biten bir maçın skoru bandı
 *      kendiliğinden günceller.
 *   2. Doğrulanmış transfer hareketleri (data/transfers.json, status
 *      "confirmed" ve kaynak bağlantısı olanlar).
 *   3. Editoryal haber kayıtları (data/news.json), yalnızca status "verified"
 *      ve kaynak bağlantısı varsa.
 *   4. Küratörlü gündem (data/news-ticker.json): resmî açıklama, maç programı,
 *      sakatlık, teknik direktör/oyuncu sözü ve transfer iddiası. Kural
 *      katmanı services/newsTicker.js, otomatik bakımı
 *      scripts/refresh-news-ticker.mjs.
 *
 * AYNI HABER İKİ KEZ GÖRÜNMEZ. Dört kaynak aynı olaya farklı açılardan
 * bakabiliyor ("Inter Turku 2-0 Başakşehir" ile "Başakşehir Avrupa'ya veda
 * etti"). Havuz birleştirildikten sonra ANLAM düzeyinde bir kez tekleştirilir;
 * kalan sürüm en açık yazımı ve en yüksek önceliği devralır.
 *
 * TAZELİK: "Son Dakika" bir zaman iddiasıdır. Bant daha önce on bir güne
 * kadar eski haberi bu rozetle gösteriyordu — içerik gerçekti ama sunum
 * yanıltıcıydı. Artık her öğenin bir zaman damgası olmak zorunda ve rozet
 * banttaki EN TAZE öğeye göre belirlenir:
 *   • en taze öğe FRESH_WINDOW_HOURS içindeyse  -> "Son Dakika"
 *   • değilse                                    -> "Gündem"
 * Hiçbir durumda uydurma başlık üretilmez.
 *
 * VERİ GEÇİCİ YOKSA: liste boşalırsa bant kaldırılmaz; en son doğrulanmış
 * öğeler korunur (data/ticker-state.json) ve durum iç zaman damgasıyla
 * kaydedilir. Okuyucu gerçek ama eski bir başlık görür, sahte bir "son
 * dakika" görmez.
 *
 * KALABALIK OLMASIN: bant en fazla MAX_ITEMS öğe taşır.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  publishableTransfers,
  logExcludedTransfers,
  logDuplicateTransfers,
  involvesSuperLigTeam
} = require("../../services/transferService.js");
const {
  MAX_CURATED_ITEMS,
  dedupeByMeaning,
  editorialRank,
  logRejected,
  normalizeTickerItems
} = require("../../services/newsTicker.js");

const { promotedNewsId } = require('../../services/newsPriority.js');
const { newsHref } = require('../../services/newsFeed.js');
const root = process.cwd();

/** "Son Dakika" rozetinin geçerli sayıldığı pencere. */
export const FRESH_WINDOW_HOURS = 36;

/** Banda alınabilecek en eski içerik. Bundan eskisi hiç gösterilmez. */
const MAX_AGE_HOURS = 24 * 7;

/**
 * Transferler daha uzun ömürlü. Bir maç sonucu bir hafta sonra haber
 * değerini yitirir; transfer dönemi boyunca "X kulübe katıldı" bilgisi
 * geçerliliğini korur. Yedi günlük pencere, doğrulanmış transferlerin
 * banda hiç girememesine yol açıyordu.
 *
 * Bu, tazelik iddiasını gevşetmiyor: "Son Dakika" rozeti hâlâ banttaki EN
 * TAZE öğeye göre veriliyor, eski bir transfer tek başına o rozeti üretemez.
 */
const TRANSFER_MAX_AGE_HOURS = 24 * 21;

/**
 * Çıplak skor satırının SERT TAVANI. Tek bir kategori bandı ele geçirmesin:
 * altı maç sonucu varken doğrulanmış transferler hiç görünmüyordu; sıralama
 * önceliği doğruydu ama sonuç tek sesli bir banttı.
 *
 * Maç kotası dörtten ikiye indirildi: küratörlü gündem artık maç sonuçlarını
 * da ANLAMIYLA taşıyor ("Beşiktaş tur atladı") ve iki kaynak aynı olayda
 * çakışıyordu.
 *
 * TAVAN, KOTA DEĞİL. Bu sayı bir süre yalnızca "rezervasyon" gibi davrandı:
 * ayrılan yerleri doldurduktan sonra artan slot önceliğe göre dolduğu için
 * ve maç öğesinin önceliği en yüksek olduğu için, artan her slota bir çıplak
 * skor daha giriyordu. MAX_ITEMS 7 iken kota bandı tam doldurduğundan sınır
 * tesadüfen tutuyordu; 8'e çıkınca üçüncü skor satırı sızdı ve gündem
 * dosyasındaki üç transfer iddiası birden banda hiç giremedi — yani söylenti
 * bandı söylentisiz kaldı. Sınır artık `rest` doldururken de uygulanıyor.
 */
export const MAX_MATCH_ITEMS = 2;
const MIN_TRANSFER_SLOTS = 1;

/**
 * Küratörlü gündeme (iddia, resmî açıklama, sakatlık, teknik direktör sözü)
 * ayrılan en az yer. Maç sonuçları altı slotu da doldurabildiği için,
 * ayrılmadığında bu kategori hiç görünmüyordu.
 *
 * "Gündem" bandın ASIL işi: bir futbol sitesinin üst şeridi skor tablosu
 * değil, gündem şerididir. Dört slot bu yüzden ayrılıyor.
 */
export const MIN_CURATED_SLOTS = 4;

/**
 * Bant en fazla bu kadar öğe taşır; şerit kalabalıklaşmamalı.
 *
 * Altıdan sekize çıktı. İki ayrı gerekçe aynı yöne işaret etti: küratörlü
 * gündem beş kategoriden sekize genişledi (maç programı, oyuncu açıklaması,
 * kulüp gündemi) ve gündem dosyası dokuz habere büyüdü. Altı slotta gündeme
 * üç yer kalıyordu. Sekiz, kayan bir şeritte hâlâ okunabilir bir uzunluk —
 * 320px'e kadar tek satır kalması ayrıca sınanıyor.
 *
 * 2 Kasım 2026: sekizden on ikiye çıktı; hafta sonu maç raporları, transfer
 * söylentileri ve Avrupa programı aynı anda gündemde olduğunda sekiz slot
 * çeşitliliği kesiyordu. Şerit tek satır kalmaya devam ediyor.
 */
export const MAX_ITEMS = 12;

const STATE_FILE = path.join(root, "data", "ticker-state.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", file), "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function hoursSince(value, now) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return Infinity;
  return (now.getTime() - time) / 3600000;
}

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) &&
    score.home !== null && score.home !== undefined &&
    score.away !== null && score.away !== undefined;
}

function slugify(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Maç kayıtları: canlı skor, biten sonuç ve bugünün başlama saatleri. */
function matchItems(now) {
  const matches = asArray(readJson("matches.json", []), "matches");
  const reports = asArray(readJson("post-match-reports.json", { records: [] }), "records");
  const reportByMatch = new Map(reports
    .filter((record) => record && record.matchId && record.publishState === "page" && record.reportUrl)
    .map((record) => [record.matchId, String(record.reportUrl).replace(/^\.\//, "")]));
  const items = [];

  for (const match of matches) {
    if (!match || !match.homeTeam || !match.awayTeam) continue;

    const status = String(match.status || "").toUpperCase();
    const stamp = match.lastVerifiedAt || match.fetchedAt || match.kickoff;
    const age = hoursSince(stamp, now);
    if (age > MAX_AGE_HOURS) continue;

    const live = ["LIVE", "IN_PLAY", "1H", "2H", "HT", "HALFTIME", "ET"].includes(status);
    const finished = ["FINISHED", "FT", "AET", "PEN"].includes(status);

    // Gündem sırası tek yerde tanımlı (services/newsTicker.js): dört
    // büyükler, sonra Avrupa'daki Türk kulüpleri, sonra Süper Lig. Aynı
    // öncelik listesi dört kaynağın hepsine uygulanıyor ki bant kaynak
    // değiştirdiğinde sıralama mantığı değişmesin.
    const rank = editorialRank({
      teams: [match.homeTeam, match.awayTeam],
      competition: match.league || match.competition
    });

    if (live && hasScore(match)) {
      items.push({
        label: "Canlı",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: `canli-skor.html#${match.id}`,
        at: stamp,
        source: "match",
        priority: 0 + rank / 10
      });
    } else if (finished && hasScore(match)) {
      items.push({
        label: "Sonuç",
        text: `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`,
        href: match.matchPage || match.analysisPage || reportByMatch.get(match.id) || `canli-skor.html#${match.id}`,
        at: stamp,
        source: "match",
        priority: 1 + rank / 10
      });
    }
  }

  return items;
}

/**
 * Doğrulanmış transferler.
 *
 * Yayın kuralı burada tekrarlanmıyor: services/transferService.js tek yetkili
 * nokta. Kural iki yerde ayrı ayrı yazılsaydı biri gevşediğinde diğeri fark
 * etmez ve bant ile takım sayfaları farklı şeyler gösterirdi.
 */
function transferItems(now) {
  const { transfers, excluded, duplicates } = publishableTransfers();
  logExcludedTransfers("ticker", excluded);
  logDuplicateTransfers("ticker", duplicates);

  return transfers
    // Bant Süper Lig gündemi: en az bir taraf lig kulübü olmalı. Giden
    // transferde karşı taraf yabancı kulüp olabilir, o da lig haberidir.
    .filter((item) => involvesSuperLigTeam(item))
    .filter((item) => hoursSince(item.date, now) <= TRANSFER_MAX_AGE_HOURS)
    .map((item) => ({
      label: "Transfer",
      // Yön açıkça yazılıyor: "kadrosunda" ifadesi gidenler için yanıltıcıydı.
      text: `${item.playerName}, ${item.toTeam} kadrosuna katıldı (${item.type})`,
      href: `super-lig-transferleri-2026-2027.html#transfer-${slugify(item.playerName)}`,
      at: item.date,
      source: "transfer",
      priority: 2 + editorialRank({ teams: [item.toTeam, item.fromTeam] }) / 10
    }));
}

/**
 * BANTTAKİ KENDİ HABERİMİZ GÖRELİ ADRESLE VERİLİR VE SAYFASI OLMADAN GİRMEZ.
 *
 * data/news.json kayıtları `url` alanını MUTLAK yazıyor
 * (https://www.futbolradar.com/haber/<slug>). Bant bunu olduğu gibi
 * kullandığında iki sorun çıkıyordu:
 *
 *   1. Künye ile sayfa AYNI dağıtımda gitmiyordu. 21 Eylül 16:17'de banda
 *      giren "Dursun Özbek'ten Okan Buruk açıklaması" son dakika manşeti
 *      canlıda 404 veriyordu: kayıt eklenmişti, sayfası henüz yayında
 *      değildi. Son dakika manşetine tıklayan okuyucu boş sayfa görüyordu.
 *   2. Mutlak adres, sayfanın kendi dağıtımını değil canlı siteyi çağırıyor;
 *      önizleme ve denetim ortamları da üretim sunucusuna gidiyordu.
 *
 * Artık kendi alan adımıza giden künye göreli yola çevriliyor ve HEDEF SAYFA
 * BU ÜRETİMDE YOKSA künye banda hiç girmiyor. "Veri yoksa gösterme" kuralı:
 * bir manşet asla 404'e götürmez.
 */
const SELF_NEWS_PATH = /^https?:\/\/(?:www\.)?futbolradar\.com\/haber\/([^/?#]+)\/?$/i;

export function selfNewsHref(url) {
  const match = SELF_NEWS_PATH.exec(String(url || "").trim());
  if (!match) return null;
  const slug = match[1].replace(/\.html$/i, "");
  return { slug, href: `haber/${slug}.html` };
}

export function newsPageExists(slug) {
  return fs.existsSync(path.join(root, "haber", `${slug}.html`));
}

/** Editoryal haberler; yalnızca doğrulanmış ve kaynaklı olanlar. */
function newsItems(now) {
  const news = asArray(readJson("news.json", []), "news", "items");

  const lead = promotedNewsId(news.filter(item => item.status === "verified"), now);
  return news
    .filter((item) =>
      item &&
      item.title &&
      String(item.status || "").toLowerCase() === "verified" &&
      item.includeInTicker !== false &&
      item.url)
    .filter((item) => hoursSince(item.publishedAt, now) <= MAX_AGE_HOURS)
    // Kendi haberimizse sayfası bu üretimde olmalı; yoksa banda girmez.
    .filter((item) => {
      const kendi = selfNewsHref(item.url);
      return !kendi || newsPageExists(kendi.slug);
    })
    .map((item) => ({
      label: item.category || "Gündem",
      id: item.id,
      text: item.ticker?.text || item.title,
      // BANTTAKİ KENDİ HABERİMİZ SİTE İÇİNDE KALIR.
      //
      // `item.url` kendi haberimizde mutlak üretim adresi tutuyor
      // (https://www.futbolradar.com/haber/...). Bant bunu ham basınca
      // bağlantı İÇ sayılıp yeni sekme almıyor ama tıklayan kişiyi
      // bulunduğu kopyadan çıkarıp canlı siteye atıyordu: önizleme ve
      // denetim ortamlarında henüz yayınlanmamış haber 404 veriyor.
      // `newsHref` kendi kaynağımızdan gelen adresi göreli yola çevirir,
      // dış kaynağın adresini olduğu gibi bırakır — kaynak künyesi
      // mutlak kalmaya devam eder.
      href: newsHref(item, ""),
      at: item.publishedAt,
      source: "news",
      // `category` tekleştirmede EDİTORYAL işareti: aynı olayın hem çıplak
      // skor satırı hem de yazılmış başlığı varsa başlık kazanır.
      category: item.category || "Gündem",
      priority: item.id === lead ? -1 : 3 + editorialRank({ team: item.team, competition: item.competition || item.category }) / 10
    }));
}

/**
 * KÜRATÖRLÜ GÜNDEM — transfer iddiaları, resmî açıklamalar, maç sonu
 * tepkileri, teknik direktör sözleri, kadro ve sakatlık haberleri.
 *
 * Diğer üç kaynak türetilmiş veriden beslenir; bu kaynak elle girilir. O
 * yüzden kural katmanı ayrı bir serviste (services/newsTicker.js) ve
 * DOĞRULAMA ZORUNLU: güveni belirtilmemiş, kaynağı gösterilmemiş ya da
 * rozetiyle çelişen bir öğe banda hiç girmez.
 */
function curatedItems(now) {
  const payload = readJson("news-ticker.json", { items: [] });
  const { items, rejected } = normalizeTickerItems(payload, { now, limit: MAX_CURATED_ITEMS });

  logRejected("ticker", rejected);

  // İki bant içi öncelik:
  //   • SON DAKİKA (0.5–0.96) — canlı skorun hemen ardında, biten maçın
  //     önünde. 24 saatlik pencere dolduğunda işaret kendiliğinden sönüyor
  //     (services/newsTicker.js), dolayısıyla bu öncelik kalıcı olamaz.
  //   • Normal gündem (1.5–1.96) — biten maç sonuçlarının ardında,
  //     editoryal haberlerin önünde.
  //
  // İkisinin içinde de sıra: editoryal rütbe (dört büyükler önce), sonra
  // kategori. Kesinleşmemiş öğeler kendi rozetlerini taşıdıkları için öne
  // çıkmaları yanıltıcı olmuyor.
  return items
    // Küratörlü künye de kendi haberimize mutlak adresle bağlanabiliyor
    // (news-ticker.json'daki source.url). Aynı kural: göreli yola çevrilir,
    // sayfası bu üretimde yoksa banda girmez. Kural katmanı (services/
    // newsTicker.js) saf kalsın diye dosya sistemi kontrolü burada.
    .filter((item) => {
      const kendi = selfNewsHref(item.href);
      return !kendi || newsPageExists(kendi.slug);
    })
    .map((item) => ({
      ...item,
      href: (selfNewsHref(item.href) || {}).href || item.href,
      source: "curated",
      priority: (item.breaking ? 0.5 : 1.5) + item.rank / 10 + item.priority / 100
    }));
}

/**
 * Aynı olayın farklı yazımlarını eler.
 *
 * Kelimesi kelimesine karşılaştırma yetmiyordu: bandın bir kaynağı
 * "Inter Turku 2-0 Başakşehir" yazarken diğeri "Başakşehir Konferans
 * Ligi'nde elendi" yazıyor ve okuyucu aynı haberi iki kez görüyordu.
 * Karşılaştırma kuralı da tek yerde (services/newsTicker.js).
 */
function dedupe(items, scope = "ticker") {
  const { items: unique, dropped } = dedupeByMeaning(items);
  logRejected(scope, dropped);
  return unique;
}

/** İki listenin aynı içeriği taşıyıp taşımadığını karşılaştırmak için. */
function signature(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.label}|${item.text}|${item.href}|${item.at}`)
    .join("\n");
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    /* Durum dosyası yazılamazsa bant yine çalışır; yalnızca yedek kaybolur. */
  }
}

/**
 * Bandın içeriğini ve rozetini üretir.
 * @returns {{items: Array, badge: string, fresh: boolean, generatedAt: string, usedFallback: boolean}}
 */
export function buildTickerFeed(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  const byRecency = (left, right) => String(right.at || "").localeCompare(String(left.at || ""));
  const byImportance = (left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    return byRecency(left, right);
  };

  // TEKLEŞTİRME BİR KEZ, DÖRT KAYNAK BİRLEŞTİKTEN SONRA.
  //
  // Daha önce her kaynak ayrı ayrı ve sonra birleşik liste yeniden
  // eleniyordu. Aynı olayın maç kaydındaki ve haber kaydındaki sürümü ancak
  // son turda karşılaşıyordu; o tur da seçim yapıldıktan SONRA geldiği için
  // seçilmiş bir slot elenip yerine bir şey konmuyordu. Tek turda elemek hem
  // bu boşluğu kapatıyor hem de "hangi haber hangi kotaya sayılıyor"
  // sorusunu tek cevaplı hâle getiriyor.
  const pool = dedupe([
    ...matchItems(now),
    ...curatedItems(now),
    ...transferItems(now),
    ...newsItems(now)
  ]);

  const fromSource = (name) => pool.filter((item) => item.source === name).sort(byImportance);

  const matches = fromSource("match");
  const curated = fromSource("curated");
  const transfers = fromSource("transfer");

  // Kategori kotası: maç sonuçları bandı tek başına doldurmasın, doğrulanmış
  // transferlere ve küratörlü gündeme yer kalsın. Kota dolmazsa boş slot
  // israf edilmez, kalan yerler önceliğe göre doldurulur.
  //
  // Küratörlü gündeme yer AYRILMASI şart: altı maç sonucu varken transfer
  // iddiaları ve resmî açıklamalar hiç görünmüyordu — transferler için
  // zaten yaşanmış ve çözülmüş olan sorunun aynısı.
  const reservedForTransfers = Math.min(transfers.length, MIN_TRANSFER_SLOTS);
  const reservedForCurated = Math.min(curated.length, MIN_CURATED_SLOTS);
  const matchQuota = Math.min(
    matches.length,
    MAX_MATCH_ITEMS,
    MAX_ITEMS - reservedForTransfers - reservedForCurated
  );

  const picked = [
    ...matches.slice(0, Math.max(matchQuota, 0)),
    ...curated.slice(0, reservedForCurated),
    ...transfers.slice(0, reservedForTransfers)
  ];

  // Kalan yerleri önceliğe göre doldur. Havuz zaten tekleştirildiği için
  // burada nesne kimliğiyle karşılaştırmak güvenli.
  //
  // Maç öğesi için SERT TAVAN burada da geçerli: süzgeç sıralamadan SONRA
  // çalışıyor, böylece kalan yer varsa en önemli maç girer — ama tavan
  // aşılmaz. Süzgeç olmasaydı maç en yüksek öncelikli kaynak olduğu için
  // artan her slotu o kapardı ve gündem hiç görünmezdi.
  let matchRoom = Math.max(0, MAX_MATCH_ITEMS - Math.max(matchQuota, 0));
  const rest = pool
    .filter((item) => !picked.includes(item))
    .sort(byImportance)
    .filter((item) => {
      if (item.source !== "match") return true;
      if (matchRoom <= 0) return false;
      matchRoom -= 1;
      return true;
    });

  // Bant kendi içinde de önceliğe göre dizilir: kota hangi öğelerin
  // gireceğini belirler, SIRAYI belirlemez. Kota olmasaydı canlı skor bir
  // transfer duyurusunun altına düşebilirdi.
  const promoted = pool.filter(item => item.priority === -1);
  const items = [...promoted, ...picked.filter(item => !promoted.includes(item)), ...rest.filter(item => !promoted.includes(item))].slice(0, MAX_ITEMS).sort(byImportance);
  const previous = readState();

  // Doğrulanmış hiçbir öğe kalmadıysa son bilinen liste korunur. Bant boş
  // kalmaz ama uydurma da üretilmez: gösterilen her başlık daha önce
  // doğrulanmış gerçek bir kayıttır.
  if (!items.length) {
    // ESKİ AMA DOĞRU ≠ TARİHİ GEÇMİŞ.
    //
    // Yedek listenin varlık sebebi "gerçek ama eski başlık göster"; tarihi
    // geçmiş bir duyuru ise eski değil, YANLIŞ. "5 Ağustos'ta oynanacak"
    // satırı 20 Ağustos'ta yedekten çizilirse bant okuyucuya yanlış bilgi
    // vermiş olur. Kesinti sürerken bile bu satırlar elenir; hepsi elenirse
    // bant boş kalır, çünkü yanlış bir başlık boş bant'tan kötüdür.
    const stillTrue = (previous && Array.isArray(previous.items) ? previous.items : [])
      .filter((item) => {
        const expires = Date.parse(item && item.expiresAt);
        return Number.isNaN(expires) || now.getTime() <= expires;
      });

    if (stillTrue.length) {
      // fallbackSince kesintinin ilk görüldüğü andır; kesinti sürerken
      // yeniden yazılmaz, böylece her tur yeni bir commit üretmez.
      if (!previous.usedFallback || !previous.fallbackSince) {
        writeState({
          ...previous,
          items: stillTrue,
          usedFallback: true,
          fallbackSince: now.toISOString(),
          fallbackReason: "doğrulanmış taze öğe bulunamadı"
        });
      }
      return {
        items: stillTrue,
        badge: "Gündem",
        fresh: false,
        generatedAt: previous.generatedAt || null,
        usedFallback: true
      };
    }

    if (!previous || previous.items?.length || !previous.fallbackSince) {
      writeState({
        items: [],
        generatedAt: null,
        usedFallback: false,
        fallbackSince: now.toISOString(),
        fallbackReason: "doğrulanmış öğe yok"
      });
    }
    return { items: [], badge: "Gündem", fresh: false, generatedAt: null, usedFallback: false };
  }

  const newestAge = Math.min(...items.map((item) => hoursSince(item.at, now)));
  const fresh = newestAge <= FRESH_WINDOW_HOURS;

  // Durum dosyası yalnızca içerik gerçekten değiştiğinde yazılır. Aksi hâlde
  // her beş dakikalık CI turu sırf zaman damgası değişti diye bir commit ve
  // ardından gereksiz bir dağıtım tetiklerdi.
  const unchanged = previous &&
    previous.fresh === fresh &&
    signature(previous.items) === signature(items);
  const generatedAt = unchanged && previous.generatedAt ? previous.generatedAt : now.toISOString();

  if (!unchanged) {
    writeState({
      items,
      generatedAt,
      newestItemAgeHours: Number.isFinite(newestAge) ? Math.round(newestAge * 10) / 10 : null,
      fresh,
      usedFallback: false
    });
  }

  return {
    items,
    badge: fresh ? "Son Dakika" : "Gündem",
    fresh,
    generatedAt,
    usedFallback: false
  };
}
