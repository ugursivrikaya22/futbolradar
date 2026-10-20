# Tasarım: Transfer Radarı + Süper Lig Takım Karşılaştırma (20 Ekim 2026)

Durum: yalnızca tasarım. Bu PR hiçbir sayfa, rota, sitemap ya da PWA dosyasını değiştirmez.
Kısıtlar: yeni API isteği yok, ücretli API yok, yeni cron yok; kaynağı (URL) olmayan kayıt sayfa üretmez;
eksik değer “Güncelleniyor” / “veri bekleniyor”; üretilmiş HTML elle düzenlenmez.

## 0. Denetim özeti (main @ 46fdfbd27b)

### Süper Lig takım sayfaları
`data/teams.json` (`isCurrentSuperLigTeam: true`) ve `services/superLigTeamPages.js` 18 kulübü listeler; 18'inin de
kalıcı sayfası main'de var: `/takimlar/<slug>` (üretici: `scripts/generate-evergreen-seo-pages.mjs`, koruyucu test:
`scripts/test-team-page-coverage.mjs`). Rewrite `vercel.json` içinde `/takimlar/:slug`, `/takim/galatasaray` → `/takimlar/...`.
JSON-LD: ProfilePage + SportsTeam + BreadcrumbList, canonical temiz adres.

| Kulüp | /takimlar | -maclari | -puan-durumu | form/oyuncu-radari |
|---|---|---|---|---|
| Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor | var | var | var | var |
| Samsunspor, Başakşehir, Konyaspor, Göztepe, Alanyaspor, Gençlerbirliği, Kasımpaşa, Rizespor, Erzurumspor, Gaziantep FK, Amed, Eyüpspor, Çorum FK, Kocaelispor | var | var | var | yok |

Sayfası eksik Süper Lig kulübü **yok**; bu yüzden yeni takım sayfası üretilmedi. #446 (`seo/team-pages`) yalnızca
yabancı kulüpleri (Bayern, Real Madrid, Barcelona, Arsenal, Man City; `data/world-clubs.json`) kapsıyor ve main ile
CONFLICTING durumda. `/en/teams/*` main'de yok (yalnızca #446'da).

### Transfer
- `/transfer-radari`, `/galatasaray-transfer-radar`, `/fenerbahce-transfer-radar` → 301 `/super-lig-transferleri-2026-2027`;
  `/en/transfer-radar` → `/en/news`.
- `data/transfers.json`: 46 kayıt, hepsi `status: confirmed`, hepsinde `sourceUrl` var. **Söylenti kaydı yok.**
- #451: `/transfer-donemi-2026-27` + ana sayfa kayan yazı (`data/transfer-donemi-2026-27.json`, `data/ticker.json`), main ile çakışıyor.

### İstatistik
- main: `/gol-kralligi`, `/asist-kralligi`, `/istatistik-merkezi`, `/takim-karsilastirmalari`,
  `/karsilastirma/takimlar/{6 büyük-4 eşleşmesi}` (Article JSON-LD).
- #456: `data/stats-leagues.json`, `services/statsLeagues.js`, ŞL/AL istatistik sayfaları; main ile çakışıyor.

## 1. Transfer Radarı

- URL: `/transfer-radari` (bugünkü 301 kaldırılır; `/super-lig-transferleri-2026-2027` ile kanibalizasyon olmaması için
  radar = "canlı akış + durum etiketi", diğer sayfa = "sezon arşivi"). EN çifti yok → hreflang yok.
- Veri: `data/transfers.json` (mevcut şema). Görünürlük kuralı: `sourceUrl` boşsa kayıt render edilmez.
  Etiket: `status=confirmed` → **Resmî**; `status=rumour` → **Söylenti** (+ `confidence` 0–1 rozet). Bugün söylenti kaydı
  olmadığından bölüm "veri bekleniyor" gösterir.
- Bölümler: H1 + son doğrulama tarihi (`lastVerifiedAt` max) · filtre (kulüp / gelen-giden / tür) — JS'siz SSG liste,
  filtre ilerletici iyileştirme · kulüp başına özet (18 takım, `/takimlar/<slug>` linki) · kayıt kartı: oyuncu (varsa
  `/futbolcu/<slug>`), kimden→kime, tür, bedel (yoksa "Güncelleniyor"), kaynak linki `rel="nofollow noopener"` ·
  #451 `/transfer-donemi-2026-27` ve `/transfer-sezonu-ne-zaman-bitiyor` iç linkleri.
- JSON-LD: BreadcrumbList + `CollectionPage` (`mainEntity: ItemList` → her öğe `NewsArticle` değil, `ListItem` +
  `url` = kaynak). Sahte tarih/yazar yok.
- Title: `Transfer Radarı 2026-27: Süper Lig Resmî Transferler ve Söylentiler | FutbolRadar`
- Meta: `Süper Lig kulüplerinin {N} doğrulanmış transferi kaynak linkleriyle; resmî / söylenti etiketi, kulüp filtresi. Son güncelleme {tarih}.`
- Üretici: `scripts/generate-transfer-radar-page.mjs` (#451'deki `generate-transfer-period-page.mjs` kalıbı; #451
  merge olduktan sonra açılmalı ki `vercel.json`/`sitemap.xml` çakışmasın).

## 2. Süper Lig takım karşılaştırma

- Temel URL: `/super-lig-takim-karsilastirma` (`?a=<slug>&b=<slug>` istemci tarafı seçim; canonical her zaman temel
  sayfa, `?a/b` noindex değil ama canonical temel). Statik eşleşmeler mevcut `/karsilastirma/takimlar/<a>-vs-<b>`
  kalıbını kullanmaya devam eder; yeni statik eşleşme yalnızca arama talebi (`data/search-demand`) gösterirse.
- Veri: `data/teams.json` (rank, played, W/D/L, GF/GA, points, form) + `data/league-standings.json`.
  **Eksik kaynak:** bu alanlarda `source: "api-football"` var ama kaynak URL'si yok → sayfa altına
  "Kaynak: API-Football standings, sezon 2026/27, son senkron {lastStandingsSyncedAt}" + TFF puan durumu linki
  eklenmeden yayın yok. `momentum` / `formScore` iç türetilmiş metrikler: "FutbolRadar hesaplaması" etiketi şart.
- Lig parametresi: #456'nın `data/stats-leagues.json` girdisi (ŞL = 203) okunur, dosya değiştirilmez; #456 merge
  olmadan bu sayfa açılmaz.
- Bölümler: iki select (SSG'de varsayılan: tablo 1. vs 2.) · metrik tablosu · son 5 maç formu · aralarındaki maçlar
  (`data/historical-match-archive.json`, yoksa "veri bekleniyor") · `/super-lig-puan-durumu`, `/takimlar/<slug>`,
  `/gol-kralligi`, `/asist-kralligi` linkleri.
- JSON-LD: BreadcrumbList + `WebPage` (`about`: iki `SportsTeam`).
- Title: `Süper Lig Takım Karşılaştırma 2026-27: Puan, Gol, Form | FutbolRadar`
- Meta: `Süper Lig'in 18 takımını puan, galibiyet, gol ve son form verisiyle yan yana karşılaştırın. Veri: API-Football, son senkron {tarih}.`
- PWA: `sw.js`/manifest değişmez; sayfa mevcut önbellek stratejisine düşer.

## 3. Eksik veri / kaynaklar
1. `data/teams.json` ve `data/league-standings.json` puan durumu satırlarında kaynak URL'si yok (yalnızca `api-football` adı).
2. `data/transfers.json` içinde söylenti kaydı yok; söylenti şeması (`status: rumour`, `confidence`, `sourceUrl`) tanımlı değil.
3. Stadyum / kuruluş / şampiyonluk bilgileri için kaynaklı veri dosyası yok (takım sayfalarında gösterilmiyor).
4. 18 kulüp listesi TFF'nin resmî listesiyle bu çalışmada yeniden doğrulanmadı (yeni istek yasağı).
