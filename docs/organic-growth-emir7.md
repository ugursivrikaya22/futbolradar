# FutbolRadar Türkiye organik büyüme teslim raporu

16 Ekim 2026. Çalışma `codex/organic-growth-emir7` branch'inde, güncel `origin/main`
(`b94a4e79c2e`) üzerinden ayrı worktree'de hazırlandı. Ana çalışma klasöründeki
kaydedilmemiş değişikliklere dokunulmadı. Production dağıtımı ve sosyal paylaşım yapılmadı.

## 1 Yapılan tanıtım iyileştirmeleri

- Ana sayfadaki mevcut ücretsiz/reklamsız görünür mesaj korundu; marka vaadi
  **FutbolRadar — Futbolun Nabzı, Reklamsız ve Ücretsiz.** olarak güncellendi.
  Kök/public ana sayfa ve yeniden üretimde kullanılan `data/brand-copy.json` eşlendi.
- Ana sayfa, bugün/canlı skor/sonuç/puan sayfaları ve haber, köşe yazısı,
  maç/maç analizi/rapor sayfalarına statik WhatsApp, X ve bağlantı kopyalama eklendi.
  Mevcut köşe paylaşım bölümündeki Facebook bağlantısı korunur.
- WhatsApp ve X normal bağlantıdır; JavaScript kapalıyken de çalışır. Kopyalama
  izni reddedildiğinde seçili adres ve erişilebilir durum mesajı gösterilir.
- Paylaşım başlığı mevcut Open Graph başlığından, adres canonical'dan alınır.
  Takım isimleri içeren maç başlıkları ve habere/köşeye özel görseller korunur.
  Eski genel SVG başvuruları mevcut PNG'ye çevrilir; eksik görsel açıklamaları eklenir.
  Her ziyaretçiye görsel üretilmez; hiçbir yeni görsel servisi yoktur.
- Tekrarlanan çalıştırma aynı çıktıyı verir. Ortak postprocess zincirine bağlandığı için
  hem tam build hem mevcut zamanlanmış üretim bu adımı kullanır; yeni zamanlama eklenmedi.
  JS/CSS mevcut içerik özetiyle sürümleme mekanizmasına dahil edildi.

Canlı ana sayfada ücretsiz/reklamsız mesajı gözlendi. İncelenen ana sayfa ve temel
istemci kodunda reklam gösterimi veya ödeme duvarı işareti bulunmadı. Bu, bütün
hesapların ve tüm üçüncü taraf ağ davranışlarının denetlendiği anlamına gelmez.
GA4/Google Ads ölçüm kodu reklam gösterimiyle aynı şey değildir; yeni reklam kampanyası açılmadı.

## 2 Otuz günlük pazarlama takvimi

[Araştırma ve günlük takvim](../marketing/organic-growth-2026-10.md): Maçkolik,
Sofascore, Flashscore, FotMob; 10 öncelikli fikir; sekiz sorgu niyeti; hazır metinler;
16 Ekim–14 Kasım için 30 satırlı plan. Her gün maç, resmî ilk 11, sonuç, tablo,
istatistik ve özgün yorum slotları koşullu tanımlandı. Etkinlik yoksa ilgili paylaşım yapılmaz.
Araştırma Codex araştırma alt ajanıyla yapıldı; Grok veya Claude çalıştırıldığı iddia edilmez.
Rakiplerin Türkiye pazar payı, Google sırası veya sosyal etkileşim üstünlüğü ölçülmedi.

## 3 Başlangıç trafik ölçümleri

[Başlangıç tablosu ve 7 14 30 gün rapor şablonları](../marketing/organic-growth-measurement.md).
GA4/GSC rapor erişimi olmadığı için gerçek tekil ziyaretçi ve kanal sayıları alınamadı.
Depodaki GSC durum kaydı 14 Ağustos'tan kalma ve yapılandırılmamış görünüyor;
bu kayıt güncel hesabın durumu diye sunulmadı. Ölçüm alanları veri yok olarak bırakıldı.

## 4 SEO fırsatları

Sekiz arama için mevcut program, canlı skor, Süper Lig tablo/sonuç ve dört takım
sayfası kullanılacak; yeni yinelenen açılış sayfası üretilmedi. Öncelik sıralaması
GSC verisi gelince sorgu–sayfa eşleşmesi, gösterim, CTR ve konuma göre yeniden yapılmalı.
Başlangıçta saat/kanal bilgisi, veri güncelliği ve sonraki maça erişim iyileştirme hipotezidir;
ölçülmüş sıralama kazanımı değildir. Teknik değişiklik bu turda paylaşım/OG ve marka ile sınırlıdır;
maç bilgisi ve yayın kanalı uydurulmadı.

## 5 Kullanıcı geri dönüş stratejisi

- Mevcut `pwa.js` favori takım seçimini ve takım sayfalarını anlat; yeni üyelik/veri tabanı ekleme.
- Mevcut `live-follow.js` maç takibini kullan. Bildirimler kullanıcının açık seçimine bağlı kalsın;
  mevcut push ayarları değiştirilmedi, yeni bildirim servisi veya sorgu eklenmedi.
- Dört takımın kalıcı sayfasını kaydetme, haftalık maç programı ve ilgili haber/köşe
  bağlantılarıyla ikinci ziyaret için somut gerekçe ver. Yeni otomatik mesaj gönderme.
- `/tahmin-ligi` 16 Ekim kontrolünde **HTTP 404** döndü. Kodda üretici bulunmasına rağmen
  canlı özellik kabul edilmedi. Tanıtım ve dönüşüm hedefi, sayfa ve gerçek kayıt/tahmin
  akışı başarıyla doğrulanıncaya kadar uygulanamaz.

## 6 Test sonuçları

- `node --test tests/organic-growth.test.mjs`: **8/8 başarılı**. Türkçe/özel karakterler,
  canonical kimliği, geçersiz adresler, görüntü koruması, tekrar build, kök/public eşliği,
  gerçek ana sayfa/haber/köşe/maç örnekleri ve postprocess sırası kapsandı.
- Tarayıcı testi: **320, 390, 1440 px başarılı**. Kopyalama başarı/ret, elle seçme,
  klavye odağı, ekrana sığma ve JavaScript kapalı paylaşım bağlantıları doğrulandı.
  Test gerçek statik ana sayfada paylaşım katmanını izole eder; diğer uygulama betikleri
  ve canlı API'ler kapalıdır. Tüm ürünün uçtan uca testi değildir.
- `test-postprocess-chain.mjs`: başarılı.
- `test-og-image.mjs`: **15.937 sayfa ve 3 görsel varlığı başarılı**.
- `test-cost-controls.mjs` ve `test-runtime-cost.mjs`: başarılı.
- JavaScript sözdizimi ve `git diff --check`: başarılı.
- Bellekte dönüştürülen **9.093 hedef sayfada** ikinci dönüşüm aynı çıktı verdi;
  bu denetim yayın dosyalarını değiştirmedi.

Tam build ve tüm proje testleri yerelde çalıştırılmadı. PR'ın mevcut CI akışı geniş
build/production doğrulamasını yapar; sonucu ayrıca kontrol edilmelidir. Üretilen bütün
binlerce HTML dosyası PR'a eklenmedi; yeni paylaşım arayüzü build sırasında uygulanır.
Yerel kanıtlar: `outputs/organic-growth/browser-results.json`, `static-audit.json`
ve `share-320.png`, `share-390.png`, `share-1440.png` (git'e eklenmeyen çıktı klasörü).

## 7 Beklenen maliyet değişikliği

Yeni ücretli API, abonelik, reklam, AI servisi, cron, sunucu fonksiyonu veya veri sorgusu yok.
Yeni tarayıcı kodu 1.095 bayt JS + 755 bayt CSS (sıkıştırılmamış); sayfa başına yaklaşık
1,7 KB statik HTML eklenir. Mevcut varlık sürümleme kullanılır. Build taraması 9.093 kök
sayfada yaklaşık 5,3 saniye sürdü; yazma ve public aynası dahil tam build süresi değildir.
Statik dosya aktarımı ve build işi az miktarda artar; toplam fatura sıfır artacak diye
garanti verilmez. Mevcut kota/fatura paneline erişilmedi. Yayın öncesinde mevcut
limitlere yakınlık kontrol edilmeli; plan/limit ve maliyet korumaları değiştirilmedi.

## 8 Pull request

Başlık: `feat: add organic sharing and Turkey growth playbook`.
Branch: `codex/organic-growth-emir7`. PR URL'si teslim mesajında verilir.
Vercel ayarları bu branch için otomatik preview dağıtımı açmıyor; main birleştirmesi
ve production yayını bu çalışmanın parçası değildir.

## 9 Günlük 1000 ziyaretçi için sonraki aksiyonlar

1. Mevcut GA4 ve GSC raporlarını alarak ölçüm tablosunu doldur; bilinmeyen başlangıcı sıfır sayma.
2. PR'ı ve geniş CI sonuçlarını incele; production yayınını ayrıca onayla.
3. İlk hafta mevcut program ve dört takım sayfasına yönlenen kaynaklı içerik taslaklarını kullan.
4. 22 Ekim'de trafik kaynağını; 29 Ekim'de en iyi iki formatı ve tekrar ziyareti;
   14 Kasım'da hedef açığını ve sonraki ayın emek dağılımını değerlendir.
5. Hedefe ulaşıldığını tek başarılı gün veya kanal kullanıcılarını toplayarak ilan etme;
   günlük tekil seri ile son yedi gün medyanını birlikte takip et.

Hedef bir başarı taahhüdü değildir. Gerçek sonuç, içerik üretimi, yayın ve kullanıcı talebine bağlıdır.
