# Metin Şablonları

Bu dizin, kullanıcıya görünen **sabit Türkçe metinleri** taşır. Kod değil, cümle
saklar: bir rozetin üstünde ne yazdığını, bir rapor durumunun okuyucuya nasıl
anlatıldığını, veri gelmediğinde hangi cümlenin basıldığını.

## Neden ayrı bir dizin?

Bir metin ile onu seçen kural aynı satırda durduğunda, üslup düzeltmesi kural
düzeltmesine dönüşme riski taşır. "Kısmi rapor · veri tamamlanmadı" cümlesini
yeniden yazan kişi, hemen altındaki `FULL_COVERAGE_RATIO` eşiğine dokunmak
zorunda kalmamalı; dokunursa sayfada hiçbir hata görünmeden yanlış rapor durumu
üretilir.

Bu yüzden ayrım şudur:

- **Şablon (bu dizin)** — cümlenin kendisi. Redaksiyon burada yapılır.
- **Servis (`services/*.js`)** — hangi cümlenin ne zaman basılacağı. Kural orada
  kalır ve tek yetkili karar noktası olmayı sürdürür.

Şablonlar **yetkili kaynaktır**: servis metni buradan `require` ile okur, kendi
kopyasını tutmaz. Aynı cümlenin iki yerde yaşaması, ikisinin bir gün ayrışması
demektir.

## Dosyalar

| Dosya | İçerik | Okuyan |
| --- | --- | --- |
| `report-status.json` | Maç raporunun beş durumu (`key`, `text`, `tone`, `detail`) | `services/matchReportStages.js` → `REPORT_STATUS` |
| `trust-labels.json` | Güven etiketleri söz dağarcığı (`text`, `tone`, `title`) | `services/trustLabels.js` → `TRUST_LABELS` |
| `awaiting.json` | "Veri bekleniyor" ailesi: boş durum metinleri | Katalog — aşağıya bakın |

Her dosyanın başında bir `$comment` alanı vardır; JSON yorum taşıyamadığı için
dosyanın sözleşmesi oraya yazılır. Metinler `statuses` / `labels` / `texts`
anahtarının altındadır, böylece `$comment` sözlüğe karışmaz.

### `awaiting.json` bir kataloğdur

Bu dosya henüz servislere bağlı **değil**: içindeki cümleler hâlâ kendi
modüllerinde tanımlı. Dosya, dağınık hâldeki "veri bekleniyor" ailesini tek
yerde görünür kılmak için var — hangi boşluğun hangi cümleyle anlatıldığını,
aynı fikri anlatan iki farklı cümle olup olmadığını buradan okuyabilirsiniz.

Girdi kuralı katıdır: buraya yalnızca `services/` içinde **gerçekten kullanılan**,
kullanıcıya görünen cümleler girer. Yeni bir boş durum cümlesi burada icat
edilmez; önce serviste kullanılır, sonra buraya kaydedilir. Her girdi hangi
modüllerde geçtiğini (`modules`) ve hangi boşluğu anlattığını (`usage`) söyler.

## Metin nasıl düzenlenir?

1. JSON'daki cümleyi değiştirin. Anahtar adlarına, `key` değerlerine, `tone`
   değerlerine ve sıraya **dokunmayın** — bunlar sözleşmedir, metin değildir.
   `key` ve `tone` CSS sınıflarına ve API yanıtlarına gider.
2. Aynı cümlenin bir aynası varsa onu da güncelleyin. Bugün iki ayna var:
   - `app.js` içindeki `TRUST_LABELS` (istemci tarafı, modülsüz ES5).
   - `services/transferService.js` içindeki `SOURCE_TYPES` — `official`,
     `media`, `rumour` metinleri buradakiyle birebir aynı olmak zorunda.
3. Testleri çalıştırın (aşağıya bakın). Ayna ayrışmışsa test kırmızı olur.

Değiştirmeden önce sorulacak soru: bu cümle bir **ölçüm iddiası** taşıyor mu?
Şablonlar sayı basmaz ve tahmin yürütmez. Veri yoksa cümle bunu açıkça söyler;
"yakında", "muhtemelen", yüzde ya da olasılık dili buraya giremez. Bahis dili
(`banko`, `kupon`, `iddaa`, `bahis`, `oran`) zaten testle engellidir.

## Eşliği hangi test korur?

| Test | Neyi korur |
| --- | --- |
| `scripts/test-trust-labels.mjs` | Söz dağarcığının kapalılığı, bahis dili yasağı, `app.js` aynasıyla metin eşliği, yayımlanmış sayfalarda tanımsız etiket olmaması |
| `scripts/test-transfer-pipeline.mjs` | `trust-labels.json` ↔ `services/transferService.js` `SOURCE_TYPES` metin eşliği ve `app.js` aynası |
| `scripts/test-report-pipeline.mjs` | Rapor durumlarının doğru pencerede seçilmesi; `key` değerlerinin sözleşmeye uyması |

Üçü de tam eşleşme arar: tek karakterlik bir fark testi düşürür. Bu kasıtlıdır —
sessizce ayrışan bir metin, okuyucuya iki farklı yerde iki farklı gerçek söyler.

```
npm test
```
