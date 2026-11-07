# Avrupa ligleri istatistik merkezleri

## Ön inceleme (8 Kasım 2026, TSİ)

- Süper Lig `/istatistik-merkezi.html`, gol krallığı/kategori sayfaları ve oyuncu profilleri zaten mevcut. Bunların adresleri veya verileri değiştirilmedi.
- Altı yarışmanın `*-puan-durumu` ve `/lig/<competitionId>.html` sayfaları zaten mevcut. Bunları kopyalamak yerine istatistik merkezlerine bağladık.
- `data/competition-leaders.json` zaten altı yarışmanın 2026 sezonunda 20'şer gol ve asist kaydını içeriyor. Kaynak: `api-football:/players/topscorers,/players/topassists`; kayıt zamanı 6 Kasım 2026, yaklaşık 05:20 TSİ.
- `data/league-standings.json` aynı sezonun 20/20/20/18/18/36 takımlık API-Football tablolarını içeriyor. Güncelleme 6 Kasım 2026, yaklaşık 05:20 TSİ. Bunlar canlı sonuç veya tamamlanmış sezon verisi diye sunulmuyor.
- `sync-competition-leaders.mjs` ve `sync-league-standings.mjs` altı ligi zaten kapsıyor. Yeni API çağrısı, cron, ortam değişkeni veya ücretli hizmet eklenmedi.
- Yerel sağlayıcı yapılandırma kontrolünde `apiConfigured:false`. Canlı API planı, kalan kota veya oyuncu xG kapsamı doğrulanamadı. Anahtar aranmadı/okunmadı; yeni sağlayıcı isteği yapılmadı. Repodaki `requestBudget.js` varsayılanları 100 günlük kota / 60 koşu bütçesi / 25 rezervdir; bu değerler hesabın gerçek planı olarak sunulmaz.
- PR #642 henüz açık. `playerStatsEligibility.js` buradan yeniden kullanıldı; varsayılan Süper Lig davranışı korunarak `superLigOnly:false` seçeneği eklendi. Avrupa ligindeki bir oyuncunun Süper Lig üyesi olmaması onu dışlamaz. Kayıtlı ayrılış/serbestlik ve gerçek sezon katılımı filtrelenir; sakatlık/ceza tek başına dışlama nedeni değildir.

## Yeni kalıcı adresler

- `/premier-lig-istatistikleri`
- `/la-liga-istatistikleri`
- `/serie-a-istatistikleri`
- `/bundesliga-istatistikleri`
- `/ligue-1-istatistikleri`
- `/sampiyonlar-ligi-istatistikleri`

Her merkezde Türkçe, sunucuda üretilmiş gol/asist ilk 20 listesi; listelerdeki oyuncular için açılır **sezonluk performans profilleri** (takım, maç, dakika, gol, asist); aynı sezon tablosundan etkileşimli takım karşılaştırması ve kayıtlı sezon seçimi bulunur. Bunlar tam kadro profilleri değildir. Aynı API-Football oyuncu kimliğiyle mevcut profil varsa oraya bağlanır; ikinci oyuncu profil URL'si veya kaynaksız biyografi üretilmez.

Karşılaştırma, ikili rekabet/tahmin değil, aynı yarışmadaki oynanan maç, galibiyet, beraberlik, mağlubiyet, atılan/yenen gol, averaj ve puan karşılaştırmasıdır. JavaScript olmadan ilk iki takımın verileri okunabilir.

Şu anda yalnızca 2026/27 sezonu kayıtlıdır. İleride aynı kaynak dosyalarında önceki sezon bulunduğunda `/istatistik/<competitionId>/<başlangıç>-<bitiş>` arşivi üretilir; güncel sezonun ikinci bir URL'si oluşturulmaz. Verisiz geçmiş sezonlar üretilmez.

## Bilinçli eksikler / güvenlik

- Oyuncu xG alanı bu kaynak kayıtlarda yok. Bölüm “Güncelleniyor” der; sayı/sıralama üretmez. Maç xG'si oyunculara dağıtılmaz, gol/şut verilerinden xG tahmin edilmez. Mevcut planın xG sağlamadığı iddia edilmez: kapsam doğrulanamamıştır.
- Tam kadro, yaş/mevki/biyografi ve eski sezonlar doğrulanmış kayıt bulunmadan üretilmez.
- Yalnız API-Football kaynaklı, doğru lig+sezon kimlikli kayıtlar kabul edilir. Diğer kaynaklardan hazır xG değerleri içeri taşınmaz.
- İnce sayfalar `noindex,follow`; en az 8 takım + 5 golcü + 5 asistçi olmayan sayfa sitemap dışıdır. Sitemap lastmod'u veri tarihidir, build saati değil.
- Manifest, service worker, PWA/push dosyaları veya önbellek listesi değiştirilmez. Yeni ayrı JS/CSS varlığı yok; mevcut `page.css` ve `site.js` kullanılır. PWA bağlama/sürümleme mevcut postprocess zincirinin sorumluluğunda kalır.

## Entegrasyon ve tekrar üretim

`generate-league-statistics-pages.mjs`, ortak yerleşimden önce `POSTPROCESS_CHAIN` içinde çalışır. Hem tam hem mevcut zamanlanmış derlemeler sayfaları ve bağlantıları tazeler. İstatistik Merkezi mevcut üst menüden erişilebilir; buradan altı lige bağlantı eklenir. Lig puan durumu/fikstür sayfaları ve mevcut ilgili takım sayfaları da bağlanır. Takımlar RICH_TEAM_PAGES/API-Football kimliğiyle (ayrı Stuttgart üreticisi için mevcut 172 kimliği dahil) eşleştirilir; isim benzerliğine göre lig atanmaz. HTML elle düzenlenmez ve üretilmiş dosyalar bu değişiklikte commit edilmez.

Her merkez benzersiz title/meta/H1, canonical, BreadcrumbList ve lider tabloları için ItemList içerir. Temiz URL rewrites ve `.html` → temiz URL kalıcı yönlendirmeleri `vercel.json` içinde tanımlıdır.

## Testler

```
npm run test:league-statistics
npm run test:league-statistics:browser
node scripts/test-postprocess-chain.mjs
node scripts/test-competition-coverage.mjs
node scripts/test-source-links.mjs
```

Tarayıcı testi altı temiz URL'yi 390px'te, karşılaştırma ve profil kontrollerini, İstatistik Merkezi → lig geçişini, 1440px taşmasını ve sayfa hatalarını denetler. Dış ağ engellenir; canlı kota tüketilmez. İsteğe bağlı ekran görüntüleri: `STATS_SCREENSHOT_DIR=/tmp/stats-evidence npm run test:league-statistics:browser`.


### Kontrol sonucu (yerel)

Yukarıdaki beş odaklı test ile `test-sitemaps.mjs` geçti. Altı sayfada 390px yatay taşma ve tarayıcı sayfa hatası yok; 1440px kontrolü de geçti. Tam build/postprocess ve tüm test paketi çalıştırılmadı.

Ek genel SEO kontrollerinde mevcut üretilmiş baseline hataları görüldü: `test-structured-data.mjs` değişmemiş `bulten.html` dosyasında JSON-LD olmamasından; `test-index-policy.mjs` değişmemiş TR/EN hafta sayfalarının canonical uyuşmazlığından başarısız. İlgili örnek dosyaların `origin/main` ile birebir aynı olduğu doğrulandı. Bu PR bu ilgisiz sayfaları veya PWA dosyalarını değiştirmez.
