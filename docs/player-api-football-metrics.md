# Oyuncu sezon metrikleri — API-Football entegrasyonu

Kontrol: 8 Kasım 2026 (Europe/Istanbul). Bu PR birleştirilmedi; üretimde veri değişikliği yok.

## Kapsam ve gerçek veri durumu

İstekte 22 metrik deniyor; mevcut `METRIC_CATALOG` gerçekte **23 saha oyuncusu metriği**, kaleciye özel 3 ek alan (26 tanım) içeriyor. Mevcut düzen korunur. Aşağıdaki eşleme 22 doğrudan/hesaplı alanını karşılayabilir; saha oyuncusunda en çok **20/23** alan dolar. Bu, her oyuncuda 19 alanın mutlaka mevcut olduğu iddiası değildir: eksik alanlar boş kalır.

Bu geliştirme oturumunda API anahtarı yapılandırılmamıştı; gerçek `/players` isteği yapılmadı, `data/players.json` değiştirilmedi. Test sayıları yalnızca sentetik, yayımlanmayan fixture verileridir. İlk gerçek dolum, mevcut anahtarlı haftalık senkron veya aynı mevcut betiğin yetkili çalıştırılmasıyla yapılır. Yeni ücretli kaynak, anahtar veya cron yok.

## Alan eşleme

| Metrik | API-Football `/players` alanı |
|---|---|
| Maç (`appearances`) | games.appearences |
| İlk 11 (`starts`) | games.lineups |
| Dakika (`minutes`) | games.minutes |
| Gol (`goals`) | goals.total |
| Asist (`assists`) | goals.assists |
| Şut (`shots`) | shots.total |
| İsabetli şut (`shotsOnTarget`) | shots.on |
| xG (`xg`) | Yok; boş |
| xA (`xa`) | Yok; boş |
| Kilit pas (`keyPasses`) | passes.key |
| Pas isabeti (`passAccuracy`) | `passes.accuracy` (%); çok blokta `Σ (accuracy × passes.total) / Σ passes.total` |
| Pas (`passes`) | passes.total |
| Dripling (`dribbles`) | dribbles.success |
| Dripling denemesi (`dribbleAttempts`) | dribbles.attempts |
| Kazanılan ikili mücadele (`duelsWon`) | duels.won |
| İkili mücadele (`duelsTotal`) | duels.total |
| Top kapma (`tackles`) | tackles.total |
| Araya girme (`interceptions`) | tackles.interceptions |
| Blok (`blocks`) | tackles.blocks |
| Top alma (`recoveries`) | Yok; boş |
| Faul (`foulsCommitted`) | fouls.committed |
| Sarı kart (`yellowCards`) | cards.yellow |
| Kırmızı kart (`redCards`) | cards.red + cards.yellowred |
| Kurtarış (`saves`) | goals.saves |
| Gol yemeden (`cleanSheets`) | Sezon oyuncu yanıtında yok; boş (takım istatistiği oyuncuya atanmaz) |
| Yenilen gol (`goalsConceded`) | goals.conceded |

**Bitiricilik / teknik beceri:** ham API alanı değildir; gol/şut oranından bir yetenek notu ya da xG tahmini üretilmez. Mevcut rating modeli ve profil yapısı değiştirilmez. Teknik üretimin ölçülebilen bileşenleri pas, kilit pas, dripling denemesi/başarısı olarak ayrı ayrı gösterilir.

## Hesap ve köken

- Yalnızca istenen API sezon kodundaki takım/turnuva blokları toplanır. Lig ve kupa ayrımı, takım adları ve lig kimlikleri sayfada açıkça listelenir: toplam bir Süper Lig sıralaması değildir.
- Her metrik için her blokta sayı bulunmalıdır. Birindeki `null` toplamı da `null` yapar. Gerçek sıfır korunur. Aynı takım/turnuva için yinelenen bloklar belirsiz kabul edilip yeni snapshot açılmaz.
- İkinci sarıdan kırmızı dahil kırmızı kart: `cards.red + cards.yellowred`; formül sayfada görünür.
- Pas isabeti: tek blokta `passes.accuracy`; çok blokta bildirilen yüzdelerin pas sayısıyla ağırlıklı ortalaması: `Σ (passes.accuracy × passes.total) / Σ passes.total`. Her yüzde 0–100 aralığında olmalı; her blokta pas sayısı bulunmalı ve toplam pas > 0 olmalı. Basit yüzde ortalaması kullanılmaz.
- 90 dakika değeri: `değer / dakika × 90` (dakika >= 90). Kaynak alanlar, toplama yöntemi, tarih ve `Veri: API-Football` sayfada yer alır.
- Yeni snapshot, eski el ile girilmiş sezon sayılarını *aynı kaynak etiketi altında karıştırmaz*. Eksik API alanlarına eski düz alanlardan, maç başına ortalamadan veya başka sezondan geri dönüş yok. `Number(null) === 0` tuzağı bu yol için kapatıldı.
- Kimlik güvenilirliği ve alan bazlı yayın kapısı korunur. Ayrılmış / aktif Süper Lig oyuncusu olmayan kayıtlar derin senkrona alınmaz; kulüp çelişkisinde sezon snapshot'ı yayımlanmaz. `services/playerStatsEligibility.js` güncel main’den alınan ortak aktiflik kuralıdır; liste kuralı değiştirilmedi.
- Maç geçmişi için mevcut `harvest-player-match-history.mjs` ve maç kadrosu/olay kayıtları kullanılmaya devam eder. Her oyuncu/maç için yeni istek döngüsü eklenmedi. Takım maç xG'si oyuncu xG'si olarak kullanılamaz.

## Kaynak kullanım koşulları

### API-Football
[Oyuncu istatistikleri dokümantasyonu](https://www.api-football.com/documentation-v3#tag/Players).
Mevcut sağlayıcı ve `/players?team=...&season=...` sayfalaması kullanılır. Oyuncu sezon şemasında xG/xA, piyasa değeri veya sözleşme bitişi yok; maç düzeyindeki takım xG'si oyuncuya dağıtılmaz. Dokümantasyon canlı fetch'i bu kontrolde HTTP 500 verdi; ardından [13 Mart 2026 tarihli resmi başlangıç rehberi](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) canlı okunarak `/players` alanları, çoklu turnuva toplamı ve pas isabetinin yüzde oluşu doğrulandı. Eşleme offline fixture testleriyle kilitlendi; oyuncu xG alanının erişilebilirliği varsayılmadı.

### Transfermarkt — alınmıyor
- [robots.txt](https://www.transfermarkt.com/robots.txt): `User-agent: * / Allow: /`; `wget` için `Disallow: /`. Robots izni kullanım lisansı değildir.
- [Terms of Use §11.1](https://www.transfermarkt.com/intern/anb): **“The User is not permitted to access or copy the Digital Content using bots, spiders, screen scraping or other automated processes.”**
- Bu açık yasak nedeniyle scraper/alternatif otomatik kopyalama uygulanmadı. Piyasa değeri ve sözleşme bilgisi Transfermarkt'tan doldurulmaz; mevcut doğrulanmış profil alanları korunur. Sayfa bunu açıklar. İleride ancak izinli/lisanslı veriyle doldurulabilir.

### FBref / Sports Reference — alınmıyor
- [FBref robots.txt](https://fbref.com/robots.txt) ve [Terms](https://www.sports-reference.com/termsofuse.html) canlı fetch/curl denemelerinde Cloudflare/timeout döndürdü; robot kuralları doğrudan okunamadı. Engel aşılmadı.
- Arama indeksindeki resmi [Data Use](https://www.sports-reference.com/data_use.html) metni: **“you should not create websites or tools based on data you scrape from Sports Reference or any of our sites ... without our permission.”**
- Resmi Terms yasaklar listesindeki 9. madde, siteyi olumsuz etkileyen otomatik erişim için yazılı izin ister; 10. madde rekabet eden/veriyi maddi olarak ikame eden veri deposu/hizmet kurmayı yasaklar. Bu istatistik sitesi için yeniden yayım izni doğrulanmadığından FBref aktarımı uygulanmadı.

### Understat — izin doğrulanamadı; alınmıyor
- [robots.txt](https://understat.com/robots.txt), [ana sayfa](https://understat.com/) ve `/terms` bu kontrolde **“We will come back soon”** bakım HTML'i döndürdü; gerçek robot kuralları veya kullanım lisansı okunamadı.
- [3 Kasım 2026 güncellemeli üçüncü taraf raporu](https://sportsdatatutorials.com/tutorials/build-an-xg-league-table-from-understat.html) tüm robotlara `Disallow: /` bildiriyor. Bu, bu oturumda doğrudan doğrulanmış bir Understat ToS maddesi **değildir**; açık izin yerine geçmez.
- İzin belirsizken oyuncu xG çekimi/isim eşlemesi uygulanmadı; mevcut maç şut deposu oyuncu xG kaynağı olarak kullanılmadı. Ayrı mevcut `sync-understat-shots.mjs` bu PR'ın kapsamında değiştirilmedi; onun kullanım izni ayrıca gözden geçirilmeli.

Yeni veri hostu kullanılmadığı için `ALLOWED_SOURCE_HOSTS` genişletilmedi; API-Football zaten izinli.

## Kota ve çalıştırma

`sync-turkish-player-profiles.mjs` mevcut haftalık adımı kullanır. Yalnızca eksik kimlik profilleri değil, 14 günden eski aktif profiller seçilir. Kimliği dolu bir oyuncunun sezon verisi de böyle yenilenebilir. Mevcut bütçe **80 istek/koşu**, günlük kalan **20** eşiği ve sayfalama sınırları aynıdır. Seçili oyuncu yoksa 0 istek/0 zenginleştirme; seçimin boş olması bütün oyuncuları güncellemez. Önceden yapılmış isteklerden gelen alanlar işlendiğinden endpoint/oyuncu/maç bazlı ek istek yok; seçimin genişlemesi eski koşulara göre bütçe içindeki kullanım sayısını artırabilir. Bu oturumun gerçek API-Football kota tüketimi: **0**.

Örnek mevcut komut (CI'da mevcut anahtarla):
`node scripts/sync-turkish-player-profiles.mjs --league=super-lig --stale-days=14 --request-budget=80 --apply --skip-squad-refresh`

Bu oturumda bu canlı apply komutu çalıştırılmadı. Üretilmiş HTML veya tam postprocess çıktısı commit edilmez. Manifest/service-worker/push/PWA dosyaları değiştirilmez.

## Doğrulama

- `node scripts/test-api-football-player-metrics.mjs`: sezon izolasyonu, 26 tanım, 20/23 azami saha oyuncusu kapsamı, null/sıfır, eksik turnuva, eski verinin üstüne güvenilir yenileme, kimlik kapısı, TR/EN sunucu HTML'i, kaynak/formüller ve boş seçimde 0 kota.
- Mevcut profil, sağlayıcı sözleşmesi ve zenginleştirme testleri ayrıca çalıştırılır.
- Mobilde mevcut `p360-stat-grid` (auto-fit/minmax 96px) korunur; uzun teknik formüller dar kartlara değil aynı bölümün açılır kaynak listesine alınır. Ek JS/kütüphane/API çağrısı yok. Bu oturumda 390px tarayıcı ekran görüntüsü alınmadı; görsel doğrulama iddiası yok.

### Bu oturumun test sonuçları

Geçti: `test-api-football-player-metrics`, `test-player-profile`, `test-player-enrichment` (offline sahte sağlayıcı), `test-provider-contract`, `test-player-canonical-merge`, `test-source-links`, `test-scheduled-updates`, `test-player-rating-engine` (22), `test-card-credibility` (10), `test-present-stat`; `git diff --check`.

Sınırlı/kırmızı kontroller:
- `test-player-360.mjs`, Osimhen'in gol alanının yayımlanmasını bekleyen 174. satırda durdu. `main`deki model aynı veri üzerinde aynı boş sonucu verdi: son doğrulama 64 gün önce olduğu için kimlik güvenilirliği kapalı. Eski veriyi taze göstermek için kapı gevşetilmedi.
- `test-i18n.mjs`: sözlük anahtar/boş değer kontrolleri geçti; 33 dosya/bağlantı kontrolü, inode sınırı nedeniyle kullanılan sparse worktree'de üretilmiş TR/EN HTML dizinleri bulunmadığından geçmedi. Tam üretim/postprocess çalıştırılmadı ve bu dosyalar commit'e dahil edilmedi.

## Kullanıcının ek isteği: ayrı PR'larla pilot açılım

PR #646 yalnızca ortak altyapıdır. Oyuncu kayıtları küçük, ayrı ve merge edilmeyen PR'larda `data/player-profile-evidence/*.json` dosyalarıyla etkinleşir. Bu yeni kayıtlar mevcut API-Football oyuncu-maç önbelleğindeki belirli gerçek maçları kullanır; sezon verisiymiş gibi göstermez. Tam sezon API dolumu ayrı mevcut senkronla devam eder. Her alan, kayıtlı maçların tamamında ölçülmüşse toplanır; eksikse “Güncelleniyor”. Bitiricilik, pres, yaratıcılık, istikrar ve teknik beceri puanı uydurulmaz. Maç xG'si oyuncuya bölüştürülmez. Ataberk'in tek kayıtlı maçı istikrar puanı üretmek için kullanılmaz.

### Öncelik sinyali

Gerçek “en çok trafik alan oyuncu” sıralaması üretilemiyor: `data/analytics/organic-traffic.json` GA4 bağlı değil/boş; `data/search-demand/search-console-status.json` Search Console bağlı değil diyor. Bu nedenle trafik sayısı/hacmi iddia edilmiyor. Elde olan **arama talebi vekili**: `data/search-demand/signals.json` içindeki 3 Ağustos 2026 tarihli Google autocomplete kayıtları. Doğrudan oyuncu sorgusu `osimhen` (10 kayıtlı öneri), ardından bağlamsal `salah trabzonspor` (9 öneri) ilk pilotu seçtiriyor. Öneri sayısı trafik hacmi değildir. Ataberk kullanıcı tarafından özellikle istendiği için sonraki ayrı pilotta yer alır. Öncelik 1/2/3 trafik puanı değil iş sırasıdır. Sitemap lastmod trafiğe kanıt diye kullanılmadı. Mevcut 80 istek sınırı altında haftalık senkron takım sırası da bu küçük kayıtların önceliğini izler.

Kimlik kontrolü, `super-lig-squads.json` içindeki son gerçekten çekilmiş, complete kadro kaydının tarihiyle yeniden değerlendirilir; bugünün saati doğrulama gibi yazılmaz. Bu dar doğrulama sadece yeni kayıtlı-maç bölümünü açar; eski rating/sezon alanlarını açmaz. Aktiflik için artık main'e birleşmiş `playerStatsEligibility.js` ortak kuralı kullanılır. Kaynak anahtarı gerekmeden mevcut veriden bu bölüm üretilebilir.

PR #642/#645 sonrası güncel main altyapı dalına merge commit'iyle alındı; önceden push edilmiş commitler yeniden yazılmadı. GitHub faturalama kısıtı nedeniyle CI beklenmez; ilgili testler her PR için yerelde çalıştırılır. `test-active-stats-players` sparse worktree'de bulunmayan eski profil HTML'ini bekleyen 50. satırda durur; aktiflik fonksiyonu ve yeni bölümün ayrılan oyuncuları reddetmesi ayrıca yerel testle doğrulanır.
