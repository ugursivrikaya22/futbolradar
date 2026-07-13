import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const today = "2026-07-10";

const nav = `
    <header class="topbar">
      <nav class="container nav" aria-label="Ana menü">
        <a class="brand" href="./index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a>
        <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button>
        <div class="nav-menu" id="primary-menu">
          <div class="nav-links"><a href="./bugunun-maclari.html">Bugünkü Maçlar</a><a href="./canli-skor.html">Canlı Skor</a><a href="./puan-durumu.html">Puan Durumu</a><a href="./takimlar.html">Takımlar</a><a href="./oyuncu-radari.html">Oyuncu Radar</a><a href="./momentum.html">Momentum</a></div>
          <a class="cta" href="./index.html#radar-sinyalleri">Radar Sinyalleri</a>
        </div>
      </nav>
    </header>`;

const footer = `
    <footer class="footer"><div class="container footer-links">FutbolRadar · <a href="./hakkinda.html">Hakkında</a> · <a href="./veri-notu.html">Veri Notu</a> · <a href="./iletisim.html">İletişim</a> · <a href="./gizlilik.html">Gizlilik</a> · <a href="./kullanim-sartlari.html">Kullanım Şartları</a></div></footer>`;

const seoPages = [
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
    title: "En Iyi Super Lig Oyunculari | AI Rating ve Scouting | FutbolRadar",
    description: "En iyi Super Lig oyunculari listesi; AI rating, form, radar skoru, piyasa degeri ve scouting sinyallerine gore siralanir.",
    h1: "En Iyi Super Lig Oyunculari",
    lead: "Super Lig oyuncularini AI rating, rol grubu, form ve radar etkisine gore karsilastir.",
    cards: ["AI rating", "Radar profili", "Scouting sinyali"]
  },
  {
    file: "en-iyi-forvetler.html",
    landing: "en-iyi-forvetler",
    title: "En Iyi Forvetler | Gol Tehdidi ve AI Rating | FutbolRadar",
    description: "En iyi forvetler listesi; gol tehdidi, xG, sut hacmi, form ve AI rating sinyalleriyle hazirlanir.",
    h1: "En Iyi Forvetler",
    lead: "Forvet ve kanat oyuncularini gol tehdidi, hucum radari ve form ivmesiyle oku.",
    cards: ["Gol tehdidi", "Hucum radari", "Bitiricilik"]
  },
  {
    file: "en-iyi-orta-sahalar.html",
    landing: "en-iyi-orta-sahalar",
    title: "En Iyi Orta Sahalar | Yaraticilik ve Pres Radari | FutbolRadar",
    description: "En iyi orta sahalar; yaraticilik, pas, pres gucu, form ve AI rating metrikleriyle listelenir.",
    h1: "En Iyi Orta Sahalar",
    lead: "Orta saha oyuncularini yaraticilik, pres, pas ve sureklilik sinyalleriyle karsilastir.",
    cards: ["Yaraticilik", "Pres gucu", "Pas kalitesi"]
  },
  {
    file: "en-iyi-defanslar.html",
    landing: "en-iyi-defanslar",
    title: "En Iyi Defanslar | Savunma Radari | FutbolRadar",
    description: "En iyi defanslar; savunma radari, sureklilik, disiplin, top kapma ve AI rating sinyalleriyle analiz edilir.",
    h1: "En Iyi Defanslar",
    lead: "Defans oyuncularini savunma etkisi, disiplin, fiziksel sureklilik ve radar skoruyla oku.",
    cards: ["Savunma radari", "Disiplin", "Sureklilik"]
  },
  {
    file: "en-iyi-kaleciler.html",
    landing: "en-iyi-kaleciler",
    title: "En Iyi Kaleciler | Kaleci Performans Radari | FutbolRadar",
    description: "En iyi kaleciler; form, savunma etkisi, veri guveni ve AI rating sinyalleriyle takip edilir.",
    h1: "En Iyi Kaleciler",
    lead: "Kalecileri form, savunma katkisi ve performans radariyla karsilastir.",
    cards: ["Kaleci formu", "Savunma etkisi", "Veri guveni"]
  },
  {
    file: "yukselen-oyuncular.html",
    landing: "yukselen-oyuncular",
    title: "Yukselen Oyuncular | Form Artisi ve Scouting Sinyali | FutbolRadar",
    description: "Yukselen oyuncular listesi; form degisimi, trend yonu, dakika artisi ve AI radar sinyalleriyle hazirlanir.",
    h1: "Yukselen Oyuncular",
    lead: "Formu yukselen oyunculari trend, dakika, potansiyel ve radar metrikleriyle takip et.",
    cards: ["Form artisi", "Trend", "Potansiyel"]
  },
  {
    file: "transfer-radari.html",
    landing: "transfer-radari",
    title: "Transfer Radari | Guncel Takim ve Eski Kulup Takibi | FutbolRadar",
    description: "Transfer radari; oyuncularin guncel takim, eski kulup, transfer gecmisi, veri durumu ve piyasa degeri alanlarini izler.",
    h1: "Transfer Radari",
    lead: "Oyuncu transfer gecmisini, guncel takimi ve veri guvenilirligini tek ekranda oku.",
    cards: ["Guncel takim", "Transfer gecmisi", "Veri guveni"]
  },
  {
    file: "genc-yetenekler.html",
    landing: "genc-yetenekler",
    title: "Genc Yetenekler | Potansiyel ve AI Rating | FutbolRadar",
    description: "Genc yetenekler listesi; yas, potansiyel rating, form, piyasa degeri ve radar sinyallerine gore hazirlanir.",
    h1: "Genc Yetenekler",
    lead: "Genc oyunculari potansiyel, form ve piyasa degeri radariyla incele.",
    cards: ["Potansiyel", "Yas profili", "Piyasa degeri"]
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
    lead: "FutbolRadar verileri bilgilendirme ve analiz amaçlıdır; kesin tahmin veya bahis yönlendirmesi değildir.",
    cards: ["Veriler hata veya gecikme içerebilir.", "Tahmin sinyalleri kesin sonuç vaadi taşımaz.", "Kullanıcı kararları kendi sorumluluğundadır."]
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
    return "Gol tehdidi, xG, sut hacmi ve ceza sahasi etkisi birlikte okunur.";
  }
  if (key.includes("yaraticilik") || key.includes("pas")) {
    return "Kilit pas, xA, asist ve top kullanimi oyuncunun uretim rolunu aciklar.";
  }
  if (key.includes("savunma") || key.includes("disiplin")) {
    return "Savunma katkisi, kart yuku ve sureklilik skoru birlikte degerlendirilir.";
  }
  if (key.includes("transfer") || key.includes("guncel takim")) {
    return "Guncel takim, eski kulup ve transfer gecmisi ayrimi korunarak gosterilir.";
  }
  if (key.includes("potansiyel") || key.includes("yas")) {
    return "Yas profili, gelisim alani ve potansiyel rating ayni kartta okunur.";
  }
  return "AI rating, form ve radar alt skorlari bu segmentteki oyunculari siralamak icin kullanilir.";
}

function cardsHtml(cards) {
  return cards.map((card) => `<article class="card"><span class="card-kicker">Radar</span><h2>${card}</h2><p>${cardDescription(card)}</p></article>`).join("");
}

function landingControlsHtml(page) {
  if (page.landing !== "transfer-radari") {
    return "";
  }

  return `<section class="transfer-toolbar" aria-label="Transfer radar filtreleri">
        <div class="transfer-filter-chips" role="group" aria-label="Hizli transfer filtreleri">
          <button type="button" data-transfer-filter="all" class="is-active" aria-pressed="true">Tum transferler</button>
          <button type="button" data-transfer-filter="son-hareket" aria-pressed="false">Son hareket</button>
          <button type="button" data-transfer-filter="eski-kulup" aria-pressed="false">Eski kulup ayrimi</button>
          <button type="button" data-transfer-filter="riskli-transfer" aria-pressed="false">Riskli takip</button>
          <button type="button" data-transfer-filter="yukselen-deger" aria-pressed="false">Yukselen deger</button>
        </div>
        <div class="filter-group">
          <label for="transfer-team-filter">Guncel takim</label>
          <select id="transfer-team-filter" data-transfer-team-filter></select>
        </div>
        <div class="filter-group">
          <label for="transfer-status-filter">Veri durumu</label>
          <select id="transfer-status-filter" data-transfer-status-filter></select>
        </div>
        <div class="filter-group">
          <label for="transfer-sort">Sirala</label>
          <select id="transfer-sort" data-transfer-sort>
            <option value="updated">Son guncelleme</option>
            <option value="market">Piyasa degeri</option>
            <option value="rating">AI rating</option>
            <option value="team">Takim</option>
          </select>
        </div>
      </section>
      <section class="transfer-radar-summary" data-transfer-summary aria-label="Transfer radar ozeti"></section>`;
}

function landingDescriptionHtml(page) {
  if (page.landing !== "transfer-radari") {
    return "";
  }

  return `\n      <section class="player-filter-note" data-transfer-filter-description>${page.lead}</section>`;
}

function pageHtml(page) {
  const url = `${domain}/${page.file}`;
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
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
${nav}
    <main class="container">
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
      <section class="player-filter-note"><span data-landing-count>Oyuncu listesi hazirlaniyor</span></section>
      <section class="grid" data-api-section="player-landing" data-api-target="player-seo-landing" data-player-landing="${page.landing}">
        <article class="data-empty" data-card="empty-state"><strong>Oyuncular yukleniyor</strong><span>Scouting kartlari veri katmanindan okunuyor.</span></article>
      </section>` : `<section class="grid three">${cardsHtml(page.cards)}</section>`}
      <section class="source-strip" aria-label="İlgili bağlantılar">
        <div><span>İlgili ekran</span><b><a href="./oyuncu-radari.html">Oyuncu Radar</a></b></div>
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

function sitemapXml(files) {
  const comparisonPages = generatedComparisonPages();
  const core = [
    "index.html",
    "bugunun-maclari.html",
    "super-lig-fikstur.html",
    "canli-skor.html",
    "puan-durumu.html",
    "takimlar.html",
    "takim-detay.html",
    "oyuncu-radari.html",
    "oyuncu-karsilastir.html",
    "oyuncu-karsilastirmalari.html",
    "oyuncu-detay.html",
    "mac-detay.html",
    "players/position/forvet.html",
    "players/league/super-lig.html",
    "oyuncular/forvetler.html",
    "oyuncular/kaleciler.html",
    "oyuncular/defanslar.html",
    "oyuncular/orta-sahalar.html",
    "oyuncular/genc-yetenekler.html",
    "oyuncular/en-iyi-oyuncular.html",
    "oyuncular/mauro-icardi.html",
    "oyuncular/kerem-akturkoglu.html",
    "oyuncular/edin-dzeko.html",
    "oyuncular/sebastian-szymanski.html",
    "oyuncular/gedson-fernandes.html",
    "oyuncular/ugurcan-cakir.html",
    "oyuncular/abdulkerim-bardakci.html",
    "oyuncular/semih-kilicsoy.html",
    ...comparisonPages,
    "momentum.html",
    "analizler.html",
    "gol-kralligi.html",
    "asist-kralligi.html",
    "derbi-radari.html",
    "haftanin-maclari.html",
    "mac-merkezi.html",
    "oyuncu-liderleri.html",
    "takim-trendleri.html",
    "futbol-radar-rehberi.html",
    "gunun-radar-bulteni.html",
    ...files
  ];
  const unique = [...new Set(core)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((file) => {
  const loc = file === "index.html" ? `${domain}/` : `${domain}/${file}`;
  const priority = file === "index.html" ? "1.0" : file.includes("karsilastirma/") ? "0.65" : file.includes("oyuncular/") ? "0.7" : "0.8";
  return `  <url>
    <loc>${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
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
