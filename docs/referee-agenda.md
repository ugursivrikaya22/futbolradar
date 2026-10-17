# Hakemler Dosyası gündem şeridi

Ana sayfaya özel, dört ayrı öğeli şerit. H1/H2 üretmez. CSS transform ile kayar; üzerine gelince, klavye odağında veya duraklatma düğmesiyle durur. Mobilde bölge kendi içinde kırpılır; azaltılmış hareket tercihinde animasyon kapanır, içerik yatay kaydırılarak okunur. Kopya döngü grubu inert ve aria-hidden'dır. Açık/koyu tema desteklenir. Şerit görünürken masaüstünde 64, mobilde 102 piksel alan ayrılır. Geçerli doğrulanmış öğe yokken şerit gizlenir ve yer kaplamaz. Yeni JS+CSS yaklaşık 8 KB, kütüphane veya dış font yok. Gerçek saha Core Web Vitals ölçümü ayrıca canlı yayında yapılmalıdır.

## İçerik ve bağlantı

- Kaynak: `editorial/referee-agenda.json`; derlenmiş güvenilir çıktı: `data/referee-agenda.json` ve public kopyası.
- Varsayılan dahili haber: `/haber/hakemler-dosyasi-son-gelismeler.html`.
- Köşe yazısının adresi belli olunca `destinationHref` alanına `/kose-yazilari/slug.html` yazılır. Yalnız mevcut yerel sayfalar kabul edilir. Alan boşsa `data/columns.json` içinde `status: published` ve `hakem-sorusturmasi` etiketi bulunan en yeni köşe yazısı otomatik seçilir.
- `data/news.json` içindeki aynı etikete sahip `status: verified` haberlerin `agendaItem` alanı da aynı inceleme kurallarından geçebilir. Etiket veya haberin verified olması tek başına şerit onayı değildir.
- İlk dört öğe: Gündoğdu dahil yedi kişinin adliyeye sevki; Kol ve Erel'in gözaltına alınması; müşteki/tanık ifadeleri; VAR konusunda TFF ve Başsavcılığın farklı açıklamaları. Başlangıç isteğindeki “inceleme gerçekleştirildi” ifadesi kesin olgu olarak kullanılmadı. İki açıklama atıfla aktarıldı.
- Kaynak saati belli değilse saat uydurulmaz: VAR kaynağında `sourceTimePrecision: date` vardır, gün başlangıcı yalnız muhafazakâr tazelik sınırı olarak kullanılır. Ekrandaki saat FutbolRadar güncelleme saatidir (TSİ).

## Editoryal kontrol

Öncelik İstanbul Cumhuriyet Başsavcılığı/resmî açıklamalar → TFF → AA → güvenilir ulusal haber kuruluşları. `services/refereeAgenda.js` kaynak alan adlarını HTTPS üzerinden doğrular; benzer görünen sahte alan adlarını kabul etmez. Kaynak sayfası açılarak haberin tarihi, kişisi, adli aşaması ve daha yeni/çelişen açıklama bulunup bulunmadığı kontrol edilir. Bir kaynak alan adının güvenilir olması, içeriğinin otomatik doğru sayılması anlamına gelmez.

Her kayıt `status: approved`, `review.status: verified`, `review.by`, `review.checkedAt`, `review.notes`, `legalStatusChecked: true`, `conflictsChecked: true` ve `review.contentHash` ister. Kaynak kontrolü otomasyon tarafından yapıldıysa by alanı açıkça Codex der; insan editör onayı varmış gibi yazılmaz. İçerik veya kaynak değişince eski hash geçersiz olur. Kontrol bittikten sonra `require('./services/refereeAgenda').reviewHash(item)` çıktısı kaydedilir. Hash bir kriptografik imza veya kimlik doğrulaması değildir; inceleme sonrası yanlışlıkla değişen içeriğin yayımlanmasını önler. JSON yazabilen bir kullanıcıya karşı yetkilendirme mekanizması olarak kullanılmaz.

Gözaltı, adliyeye sevk, serbest bırakılma, tutuklama ve adli kontrol ayrı `legalStatus` değerlerinden kontrollü cümle üretir. Bir durum diğerine dönüştürülmez. “Suçlu”, “şikeci”, “bahisçi” ifadeleri reddedilir. Farklı bir adli karar mevcut durumlardan birine zorlanmamalı; kaynaklı bir şablon ve test eklenmeden beklemelidir.

RSS keşifleri `editorial/referee-review-queue.json` içine pending-review olarak gider. Hakemler Dosyası haberleri otomatik genel ticker ve latest-news yayınından da ayrılır. Yeni keşif kendi başına SON DAKİKA yayımlayamaz. Özel kaynak taraması ayrıca bu sohbette oluşturulan iki saatlik heartbeat tarafından yapılır. Çelişkili kaynaklar kesin sonuca çevrilmez; atıflı düzeltme veya inceleme kuyruğu kullanılır.

## Eskime ve adli durum değişimi

- Her öğede sourcePublishedAt, publishedAt, updatedAt, expiresAt bulunur.
- Öğe, expiresAt / ilk FutbolRadar yayını +24 saat / kaynak yayını +72 saat tarihlerinden en erken olanında çıkar.
- SON DAKİKA yalnız onaylı, önemli (`importance: high`) ve kaynak zamanı 12 saatten genç öğe varsa görünür; sonra GÜNDEM olur.
- Aynı kişinin `subjectKeys` değeri sabit tutulur. Yeni olay eski adli durumu kaldırır. İki kişilik eski haberde yalnız bir kişinin durumu değişirse eski birleşik haber bütünüyle çıkar; diğer kişi için gerekirse ayrı doğrulanmış kayıt hazırlanır.
- `supersedes` ile açık düzeltme ilişkisi de kurulabilir. Yenisi süresi dolunca eski durum geri getirilmez.
- “Yeni gelişme yok” kontrolü publishedAt/updatedAt değiştirmez. Sayfa beş dakikada bir aynı küçük yerel JSON'u kontrol eder; görünmeyen sekmede ağ isteği atmaz. Dakikalık yerel kontrol eski bilgiyi ağ hatasında bile kaldırır. Feed için no-store başlığı kullanılır.
- Boş durumda şerit gizlenir. Arka plandaki beş dakikalık veri kontrolü devam eder; yeni geçerli doğrulanmış öğe geldiğinde şerit otomatik açılır. Son öğenin süresi dolunca yeniden gizlenir.

## Çalıştırma ve yayın

`node scripts/build-referee-agenda.mjs` şeridi, köşe yazısı hedefini, JSON çıktısını ve haber arşivi verisini günceller. `node scripts/generate-news-pages.mjs --id=hakemler-dosyasi-son-gelismeler` ilgili haber HTML'ini üretir. `npm run build:referee-agenda` ikisini çalıştırır. Node kullanılabilir fakat bu oturumda npm PATH içinde değildi; kontroller Node ile yapıldı.

Mevcut build ve saatlik scheduled-update hattına generator eklendi. Yayın kaynağı henüz onaylanmadıysa veya süresi dolduysa eksik içerik üretilmez. `.vercelignore` private editorial dosyalarını dışarıda tutar; bu ortamda build önceden kontrol edilmiş public feed'i korur, sürelerini uzatmaz. Gerçek deploy/push bu görevde yapılmadı. Heartbeat yerel değişikliği canlı güncelleme diye bildirmemelidir. Deploy olmadan production site bu yerel değişiklikleri alamaz.

Testler: `node --test tests/referee-agenda.test.cjs`, `node scripts/test-referee-agenda-browser.cjs` (PLAYWRIGHT_MODULE runtime), mevcut scheduled-update/news-ticker/news-publication regresyonları. Browser 320/390/768/1440, açık/koyu tema, azaltılmış hareket, pause, link, canlı expiry ve taşmayı denetler. Görseller outputs/referee-agenda-qa içinde.
