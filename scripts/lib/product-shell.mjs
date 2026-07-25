import path from "node:path";

function prefixFor(relativePath) {
  const directory = path.posix.dirname(String(relativePath || "").replace(/\\/g, "/"));
  if (!directory || directory === ".") return "./";
  return "../".repeat(directory.split("/").filter(Boolean).length);
}

function header(prefix = "./") {
  return `<header class="topbar site-header">
  <nav class="container nav" aria-label="Ana menü">
    <a class="brand" href="${prefix}index.html" aria-label="FutbolRadar ana sayfa">
      <span class="brand-mark" aria-hidden="true">FR</span>
      <span>FutbolRadar</span>
    </a>
    <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false" aria-controls="primary-menu">
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
    </button>
    <div class="nav-menu" id="primary-menu">
      <div class="nav-group nav-group-popular">
        <span class="nav-group-label">Hızlı Erişim</span>
        <div class="nav-links">
          <a href="${prefix}bugunun-maclari.html" data-analytics-event="homepage_today_matches_click">Bugünkü Maçlar</a>
          <a href="${prefix}canli-skor.html" data-analytics-event="homepage_live_score_click">Canlı Skor</a>
          <a href="${prefix}puan-durumu.html">Puan Durumu</a>
          <a href="${prefix}takimlar.html">Takımlar</a>
          <a href="${prefix}oyuncu-radari.html">Oyuncular</a>
        </div>
      </div>
      <div class="nav-group nav-group-analysis">
        <span class="nav-group-label">Radar Analiz</span>
        <div class="nav-links">
          <a class="mobile-only-nav" href="${prefix}oyuncu-radari.html">Oyuncu Radar</a>
          <a href="${prefix}radar-merkezi.html" data-analytics-event="radar_center_click">Radar Merkezi</a>
          <a href="${prefix}momentum.html">Momentum</a>
          <a href="${prefix}transfer-radari.html" data-analytics-event="transfer_radar_click">Transfer Radar</a>
          <a href="${prefix}analizler.html">Analizler</a>
        </div>
      </div>
      <button class="quick-action site-search-toggle" type="button" aria-label="Site içinde ara">Ara</button>
      <a class="cta nav-compare-cta" href="${prefix}oyuncu-karsilastir.html" data-analytics-event="player_compare_click">Oyuncu Karşılaştır</a>
    </div>
  </nav>
</header>`;
}

function footer(prefix = "./") {
  return `<footer class="footer site-footer">
  <div class="container footer-grid">
    <section><strong>Popüler</strong><a href="${prefix}bugunun-maclari.html">Bugünün Maçları</a><a href="${prefix}canli-skor.html">Canlı Skor</a><a href="${prefix}puan-durumu.html">Puan Durumu</a><a href="${prefix}takimlar.html">Takımlar</a><a href="${prefix}oyuncu-radari.html">Oyuncu Radar</a></section>
    <section><strong>Radar Analiz</strong><a href="${prefix}radar-merkezi.html">Radar Merkezi</a><a href="${prefix}momentum.html">Momentum</a><a href="${prefix}transfer-radari.html">Transfer Radar</a><a href="${prefix}oyuncu-karsilastir.html">Oyuncu Karşılaştır</a><a href="${prefix}analizler.html">Analizler</a></section>
    <section><strong>Büyük Takımlar</strong><a href="${prefix}takim-detay.html?team=Galatasaray">Galatasaray</a><a href="${prefix}takim-detay.html?team=Fenerbah%C3%A7e">Fenerbahçe</a><a href="${prefix}takim-detay.html?team=Be%C5%9Fikta%C5%9F">Beşiktaş</a><a href="${prefix}takim-detay.html?team=Trabzonspor">Trabzonspor</a></section>
    <section><strong>Kurumsal</strong><a href="${prefix}hakkinda.html">Hakkında</a><a href="${prefix}veri-notu.html">Veri Notu</a><a href="${prefix}iletisim.html">İletişim</a><a href="${prefix}gizlilik.html">Gizlilik</a><a href="${prefix}kullanim-sartlari.html">Kullanım Şartları</a></section>
  </div>
  <div class="container footer-disclaimer">FutbolRadar verileri bilgilendirme ve analiz amaçlıdır; kesin tahmin veya bahis yönlendirmesi değildir.</div>
</footer>`;
}

export { footer, header, prefixFor };
