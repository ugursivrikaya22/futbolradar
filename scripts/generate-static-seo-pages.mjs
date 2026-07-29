import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const today = "2026-07-22";

/**
 * TAZELİK SİNYALİ SAYFANIN RİTMİNE UYMALI.
 *
 * Site haritası bugüne kadar 3281 URL'nin TAMAMINA `weekly` yazıyordu —
 * canlı skor sayfasına da. Dakikada değişen bir sayfaya "haftada bir
 * değişir" demek, tarayıcıya tam da gelmemesi gereken zamanı söylemek
 * oluyor: canlı skor aramalarında görünürlük tam olarak tazelikten
 * geliyor ve sinyal onu baltalıyordu.
 *
 * Sınıflandırma sayfanın GERÇEK ritmine göre. Uydurma bir "always"
 * yazmıyoruz: yalnızca sağlayıcıdan sürekli beslenen sayfalar `hourly`,
 * günlük programa bağlı olanlar `daily`, kalanı `weekly`.
 */
const LIVE_PAGES = new Set([
  "canli-skor.html",
  "bugunun-maclari.html"
]);

const DAILY_PAGES = new Set([
  "index.html",
  "gunluk-mac-analizleri.html",
  "super-lig-mac-analizleri.html",
  "mac-merkezi.html",
  "haftanin-maclari.html",
  "bugunku-mac-tahminleri.html",
  "gunun-radar-bulteni.html",
  "super-lig-fikstur.html",
  "puan-durumu.html",
  "momentum.html"
]);

function changeFrequency(file) {
  if (LIVE_PAGES.has(file)) return "hourly";
  if (DAILY_PAGES.has(file)) return "daily";
  return "weekly";
}

const nav = `
    ${siteHeader({ base: "./" })}`;

const footer = `
    ${siteFooter({ base: "./" })}`;

const seoPages = [
  /**
   * MAÇ ARAMA NİYETİ SAYFALARI.
   *
   * "Bugünün maçları", "canlı skor" ve "maç analizi" aramaları sitenin en
   * yüksek hacimli giriş noktaları; ama iki niyet için hiç sayfa yoktu:
   * "günlük maç analizleri" ve "Süper Lig maç analizleri". Bu iki sayfa o
   * boşluğu kapatıyor.
   *
   * İçerikleri BURADA üretilmiyor: kabuk burada yazılıyor (başlık, açıklama,
   * canonical, site haritası girdisi), gerçek maç listesi derlemenin ilerleyen
   * adımında `scripts/prerender-core-pages.mjs` tarafından `data-api-target`
   * yuvalarına yazılıyor. Böylece maç verisi tek yerden okunuyor ve bu
   * dosya veri kaynaklarına hiç bağlanmıyor.
   */
  {
    file: "gunluk-mac-analizleri.html",
    title: "Günlük Maç Analizleri | Bugünün Maçları ve Canlı Skor | FutbolRadar",
    description: "Günlük maç analizleri; bugünün maçları, canlı skorlar, başlama saatleri ve her karşılaşmanın form odaklı radar okuması tek sayfada.",
    h1: "Günlük Maç Analizleri",
    lead: "Bugün oynanan ve oynanacak karşılaşmaları saat, durum, skor ve radar sinyaliyle birlikte oku.",
    slot: "daily-analysis-matches",
    slotTitle: "Bugünün maçları ve analiz bağlantıları",
    slotLead: "Canlı maçlar önce; ardından başlama saatine göre günün programı. Doğrulanmamış eşleşme listelenmez.",
    related: [
      ["./bugunun-maclari.html", "Bugünün maçları", "Günün tam programı"],
      ["./canli-skor.html", "Canlı skor", "Devam eden maçların anlık skoru"],
      ["./super-lig-mac-analizleri.html", "Süper Lig", "Lig maçlarının analiz sayfaları"]
    ]
  },
  {
    file: "super-lig-mac-analizleri.html",
    title: "Süper Lig Maç Analizleri | Maç Önü Okuma ve Maç Raporları | FutbolRadar",
    description: "Süper Lig maç analizleri; hafta hafta eşleşmelerin form, kadro ve radar okuması ile tamamlanan karşılaşmaların veri odaklı maç raporları.",
    h1: "Süper Lig Maç Analizleri",
    lead: "Süper Lig eşleşmelerinin maç öncesi radar okumasına ve tamamlanan maçların raporlarına buradan geç.",
    slot: "super-lig-analysis-links",
    slotTitle: "Maç analizi sayfaları",
    slotLead: "Her eşleşmenin kalıcı analiz sayfası; form, kadro durumu ve radar puanı maç yaklaştıkça güncellenir.",
    related: [
      ["./super-lig-fikstur.html", "Fikstür", "Sezonun onaylı eşleşmeleri"],
      ["./super-lig-form-durumu.html", "Takım formu", "18 takımın son maç serisi"],
      ["./mac-merkezi.html", "Maç raporları", "Tamamlanan maçların analizleri"]
    ]
  },
  {
    file: "super-lig-form-durumu.html",
    title: "Süper Lig Form Durumu | Takım Momentum ve Son 5 Maç | FutbolRadar",
    description: "Süper Lig form durumu sayfası; takımların son 5 maç ivmesi, hücum-savunma dengesi ve momentum sinyallerini gösterir.",
    h1: "Süper Lig Form Durumu",
    lead: "Takımların son formunu, momentum eğilimini ve maç önü veri sinyallerini birlikte oku.",
    cards: ["Son 5 maç formu", "Momentum değişimi", "Gol eğilimi"]
  },
  {
    file: "super-lig-momentum-siralamasi.html",
    title: "Süper Lig Momentum Sıralaması | FutbolRadar",
    description: "Süper Lig momentum sıralaması; form puanı, hücum üretimi, savunma dengesi ve trend açıklamasıyla güncellenir.",
    h1: "Süper Lig Momentum Sıralaması",
    lead: "Momentum skoru, son form ve takım dengesinden üretilen FutbolRadar sinyalidir.",
    cards: ["Momentum puanı", "Trend yönü", "Hücum ve savunma"]
  },
  {
    file: "bugunku-mac-tahminleri.html",
    title: "Bugünkü Maç Tahminleri | Momentum ve AI Analiz | FutbolRadar",
    description: "Bugünkü maç tahminleri sayfası; maçları AI tahmin, gol potansiyeli, risk ve momentum farkıyla analiz eder.",
    h1: "Bugünkü Maç Tahminleri",
    lead: "Maçları yalnızca skora göre değil; form, tempo, risk ve gol beklentisine göre değerlendir.",
    cards: ["AI tahmin", "Gol potansiyeli", "Sürpriz riski"]
  },
  {
    file: "super-lig-oyuncu-radari.html",
    title: "Süper Lig Oyuncu Radarı | AI Rating ve Performans | FutbolRadar",
    description: "Süper Lig oyuncu radarı; AI rating, gol tehdidi, yaratıcılık, pres gücü ve form sinyallerine göre oyuncuları listeler.",
    h1: "Süper Lig Oyuncu Radarı",
    lead: "Oyuncuları rating, mevki, takım, dakika ve performans radarına göre keşfet.",
    cards: ["AI rating", "Gol tehdidi", "Pres gücü"]
  },
  {
    file: "galatasaray-oyuncu-radari.html",
    title: "Galatasaray Oyuncu Radarı | Kadro ve AI Rating | FutbolRadar",
    description: "Galatasaray oyuncu radarı; kadro oyuncularını AI rating, form, yaratıcılık ve gol tehdidi metrikleriyle inceler.",
    h1: "Galatasaray Oyuncu Radarı",
    lead: "Galatasaray kadrosundaki oyuncuların form ve radar sinyallerini karşılaştır.",
    cards: ["Kadro oyuncuları", "Form trendi", "Oyuncu profilleri"]
  },
  {
    file: "fenerbahce-oyuncu-radari.html",
    title: "Fenerbahçe Oyuncu Radarı | Kadro ve Performans | FutbolRadar",
    description: "Fenerbahçe oyuncu radarı; oyuncu performansını AI rating, gol tehdidi, yaratıcılık ve pres metrikleriyle gösterir.",
    h1: "Fenerbahçe Oyuncu Radarı",
    lead: "Fenerbahçe oyuncularını güncel takım, mevki ve performans sinyallerine göre incele.",
    cards: ["Kanat üretimi", "AI rating", "Transfer takibi"]
  },
  {
    file: "besiktas-oyuncu-radari.html",
    title: "Beşiktaş Oyuncu Radarı | Kadro ve Form Analizi | FutbolRadar",
    description: "Beşiktaş oyuncu radarı; oyuncuların form, pres, süreklilik ve AI rating sinyallerini veri kartlarıyla sunar.",
    h1: "Beşiktaş Oyuncu Radarı",
    lead: "Beşiktaş kadrosunda yükselen oyuncuları ve form düşüş sinyallerini takip et.",
    cards: ["Pres gücü", "Genç yetenek", "Form değişimi"]
  },
  {
    file: "trabzonspor-oyuncu-radari.html",
    title: "Trabzonspor Oyuncu Radarı | Kadro ve Performans | FutbolRadar",
    description: "Trabzonspor oyuncu radarı; kadro performansını AI rating, mevki, form ve oyuncu trendleriyle analiz eder.",
    h1: "Trabzonspor Oyuncu Radarı",
    lead: "Trabzonspor oyuncu profillerini takım ve mevki bazında değerlendir.",
    cards: ["Takım filtresi", "Mevki analizi", "Oyuncu trendi"]
  },
  {
    file: "galatasaray-form-durumu.html",
    title: "Galatasaray Form Durumu | Momentum ve Son Maçlar | FutbolRadar",
    description: "Galatasaray form durumu; son maç ivmesi, momentum skoru, hücum üretimi ve savunma dengesini özetler.",
    h1: "Galatasaray Form Durumu",
    lead: "Galatasaray'ın güncel momentumunu ve son maç trendini takım radarında oku.",
    cards: ["Momentum yüksek", "Hücum üretimi", "Son form"]
  },
  {
    file: "fenerbahce-form-durumu.html",
    title: "Fenerbahçe Form Durumu | Momentum ve AI Analiz | FutbolRadar",
    description: "Fenerbahçe form durumu; takım momentumu, gol eğilimi, maç önü risk ve son 5 maç sinyalini gösterir.",
    h1: "Fenerbahçe Form Durumu",
    lead: "Fenerbahçe'nin form grafiğini momentum, risk ve hücum üretimiyle birlikte incele.",
    cards: ["Gol eğilimi", "Risk seviyesi", "Son 5 maç"]
  },
  {
    file: "besiktas-form-durumu.html",
    title: "Beşiktaş Form Durumu | Momentum ve Takım Analizi | FutbolRadar",
    description: "Beşiktaş form durumu; takım ivmesi, hücum-savunma dengesi, son maç trendi ve risk sinyallerini analiz eder.",
    h1: "Beşiktaş Form Durumu",
    lead: "Beşiktaş'ın form dalgalanmasını veri kartlarıyla takip et.",
    cards: ["Form dengesi", "Momentum riski", "Savunma sinyali"]
  },
  {
    file: "trabzonspor-form-durumu.html",
    title: "Trabzonspor Form Durumu | Momentum ve Son Maçlar | FutbolRadar",
    description: "Trabzonspor form durumu; son maç performansı, momentum puanı, gol eğilimi ve savunma dengesini gösterir.",
    h1: "Trabzonspor Form Durumu",
    lead: "Trabzonspor'un son maç trendini ve momentum kırılımlarını incele.",
    cards: ["Trend izleme", "Gol üretimi", "Savunma dengesi"]
  }
];

const playerSeoPages = [
  {
    file: "en-iyi-super-lig-oyunculari.html",
    landing: "en-iyi-super-lig-oyunculari",
    title: "En İyi Süper Lig Oyuncuları | AI Rating ve Oyuncu Radarı | FutbolRadar",
    description: "En iyi Süper Lig oyuncularını AI rating, form, potansiyel, piyasa değeri ve oyuncu radar sinyallerine göre karşılaştırın.",
    h1: "En İyi Süper Lig Oyuncuları",
    lead: "Süper Lig oyuncularını AI rating, rol grubu, form, potansiyel ve radar etkisine göre karşılaştır.",
    cards: ["AI rating", "Radar profili", "Oyuncu karşılaştırma"]
  },
  {
    file: "en-iyi-forvetler.html",
    landing: "en-iyi-forvetler",
    title: "En Iyi Forvetler | Gol Tehdidi ve AI Rating | FutbolRadar",
    description: "En iyi forvetler listesi; gol tehdidi, xG, sut hacmi, form ve AI rating sinyalleriyle hazirlanir.",
    h1: "En Iyi Forvetler",
    lead: "Forvet ve kanat oyuncularını gol tehdidi, hücum radarı ve form ivmesiyle oku.",
    cards: ["Gol tehdidi", "Hücum radarı", "Bitiricilik"]
  },
  {
    file: "en-iyi-orta-sahalar.html",
    landing: "en-iyi-orta-sahalar",
    title: "En Iyi Orta Sahalar | Yaraticilik ve Pres Radari | FutbolRadar",
    description: "En iyi orta sahalar; yaratıcılık, pas, pres gücü, form ve AI rating metrikleriyle listelenir.",
    h1: "En Iyi Orta Sahalar",
    lead: "Orta saha oyuncularını yaratıcılık, pres, pas ve süreklilik sinyalleriyle karşılaştır.",
    cards: ["Yaratıcılık", "Pres gücü", "Pas kalitesi"]
  },
  {
    file: "en-iyi-defanslar.html",
    landing: "en-iyi-defanslar",
    title: "En Iyi Defanslar | Savunma Radari | FutbolRadar",
    description: "En iyi defanslar; savunma radarı, süreklilik, disiplin, top kapma ve AI rating sinyalleriyle analiz edilir.",
    h1: "En Iyi Defanslar",
    lead: "Defans oyuncularını savunma etkisi, disiplin, fiziksel süreklilik ve radar skoruyla oku.",
    cards: ["Savunma radari", "Disiplin", "Süreklilik"]
  },
  {
    file: "en-iyi-kaleciler.html",
    landing: "en-iyi-kaleciler",
    title: "En Iyi Kaleciler | Kaleci Performans Radari | FutbolRadar",
    description: "En iyi kaleciler; form, savunma etkisi, veri güveni ve AI rating sinyalleriyle takip edilir.",
    h1: "En Iyi Kaleciler",
    lead: "Kalecileri form, savunma katkısı ve performans radarıyla karşılaştır.",
    cards: ["Kaleci formu", "Savunma etkisi", "Veri güveni"]
  },
  {
    file: "yukselen-oyuncular.html",
    landing: "yukselen-oyuncular",
    title: "Yukselen Oyuncular | Form Artisi ve Scouting Sinyali | FutbolRadar",
    description: "Yükselen oyuncular listesi; form değişimi, trend yönü, dakika artışı ve AI radar sinyalleriyle hazırlanır.",
    h1: "Yükselen Oyuncular",
    lead: "Formu yükselen oyuncuları trend, dakika, potansiyel ve radar metrikleriyle takip et.",
    cards: ["Form artisi", "Trend", "Potansiyel"]
  },
  {
    file: "transfer-radari.html",
    landing: "transfer-radari",
    title: "Transfer Radarı | Güncel Gelen ve Giden Oyuncular | FutbolRadar",
    description: "Transfer Radarı ile Süper Lig takımlarına gelen ve giden oyuncuları, bonservis bilgilerini ve doğrulama tarihlerini takip edin.",
    h1: "Transfer Radarı",
    lead: "Süper Lig'e gelen ve ligden ayrılan oyuncuları; tarih, kulüp ve bonservis ayrımıyla takip et.",
    cards: ["Güncel takım", "Transfer geçmişi", "Veri güveni"]
  },
  {
    file: "genc-yetenekler.html",
    landing: "genc-yetenekler",
    title: "Genc Yetenekler | Potansiyel ve AI Rating | FutbolRadar",
    description: "Genç yetenekler listesi; yaş, potansiyel rating, form, piyasa değeri ve radar sinyallerine göre hazırlanır.",
    h1: "Genç Yetenekler",
    lead: "Genç oyuncuları potansiyel, form ve piyasa değeri radarıyla incele.",
    cards: ["Potansiyel", "Yaş profili", "Piyasa değeri"]
  }
];

const legalPages = [
  {
    file: "veri-notu.html",
    title: "Veri Notu | FutbolRadar",
    description: "FutbolRadar veri notu; canlı veri, doğrulanmış kayıtlar, manuel oyuncu kontrolü ve analiz kapsamını açıklar.",
    h1: "Veri Notu",
    lead: "FutbolRadar verileri farklı kaynaklardan derlenir; canlı veri alınamadığında son doğrulanmış kayıtlar gösterilebilir.",
    cards: ["Canlı veri geçici alınamazsa son doğrulanmış kayıtlar korunur.", "Oyuncu ve transfer bilgilerinde manuel doğrulama uygulanabilir.", "Analizler bilgilendirme amaçlıdır."]
  },
  {
    file: "gizlilik.html",
    title: "Gizlilik | FutbolRadar",
    description: "FutbolRadar gizlilik sayfası; statik site kullanımı, çerez yaklaşımı ve iletişim verisi kapsamını sade şekilde açıklar.",
    h1: "Gizlilik",
    lead: "FutbolRadar, kullanıcı deneyimini sade tutar ve hassas kişisel veri toplamadan veri analiz ekranları sunmayı hedefler.",
    cards: ["Zorunlu olmayan kişisel veri istenmez.", "Teknik trafik ölçümü anonimleştirilebilir.", "İletişim mesajları yalnızca yanıt amacıyla kullanılır."]
  },
  {
    file: "kullanim-sartlari.html",
    title: "Kullanım Şartları | FutbolRadar",
    description: "FutbolRadar kullanım şartları; analiz verilerinin bilgilendirme amacıyla sunulduğunu ve bahis yönlendirmesi olmadığını belirtir.",
    h1: "Kullanım Şartları",
    lead: "FutbolRadar verileri bilgilendirme ve analiz amaçlıdır; sonuç vaadi ya da bahis yönlendirmesi değildir.",
    cards: ["Veriler hata veya gecikme içerebilir.", "Analiz sinyalleri sonuç vaadi taşımaz.", "Kullanıcı kararları kendi sorumluluğundadır."]
  },
  {
    file: "iletisim.html",
    title: "İletişim | FutbolRadar",
    description: "FutbolRadar iletişim sayfası; veri düzeltme, iş birliği ve ürün geri bildirimi için profesyonel iletişim bilgisini sunar.",
    h1: "İletişim",
    lead: "Veri düzeltme, oyuncu bilgisi güncelleme veya iş birliği talepleri için FutbolRadar ekibine ulaş.",
    cards: ["Veri düzeltme talepleri incelenir.", "Oyuncu transfer geri bildirimleri kayda alınır.", "Ürün önerileri geliştirme kuyruğuna aktarılır."]
  },
  {
    file: "hakkinda.html",
    title: "Hakkında | FutbolRadar",
    description: "FutbolRadar hakkında; futbolu canlı skor, momentum, oyuncu radarı ve veri odaklı analizle okuyan platform vizyonunu anlatır.",
    h1: "FutbolRadar Hakkında",
    lead: "FutbolRadar, maçları skorun ötesinde form, momentum, oyuncu performansı ve veri güvenilirliğiyle yorumlar.",
    cards: ["Premium futbol dashboard deneyimi.", "Oyuncu ve takım radarları.", "API destekli veri omurgası."]
  }
];

function cardDescription(card) {
  const key = String(card).toLowerCase();
  if (key.includes("gol") || key.includes("bitiricilik")) {
    return "Gol tehdidi, xG, şut hacmi ve ceza sahası etkisi birlikte okunur.";
  }
  if (key.includes("yaraticilik") || key.includes("pas")) {
    return "Kilit pas, xA, asist ve top kullanımı oyuncunun üretim rolünü açıklar.";
  }
  if (key.includes("savunma") || key.includes("disiplin")) {
    return "Savunma katkısı, kart yükü ve süreklilik skoru birlikte değerlendirilir.";
  }
  if (key.includes("transfer") || key.includes("guncel takim") || key.includes("güncel takım")) {
    return "Güncel takım, eski kulüp ve transfer geçmişi ayrımı korunarak gösterilir.";
  }
  if (key.includes("potansiyel") || key.includes("yas")) {
    return "Yaş profili, gelişim alanı ve potansiyel rating aynı kartta okunur.";
  }
  return "AI rating, form ve radar alt skorları bu segmentteki oyuncuları sıralamak için kullanılır.";
}

function cardsHtml(cards) {
  return cards.map((card) => `<article class="card"><span class="card-kicker">Radar</span><h2>${card}</h2><p>${cardDescription(card)}</p></article>`).join("");
}

function landingControlsHtml(page) {
  if (page.landing !== "transfer-radari") {
    return "";
  }

  return `<section class="transfer-toolbar" aria-label="Transfer Radarı filtreleri">
        <div class="transfer-filter-chips" role="group" aria-label="Hızlı transfer filtreleri">
          <button type="button" data-transfer-filter="all" class="is-active" aria-pressed="true">Tüm transferler</button>
          <button type="button" data-transfer-filter="son-hareket" aria-pressed="false">Son hareket</button>
          <button type="button" data-transfer-filter="eski-kulup" aria-pressed="false">Eski kulüp ayrımı</button>
          <button type="button" data-transfer-filter="riskli-transfer" aria-pressed="false">Riskli takip</button>
          <button type="button" data-transfer-filter="yukselen-deger" aria-pressed="false">Yükselen değer</button>
        </div>
        <div class="filter-group">
          <label for="transfer-team-filter">Takım</label>
          <select id="transfer-team-filter" data-transfer-team-filter></select>
        </div>
        <div class="filter-group">
          <label for="transfer-direction-filter">Hareket yönü</label>
          <select id="transfer-direction-filter" data-transfer-direction-filter disabled>
            <option value="">Tüm hareketler</option>
            <option value="in">Gelenler</option>
            <option value="out">Gidenler</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="transfer-status-filter">Transfer durumu</label>
          <select id="transfer-status-filter" data-transfer-status-filter></select>
        </div>
        <div class="filter-group">
          <label for="transfer-sort">Sırala</label>
          <select id="transfer-sort" data-transfer-sort>
            <option value="updated">En yeni</option>
            <option value="market">Bonservis bedeli</option>
            <option value="rating">Oyuncu adı</option>
            <option value="team">Takım</option>
          </select>
        </div>
      </section>
      <section class="transfer-radar-summary" data-transfer-summary aria-label="Transfer Radarı özeti"></section>`;
}

function landingDescriptionHtml(page) {
  if (page.landing !== "transfer-radari") {
    return "";
  }

  return `\n      <section class="player-filter-note" data-transfer-filter-description>${page.lead}</section>`;
}

function landingExtraLinksHtml(page) {
  if (page.landing !== "en-iyi-super-lig-oyunculari") {
    return "";
  }

  return `<section class="trend-link-grid" aria-label="Oyuncu karşılaştırma bağlantıları">
        <a href="./oyuncu-karsilastirmalari.html"><span>Karşılaştırma</span><strong>Oyuncu karşılaştırmaları</strong><p>Öne çıkan oyuncuları radar ve özellik farklarıyla yan yana incele.</p></a>
        <a href="./oyuncu-radari.html?filter=yukselen"><span>Form</span><strong>Yükselen oyuncular</strong><p>Form değişimi pozitif olan oyuncuları keşfet.</p></a>
        <a href="./genc-yetenekler.html"><span>Potansiyel</span><strong>Genç yetenekler</strong><p>Yaş, potansiyel ve piyasa değeri odağında filtrele.</p></a>
      </section>`;
}

/**
 * Veri yuvası olan sayfaların gövdesi. İçerik derlemenin ilerleyen adımında
 * doldurulur; buraya yazılan boş durum, yuva doldurulamazsa okuyucunun
 * göreceği dürüst karşılıktır — boş bir ızgara değil, sebebini söyleyen bir
 * kart.
 */
function slotSectionHtml(page) {
  if (!page.slot) return "";

  return `<section class="section" aria-labelledby="${page.slot}-title">
        <div class="section-head"><div class="section-title"><span class="section-kicker">FutbolRadar</span><h2 id="${page.slot}-title">${page.slotTitle}</h2><p>${page.slotLead}</p></div></div>
        <div class="matches-grid" data-api-target="${page.slot}" data-static-fallback="true">
          <article class="data-empty" data-card="empty-state"><strong>Doğrulanmış maç kaydı bekleniyor</strong><span>Eşleşmeler doğrulandığı anda saat, durum ve analiz bağlantılarıyla burada listelenecek.</span></article>
        </div>
      </section>`;
}

function relatedLinksHtml(page) {
  if (!Array.isArray(page.related) || !page.related.length) return "";

  return `<section class="trend-link-grid" aria-label="İlgili sayfalar">
        ${page.related.map(([href, label, note]) =>
          `<a href="${href}"><span>${label}</span><strong>${note}</strong></a>`).join("\n        ")}
      </section>`;
}

function pageHtml(page) {
  const url = `${domain}/${page.file}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: page.h1,
        description: page.description,
        url,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
          { "@type": "ListItem", position: 2, name: page.h1, item: url }
        ]
      }
    ]
  };
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${page.title}</title>
    <meta name="description" content="${page.description}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${page.title}" />
    <meta property="og:description" content="${page.description}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${page.title}" />
    <meta name="twitter:description" content="${page.description}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
${nav}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>${page.h1}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">FutbolRadar analiz</span>
            <h1>${page.h1}</h1>
            <p class="lead">${page.lead}</p>
          </div>
          <span class="hero-meta">Veriler periyodik olarak güncellenir</span>
        </div>
      </section>
      ${page.landing ? `<section class="grid three">${cardsHtml(page.cards)}</section>${landingControlsHtml(page)}${landingDescriptionHtml(page)}
      <section class="player-filter-note"><span data-landing-count>Oyuncu listesi hazırlanıyor</span></section>
      <section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="${page.landing}">
        <article class="data-empty" data-card="empty-state"><strong>Oyuncular yükleniyor</strong><span>Doğrulanmış oyuncu profilleri hazırlanıyor.</span></article>
      </section>${landingExtraLinksHtml(page)}` : page.slot
        ? `${slotSectionHtml(page)}\n      ${relatedLinksHtml(page)}`
        : `<section class="grid three">${cardsHtml(page.cards)}</section>`}
      <section class="source-strip" aria-label="İlgili bağlantılar">
        <div><span>İlgili ekran</span><b><a href="./oyuncu-radari.html">Oyuncu Radarı</a></b></div>
        <div><span>Takım verisi</span><b><a href="./momentum.html">Momentum</a></b></div>
        <div><span>Maç verisi</span><b><a href="./bugunun-maclari.html">Bugünkü Maçlar</a></b></div>
      </section>
    </main>
${footer}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

function writePage(page) {
  const html = pageHtml(page);
  fs.writeFileSync(path.join(root, page.file), html, "utf8");
  fs.writeFileSync(path.join(root, "public", page.file), html, "utf8");
}

function generatedComparisonPages() {
  const dir = path.join(root, "karsilastirma");
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .sort()
    .map((file) => `karsilastirma/${file}`);
}

// Every generated player page belongs in the sitemap. Scanning the directory
// keeps it correct as squads grow instead of relying on a hand-kept list.
// Alias files are skipped: they are noindex redirects to the canonical
// profile, and listing a redirect in a sitemap is a crawl error.
function generatedPlayerPages() {
  const dir = path.join(root, "oyuncular");
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".html"))
    .filter((file) => !/content="noindex/.test(fs.readFileSync(path.join(dir, file), "utf8")))
    .sort()
    .map((file) => `oyuncular/${file}`);
}

function sitemapXml(files) {
  const comparisonPages = generatedComparisonPages();
  const playerPages = generatedPlayerPages();
  const core = [
    "index.html",
    "bugunun-maclari.html",
    "super-lig-fikstur.html",
    "canli-skor.html",
    "puan-durumu.html",
    "takimlar.html",
    "oyuncu-radari.html",
    "oyuncu-karsilastirmalari.html",
    "players/position/forvet.html",
    "players/league/super-lig.html",
    "oyuncular/forvetler.html",
    "oyuncular/kaleciler.html",
    "oyuncular/defanslar.html",
    "oyuncular/orta-sahalar.html",
    "oyuncular/genc-yetenekler.html",
    "oyuncular/en-iyi-oyuncular.html",
    ...playerPages,
    ...comparisonPages,
    "momentum.html",
    "analizler.html",
    "haberler.html",
    "gol-kralligi.html",
    "asist-kralligi.html",
    "derbi-radari.html",
    "haftanin-maclari.html",
    "mac-merkezi.html",
    "istatistik-merkezi.html",
    "oyuncu-liderleri.html",
    "takim-trendleri.html",
    "futbol-radar-rehberi.html",
    "gunun-radar-bulteni.html",
    // Indexable and linked from four pages, but was never listed here.
    "transfer-izleme.html",
    ...files
  ];
  const unique = [...new Set(core)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((file) => {
  const loc = file === "index.html" ? `${domain}/` : `${domain}/${file}`;
  const priority = file === "index.html" ? "1.0"
    : LIVE_PAGES.has(file) ? "0.9"
    : file.includes("karsilastirma/") ? "0.65"
    : file.includes("oyuncular/") ? "0.7" : "0.8";
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changeFrequency(file)}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}).join("\n")}
</urlset>
`;
}

const pages = [...seoPages, ...playerSeoPages, ...legalPages];
pages.forEach(writePage);
const sitemap = sitemapXml(pages.map((page) => page.file));
fs.writeFileSync(path.join(root, "sitemap.xml"), sitemap, "utf8");
fs.writeFileSync(path.join(root, "public", "sitemap.xml"), sitemap, "utf8");
console.log(`Generated ${pages.length} static SEO/trust pages`);
