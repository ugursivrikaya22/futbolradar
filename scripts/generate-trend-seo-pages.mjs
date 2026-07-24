import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const updatedAt = "2026-07-22";
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));

const playerById = new Map(players.map((player) => [player.id, player]));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function formatDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00+03:00`);
  if (Number.isNaN(date.getTime())) return "Tarih doğrulanıyor";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function playerLink(transfer) {
  const player = playerById.get(transfer.playerId);
  if (!player) return "";
  return `<a class="detail-link" href="./oyuncular/${escapeHtml(player.id)}.html">Oyuncu profili</a>`;
}

function transferCards(records) {
  if (!records.length) {
    return `<article class="data-empty trend-empty" data-card="empty-state"><strong>Doğrulanmış transfer kaydı henüz yok</strong><span>Kulüp açıklaması veya güvenilir kayıt ulaştığında bu alan güncellenecek. Söylentiler kesinleşmiş transfer gibi gösterilmez.</span></article>`;
  }

  return records.map((transfer) => {
    const directionTeam = transfer.toTeam === "Serbest oyuncu" ? transfer.fromTeam : transfer.toTeam;
    return `<article class="trend-transfer-card" data-card="transfer-record" data-team="${escapeHtml(slugify(directionTeam))}">
      <div class="trend-transfer-head"><span class="tag green">${escapeHtml(transfer.status === "confirmed" ? "Doğrulandı" : "Takipte")}</span><time datetime="${escapeHtml(transfer.date)}">${escapeHtml(formatDate(transfer.date))}</time></div>
      <div><span class="card-kicker">${escapeHtml(transfer.position || "Oyuncu")}</span><h3>${escapeHtml(transfer.playerName)}</h3></div>
      <div class="trend-transfer-route"><span>${escapeHtml(transfer.fromTeam)}</span><b aria-label="takım değişikliği">→</b><span>${escapeHtml(transfer.toTeam)}</span></div>
      <dl class="trend-mini-stats"><div><dt>Transfer tipi</dt><dd>${escapeHtml(transfer.type || "Açıklanmadı")}</dd></div><div><dt>Bedel</dt><dd>${escapeHtml(transfer.fee || "Açıklanmadı")}</dd></div></dl>
      <div class="trend-card-actions">${playerLink(transfer)}<a class="detail-link ghost" href="./transfer-radari.html">Transfer Radar</a></div>
    </article>`;
  }).join("");
}

function teamTransfers(team) {
  return transfers
    .filter((transfer) => transfer.status === "confirmed" && (transfer.fromTeam === team || transfer.toTeam === team))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function factCards(items) {
  return `<section class="trend-fact-grid" aria-label="Öne çıkan bilgiler">${items.map((item) => `<article class="trend-fact-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong><p>${escapeHtml(item.note)}</p></article>`).join("")}</section>`;
}

function linkGrid(items) {
  return `<section class="trend-link-grid" aria-label="İlgili FutbolRadar sayfaları">${items.map((item) => `<a href="${escapeHtml(item.href)}"><span>${escapeHtml(item.kicker)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.text)}</p></a>`).join("")}</section>`;
}

function section(title, lead, content, kicker = "Radar görünümü") {
  return `<section class="trend-section"><div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(lead)}</p></div></div>${content}</section>`;
}

const commonLinks = [
  { href: "./oyuncu-radari.html", kicker: "Oyuncu", title: "Oyuncu Radarı", text: "Form, rol ve performans sinyallerini incele." },
  { href: "./takimlar.html", kicker: "Takım", title: "Takım merkezi", text: "Kadro ve takım sayfalarına geç." },
  { href: "./bugunun-maclari.html", kicker: "Maç", title: "Bugünün Maçları", text: "Günün doğrulanmış programını takip et." },
  { href: "./momentum.html", kicker: "Trend", title: "Momentum", text: "Takımların güncel hareket yönünü karşılaştır." }
];

const pages = [
  {
    file: "transfer-sezonu-ne-zaman-bitiyor.html",
    title: "Transfer Sezonu Ne Zaman Bitiyor? 2026-2027 Tarihleri | FutbolRadar",
    description: "2026-2027 yaz transfer dönemi ne zaman bitiyor? Süper Lig yaz ve ara transfer tarihlerini, kalan süreyi ve transfer takibini inceleyin.",
    h1: "Transfer Sezonu Ne Zaman Bitiyor?",
    lead: "2026-2027 sezonunda Türkiye'deki yaz transfer ve tescil dönemi 4 Eylül 2026'da sona erecek. Tarihleri, takip akışını ve doğrulanmış hareketleri tek ekranda oku.",
    facts: [
      { label: "Yaz dönemi başlangıcı", value: "22 Haziran 2026", note: "Birinci transfer ve tescil döneminin başlangıcı." },
      { label: "Yaz dönemi bitişi", value: "4 Eylül 2026", note: "Kulüpler için yaz penceresinin son günü." },
      { label: "Ara transfer dönemi", value: "1 Ocak - 5 Şubat 2027", note: "İkinci transfer ve tescil dönemi." }
    ],
    body: () => `${section("2026-2027 transfer takvimi", "Takvim, Türkiye Futbol Federasyonunun ilan ettiği tescil dönemlerini gösterir.", `<div class="trend-timeline"><article><span>22 Haziran</span><div><h3>Yaz penceresi açıldı</h3><p>Kulüpler yeni sezon kadrolarını resmileştirmeye başladı.</p></div></article><article class="is-current"><span>22 Temmuz</span><div><h3>Transfer dönemi sürüyor</h3><p>FutbolRadar yalnızca doğrulanan kulüp değişikliklerini kesinleşmiş kayıt olarak gösterir.</p></div></article><article><span>4 Eylül</span><div><h3>Yaz penceresi kapanacak</h3><p>Son gün işlemleri tamamlandıktan sonra kadro görünümü yeniden doğrulanır.</p></div></article></div>`, "Resmî takvim")}${section("Transferleri nasıl takip ediyoruz?", "Güncel takım, eski kulüp, transfer tipi ve doğrulama tarihi ayrı alanlarda tutulur.", `<div class="trend-note"><strong>Söylenti ile kesinleşmiş transfer ayrılır.</strong><p>Bir kayıt doğrulanmadan oyuncu profilindeki güncel takım bilgisi değiştirilmez. Bedel açıklanmadıysa tahmini rakam yazılmaz.</p><a class="button primary" href="./transfer-radari.html">Transfer Radarını aç</a></div>`, "Veri güveni")}`,
    links: [
      { href: "./super-lig-transferleri-2026-2027.html", kicker: "Sezon", title: "2026-2027 Süper Lig Transferleri", text: "Takım bazlı gelen ve giden oyuncuları gör." },
      { href: "./galatasaray-transfer-radar.html", kicker: "Galatasaray", title: "Galatasaray Transfer Radar", text: "Kadro hareketlerini analiz görünümünde oku." },
      { href: "./fenerbahce-transfer-radar.html", kicker: "Fenerbahçe", title: "Fenerbahçe Transfer Radar", text: "Gelen oyuncuları ve kadro etkisini incele." },
      ...commonLinks.slice(0, 1)
    ]
  },
  {
    file: "super-lig-transferleri-2026-2027.html",
    title: "2026-2027 Süper Lig Transferleri: Gelenler ve Gidenler | FutbolRadar",
    description: "2026-2027 Süper Lig transferlerini takım, oyuncu, bonservis, geliş ve ayrılık yönüyle FutbolRadar Transfer Radar ekranında inceleyin.",
    h1: "2026-2027 Süper Lig Transferleri",
    lead: "Takım bazlı gelen ve giden oyuncuları; güncel takım, transfer tipi, açıklanan bedel ve oyuncu profili bağlantılarıyla takip et.",
    facts: [
      { label: "Takip edilen kayıt", value: String(transfers.filter((item) => item.status === "confirmed").length), note: "Doğrulanmış transfer hareketi." },
      { label: "Yaz dönemi sonu", value: "4 Eylül 2026", note: "TFF tescil takvimindeki kapanış tarihi." },
      { label: "Veri yaklaşımı", value: "Doğrulama odaklı", note: "Açıklanmayan bedeller tahmin edilmez." }
    ],
    body: () => section("Son transfer hareketleri", "Kayıtlar en yeni tarih önde olacak şekilde listelenir.", `<div class="trend-transfer-grid">${transferCards(transfers.filter((item) => item.status === "confirmed").sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12))}</div>`, "Transfer Radar"),
    links: [
      { href: "./transfer-sezonu-ne-zaman-bitiyor.html", kicker: "Takvim", title: "Transfer sezonu ne zaman bitiyor?", text: "Yaz ve ara transfer tarihlerini incele." },
      { href: "./galatasaray-transfer-radar.html", kicker: "Takım", title: "Galatasaray Transfer Radar", text: "Galatasaray hareketlerini ayır." },
      { href: "./fenerbahce-transfer-radar.html", kicker: "Takım", title: "Fenerbahçe Transfer Radar", text: "Fenerbahçe hareketlerini ayır." },
      { href: "./transfer-radari.html", kicker: "Tüm kayıtlar", title: "Transfer Radarı", text: "Filtrelenebilir transfer ekranını aç." }
    ]
  },
  {
    file: "gornik-zabrze-fenerbahce-rovans-ne-zaman.html",
    title: "Górnik Zabrze Fenerbahçe Rövanş Maçı Ne Zaman? | FutbolRadar",
    description: "Górnik Zabrze Fenerbahçe rövanş maçı 29 Temmuz 2026'da. İlk maç sonucu, tur senaryosu ve maç öncesi veri notlarını inceleyin.",
    h1: "Górnik Zabrze Fenerbahçe Rövanş Maçı Ne Zaman?",
    lead: "Şampiyonlar Ligi ikinci eleme turu rövanşı 29 Temmuz 2026'da oynanacak. Fenerbahçe ilk maçtan taşıdığı 1-0 avantajla Polonya'ya gidiyor.",
    facts: [
      { label: "Rövanş tarihi", value: "29 Temmuz 2026", note: "UEFA ikinci eleme turu rövanş günü." },
      { label: "İlk maç", value: "Fenerbahçe 1-0 Górnik", note: "Talisca'nın golüyle gelen skor avantajı." },
      { label: "Tur senaryosu", value: "Beraberlik yeterli", note: "Toplam skor eşitlenirse karşılaşma uzatmaya gider." }
    ],
    body: () => `${section("Rövanş öncesi veri özeti", "İlk maçın sonucu avantaj sağlıyor; fakat tek gollük fark turu kesinleştirmiyor.", `<div class="trend-data-table"><div class="trend-table-row head"><span>Gösterge</span><span>Fenerbahçe</span><span>Górnik Zabrze</span></div><div class="trend-table-row"><span>İlk maç skoru</span><b>1</b><b>0</b></div><div class="trend-table-row"><span>İlk maç xG</span><b>1,54</b><b>0,06</b></div><div class="trend-table-row"><span>İlk maç şut</span><b>15</b><b>2</b></div></div>`, "Maç önü")}${section("Momentum nasıl okunmalı?", "Rövanş momentumu yalnızca ilk maç skorundan üretilmez.", `<div class="trend-note"><strong>Canlı kadro ve yeni maç verisi bekleniyor.</strong><p>Kesin ilk 11, sakatlık ve son antrenman bilgisi doğrulanmadan yapay bir momentum yüzdesi gösterilmez. İlk maçta Fenerbahçe oyun kontrolünü elinde tuttu; rövanşta skor koruma tercihi ile hücum devamlılığı birlikte izlenecek.</p></div>`, "Analiz notu")}`,
    links: [
      { href: "./fenerbahce-gornik-zabrze-mac-analizi.html", kicker: "İlk maç", title: "Fenerbahçe Górnik maç analizi", text: "xG, şut, pas ve kritik anları aç." },
      { href: "./fenerbahce-avrupa-maclari.html", kicker: "Fikstür", title: "Fenerbahçe Avrupa maçları", text: "Avrupa yolculuğunu tek sayfada takip et." },
      { href: "./bugunun-maclari.html", kicker: "Program", title: "Bugünün Maçları", text: "Günün maç programına geç." },
      { href: "./fenerbahce-oyuncu-radari.html", kicker: "Kadro", title: "Fenerbahçe Oyuncu Radarı", text: "Oyuncu form ve rol sinyallerini incele." }
    ]
  },
  {
    file: "uefa-ulke-puani-siralamasi.html",
    title: "UEFA Ülke Puanı Sıralaması ve Türkiye'nin Puanı | FutbolRadar",
    description: "UEFA ülke puanı sıralaması nasıl hesaplanır? Türkiye'nin Avrupa maçlarından kazandığı puanların etkisini ve temsilci performansını inceleyin.",
    h1: "UEFA Ülke Puanı Sıralaması",
    lead: "Türkiye'nin Avrupa kupalarındaki konumu, temsilcilerin maç sonuçları ve sezon katsayılarının birleşimiyle değişir. FutbolRadar puanın arkasındaki maç etkisini açıklar.",
    facts: [
      { label: "Hesaplama", value: "Takım puanı / temsilci", note: "Sezon puanı katılan kulüp sayısına bölünür." },
      { label: "Değerlendirme", value: "5 sezon", note: "Ülke sırası beş sezonluk toplamla oluşur." },
      { label: "Güncelleme", value: "Tur sonrasında", note: "UEFA sıralaması tamamlanan turlardan sonra yenilenir." }
    ],
    body: () => `${section("Ülke puanı neyi belirler?", "Sıralama, ülkelerin sonraki sezonlarda Avrupa kupalarına kaç takımla ve hangi aşamadan katılacağını etkiler.", `<div class="trend-explainer-grid"><article><span>1</span><h3>Maç puanı oluşur</h3><p>Galibiyet, beraberlik ve aşama bonusları kulüp hanesine eklenir.</p></article><article><span>2</span><h3>Temsilci sayısına bölünür</h3><p>Bir ülkenin sezon toplamı, o sezon yarışan kulüp sayısıyla oranlanır.</p></article><article><span>3</span><h3>Beş sezon birleşir</h3><p>Son beş sezonun katsayıları ülke sırasını oluşturur.</p></article></div>`, "Puan sistemi")}${section("Türkiye için maç etkisi", "Ön eleme turlarındaki her sonuç sezon katsayısına katkı verir; güncel sıra resmî UEFA tablosu üzerinden doğrulanmalıdır.", `<div class="trend-note"><strong>Kesin sıra uydurulmaz.</strong><p>UEFA tablosu tamamlanan turların ardından değişebildiği için FutbolRadar doğrulanmamış anlık sıra yayımlamaz. Temsilcilerin maçlarını ve oluşan etkileri analiz sayfalarında izler.</p><a class="detail-link" href="https://www.uefa.com/nationalassociations/uefarankings/?year=2026" target="_blank" rel="noopener noreferrer">Resmî UEFA sıralamasını aç</a></div>`, "Doğruluk notu")}`,
    links: [
      { href: "./sampiyonlar-ligi-on-eleme-maclari.html", kicker: "UEFA", title: "Şampiyonlar Ligi ön eleme maçları", text: "Eleme takvimini ve temsilci maçlarını incele." },
      { href: "./fenerbahce-avrupa-maclari.html", kicker: "Temsilci", title: "Fenerbahçe Avrupa maçları", text: "Fenerbahçe'nin sonuç ve fikstür akışını aç." },
      ...commonLinks.slice(2)
    ]
  },
  {
    file: "sampiyonlar-ligi-on-eleme-maclari.html",
    title: "Şampiyonlar Ligi Ön Eleme Maçları 2026-2027 | FutbolRadar",
    description: "2026-2027 Şampiyonlar Ligi ön eleme maçları, tur tarihleri, Fenerbahçe eşleşmesi ve veri odaklı maç analizleri FutbolRadar'da.",
    h1: "Şampiyonlar Ligi Ön Eleme Maçları",
    lead: "2026-2027 Şampiyonlar Ligi elemeleri 7 Temmuz'da başladı ve play-off rövanşlarıyla 26 Ağustos'ta tamamlanacak. Temsilci maçlarını takvim ve analizle takip et.",
    facts: [
      { label: "Eleme başlangıcı", value: "7 Temmuz 2026", note: "Birinci eleme turu ilk maçları." },
      { label: "İkinci tur", value: "21/22 ve 28/29 Temmuz", note: "Fenerbahçe bu aşamada yarışıyor." },
      { label: "Eleme bitişi", value: "26 Ağustos 2026", note: "Play-off rövanşlarının son günü." }
    ],
    body: () => `${section("Fenerbahçe eşleşmesi", "Sarı-lacivertliler ilk maçta Górnik Zabrze'yi 1-0 mağlup etti; rövanş 29 Temmuz'da.", `<div class="trend-fixture-list"><article><div><span>21 Temmuz 2026 · Tamamlandı</span><h3>Fenerbahçe 1-0 Górnik Zabrze</h3><p>15 şut, 1,54 xG ve yüzde 79 topa sahip olma.</p></div><a class="detail-link" href="./fenerbahce-gornik-zabrze-mac-analizi.html">Analizi aç</a></article><article><div><span>29 Temmuz 2026 · Rövanş</span><h3>Górnik Zabrze - Fenerbahçe</h3><p>Fenerbahçe tek gollük avantajla rövanşa çıkacak.</p></div><a class="detail-link" href="./gornik-zabrze-fenerbahce-rovans-ne-zaman.html">Maç önünü aç</a></article></div>`, "Temsilci Radar")}${section("Eleme yolu", "İkinci turu geçen taraf üçüncü eleme turunda Sturm Graz - Hearts eşleşmesinin galibiyle karşılaşacak.", `<div class="trend-timeline compact"><article class="is-current"><span>2. tur</span><div><h3>Górnik Zabrze eşleşmesi</h3><p>21 ve 29 Temmuz.</p></div></article><article><span>3. tur</span><div><h3>Sturm Graz / Hearts</h3><p>Tur geçilirse sıradaki eşleşme.</p></div></article><article><span>Play-off</span><div><h3>Lig aşaması öncesi son tur</h3><p>İlk maçlar 18/19, rövanşlar 25/26 Ağustos.</p></div></article></div>`, "Turnuva yolu")}`,
    links: [
      { href: "./fenerbahce-avrupa-maclari.html", kicker: "Takım", title: "Fenerbahçe Avrupa maçları", text: "Fikstür, sonuç ve analiz bağlantıları." },
      { href: "./uefa-ulke-puani-siralamasi.html", kicker: "Katsayı", title: "UEFA ülke puanı", text: "Avrupa sonuçlarının ülke puanına etkisini öğren." },
      ...commonLinks.slice(2)
    ]
  },
  {
    file: "fenerbahce-avrupa-maclari.html",
    title: "Fenerbahçe Avrupa Maçları 2026-2027: Fikstür ve Sonuçlar | FutbolRadar",
    description: "Fenerbahçe Avrupa maçları, Şampiyonlar Ligi eleme fikstürü, sonuçlar, maç analizleri ve oyuncu performans bağlantıları FutbolRadar'da.",
    h1: "Fenerbahçe Avrupa Maçları",
    lead: "Fenerbahçe'nin 2026-2027 Avrupa yolculuğunu; fikstür, skor, tur durumu, maç analizi ve oyuncu radar bağlantılarıyla tek sayfada takip et.",
    facts: [
      { label: "Organizasyon", value: "Şampiyonlar Ligi", note: "2026-2027 ikinci eleme turu." },
      { label: "İlk maç", value: "1-0", note: "Górnik Zabrze karşısında Fenerbahçe galibiyeti." },
      { label: "Sıradaki maç", value: "29 Temmuz", note: "Górnik Zabrze deplasmanındaki rövanş." }
    ],
    body: () => `${section("Avrupa fikstürü ve sonuçlar", "Tamamlanan maçlar doğrulanmış skorla, yaklaşan maçlar program durumuyla gösterilir.", `<div class="trend-fixture-list"><article><div><span>21 Temmuz · Şampiyonlar Ligi</span><h3>Fenerbahçe 1-0 Górnik Zabrze</h3><p>Durum: Tamamlandı · İlk maç</p></div><a class="detail-link" href="./fenerbahce-gornik-zabrze-mac-analizi.html">Tüm istatistikler</a></article><article><div><span>29 Temmuz · Şampiyonlar Ligi</span><h3>Górnik Zabrze - Fenerbahçe</h3><p>Durum: Planlandı · Rövanş</p></div><a class="detail-link" href="./gornik-zabrze-fenerbahce-rovans-ne-zaman.html">Rövanş rehberi</a></article></div>`, "Avrupa maç merkezi")}${section("Kadro etki vitrini", "Oyuncu etkisi yalnızca profil verisi bulunan ve güncel takımı doğrulanmış isimlerle bağlanır.", `<div class="trend-player-links"><a href="./oyuncular/kerem-akturkoglu.html"><span>Sol kanat</span><strong>Kerem Aktürkoğlu</strong><small>Profil ve form radarı</small></a><a href="./oyuncular/sebastian-szymanski.html"><span>10 numara</span><strong>Sebastian Szymanski</strong><small>Yaratıcılık ve pres radarı</small></a><a href="./fenerbahce-oyuncu-radari.html"><span>Tüm kadro</span><strong>Fenerbahçe Oyuncu Radarı</strong><small>Takım filtresini aç</small></a></div>`, "Oyuncu etkisi")}`,
    links: [
      { href: "./sampiyonlar-ligi-on-eleme-maclari.html", kicker: "Turnuva", title: "Şampiyonlar Ligi ön eleme", text: "Tur tarihlerini ve eleme yolunu gör." },
      { href: "./uefa-ulke-puani-siralamasi.html", kicker: "UEFA", title: "Ülke puanı sıralaması", text: "Temsilci sonuçlarının katsayı etkisini oku." },
      { href: "./fenerbahce-transfer-radar.html", kicker: "Kadro", title: "Fenerbahçe Transfer Radar", text: "Yeni kadro hareketlerini incele." },
      ...commonLinks.slice(2, 3)
    ]
  },
  {
    file: "galatasaray-transfer-radar.html",
    title: "Galatasaray Transfer Radar 2026-2027 | Gelenler ve Gidenler | FutbolRadar",
    description: "Galatasaray transfer radarında 2026-2027 gelen ve giden oyuncuları, kadro ihtiyaçlarını, piyasa bilgilerini ve oyuncu etkisini inceleyin.",
    h1: "Galatasaray Transfer Radar",
    lead: "Galatasaray'ın doğrulanmış transfer hareketlerini güncel takım, eski kulüp, transfer tipi ve kadro etkisi ayrımıyla oku.",
    facts: [
      { label: "Doğrulanmış hareket", value: String(teamTransfers("Galatasaray").length), note: "Galatasaray giriş ve çıkış kayıtları." },
      { label: "Kadro odağı", value: "Merkez ve santrfor", note: "Gelen ve ayrılan oyuncu profillerinin rol etkisi." },
      { label: "Pencere sonu", value: "4 Eylül 2026", note: "Yaz transfer dönemi kapanışı." }
    ],
    body: () => `${section("Gelenler ve gidenler", "Yalnızca doğrulanmış takım değişiklikleri listelenir.", `<div class="trend-transfer-grid">${transferCards(teamTransfers("Galatasaray"))}</div>`, "Galatasaray transferleri")}${section("Kadro ihtiyaç radarı", "Bu alan resmî transfer açıklaması değil, mevcut giriş ve çıkışların rol bazlı analizidir.", `<div class="trend-need-grid"><article><span>Santrfor</span><strong>Süreklilik</strong><p>Ayrılan santrfor sonrası ceza sahası bitiriciliği ve rol devamlılığı izleniyor.</p></article><article><span>Merkez orta saha</span><strong>Geçiş dengesi</strong><p>Yeni oyuncunun top kazanma ve pas güvenliği etkisi maç verisi oluştukça ölçülecek.</p></article><article><span>Kadro yapısı</span><strong>Dakika dağılımı</strong><p>Yeni sezon resmi maçları başlamadan kesin rol puanı üretilmez.</p></article></div>`, "AI uyum çerçevesi")}`,
    links: [
      { href: "./galatasaray-oyuncu-radari.html", kicker: "Kadro", title: "Galatasaray Oyuncu Radarı", text: "Güncel takım filtresiyle oyuncuları incele." },
      { href: "./super-lig-transferleri-2026-2027.html", kicker: "Lig", title: "Süper Lig transferleri", text: "Diğer takımların hareketleriyle karşılaştır." },
      { href: "./transfer-radari.html", kicker: "Filtre", title: "Transfer Radarı", text: "Tüm doğrulanmış kayıtları aç." },
      ...commonLinks.slice(1, 2)
    ]
  },
  {
    file: "fenerbahce-transfer-radar.html",
    title: "Fenerbahçe Transfer Radar 2026-2027 | Gelenler ve Gidenler | FutbolRadar",
    description: "Fenerbahçe transfer radarında 2026-2027 gelen ve giden oyuncuları, kadro ihtiyaçlarını, piyasa bilgilerini ve oyuncu etkisini inceleyin.",
    h1: "Fenerbahçe Transfer Radar",
    lead: "Fenerbahçe'nin doğrulanmış transfer hareketlerini; oyuncu rolü, açıklanan bedel, güncel takım ve Avrupa kadrosuna olası etkisiyle takip et.",
    facts: [
      { label: "Doğrulanmış hareket", value: String(teamTransfers("Fenerbahçe").length), note: "Fenerbahçe giriş ve çıkış kayıtları." },
      { label: "Avrupa gündemi", value: "Şampiyonlar Ligi", note: "Kadro etkisi eleme maçlarıyla birlikte izleniyor." },
      { label: "Pencere sonu", value: "4 Eylül 2026", note: "Yaz transfer dönemi kapanışı." }
    ],
    body: () => `${section("Gelenler ve gidenler", "Kulüp değişikliği doğrulanan kayıtlar en yeni tarih önde listelenir.", `<div class="trend-transfer-grid">${transferCards(teamTransfers("Fenerbahçe"))}</div>`, "Fenerbahçe transferleri")}${section("Kadro uyum radarı", "Yeni oyuncuların gerçek katkı puanı resmi maç dakikaları oluştukça hesaplanabilir.", `<div class="trend-need-grid"><article><span>Hücum</span><strong>Kanat ve bitiricilik</strong><p>Yeni hücum profillerinin şut kalitesi ve ceza sahası etkisi izlenecek.</p></article><article><span>Savunma</span><strong>Geçiş güvenliği</strong><p>Stoper ve bek rollerinde alan savunması, top kazanma ve pas çıkışı birlikte değerlendirilecek.</p></article><article><span>Avrupa kadrosu</span><strong>Rol dengesi</strong><p>Kesin kadro bildirimi oluşmadan oyuncular için UEFA uygunluğu varsayılmaz.</p></article></div>`, "AI uyum çerçevesi")}`,
    links: [
      { href: "./fenerbahce-oyuncu-radari.html", kicker: "Kadro", title: "Fenerbahçe Oyuncu Radarı", text: "Form ve rol sinyallerini incele." },
      { href: "./fenerbahce-avrupa-maclari.html", kicker: "Avrupa", title: "Fenerbahçe Avrupa maçları", text: "Kadro etkisini maç akışıyla birlikte oku." },
      { href: "./super-lig-transferleri-2026-2027.html", kicker: "Lig", title: "Süper Lig transferleri", text: "Diğer takımların hareketleriyle karşılaştır." },
      { href: "./transfer-radari.html", kicker: "Filtre", title: "Transfer Radarı", text: "Tüm doğrulanmış kayıtları aç." }
    ]
  }
];

function pageHtml(page) {
  const url = `${domain}/${page.file}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: page.h1, description: page.description, url, dateModified: updatedAt, isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${domain}/` } },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/` },
        { "@type": "ListItem", position: 2, name: "Trend Radar", item: `${domain}/` },
        { "@type": "ListItem", position: 3, name: page.h1, item: url }
      ] }
    ]
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage trend-seo-page">
    <header class="topbar"><nav class="container nav" aria-label="Ana menü"><a class="brand" href="./index.html" aria-label="FutbolRadar ana sayfa"><span class="brand-mark">FR</span><span>FutbolRadar</span></a><button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu"><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span><span class="nav-toggle-bar"></span></button><div class="nav-menu" id="primary-menu"><div class="nav-links"><a href="./bugunun-maclari.html">Bugünkü Maçlar</a><a href="./canli-skor.html">Canlı Skor</a><a href="./puan-durumu.html">Puan Durumu</a><a href="./super-lig-fikstur.html">Süper Lig Fikstürü</a><a href="./takimlar.html">Takımlar</a><a href="./oyuncu-radari.html">Oyuncu Radarı</a><a href="./momentum.html">Momentum</a></div><a class="cta" href="./index.html#radar-sinyalleri">Radar Sinyalleri</a></div></nav></header>
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./index.html">Trend Radar</a><span>/</span><span>${escapeHtml(page.h1)}</span></nav>
      <section class="trend-hero"><div><span class="eyebrow">Gündem · Veri · Analiz</span><h1>${escapeHtml(page.h1)}</h1><p>${escapeHtml(page.lead)}</p></div><aside><span>Son kontrol</span><strong>22 Temmuz 2026</strong><small>Doğrulanmayan alanlar kesin bilgi gibi sunulmaz.</small></aside></section>
      ${factCards(page.facts)}
      ${page.body()}
      ${section("İlgili radar ekranları", "Bu konuyu takım, oyuncu, maç ve momentum verileriyle derinleştir.", linkGrid(page.links), "İç bağlantılar")}
      <section class="trend-home-cta"><div><span class="section-kicker">FutbolRadar</span><h2>Skordan fazlasını oku.</h2><p>Canlı maç merkezi, oyuncu performansı, takım formu ve transfer hareketlerini aynı veri dilinde takip et.</p></div><a class="button primary" href="./index.html">Ana sayfaya dön</a></section>
    </main>
    <footer class="footer"><div class="container footer-links">FutbolRadar · Veri odaklı futbol analizi · <a href="./hakkinda.html">Hakkında</a> · <a href="./veri-notu.html">Veri Notu</a> · <a href="./iletisim.html">İletişim</a> · <a href="./gizlilik.html">Gizlilik</a> · <a href="./kullanim-sartlari.html">Kullanım Şartları</a></div></footer>
    <script src="./site.js" defer></script>
  </body>
</html>`;
}

function writePage(page) {
  const html = pageHtml(page);
  fs.writeFileSync(path.join(root, page.file), html, "utf8");
  fs.writeFileSync(path.join(root, "public", page.file), html, "utf8");
}

function upsertSitemap(files) {
  const sitemapPath = path.join(root, "sitemap.xml");
  let xml = fs.readFileSync(sitemapPath, "utf8");
  for (const file of files) {
    const loc = `${domain}/${file}`;
    const escapedLoc = loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    xml = xml.replace(new RegExp(`  <url>\\s*<loc>${escapedLoc}<\\/loc>[\\s\\S]*?<\\/url>`, "g"), "");
    xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${updatedAt}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>`);
  }
  fs.writeFileSync(sitemapPath, xml, "utf8");
  fs.writeFileSync(path.join(root, "public", "sitemap.xml"), xml, "utf8");
}

pages.forEach(writePage);
upsertSitemap([
  ...pages.map((page) => page.file),
  "fenerbahce-gornik-zabrze-mac-analizi.html",
  "en-iyi-super-lig-oyunculari.html"
]);
console.log(`Generated ${pages.length} football trend SEO pages`);
