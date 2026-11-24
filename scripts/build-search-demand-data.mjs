/**
 * FIRSAT ENVANTERİ VE TAKVİM ÜRETİCİ
 * ----------------------------------------------------------------------------
 * data/search-demand/opportunities.json ve calendar.json dosyalarını üretir.
 *
 * Puanlar burada ELLE YAZILMAZ: her fırsatın boyut değerleri ve kanıtları
 * tanımlanır, toplam puan services/searchDemand.js üzerinden hesaplanır.
 * test-search-demand.mjs aynı hesabı yeniden yapar; dosyadaki puanla hesap
 * tutmazsa test düşer. Böylece "uydurma toplam puan" yapısal olarak imkânsız.
 *
 * Kanıt notları dürüsttür: Search Console ve site içi arama HENÜZ bağlı
 * olmadığı için talep kanıtı SERP gözlemi (aynı sorguda yayın yapan büyük
 * yayınlar), fikstür gerçekleri ve kaynaklı haber kayıtlarından gelir. GSC
 * bağlandığında boyut değerleri gerçek gösterim verisiyle yeniden kalibre
 * edilmelidir (bkz. docs/search-demand-engine.md).
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { computeOpportunityScore, validateOpportunity } = require("../services/searchDemand.js");

const outDir = path.join(root, "data", "search-demand");
const GENERATED_AT = "2026-08-03T12:30:00+03:00";

/** Kısa kanıt kurucuları. */
const ev = (source, ref, note) => ({ source, ref, note });
const FIX = (note) => ev("internal-fixtures", "data/fixture-calendar.json", note);
const LIG = (note) => ev("internal-fixtures", "data/super-lig-fixtures.json", note);
const TRF = (note) => ev("internal-transfers", "data/transfers.json", note);
const NEWS = (id, note) => ev("internal-news", `data/news.json#${id}`, note);
const SERP = (url, note) => ev("serp-observation", url, note);
const MR = (url, note) => ev("manual-research", url, note);
const SITE = (note) => ev("site-traffic", "search-index.json", note);

/**
 * Fırsat fabrikası. `dims` sekiz boyutun 0-100 değerleri; kanıt listesi tüm
 * boyutlara uygulanır (iç bağlantı/site uyumu için otomatik iç kanıt eklenir).
 */
function opportunity(entry) {
  const { dims, evidence, ...rest } = entry;
  const withInternal = [...evidence, SITE("Mevcut sayfa ağı: takım, fikstür, canlı skor ve haber sayfaları bağlantı verebilir.")];
  const dimensions = {
    demand: { value: dims.demand, evidence },
    trendRise: { value: dims.trend, evidence },
    turkeyRelevance: { value: dims.turkey, evidence },
    siteFit: { value: dims.fit, evidence: withInternal },
    beatableCompetition: { value: dims.comp, evidence },
    timeSensitivity: { value: dims.time, evidence },
    internalLinks: { value: dims.links, evidence: withInternal },
    longTerm: { value: dims.evergreen, evidence }
  };
  const { score, missingData } = computeOpportunityScore(dimensions);
  return { ...rest, evidence, dimensions, score, missingData };
}

const items = [
  // ── ÜRETİLEN İLK 10 (plannedSlug ile içerik planına bağlı) ───────────────
  opportunity({
    id: "fb-sturm-graz-mac-rehberi",
    query: "fenerbahçe sturm graz maçı ne zaman hangi kanalda",
    suggestedTitle: "Fenerbahçe-Sturm Graz maçı ne zaman, saat kaçta, hangi kanalda?",
    contentType: "match-guide",
    classifications: ["today", "match-intent", "informational", "commercial-potential"],
    decision: "new",
    plannedSlug: "fenerbahce-sturm-graz-ne-zaman-hangi-kanalda",
    team: "Fenerbahçe",
    publishWindow: "2026-08-03 (maçtan 2 gün önce)",
    linkTargets: ["fenerbahce-avrupa-maclari.html", "canli-skor.html", "haber/fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu.html", "fenerbahce-form-durumu.html"],
    evidence: [
      FIX("Doğrulanmış fikstür: 5 Ağustos 21.00, Chobani Stadyumu."),
      SERP("https://www.hurriyet.com.tr/sporarena/galeri-fenerbahce-sturm-graz-maci-ne-zaman-saat-kacta-hangi-kanalda-fenerbahce-sampiyonlar-ligi-3-eleme-turu-mac-tarihi-43257660", "Hürriyet, Sabah, Habertürk ve CNN Türk aynı soru kalıbında galeri yayımladı — talep ve rekabet kanıtı."),
      NEWS("fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu", "Sitede maç önü haberi yayında; rehber sayfa eksik.")
    ],
    dims: { demand: 85, trend: 90, turkey: 100, fit: 85, comp: 45, time: 95, links: 85, evergreen: 15 }
  }),
  opportunity({
    id: "bjk-hradec-mac-rehberi",
    query: "hradec kralove beşiktaş maçı ne zaman hangi kanalda",
    suggestedTitle: "Hradec Králové-Beşiktaş maçı ne zaman, saat kaçta, hangi kanalda?",
    contentType: "match-guide",
    classifications: ["today", "match-intent", "informational", "commercial-potential"],
    decision: "new",
    plannedSlug: "hradec-kralove-besiktas-ne-zaman-hangi-kanalda",
    team: "Beşiktaş",
    publishWindow: "2026-08-03 (maçtan 3 gün önce)",
    linkTargets: ["canli-skor.html", "haber/besiktas-avrupa-ligi-kura-hradec-kralove.html", "besiktas-form-durumu.html", "super-lig-fikstur.html"],
    evidence: [
      FIX("Doğrulanmış fikstür: 6 Ağustos 20.00, Malšovická Arena."),
      SERP("https://www.milliyet.com.tr/galeri/besiktas-hradec-kralove-uefa-avrupa-ligi-3-on-eleme-turu-ilk-maci-ne-zaman-saat-kacta-hangi-kanalda-7632684", "Milliyet ve Sabah aynı soru kalıbında yayın yaptı; S Sport yayın bilgisi haberlerde doğrulandı."),
      NEWS("besiktas-avrupa-ligi-kura-hradec-kralove", "Kura haberi yayında; rehber sayfa eksik.")
    ],
    dims: { demand: 75, trend: 85, turkey: 100, fit: 85, comp: 50, time: 95, links: 80, evergreen: 15 }
  }),
  opportunity({
    id: "super-lig-ne-zaman-basliyor",
    query: "süper lig ne zaman başlıyor 2026",
    suggestedTitle: "Süper Lig ne zaman başlıyor? 2026-27 sezonu açılış tarihi ve ilk hafta programı",
    contentType: "qa",
    classifications: ["today", "informational", "commercial-potential"],
    decision: "new",
    plannedSlug: "super-lig-2026-2027-ne-zaman-basliyor",
    team: "Süper Lig",
    publishWindow: "2026-08-03 (açılışa 11 gün)",
    linkTargets: ["super-lig-fikstur.html", "puan-durumu.html", "haber/super-lig-2026-2027-sezonu-14-agustos-acilis.html", "bugunun-maclari.html"],
    evidence: [
      LIG("Doğrulanmış fikstür verisi: sezon 14 Ağustos'ta başlıyor, ilk iki haftanın eşleşmeleri onaylı."),
      SERP("https://www.hurriyet.com.tr/sporarena/galeri-super-lig-ne-zaman-baslayacak-2026-2027-super-lig-ne-zaman-basliyor-derbiler-ne-zaman-43258448", "Hürriyet ve NTV aynı soruyu son 72 saatte yeniden yayımladı — açılışa yaklaşırken talep yükseliyor."),
      MR("https://www.tff.org/default.aspx?pageID=687&ftxtID=50517", "TFF sezon planlaması resmî kaynağı.")
    ],
    dims: { demand: 80, trend: 75, turkey: 100, fit: 90, comp: 40, time: 85, links: 85, evergreen: 25 }
  }),
  opportunity({
    id: "salah-transfer-merkez",
    query: "salah trabzonspor son dakika",
    suggestedTitle: "Mohamed Salah-Trabzonspor iddiasında son durum: bilinenler ve doğrulanmayanlar",
    contentType: "transfer-hub",
    classifications: ["breaking", "transfer-intent", "informational"],
    decision: "new",
    plannedSlug: "mohamed-salah-trabzonspor-transfer-son-durum",
    team: "Trabzonspor",
    player: "Mohamed Salah",
    transferStatus: "rumour",
    publishWindow: "2026-08-03 (gündem sıcak)",
    linkTargets: ["haber/mohamed-salah-trabzonspor-transferi-resmen-aciklandi.html", "trabzonspor-form-durumu.html", "super-lig-transferleri-2026-2027.html", "haber/trabzonspor-ertugrul-dogan-salah-transfer-aciklamasi.html"],
    evidence: [
      SERP("https://www.hurriyet.com.tr/sporarena/ertugrul-dogandan-salah-aciklamasi-su-anda-bir-anlasma-yok-43259784", "Hürriyet, Fanatik, A Haber, Sözcü ve beIN aynı dosyayı art arda işledi — ulusal gündemin en görünür transfer sorgusu."),
      NEWS("trabzonspor-salah-transfer-iddiasi-son-durum", "Sitede iddia + yalanlama haberleri yayında; tek merkez sayfa eksik."),
      NEWS("trabzonspor-ertugrul-dogan-salah-transfer-aciklamasi", "Başkanın 2 Ağustos tarihli 'anlaşma yok' açıklaması kayıtlı.")
    ],
    dims: { demand: 90, trend: 95, turkey: 100, fit: 80, comp: 40, time: 90, links: 80, evergreen: 20 }
  }),
  opportunity({
    id: "osimhen-transfer-merkez",
    query: "osimhen transfer son durum",
    suggestedTitle: "Victor Osimhen transferinde son durum: İngiliz kulüpleri iddiaları ve Galatasaray'ın tavrı",
    contentType: "transfer-hub",
    classifications: ["today", "transfer-intent", "informational"],
    decision: "new",
    plannedSlug: "victor-osimhen-transfer-son-durum",
    team: "Galatasaray",
    player: "Victor Osimhen",
    transferStatus: "reported",
    publishWindow: "2026-08-03",
    linkTargets: ["haber/galatasaray-osimhen-premier-league-ilgisi-iddialari.html", "galatasaray-form-durumu.html", "super-lig-transferleri-2026-2027.html", "haber/galatasaray-rennes-hazirlik-maci-3-3.html"],
    evidence: [
      SERP("https://www.fanatik.com.tr/galatasaray/galeri-galatasarayda-osimhen-alarmi-transferde-pesini-birakmiyorlar-2632780", "Fanatik, Sporx (BBC aktarımı) ve Nijerya basını 48 saatte art arda yayın yaptı."),
      NEWS("galatasaray-osimhen-premier-league-ilgisi-iddialari", "Sitede günün haberi yayında; iddiaları tek tabloda izleyen merkez sayfa eksik.")
    ],
    dims: { demand: 85, trend: 85, turkey: 95, fit: 80, comp: 40, time: 80, links: 80, evergreen: 25 }
  }),
  opportunity({
    id: "gs-corum-acilis-rehberi",
    query: "galatasaray çorum fk maçı ne zaman",
    suggestedTitle: "Galatasaray-Çorum FK maçı ne zaman, saat kaçta? Süper Lig açılış maçı",
    contentType: "match-guide",
    classifications: ["today", "match-intent", "informational"],
    decision: "new",
    plannedSlug: "galatasaray-corum-fk-ne-zaman-hangi-kanalda",
    team: "Galatasaray",
    publishWindow: "2026-08-03 (açılışa 11 gün, erken pozisyon)",
    linkTargets: ["super-lig-fikstur.html", "galatasaray-form-durumu.html", "haber/super-lig-2026-2027-sezonu-14-agustos-acilis.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 1. hafta Galatasaray-Çorum FK."),
      MR("https://www.ntv.com.tr/sporskor/galeri-super-lig-baslangic-tarihi-2026-2027-sezonu-super-lig-ne-zaman-baslayacak-iste-ilk-hafta-mac-programi-1732558", "NTV ilk hafta programında 14 Ağustos Cuma 21.30 RAMS Park bilgisini yayımladı."),
      SERP("https://www.fotomac.com.tr/superlig/2026/07/31/super-lig-ne-zaman-basliyor-2026-2027-yeni-sezon-ne-zaman-baslayacak", "Açılış maçı sorgu kalıbı büyük yayınlarda işleniyor; maç haftasında zirve yapar.")
    ],
    dims: { demand: 65, trend: 70, turkey: 100, fit: 85, comp: 55, time: 75, links: 85, evergreen: 15 }
  }),
  opportunity({
    id: "derbi-takvimi-2026-27",
    query: "süper lig derbi tarihleri 2026 2027",
    suggestedTitle: "Süper Lig derbi takvimi 2026-27: Derbiler hangi hafta oynanacak?",
    contentType: "qa",
    classifications: ["today", "informational", "evergreen"],
    decision: "new",
    plannedSlug: "super-lig-derbi-takvimi-2026-2027",
    team: "Süper Lig",
    publishWindow: "2026-08-03",
    linkTargets: ["super-lig-fikstur.html", "derbi-radari.html", "haber/super-lig-2026-2027-sezonu-14-agustos-acilis.html", "puan-durumu.html"],
    evidence: [
      MR("https://www.milliyet.com.tr/skorer/live-super-ligde-2026-2027-sezonu-fiksturu-cekildi-derbi-tarihleri-ve-mac-programlari-belli-oldu-7620103", "Milliyet fikstür çekiminde derbi haftalarını yayımladı (4, 6, 8, 9, 13, 15. haftalar)."),
      SERP("https://www.hurriyet.com.tr/sporarena/galeri-super-lig-ne-zaman-baslayacak-2026-2027-super-lig-ne-zaman-basliyor-derbiler-ne-zaman-43258448", "'Derbiler ne zaman' kalıbı sezon açılışı sorgusuyla birlikte işleniyor."),
      LIG("Fikstür verisi hafta eşleşmelerini doğruluyor.")
    ],
    dims: { demand: 60, trend: 60, turkey: 100, fit: 85, comp: 55, time: 60, links: 80, evergreen: 60 }
  }),
  opportunity({
    id: "vlahovic-transfer-merkez",
    query: "vlahovic beşiktaş son dakika",
    suggestedTitle: "Dusan Vlahovic-Beşiktaş iddiasında son durum: teklif iddiaları ve bilinenler",
    contentType: "transfer-hub",
    classifications: ["today", "transfer-intent", "informational"],
    decision: "new",
    plannedSlug: "dusan-vlahovic-besiktas-transfer-son-durum",
    team: "Beşiktaş",
    player: "Dusan Vlahovic",
    transferStatus: "rumour",
    publishWindow: "2026-08-03",
    linkTargets: ["haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html", "besiktas-form-durumu.html", "super-lig-transferleri-2026-2027.html"],
    evidence: [
      SERP("https://www.fanatik.com.tr/transfer/live-teklifin-detaylari-belli-oldu-besiktastan-dusan-vlahovic-icin-dev-harekat-2632834", "Fanatik canlı transfer akışında dosyayı işliyor; Beşiktaş basını art arda iddia yayımlıyor."),
      NEWS("besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari", "Sitede hedef listesi haberi yayında; oyuncu bazlı merkez sayfa eksik.")
    ],
    dims: { demand: 70, trend: 80, turkey: 95, fit: 75, comp: 45, time: 85, links: 75, evergreen: 20 }
  }),
  opportunity({
    id: "avrupa-ligi-eleme-rehberi",
    query: "avrupa ligi eleme sistemi nasıl işliyor",
    suggestedTitle: "UEFA Avrupa Ligi eleme sistemi: Turlar, play-off ve lig aşaması nasıl işliyor?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "avrupa-ligi-eleme-sistemi-rehberi",
    team: "Beşiktaş",
    publishWindow: "2026-08-03 (BJK eleme haftası bağlamıyla)",
    linkTargets: ["haber/besiktas-avrupa-ligi-kura-hradec-kralove.html", "uefa-ulke-puani-siralamasi.html", "canli-skor.html", "besiktas-form-durumu.html"],
    evidence: [
      MR("https://www.uefa.com/uefaeuropaleague/", "UEFA'nın resmî turnuva sayfası format bilgisinin birincil kaynağı."),
      FIX("Beşiktaş'ın 3. eleme turu maçı takvimde: format sorusu tam bu hafta aranıyor."),
      NEWS("besiktas-avrupa-ligi-kura-hradec-kralove", "Kura haberindeki 'play-off'a yükselir' bağlamı format sorusunu doğuruyor.")
    ],
    dims: { demand: 45, trend: 55, turkey: 80, fit: 75, comp: 65, time: 45, links: 75, evergreen: 90 }
  }),
  opportunity({
    id: "bjk-yeni-transferler",
    query: "beşiktaş yeni transferleri kimler",
    suggestedTitle: "Beşiktaş'ın 2026-27 transferleri: Gelenler, gidenler ve gündemdeki isimler",
    contentType: "qa",
    classifications: ["today", "transfer-intent", "informational"],
    decision: "new",
    plannedSlug: "besiktas-yeni-transferleri-2026-2027",
    team: "Beşiktaş",
    transferStatus: "confirmed",
    publishWindow: "2026-08-03",
    linkTargets: ["super-lig-transferleri-2026-2027.html", "besiktas-oyuncu-radari.html", "haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html"],
    evidence: [
      TRF("Doğrulanmış kayıtlar: Trossard, Nübel, Salih Özcan, Doğan Alemdar geldi; Sanuç ayrıldı."),
      SERP("https://www.fotospor.com.tr/besiktas/besktas-agustosta-yakacak-123-yetmez-45-olsun-709613", "'Beşiktaş transfer' kalıbı yoğun işleniyor; doğrulanmış liste + gündem ayrımı sunan sayfa eksik.")
    ],
    dims: { demand: 65, trend: 60, turkey: 100, fit: 90, comp: 50, time: 65, links: 85, evergreen: 35 }
  }),

  // ── MAÇ NİYETLİ DİĞER FIRSATLAR ──────────────────────────────────────────
  opportunity({
    id: "fb-sturm-muhtemel-11",
    query: "fenerbahçe sturm graz muhtemel 11",
    suggestedTitle: "Fenerbahçe-Sturm Graz muhtemel 11'ler",
    contentType: "update-existing",
    classifications: ["today", "match-intent", "informational"],
    decision: "update",
    existingPage: "fenerbahce-sturm-graz-ne-zaman-hangi-kanalda.html",
    team: "Fenerbahçe",
    publishWindow: "2026-08-04 (maç günü -1, kadro verisi doğrulanınca)",
    linkTargets: ["fenerbahce-oyuncu-radari.html", "canli-skor.html", "fenerbahce-avrupa-maclari.html"],
    evidence: [
      SERP("https://www.sabah.com.tr/spor/futbol/2026/07/30/fenerbahcede-sturm-graz-maci-hazirliklari-basladi", "Muhtemel 11 kalıbı maç gününe doğru büyük yayınlarda zirve yapıyor."),
      FIX("Maç 5 Ağustos'ta; 11 doğrulanmadan yayımlanmaz, rehber sayfa güncellenir.")
    ],
    dims: { demand: 75, trend: 85, turkey: 100, fit: 70, comp: 45, time: 95, links: 70, evergreen: 5 }
  }),
  opportunity({
    id: "fb-sturm-rovans-rehberi",
    query: "sturm graz fenerbahçe rövanş ne zaman",
    suggestedTitle: "Sturm Graz-Fenerbahçe rövanşı ne zaman? Tur atlama senaryoları",
    contentType: "match-guide",
    classifications: ["today", "match-intent", "informational"],
    decision: "new",
    team: "Fenerbahçe",
    publishWindow: "2026-08-06 (ilk maç sonrası)",
    linkTargets: ["fenerbahce-avrupa-maclari.html", "canli-skor.html", "haber/fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu.html"],
    evidence: [
      MR("https://www.hurriyet.com.tr/sporarena/galeri-fenerbahce-sturm-graz-maci-ne-zaman-saat-kacta-hangi-kanalda-fenerbahce-sampiyonlar-ligi-3-eleme-turu-mac-tarihi-43257660", "Rövanş tarihi (11 Ağustos, Graz) basında doğrulandı."),
      SITE("Mevcut Górnik rövanş sayfası aynı kalıbın trafiğini kanıtlıyor (gornik-zabrze-fenerbahce-rovans-ne-zaman.html).")
    ],
    dims: { demand: 60, trend: 55, turkey: 100, fit: 80, comp: 50, time: 80, links: 75, evergreen: 10 }
  }),
  opportunity({
    id: "bjk-rovans-rehberi",
    query: "beşiktaş hradec kralove rövanş ne zaman",
    suggestedTitle: "Beşiktaş-Hradec Králové rövanşı ne zaman, nerede oynanacak?",
    contentType: "update-existing",
    classifications: ["today", "match-intent", "informational"],
    decision: "update",
    existingPage: "hradec-kralove-besiktas-ne-zaman-hangi-kanalda.html",
    team: "Beşiktaş",
    publishWindow: "2026-08-07 (ilk maç sonrası)",
    linkTargets: ["canli-skor.html", "besiktas-form-durumu.html", "haber/besiktas-avrupa-ligi-kura-hradec-kralove.html"],
    evidence: [
      MR("https://www.sabah.com.tr/galeri/yasam/besiktas-hradec-kralove-maci-ne-zaman-oynanacak-besiktas-uefa-avrupa-ligi-3-eleme-turunda", "Rövanş 13 Ağustos Tüpraş Stadyumu bilgisi basında doğrulandı."),
      FIX("İlk maç 6 Ağustos'ta; rövanş bölümü rehberde güncellenecek.")
    ],
    dims: { demand: 55, trend: 55, turkey: 100, fit: 75, comp: 55, time: 80, links: 70, evergreen: 5 }
  }),
  opportunity({
    id: "gs-villarreal-hazirlik",
    query: "galatasaray villarreal hazırlık maçı ne zaman",
    suggestedTitle: "Galatasaray-Villarreal hazırlık maçı ne zaman, saat kaçta?",
    contentType: "quick-news",
    classifications: ["today", "match-intent", "informational"],
    decision: "new",
    team: "Galatasaray",
    publishWindow: "2026-08-07 (maçtan 1 gün önce)",
    linkTargets: ["galatasaray-form-durumu.html", "bugunun-maclari.html", "haber/galatasaray-rennes-hazirlik-maci-3-3.html"],
    evidence: [
      FIX("Sağlayıcı takviminde 8 Ağustos Galatasaray-Villarreal kaydı var; saat/stat doğrulanınca yayımlanır."),
      SERP("https://www.fotomac.com.tr/galatasaray/2026/08/02/galatasaray-gol-duellosunda-rennes-ile-yenisemedi", "Hazırlık maçı sorguları GS haberlerinde yoğun işleniyor.")
    ],
    dims: { demand: 50, trend: 60, turkey: 100, fit: 75, comp: 55, time: 85, links: 70, evergreen: 5 }
  }),
  opportunity({
    id: "genclerbirligi-fb-rehberi",
    query: "gençlerbirliği fenerbahçe maçı ne zaman",
    suggestedTitle: "Gençlerbirliği-Fenerbahçe maçı ne zaman, saat kaçta?",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Fenerbahçe",
    publishWindow: "2026-08-12 (lig açılış haftası)",
    linkTargets: ["super-lig-fikstur.html", "fenerbahce-form-durumu.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 1. hafta, 15 Ağustos 21.30 (NTV programı)."),
      MR("https://www.ntv.com.tr/sporskor/galeri-super-lig-baslangic-tarihi-2026-2027-sezonu-super-lig-ne-zaman-baslayacak-iste-ilk-hafta-mac-programi-1732558", "İlk hafta programı basında yayımlandı.")
    ],
    dims: { demand: 55, trend: 45, turkey: 100, fit: 85, comp: 55, time: 65, links: 80, evergreen: 10 }
  }),
  opportunity({
    id: "kasimpasa-ts-rehberi",
    query: "kasımpaşa trabzonspor maçı ne zaman",
    suggestedTitle: "Kasımpaşa-Trabzonspor maçı ne zaman, saat kaçta?",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Trabzonspor",
    publishWindow: "2026-08-12",
    linkTargets: ["super-lig-fikstur.html", "trabzonspor-form-durumu.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 1. hafta, 15 Ağustos 19.00."),
      MR("https://www.ntv.com.tr/sporskor/galeri-super-lig-baslangic-tarihi-2026-2027-sezonu-super-lig-ne-zaman-baslayacak-iste-ilk-hafta-mac-programi-1732558", "İlk hafta programı basında yayımlandı.")
    ],
    dims: { demand: 50, trend: 45, turkey: 100, fit: 85, comp: 55, time: 65, links: 80, evergreen: 10 }
  }),
  opportunity({
    id: "bjk-eyupspor-rehberi",
    query: "beşiktaş eyüpspor maçı ne zaman",
    suggestedTitle: "Beşiktaş-Eyüpspor maçı ne zaman, saat kaçta?",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Beşiktaş",
    publishWindow: "2026-08-13",
    linkTargets: ["super-lig-fikstur.html", "besiktas-form-durumu.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 1. hafta, 16 Ağustos 21.30."),
      MR("https://www.ntv.com.tr/sporskor/galeri-super-lig-baslangic-tarihi-2026-2027-sezonu-super-lig-ne-zaman-baslayacak-iste-ilk-hafta-mac-programi-1732558", "İlk hafta programı basında yayımlandı.")
    ],
    dims: { demand: 50, trend: 45, turkey: 100, fit: 85, comp: 55, time: 60, links: 80, evergreen: 10 }
  }),
  opportunity({
    id: "super-lig-ilk-hafta-canli",
    query: "süper lig canlı skor ilk hafta",
    suggestedTitle: "Süper Lig ilk hafta canlı skor ve sonuçlar",
    contentType: "update-existing",
    classifications: ["match-intent", "commercial-potential"],
    decision: "update",
    existingPage: "canli-skor.html",
    team: "Süper Lig",
    publishWindow: "2026-08-14..17 (maç günleri)",
    linkTargets: ["canli-skor.html", "mac-sonuclari.html", "puan-durumu.html"],
    evidence: [
      LIG("Açılış haftası 14-17 Ağustos; canlı skor sayfası mevcut ve sağlayıcı beslemeli."),
      SITE("canli-skor.html sitenin ana canlı yüzeyi; ilk hafta görünürlüğü ana sayfadan güçlendirilecek.")
    ],
    dims: { demand: 80, trend: 70, turkey: 100, fit: 95, comp: 25, time: 90, links: 90, evergreen: 30 }
  }),
  opportunity({
    id: "fb-konyaspor-2-hafta",
    query: "fenerbahçe konyaspor maçı ne zaman",
    suggestedTitle: "Fenerbahçe-Konyaspor maçı ne zaman? 2. hafta programı",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Fenerbahçe",
    publishWindow: "2026-08-19 (TFF saat ataması sonrası)",
    linkTargets: ["super-lig-fikstur.html", "fenerbahce-form-durumu.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 2. hafta Fenerbahçe-Konyaspor; tarih/saat ataması bekleniyor — atanmadan saat YAZILMAZ.")
    ],
    dims: { demand: 45, trend: 30, turkey: 100, fit: 85, comp: 55, time: 45, links: 80, evergreen: 10 }
  }),
  opportunity({
    id: "erzurumspor-gs-2-hafta",
    query: "erzurumspor galatasaray maçı ne zaman",
    suggestedTitle: "Erzurumspor FK-Galatasaray maçı ne zaman? 2. hafta programı",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Galatasaray",
    publishWindow: "2026-08-19",
    linkTargets: ["super-lig-fikstur.html", "galatasaray-form-durumu.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 2. hafta Erzurumspor FK-Galatasaray; saat ataması bekleniyor.")
    ],
    dims: { demand: 45, trend: 30, turkey: 100, fit: 85, comp: 55, time: 45, links: 80, evergreen: 10 }
  }),
  opportunity({
    id: "mac-sonucu-fb-sturm",
    query: "fenerbahçe sturm graz maç sonucu",
    suggestedTitle: "Fenerbahçe-Sturm Graz maç sonucu ve öne çıkanlar",
    contentType: "quick-news",
    classifications: ["breaking", "match-intent"],
    decision: "new",
    team: "Fenerbahçe",
    publishWindow: "2026-08-05 (maç bitiminde)",
    linkTargets: ["mac-sonuclari.html", "canli-skor.html", "fenerbahce-avrupa-maclari.html"],
    evidence: [
      FIX("Maç 5 Ağustos'ta; sonuç sayfası maç bitince doğrulanmış skorla açılır — önce yazılmaz."),
      SITE("mac-raporu/ altyapısı maç sonu raporlarını otomatik üretiyor.")
    ],
    dims: { demand: 80, trend: 85, turkey: 100, fit: 90, comp: 40, time: 95, links: 85, evergreen: 5 }
  }),
  opportunity({
    id: "mac-sonucu-bjk-hradec",
    query: "hradec kralove beşiktaş maç sonucu",
    suggestedTitle: "Hradec Králové-Beşiktaş maç sonucu ve tur senaryosu",
    contentType: "quick-news",
    classifications: ["breaking", "match-intent"],
    decision: "new",
    team: "Beşiktaş",
    publishWindow: "2026-08-06 (maç bitiminde)",
    linkTargets: ["mac-sonuclari.html", "canli-skor.html", "besiktas-form-durumu.html"],
    evidence: [
      FIX("Maç 6 Ağustos'ta; skor doğrulanmadan sonuç sayfası açılmaz."),
      SITE("Maç sonu rapor hattı mevcut.")
    ],
    dims: { demand: 70, trend: 80, turkey: 100, fit: 90, comp: 45, time: 95, links: 85, evergreen: 5 }
  }),

  // ── TRANSFER NİYETLİ DİĞER FIRSATLAR ─────────────────────────────────────
  opportunity({
    id: "schick-besiktas-iddia",
    query: "patrick schick beşiktaş",
    suggestedTitle: "Patrick Schick-Beşiktaş iddiası: bilinenler ve doğrulanmayanlar",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html",
    team: "Beşiktaş",
    player: "Patrick Schick",
    transferStatus: "rumour",
    publishWindow: "gelişme olursa",
    linkTargets: ["haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html", "super-lig-transferleri-2026-2027.html", "besiktas-oyuncu-radari.html"],
    evidence: [
      SERP("https://www.sporx.com/besiktas-in-santrfor-hedefi-yeniden-patrick-schick-SXHBQ1171198SXQ", "Sporx 3 Ağustos'ta dosyayı yeniden açtı; yeni sayfa yerine mevcut haber güncellenir.")
    ],
    dims: { demand: 50, trend: 65, turkey: 90, fit: 70, comp: 50, time: 70, links: 70, evergreen: 15 }
  }),
  opportunity({
    id: "nunez-besiktas-iddia",
    query: "darwin nunez beşiktaş",
    suggestedTitle: "Darwin Núñez-Beşiktaş iddiası: kiralık formül gündemde",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html",
    team: "Beşiktaş",
    player: "Darwin Núñez",
    transferStatus: "rumour",
    publishWindow: "gelişme olursa",
    linkTargets: ["haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html", "super-lig-transferleri-2026-2027.html", "besiktas-form-durumu.html"],
    evidence: [
      SERP("https://www.sporx.com/besiktas-ta-darwin-nunez-gelismesi-SXHBQ1171174SXQ", "Tavolieri kaynaklı kiralık iddiası Sporx üzerinden aktarıldı.")
    ],
    dims: { demand: 55, trend: 70, turkey: 90, fit: 70, comp: 50, time: 70, links: 70, evergreen: 15 }
  }),
  opportunity({
    id: "soule-besiktas-iddia",
    query: "matias soule beşiktaş",
    suggestedTitle: "Matías Soulé-Beşiktaş iddiası: sağ kanat planındaki yeri",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html",
    team: "Beşiktaş",
    player: "Matías Soulé",
    transferStatus: "rumour",
    publishWindow: "gelişme olursa",
    linkTargets: ["haber/besiktas-transfer-listesi-schick-vlahovic-nunez-iddialari.html", "super-lig-transferleri-2026-2027.html", "besiktas-oyuncu-radari.html"],
    evidence: [
      SERP("https://www.takvim.com.tr/spor/besiktas/2026/08/02/besiktasa-tangocu-kanat-transfer-icin-rota-roma", "Takvim 2 Ağustos'ta rota haberini yayımladı.")
    ],
    dims: { demand: 45, trend: 60, turkey: 90, fit: 65, comp: 55, time: 65, links: 70, evergreen: 15 }
  }),
  opportunity({
    id: "kolo-muani-juventus",
    query: "kolo muani juventus son dakika",
    suggestedTitle: "Kolo Muani-Juventus'ta son durum: sağlık kontrolü aşaması",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/avrupa-futbolundan-kisa-kisa-3-agustos-2026.html",
    player: "Randal Kolo Muani",
    transferStatus: "reported",
    publishWindow: "resmî açıklama gelince haber",
    linkTargets: ["haber/avrupa-futbolundan-kisa-kisa-3-agustos-2026.html", "haberler.html", "super-lig-transferleri-2026-2027.html"],
    evidence: [
      SERP("https://www.sporx.com/randal-kolo-muani-icin-juventus-ta-geri-sayim-SXHBQ1171120SXQ", "Sporx sağlık kontrolü/imza aşamasını aktardı; resmî açıklama bekleniyor.")
    ],
    dims: { demand: 45, trend: 65, turkey: 40, fit: 60, comp: 45, time: 80, links: 60, evergreen: 10 }
  }),
  opportunity({
    id: "dzeko-schalke",
    query: "edin dzeko schalke",
    suggestedTitle: "Edin Džeko-Schalke'de son durum: imza süreci",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/avrupa-futbolundan-kisa-kisa-3-agustos-2026.html",
    player: "Edin Džeko",
    transferStatus: "reported",
    publishWindow: "resmî açıklama gelince haber",
    linkTargets: ["haber/avrupa-futbolundan-kisa-kisa-3-agustos-2026.html", "haberler.html", "super-lig-transferleri-2026-2027.html"],
    evidence: [
      SERP("https://www.sporx.com/edin-dzeko-imza-atmaya-gitti-SXHBQ1171133SXQ", "Sporx imza yolculuğunu aktardı; eski Fenerbahçeli olduğu için TR ilgisi yüksek.")
    ],
    dims: { demand: 45, trend: 60, turkey: 60, fit: 60, comp: 50, time: 80, links: 60, evergreen: 10 }
  }),
  opportunity({
    id: "transfer-donemi-kapanis",
    query: "transfer dönemi ne zaman bitiyor 2026",
    suggestedTitle: "Transfer dönemi ne zaman bitiyor? 2026 yaz penceresi kapanış tarihleri",
    contentType: "update-existing",
    classifications: ["informational", "evergreen"],
    decision: "update",
    existingPage: "transfer-sezonu-ne-zaman-bitiyor.html",
    team: "Süper Lig",
    publishWindow: "2026-08-04 (mevcut sayfa tazelenecek)",
    linkTargets: ["transfer-sezonu-ne-zaman-bitiyor.html", "super-lig-transferleri-2026-2027.html", "super-lig-fikstur.html"],
    evidence: [
      SITE("transfer-sezonu-ne-zaman-bitiyor.html sayfası mevcut — yeni sayfa açmak kanibalizasyon olur; güncelleme kararı."),
      MR("https://www.espn.com/soccer/story/_/id/48944912/premier-league-efl-summer-transfer-window-2026-dates-does-open-deadline-day", "Premier Lig penceresi 1 Eylül'de kapanıyor (ESPN).")
    ],
    dims: { demand: 60, trend: 55, turkey: 85, fit: 90, comp: 45, time: 70, links: 80, evergreen: 55 }
  }),
  opportunity({
    id: "salah-maasi-sorgusu",
    query: "salah maaşı ne kadar",
    suggestedTitle: "Salah'ın maaşı ne kadar? Trabzonspor iddiasındaki rakamların kaynağı",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "mohamed-salah-trabzonspor-transfer-son-durum.html",
    player: "Mohamed Salah",
    transferStatus: "rumour",
    publishWindow: "merkez sayfada bölüm",
    linkTargets: ["haber/mohamed-salah-trabzonspor-transferi-resmen-aciklandi.html", "super-lig-transferleri-2026-2027.html", "trabzonspor-form-durumu.html"],
    evidence: [
      SERP("https://www.hurriyet.com.tr/sporarena/ertugrul-dogandan-salah-aciklamasi-su-anda-bir-anlasma-yok-43259784", "Maaş rakamı iddiası (17M€) tüm büyük yayınlarda dolaşıyor; kaynağı ve doğrulanmadığı merkez sayfada açıklanır.")
    ],
    dims: { demand: 60, trend: 75, turkey: 95, fit: 75, comp: 45, time: 80, links: 70, evergreen: 15 }
  }),
  opportunity({
    id: "osimhen-kac-gol",
    query: "osimhen galatasaray kaç gol attı",
    suggestedTitle: "Osimhen Galatasaray'da kaç gol attı? Sezon sezon istatistikler",
    contentType: "update-existing",
    classifications: ["informational"],
    decision: "update",
    existingPage: "victor-osimhen-transfer-son-durum.html",
    player: "Victor Osimhen",
    publishWindow: "merkez sayfada bölüm",
    linkTargets: ["haber/galatasaray-osimhen-premier-league-ilgisi-iddialari.html", "galatasaray-oyuncu-radari.html", "gol-kralligi.html"],
    evidence: [
      SERP("https://www.sporx.com/tottenham-osimhen-icin-devrede-SXHBQ1171081SXQ", "74 maç 59 gol istatistiği basında dolaşıyor; istatistik bölümü merkez sayfada yer alır.")
    ],
    dims: { demand: 55, trend: 60, turkey: 95, fit: 80, comp: 50, time: 60, links: 75, evergreen: 30 }
  }),
  opportunity({
    id: "trossard-besiktas-profil",
    query: "leandro trossard beşiktaş",
    suggestedTitle: "Trossard Beşiktaş'ta: doğrulanmış transferin detayları",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "super-lig-transferleri-2026-2027.html",
    team: "Beşiktaş",
    player: "Leandro Trossard",
    transferStatus: "confirmed",
    publishWindow: "mevcut sayfada bölüm güçlendirme",
    linkTargets: ["super-lig-transferleri-2026-2027.html", "besiktas-oyuncu-radari.html", "besiktas-form-durumu.html"],
    evidence: [
      TRF("Doğrulanmış kayıt: Arsenal → Beşiktaş, 15 Temmuz, bonservis.")
    ],
    dims: { demand: 45, trend: 35, turkey: 95, fit: 85, comp: 55, time: 40, links: 80, evergreen: 30 }
  }),
  opportunity({
    id: "onana-trabzonspor-profil",
    query: "andre onana trabzonspor",
    suggestedTitle: "Onana Trabzonspor'da: kiralık transferin kapsamı",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "super-lig-transferleri-2026-2027.html",
    team: "Trabzonspor",
    player: "Andre Onana",
    transferStatus: "confirmed",
    publishWindow: "mevcut sayfada bölüm güçlendirme",
    linkTargets: ["super-lig-transferleri-2026-2027.html", "trabzonspor-oyuncu-radari.html", "trabzonspor-form-durumu.html"],
    evidence: [
      TRF("Doğrulanmış kayıt: Manchester United → Trabzonspor, 3 Temmuz, kiralık.")
    ],
    dims: { demand: 50, trend: 35, turkey: 95, fit: 85, comp: 55, time: 40, links: 80, evergreen: 30 }
  }),
  opportunity({
    id: "greenwood-fb-profil",
    query: "mason greenwood fenerbahçe",
    suggestedTitle: "Greenwood Fenerbahçe'de: transferin doğrulanmış detayları",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "super-lig-transferleri-2026-2027.html",
    team: "Fenerbahçe",
    player: "Mason Greenwood",
    transferStatus: "confirmed",
    publishWindow: "mevcut sayfada bölüm güçlendirme",
    linkTargets: ["super-lig-transferleri-2026-2027.html", "fenerbahce-oyuncu-radari.html", "fenerbahce-form-durumu.html"],
    evidence: [
      TRF("Doğrulanmış kayıt: Olympique Marsilya → Fenerbahçe, 14 Temmuz, bonservis.")
    ],
    dims: { demand: 50, trend: 35, turkey: 95, fit: 85, comp: 55, time: 40, links: 80, evergreen: 30 }
  }),
  opportunity({
    id: "ts-nwaiwu-sorgusu",
    query: "nwaiwu trabzonspor ayrılıyor mu",
    suggestedTitle: "Nwaiwu Trabzonspor'dan ayrılıyor mu? Başkanın açıklaması",
    contentType: "update-existing",
    classifications: ["transfer-intent", "informational"],
    decision: "update",
    existingPage: "haber/trabzonspor-ertugrul-dogan-salah-transfer-aciklamasi.html",
    team: "Trabzonspor",
    player: "Chibuike Nwaiwu",
    transferStatus: "denied",
    publishWindow: "gelişme olursa",
    linkTargets: ["haber/trabzonspor-ertugrul-dogan-salah-transfer-aciklamasi.html", "trabzonspor-oyuncu-radari.html", "super-lig-transferleri-2026-2027.html"],
    evidence: [
      NEWS("trabzonspor-ertugrul-dogan-salah-transfer-aciklamasi", "Doğan: beklenen seviyede teklif gelmedi, satış düşünülmüyor — kayıtlı açıklama.")
    ],
    dims: { demand: 35, trend: 40, turkey: 95, fit: 70, comp: 60, time: 55, links: 65, evergreen: 10 }
  }),

  // ── BİLGİ / EVERGREEN FIRSATLARI ─────────────────────────────────────────
  opportunity({
    id: "sampiyonlar-ligi-eleme-format",
    query: "şampiyonlar ligi eleme turları nasıl işliyor",
    suggestedTitle: "Şampiyonlar Ligi eleme turları: sistem nasıl işliyor?",
    contentType: "update-existing",
    classifications: ["evergreen", "informational"],
    decision: "update",
    existingPage: "sampiyonlar-ligi-on-eleme-maclari.html",
    team: "Fenerbahçe",
    publishWindow: "2026-08-04 (mevcut sayfa güçlendirilecek)",
    linkTargets: ["sampiyonlar-ligi-on-eleme-maclari.html", "fenerbahce-avrupa-maclari.html", "uefa-ulke-puani-siralamasi.html"],
    evidence: [
      SITE("sampiyonlar-ligi-on-eleme-maclari.html mevcut ve eleme yolunu anlatıyor; format bölümü genişletilir."),
      FIX("FB'nin 3. eleme maçı bu hafta — format sorusu tam şimdi soruluyor.")
    ],
    dims: { demand: 50, trend: 55, turkey: 85, fit: 85, comp: 55, time: 50, links: 80, evergreen: 80 }
  }),
  opportunity({
    id: "uefa-ulke-puani",
    query: "uefa ülke puanı sıralaması türkiye",
    suggestedTitle: "UEFA ülke puanında Türkiye kaçıncı sırada?",
    contentType: "update-existing",
    classifications: ["evergreen", "informational"],
    decision: "update",
    existingPage: "uefa-ulke-puani-siralamasi.html",
    team: "Süper Lig",
    publishWindow: "eleme haftalarında güncel tutulacak",
    linkTargets: ["uefa-ulke-puani-siralamasi.html", "fenerbahce-avrupa-maclari.html", "canli-skor.html"],
    evidence: [
      SITE("uefa-ulke-puani-siralamasi.html yayında; eleme haftaları sorgu tepe dönemi."),
      FIX("İki temsilci bu hafta Avrupa'da — ülke puanı bağlamı sıcak.")
    ],
    dims: { demand: 50, trend: 55, turkey: 95, fit: 90, comp: 50, time: 55, links: 80, evergreen: 70 }
  }),
  opportunity({
    id: "puan-durumu-sorgusu",
    query: "süper lig puan durumu",
    suggestedTitle: "Süper Lig puan durumu (2026-27)",
    contentType: "update-existing",
    classifications: ["informational", "commercial-potential", "evergreen"],
    decision: "update",
    existingPage: "puan-durumu.html",
    team: "Süper Lig",
    publishWindow: "sezonla birlikte sürekli",
    linkTargets: ["puan-durumu.html", "super-lig-fikstur.html", "mac-sonuclari.html"],
    evidence: [
      SITE("puan-durumu.html mevcut ana yüzey; sezon başlayınca sorgu hacmi ligle birlikte döner."),
      LIG("Sezon 14 Ağustos'ta başlıyor — sayfanın 2026-27 tablosuna hazır olması gerekiyor.")
    ],
    dims: { demand: 85, trend: 55, turkey: 100, fit: 95, comp: 25, time: 70, links: 90, evergreen: 75 }
  }),
  opportunity({
    id: "fikstur-sorgusu",
    query: "süper lig fikstürü 2026 2027",
    suggestedTitle: "Süper Lig 2026-27 fikstürü: hafta hafta program",
    contentType: "update-existing",
    classifications: ["informational", "evergreen"],
    decision: "update",
    existingPage: "super-lig-fikstur.html",
    team: "Süper Lig",
    publishWindow: "TFF saat atamalarıyla sürekli",
    linkTargets: ["super-lig-fikstur.html", "puan-durumu.html", "bugunun-maclari.html"],
    evidence: [
      SITE("super-lig-fikstur.html yayında ve onaylı eşleşmeleri gösteriyor."),
      SERP("https://www.hurriyet.com.tr/sporarena/live-super-lig-fikstur-cekimi-basladi-2026-2027-super-lig-fikstur-cekimi-43233953", "Fikstür sorgusu büyük yayınlarda canlı takip edildi.")
    ],
    dims: { demand: 75, trend: 60, turkey: 100, fit: 95, comp: 30, time: 65, links: 90, evergreen: 70 }
  }),
  opportunity({
    id: "gol-kralligi-sorgusu",
    query: "süper lig gol krallığı 2026 27",
    suggestedTitle: "Süper Lig gol krallığı: sezonun golcü sıralaması",
    contentType: "update-existing",
    classifications: ["informational", "evergreen"],
    decision: "update",
    existingPage: "gol-kralligi.html",
    team: "Süper Lig",
    publishWindow: "sezonla birlikte",
    linkTargets: ["gol-kralligi.html", "oyuncu-liderleri.html", "puan-durumu.html"],
    evidence: [
      SITE("gol-kralligi.html mevcut; sezon başında sıfırlanmış tabloyla hazır olmalı.")
    ],
    dims: { demand: 55, trend: 35, turkey: 100, fit: 90, comp: 40, time: 45, links: 85, evergreen: 70 }
  }),
  opportunity({
    id: "kadikoy-avrupa-gecesi-kosesi",
    query: "fenerbahçe şampiyonlar ligi yorum",
    suggestedTitle: "Kadıköy'de Avrupa gecesi: Fenerbahçe'nin eleme matematiği (köşe yazısı)",
    contentType: "column",
    classifications: ["opinion", "match-intent"],
    decision: "new",
    team: "Fenerbahçe",
    publishWindow: "2026-08-04",
    linkTargets: ["kose-yazilari.html", "fenerbahce-avrupa-maclari.html", "haber/fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu.html"],
    evidence: [
      NEWS("fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu", "Maç önü verisi hazır; köşe yazısı format gereği tez + analiz ister."),
      SITE("kose-yazilari/ hattı ve yazar sayfaları mevcut.")
    ],
    dims: { demand: 45, trend: 55, turkey: 95, fit: 80, comp: 60, time: 70, links: 75, evergreen: 20 }
  }),
  opportunity({
    id: "transfer-verimliligi-kosesi",
    query: "süper lig transfer politikası analiz",
    suggestedTitle: "Bütçe makası ve akıllı transfer: Anadolu kulüplerinin tek yolu (köşe yazısı)",
    contentType: "column",
    classifications: ["opinion", "evergreen"],
    decision: "new",
    team: "Süper Lig",
    publishWindow: "2026-08-05",
    linkTargets: ["kose-yazilari.html", "haber/alanyaspor-joao-pereira-super-lig-makas-aciklamasi.html", "super-lig-transferleri-2026-2027.html"],
    evidence: [
      NEWS("alanyaspor-joao-pereira-super-lig-makas-aciklamasi", "Pereira'nın 'makas çok fazla' açıklaması tez için kaynaklı zemin."),
      TRF("Doğrulanmış transfer hareketleri bütçe analizine veri sağlıyor.")
    ],
    dims: { demand: 35, trend: 40, turkey: 90, fit: 80, comp: 65, time: 40, links: 75, evergreen: 60 }
  }),
  opportunity({
    id: "ts-kadro-analiz-kosesi",
    query: "trabzonspor kadro analizi 2026",
    suggestedTitle: "Onana'dan Muçi'ye: Trabzonspor'un sessiz kadro inşası (köşe yazısı)",
    contentType: "column",
    classifications: ["opinion", "informational"],
    decision: "new",
    team: "Trabzonspor",
    publishWindow: "2026-08-06",
    linkTargets: ["kose-yazilari.html", "trabzonspor-oyuncu-radari.html", "haber/trabzonspor-udinese-hazirlik-maci-1-0.html"],
    evidence: [
      TRF("Doğrulanmış TS transferleri (Onana, Özkaçar, Akaydın, Malinovskyi) analiz zemini."),
      NEWS("trabzonspor-udinese-hazirlik-maci-1-0", "Kamp kapanış galibiyeti güncel bağlam.")
    ],
    dims: { demand: 35, trend: 40, turkey: 95, fit: 80, comp: 65, time: 45, links: 75, evergreen: 45 }
  }),
  opportunity({
    id: "sakat-cezali-yuzeyi",
    query: "sakat ve cezalı oyuncular süper lig",
    suggestedTitle: "Süper Lig sakat ve cezalı oyuncular listesi (haftalık)",
    contentType: "update-existing",
    classifications: ["informational", "match-intent"],
    decision: "update",
    existingPage: "super-lig-oyuncu-radari.html",
    team: "Süper Lig",
    publishWindow: "lig başlayınca haftalık",
    linkTargets: ["super-lig-oyuncu-radari.html", "oyuncu-radari.html", "bugunun-maclari.html"],
    evidence: [
      SITE("squad-statuses verisi mevcut; doğrulanmış sakatlık/ceza kaydı olmadan liste YAYIMLANMAZ — veri hattı kurulunca yüzey açılır.")
    ],
    dims: { demand: 60, trend: 40, turkey: 100, fit: 70, comp: 45, time: 60, links: 80, evergreen: 55 }
  }),
  opportunity({
    id: "muhtemel-11-yuzeyi",
    query: "muhtemel 11 süper lig",
    suggestedTitle: "Muhtemel 11'ler: hafta hafta tahmini kadrolar",
    contentType: "update-existing",
    classifications: ["match-intent", "informational"],
    decision: "update",
    existingPage: "mac-merkezi.html",
    team: "Süper Lig",
    publishWindow: "lig başlayınca maç günleri",
    linkTargets: ["mac-merkezi.html", "bugunun-maclari.html", "oyuncu-radari.html"],
    evidence: [
      SITE("Resmî 11 entegrasyonu mevcut (docs/official-lineup-integration.md); muhtemel 11 ancak kaynaklı kadro verisiyle yayımlanır.")
    ],
    dims: { demand: 70, trend: 45, turkey: 100, fit: 75, comp: 40, time: 70, links: 80, evergreen: 40 }
  }),
  opportunity({
    id: "fb-avrupa-yolu-sayfasi",
    query: "fenerbahçe avrupa maçları 2026",
    suggestedTitle: "Fenerbahçe'nin Avrupa yolu: eleme takvimi ve sonuçlar",
    contentType: "update-existing",
    classifications: ["match-intent", "informational"],
    decision: "update",
    existingPage: "fenerbahce-avrupa-maclari.html",
    team: "Fenerbahçe",
    publishWindow: "her eleme maçından sonra",
    linkTargets: ["fenerbahce-avrupa-maclari.html", "canli-skor.html", "haber/fenerbahce-sturm-graz-sampiyonlar-ligi-mac-onu.html"],
    evidence: [
      SITE("fenerbahce-avrupa-maclari.html yayında; Górnik rövanş sonucu ve Sturm eşleşmesiyle güncellenmeli."),
      FIX("Sturm Graz maçı 5 Ağustos'ta takvimde.")
    ],
    dims: { demand: 55, trend: 60, turkey: 100, fit: 95, comp: 45, time: 75, links: 85, evergreen: 30 }
  }),
  opportunity({
    id: "gunun-maclari-yuzeyi",
    query: "bugün hangi maçlar var",
    suggestedTitle: "Bugünün maçları: gün gün program ve yayın akışı",
    contentType: "update-existing",
    classifications: ["match-intent", "commercial-potential"],
    decision: "update",
    existingPage: "bugunun-maclari.html",
    team: "Süper Lig",
    publishWindow: "her gün",
    linkTargets: ["bugunun-maclari.html", "canli-skor.html", "super-lig-fikstur.html"],
    evidence: [
      SITE("bugunun-maclari.html sağlayıcı beslemeli; Avrupa eleme haftasında öne çıkarılacak."),
      FIX("5-6 Ağustos temsilci maçları programda.")
    ],
    dims: { demand: 75, trend: 50, turkey: 95, fit: 95, comp: 30, time: 85, links: 90, evergreen: 50 }
  }),
  opportunity({
    id: "gs-teknik-direktor-sorgusu",
    query: "galatasaray teknik direktörü kim",
    suggestedTitle: "Galatasaray'ın teknik direktörü kim? Teknik heyet dosyası",
    contentType: "qa",
    classifications: ["informational", "evergreen"],
    decision: "new",
    team: "Galatasaray",
    publishWindow: "kadro/heyet verisi doğrulanınca",
    linkTargets: ["galatasaray-form-durumu.html", "takimlar.html", "galatasaray-oyuncu-radari.html"],
    evidence: [
      SITE("Takım sayfaları mevcut ama teknik heyet bilgisi eksik — içerik açığı; yayın için doğrulanmış heyet verisi şart (şu an eksik).")
    ],
    dims: { demand: 45, trend: 25, turkey: 100, fit: 70, comp: 55, time: 30, links: 75, evergreen: 65 }
  }),
  opportunity({
    id: "fb-kante-durumu",
    query: "kante fenerbahçe kadrosunda mı",
    suggestedTitle: "Kanté Fenerbahçe kadrosunda mı? Doğrulanmış kadro durumu",
    contentType: "qa",
    classifications: ["informational"],
    decision: "new",
    team: "Fenerbahçe",
    player: "N'Golo Kanté",
    publishWindow: "kadro verisi doğrulanınca",
    linkTargets: ["fenerbahce-oyuncu-radari.html", "super-lig-transferleri-2026-2027.html", "fenerbahce-form-durumu.html"],
    evidence: [
      TRF("Doğrulanmış kayıt: Kanté Şubat 2026'da Fenerbahçe'ye transfer oldu; 'kadroda mı' sorgusunun zemini.")
    ],
    dims: { demand: 40, trend: 30, turkey: 95, fit: 75, comp: 60, time: 35, links: 75, evergreen: 40 }
  }),
  opportunity({
    id: "icardi-nereye",
    query: "icardi hangi takımda",
    suggestedTitle: "Icardi hangi takımda? Galatasaray sonrası son durum",
    contentType: "qa",
    classifications: ["informational", "transfer-intent"],
    decision: "new",
    team: "Galatasaray",
    player: "Mauro Icardi",
    transferStatus: "confirmed",
    publishWindow: "2026-08-08",
    linkTargets: ["super-lig-transferleri-2026-2027.html", "galatasaray-form-durumu.html", "galatasaray-oyuncu-radari.html"],
    evidence: [
      TRF("Doğrulanmış kayıt: Icardi'nin Galatasaray sözleşmesi 16 Temmuz'da sona erdi (serbest oyuncu)."),
      SITE("Oyuncu profili sayfası mevcut; 'hangi takımda' cevabı doğrulanmış kayıtla verilebilir.")
    ],
    dims: { demand: 50, trend: 40, turkey: 95, fit: 80, comp: 50, time: 45, links: 75, evergreen: 30 }
  }),
  opportunity({
    id: "rizespor-pyramids-rehberi",
    query: "rizespor pyramids maçı ne zaman",
    suggestedTitle: "Çaykur Rizespor-Pyramids hazırlık maçı ne zaman?",
    contentType: "quick-news",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Çaykur Rizespor",
    publishWindow: "2026-08-07",
    linkTargets: ["bugunun-maclari.html", "takimlar.html", "super-lig-fikstur.html"],
    evidence: [
      FIX("Sağlayıcı takviminde 8 Ağustos Çaykur Rizespor-Pyramids kaydı var; saat doğrulanınca yayımlanır.")
    ],
    dims: { demand: 30, trend: 40, turkey: 90, fit: 70, comp: 65, time: 75, links: 65, evergreen: 5 }
  }),
  opportunity({
    id: "premier-lig-acilis",
    query: "premier lig ne zaman başlıyor",
    suggestedTitle: "Premier Lig ne zaman başlıyor? 2026-27 sezon takvimi",
    contentType: "qa",
    classifications: ["informational"],
    decision: "new",
    team: "Dünya Futbolu",
    publishWindow: "2026-08-17 (açılış haftası öncesi)",
    linkTargets: ["haber/avrupa-futbolundan-kisa-kisa-3-agustos-2026.html", "haberler.html", "canli-skor.html"],
    evidence: [
      MR("https://www.espn.com/soccer/story/_/id/48944912/premier-league-efl-summer-transfer-window-2026-dates-does-open-deadline-day", "ESPN: sezon 21 Ağustos'ta başlıyor, pencere 1 Eylül'de kapanıyor.")
    ],
    dims: { demand: 50, trend: 45, turkey: 55, fit: 60, comp: 40, time: 60, links: 60, evergreen: 30 }
  }),
  opportunity({
    id: "samsunspor-goztepe-rehberi",
    query: "samsunspor göztepe maçı ne zaman",
    suggestedTitle: "Samsunspor-Göztepe maçı ne zaman, saat kaçta?",
    contentType: "match-guide",
    classifications: ["match-intent", "informational"],
    decision: "new",
    team: "Samsunspor",
    publishWindow: "2026-08-14",
    linkTargets: ["super-lig-fikstur.html", "takimlar.html", "canli-skor.html"],
    evidence: [
      LIG("Doğrulanmış eşleşme: 1. hafta kapanışı, 17 Ağustos 21.30."),
      MR("https://www.ntv.com.tr/sporskor/galeri-super-lig-baslangic-tarihi-2026-2027-sezonu-super-lig-ne-zaman-baslayacak-iste-ilk-hafta-mac-programi-1732558", "İlk hafta programı basında yayımlandı.")
    ],
    dims: { demand: 35, trend: 35, turkey: 95, fit: 80, comp: 60, time: 55, links: 75, evergreen: 5 }
  }),
  opportunity({
    id: "fb-bjk-derbi-erken",
    query: "fenerbahçe beşiktaş derbisi ne zaman",
    suggestedTitle: "Fenerbahçe-Beşiktaş derbisi ne zaman? 4. hafta programı",
    contentType: "update-existing",
    classifications: ["match-intent", "informational"],
    decision: "update",
    existingPage: "super-lig-derbi-takvimi-2026-2027.html",
    team: "Süper Lig",
    publishWindow: "TFF saat ataması gelince",
    linkTargets: ["super-lig-derbi-takvimi-2026-2027.html", "derbi-radari.html", "super-lig-fikstur.html"],
    evidence: [
      MR("https://www.milliyet.com.tr/skorer/live-super-ligde-2026-2027-sezonu-fiksturu-cekildi-derbi-tarihleri-ve-mac-programlari-belli-oldu-7620103", "Derbi 4. haftada; kesin tarih TFF atamasıyla netleşecek — atama gelmeden saat yazılmaz.")
    ],
    dims: { demand: 55, trend: 35, turkey: 100, fit: 85, comp: 50, time: 45, links: 80, evergreen: 25 }
  }),
  opportunity({
    id: "kocaelispor-yukselen",
    query: "kocaelispor süper lig kadrosu",
    suggestedTitle: "Süper Lig'e dönen Kocaelispor: kadro ve sezon beklentisi",
    contentType: "team-file",
    classifications: ["informational", "evergreen"],
    decision: "new",
    team: "Kocaelispor",
    publishWindow: "2026-08-10 (kadro verisi doğrulanınca)",
    linkTargets: ["takimlar.html", "super-lig-fikstur.html", "puan-durumu.html"],
    evidence: [
      LIG("Kocaelispor 1. haftada Başakşehir deplasmanında — yeni çıkan takımlara sezon başı ilgisi bilinen kalıp; kadro dosyası doğrulanmış veriyle hazırlanır."),
      SITE("Takım sayfası altyapısı mevcut, içerik dosyası eksik.")
    ],
    dims: { demand: 35, trend: 45, turkey: 95, fit: 70, comp: 65, time: 45, links: 70, evergreen: 45 }
  }),
  opportunity({
    id: "genc-oyuncular-dosyasi",
    query: "süper lig genç oyuncular 2026",
    suggestedTitle: "Süper Lig'de sezonun takip edilecek genç oyuncuları",
    contentType: "update-existing",
    classifications: ["informational", "evergreen"],
    decision: "update",
    existingPage: "genc-yetenekler.html",
    team: "Süper Lig",
    publishWindow: "2026-08-11",
    linkTargets: ["genc-yetenekler.html", "yukselen-oyuncular.html", "oyuncu-radari.html"],
    evidence: [
      SITE("genc-yetenekler.html yayında ve oyuncu verisiyle besleniyor; sezon açılışına güncellenmeli.")
    ],
    dims: { demand: 40, trend: 30, turkey: 95, fit: 90, comp: 55, time: 35, links: 85, evergreen: 70 }
  }),
  opportunity({
    id: "mac-tahminleri-yuzeyi",
    query: "süper lig maç tahminleri",
    suggestedTitle: "Süper Lig maç tahminleri: ilk hafta değerlendirmesi",
    contentType: "update-existing",
    classifications: ["match-intent", "commercial-potential"],
    decision: "update",
    existingPage: "bugunku-mac-tahminleri.html",
    team: "Süper Lig",
    publishWindow: "2026-08-13",
    linkTargets: ["bugunku-mac-tahminleri.html", "mac-merkezi.html", "canli-skor.html"],
    evidence: [
      SITE("bugunku-mac-tahminleri.html yayında; ilk hafta tahmin sayfası veriyle güncellenecek.")
    ],
    dims: { demand: 60, trend: 45, turkey: 100, fit: 90, comp: 35, time: 70, links: 85, evergreen: 40 }
  }),
  // ── Kalıcı rehberler (sahip GSC dışa aktarımı, son 3 ay, Web) ────────────
  opportunity({
    id: "avrupa-ligi-ilk-8",
    query: "avrupa ligi nde ilk 8 e girince ne oluyor",
    suggestedTitle: "Avrupa Ligi'nde ilk 8'e girince ne oluyor?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "avrupa-ligi-ilk-8-kurali",
    publishWindow: "2026-11-24",
    linkTargets: ["avrupa-ligi-eleme-sistemi-rehberi.html", "avrupa-liginden-elenince-ne-olur.html", "lig/avrupa-ligi.html"],
    evidence: [
      ev("search-console", "gsc-export:web:last-3-months", "Sahip GSC dışa aktarımı: 'avrupa ligi nde ilk 8 e girince ne oluyor' 323 gösterim; 'avrupa ligi üst tur atlama sistemi' 47 gösterim. Toplam 370.")
    ],
    dims: { demand: 85, trend: 40, turkey: 80, fit: 90, comp: 55, time: 30, links: 90, evergreen: 95 }
  }),
  opportunity({
    id: "avrupa-ligi-elenince",
    query: "avrupa liginden elenince ne olur",
    suggestedTitle: "Avrupa Ligi'nden elenen takım ne olur?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "avrupa-liginden-elenince-ne-olur",
    publishWindow: "2026-11-24",
    linkTargets: ["avrupa-ligi-eleme-sistemi-rehberi.html", "avrupa-ligi-ilk-8-kurali.html", "lig/konferans-ligi.html"],
    evidence: [
      ev("search-console", "gsc-export:web:last-3-months", "Sahip GSC dışa aktarımı: elenince ve play-off elenince sorguları toplam 141 gösterim.")
    ],
    dims: { demand: 60, trend: 30, turkey: 75, fit: 85, comp: 60, time: 25, links: 85, evergreen: 90 }
  }),
  opportunity({
    id: "avrupa-ligi-kac-eleme-turu",
    query: "avrupa ligi kaç eleme turu var",
    suggestedTitle: "Avrupa Ligi'nde kaç eleme turu var?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "avrupa-ligi-kac-eleme-turu",
    publishWindow: "2026-11-24",
    linkTargets: ["avrupa-ligi-eleme-sistemi-rehberi.html", "avrupa-ligi-eleme-maclari-ne-zaman.html", "avrupa-liginden-elenince-ne-olur.html"],
    evidence: [
      ev("search-console", "gsc-export:web:last-3-months", "Sahip GSC dışa aktarımı: kaç eleme turu ve kaç ön eleme sorguları toplam 93 gösterim.")
    ],
    dims: { demand: 50, trend: 25, turkey: 70, fit: 85, comp: 55, time: 20, links: 80, evergreen: 90 }
  }),
  opportunity({
    id: "avrupa-ligi-eleme-ne-zaman",
    query: "uefa avrupa ligi eleme maçları ne zaman",
    suggestedTitle: "UEFA Avrupa Ligi eleme maçları ne zaman?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "avrupa-ligi-eleme-maclari-ne-zaman",
    publishWindow: "2026-11-24",
    linkTargets: ["avrupa-ligi-kac-eleme-turu.html", "avrupa-ligi-eleme-sistemi-rehberi.html", "lig/avrupa-ligi.html"],
    evidence: [
      ev("search-console", "gsc-export:web:last-3-months", "Sahip GSC dışa aktarımı: 'uefa avrupa ligi eleme maçları ne zaman' 71 gösterim."),
      MR("https://www.uefa.com/news-media/news/02a0-1f71bdf70a9a-b6067bd647f2-1000--2026-european-football-calendar-dates-for-all-uefa-competiti/", "UEFA 2026 futbol takvimi eleme turlarının günlerini yayımlar.")
    ],
    dims: { demand: 45, trend: 20, turkey: 65, fit: 80, comp: 55, time: 35, links: 75, evergreen: 70 }
  }),
  opportunity({
    id: "super-lig-kume-dusme-averaj",
    query: "süper lig küme düşme ve averaj kuralları",
    suggestedTitle: "Süper Lig'de küme düşme ve averaj nasıl işler?",
    contentType: "evergreen-guide",
    classifications: ["evergreen", "informational"],
    decision: "new",
    plannedSlug: "super-lig-kume-dusme-ve-averaj",
    publishWindow: "2026-11-24",
    linkTargets: ["super-lig-puan-durumu.html", "puan-durumu.html", "puan-durumu-simulator.html"],
    evidence: [
      MR("https://www.tff.org/Resources/TFF/Documents/STATULER/2026-2027/2026-2027-sezonu-super-lig-musabakalari-statusu.pdf", "2026-2027 Süper Lig statüsü madde 3, son üç sıranın 1. Lig'e düşeceğini yazar. Bu GSC dışa aktarımında gösterim 0.")
    ],
    dims: { demand: 0, trend: 0, turkey: 95, fit: 85, comp: 70, time: 15, links: 75, evergreen: 95 }
  })
];

// Doğrulama + sıralama + öncelik numarası.
const invalid = [];
for (const entry of items) {
  const verdict = validateOpportunity(entry);
  if (!verdict.valid) invalid.push({ id: entry.id, errors: verdict.errors });
}
if (invalid.length) {
  for (const row of invalid) {
    console.error(`[build-search-demand] GEÇERSİZ fırsat ${row.id}: ${row.errors.join("; ")}`);
  }
  process.exit(1);
}

items.sort((left, right) => right.score - left.score);
items.forEach((entry, index) => { entry.priority = index + 1; });

const opportunities = {
  generatedAt: GENERATED_AT,
  note: "Puanlar services/searchDemand.js ile boyutlardan hesaplanır; elle puan yazılamaz. Search Console bağlanınca demand/trend boyutları gerçek gösterim verisiyle yeniden kalibre edilmelidir.",
  dataGaps: [
    "Search Console API bağlı değil — gösterim/tıklama raporları için VERİ YOK (kurulum: docs/search-demand-engine.md).",
    "Site içi arama kayıtları toplanmıyor — site-search kanıtı şu an kullanılamıyor.",
    "Google Trends programatik erişimi kurulmadı — trend kanıtı SERP gözlemi ve yayın yoğunluğuna dayanıyor."
  ],
  items
};

// ── 30 GÜNLÜK İÇERİK TAKVİMİ ────────────────────────────────────────────────
// Fikstür gerçeklerine bağlı: koşullu adımlar "tur geçilirse" diliyle yazılır.
const calendar = {
  generatedAt: GENERATED_AT,
  note: "Takvim doğrulanmış fikstüre dayanır; koşullu satırlar sonuç netleşince kesinleşir. Maç içerik döngüsü: -2 gün rehber, maç günü canlı, +1 saat sonuç, +1 gün analiz.",
  days: [
    { date: "2026-08-03", actions: ["Günün haber paketi + ilk 10 içerik yayında (bu koşu)", "Ticker ve ana sayfa güncel"] },
    { date: "2026-08-04", actions: ["FB-Sturm rehberine muhtemel 11/eksikler güncellemesi (kaynaklı kadro verisi gelirse)", "Köşe: Kadıköy'de Avrupa gecesi", "Salah/Osimhen merkez sayfalarında gün sonu durum kontrolü"] },
    { date: "2026-08-05", actions: ["MAÇ GÜNÜ: FB-Sturm Graz 21.00 — kesin 11 (resmî açıklamayla), canlı skor öne çıkarma", "Maç bitiminde doğrulanmış skorla sonuç haberi + rehberde rövanş bölümü"] },
    { date: "2026-08-06", actions: ["MAÇ GÜNÜ: Hradec Králové-Beşiktaş 20.00 — aynı döngü", "FB-Sturm maç sonrası analiz + oyuncu değerlendirmeleri"] },
    { date: "2026-08-07", actions: ["BJK maç sonrası analiz", "GS-Villarreal hazırlık maçı ön haberi (saat doğrulanırsa)"] },
    { date: "2026-08-08", actions: ["GS-Villarreal ve Rizespor-Pyramids hazırlık maçları takip + sonuç", "Haftalık transfer durum turu: Salah, Osimhen, Vlahovic merkezleri"] },
    { date: "2026-08-09", actions: ["Hazırlık maçları özet + lig açılışına sayım içeriği", "İç bağlantı denetimi: yeni sayfalar yetim mi?"] },
    { date: "2026-08-10", actions: ["Kocaelispor takım dosyası (kadro verisi doğrulanırsa)", "Sezon önü ekspres: 18 takım tek sayfa güncellemesi"] },
    { date: "2026-08-11", actions: ["MAÇ GÜNÜ: Sturm Graz-Fenerbahçe rövanşı — rehber güncel, canlı, sonuç", "Tur geçilirse: play-off rakibi ve tarih sayfası AYNI GECE"] },
    { date: "2026-08-12", actions: ["FB rövanş analizi", "Gençlerbirliği-FB ve Kasımpaşa-TS açılış rehberleri yayına"] },
    { date: "2026-08-13", actions: ["MAÇ GÜNÜ: Beşiktaş-Hradec rövanşı Tüpraş'ta — tam döngü", "İlk hafta tahmin sayfası güncellemesi"] },
    { date: "2026-08-14", actions: ["SEZON AÇILIŞI: Galatasaray-Çorum FK 21.30 — rehber tepe trafik penceresi, canlı skor, sonuç + analiz", "Puan durumu 2026-27 tablosu canlı"] },
    { date: "2026-08-15", actions: ["4 lig maçı (Konyaspor-Rize, Kasımpaşa-TS, Gaziantep-Alanya, Gençlerbirliği-FB) — maç günü döngüsü", "Gol krallığı tablosu ilk verilerle"] },
    { date: "2026-08-16", actions: ["3 lig maçı (Başakşehir-Kocaeli, Amed-Erzurum, BJK-Eyüpspor) — döngü", "Hafta içi Avrupa play-off programı netleşirse duyuru"] },
    { date: "2026-08-17", actions: ["Samsunspor-Göztepe ile hafta kapanışı", "1. hafta panorama: sonuçlar, öne çıkanlar, puan durumu etkisi"] },
    { date: "2026-08-18", actions: ["1. hafta sonrası oyuncu radarı güncellemesi", "2. hafta rehberleri hazırlığı (TFF saat atamaları)"] },
    { date: "2026-08-19", actions: ["2. hafta maç rehberleri yayına (FB-Konyaspor, Erzurum-GS, Alanya-BJK, TS-Başakşehir)"] },
    { date: "2026-08-20", actions: ["Avrupa play-off haftası önizlemesi (temsilci kaldıysa)", "Transfer merkezlerinde durum turu"] },
    { date: "2026-08-21", actions: ["Premier Lig 2026-27 açılışı — Avrupa'dan kısa kısa güncellemesi", "Türk oyuncuların Avrupa'daki ilk haftası izleme listesi"] },
    { date: "2026-08-22", actions: ["2. hafta cumartesi maçları — döngü"] },
    { date: "2026-08-23", actions: ["2. hafta pazar maçları — döngü", "Hafta panoraması"] },
    { date: "2026-08-24", actions: ["2. hafta kapanışı + momentum güncellemesi"] },
    { date: "2026-08-25", actions: ["ŞL play-off ilk maç penceresi (FB turu geçtiyse) — tam maç döngüsü", "Değilse: 3. hafta erken rehberleri"] },
    { date: "2026-08-26", actions: ["ŞL play-off penceresi devam — lig aşaması senaryo sayfası hazır"] },
    { date: "2026-08-27", actions: ["AL play-off penceresi (BJK turu geçtiyse) — tam döngü", "Ülke puanı sayfası güncellemesi"] },
    { date: "2026-08-28", actions: ["Avrupa haftası panorama + kura/lig aşaması takvim içerikleri (netleşen veriyle)"] },
    { date: "2026-08-29", actions: ["3. hafta cumartesi maçları — döngü", "Transfer kapanış haftası: merkez sayfalara 'son 72 saat' bölümü"] },
    { date: "2026-08-30", actions: ["3. hafta pazar maçları — döngü"] },
    { date: "2026-08-31", actions: ["3. hafta kapanışı", "Transfer kapanışına son gün önizlemesi: doğrulanmış işlemler tablosu"] },
    { date: "2026-09-01", actions: ["TRANSFER KAPANIŞI (İngiltere 23.00): gece boyu doğrulanmış işlem akışı", "Kapanış bilançosu içeriği ertesi sabah"] }
  ]
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "opportunities.json"), `${JSON.stringify(opportunities, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outDir, "calendar.json"), `${JSON.stringify(calendar, null, 2)}\n`, "utf8");

const high = items.filter((entry) => entry.score >= 75).length;
console.log(`[build-search-demand] ${items.length} fırsat yazıldı (${high} yüksek öncelik ≥75, ${calendar.days.length} günlük takvim).`);
