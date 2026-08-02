# Transfer alım otomasyonu

Türk kulüplerini ilgilendiren transferleri resmî ve güvenilir kaynaklardan
otomatik toplayıp yayına hazırlayan hat.

## Tek cümlelik sözleşme

**Basın haberi resmî transfer değildir.** `official` durumu yalnızca resmî
katmandan (kulüp sitesi/sosyal hesabı, KAP, TFF, oyuncu/menajerlik) gelen bir
kaynakla verilebilir. Bu kural iyi niyete değil koda gömülü:
`services/transfers/statusModel.js` içindeki `statusCeiling()` medya
kaynaklarının tavanını `agreement_reached` ile sınırlar ve aşan her talebi
gerekçesiyle aşağı çeker.

## Çalıştırma

```bash
npm run transfer:ingest          # resmî/birincil kaynaklar (fast)
npm run transfer:ingest:broad    # geniş haber kaynakları (broad)

node scripts/ingest-transfers.mjs --cadence=fast --dry-run
node scripts/ingest-transfers.mjs --fixture=scripts/fixtures/transfer-sources.json
```

Elle tetikleme: GitHub → Actions → **Transfer Ingestion Automation** →
*Run workflow* → `cadence` (fast/broad) ve isteğe bağlı `dry_run`.

## Zamanlama

| Ritim | Sıklık | Kaynaklar |
| --- | --- | --- |
| `fast` | 5 dakika | KAP, Anadolu Ajansı |
| `broad` | 10 dakika | TRT Haber, Hürriyet, Fotomaç |

Her ritim kendi `concurrency` grubunda ve `cancel-in-progress: false`; aynı
anda iki koşu `data/transfers.json`'a yazamaz.

## Ortam değişkenleri

Hattın çalışması için **zorunlu secret yok** — kaynaklar açık ve resmîdir.

| Değişken | Zorunlu | İşlevi |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | hayır | Bildirim gönderimi. Yoksa koşu çökmez; eksik değişkenin adı koşu özetine yazılır. |
| `TELEGRAM_CHAT_ID` | hayır | Bildirimin gideceği sohbet. |

`GITHUB_STEP_SUMMARY` Actions tarafından sağlanır; koşu özeti oraya yazılır.

## Kaynak erişilebilirliği — bilinen kısıt

Öncelik listesinin ilki kulüplerin kendi siteleridir ve bu sıra doğrudur.
Ölçülen gerçek şu: `galatasaray.org`, `fenerbahce.org`, `bjk.com.tr`,
`trabzonspor.org.tr` ve `tff.org` sunucu tarafı isteklere Cloudflare tarayıcı
doğrulamasıyla yanıt veriyor (403 "Just a moment") — bir CI koşusundan düz
HTTP ile okunamıyorlar.

Bu kaynaklar **kayıt defterinden silinmedi**; `transport: "browser"` ve
`enabled: false` ile duruyorlar ve her sağlık raporunda "erişilemiyor"
satırı üretiyorlar. Silinselerdi eksiklik görünmez olurdu.

Erişilebilen resmî katman **KAP**'tır: kulüpler sportif sözleşmeleri oraya
yasal zorunlulukla bildirir. Pratikte `official` durumu oradan gelir.

Kulüp sitelerini açmak için tarayıcı taşıyıcısı (Playwright) gerekir. Proje
sıfır bağımlılıklı ve 5 dakikalık bir cron'a tarayıcı kurulumu eklemek koşuyu
bütçeden çıkarır; taşıyıcı eklendiği gün tek yapılacak şey
`sourceRegistry.js` içindeki `enabled` bayrağını açmaktır.

## Mimari

Kaynağa özgü mantık yayın mantığından ayrı:

| Modül | Sorumluluk |
| --- | --- |
| `sourceRegistry.js` | Kaynak listesi, katman, ritim, taşıyıcı |
| `fetcher.js` | HTTP, zaman aşımı, üstel geri çekilme, Cloudflare tespiti |
| `parser.js` | RSS/HTML/JSON ayrıştırma, durum/tür/kulüp/ücret çıkarımı |
| `normalizer.js` | Türkçe katlama, kulüp takma adları, transfer penceresi |
| `playerDirectory.js` | Oyuncu adı doğrulama kapısı |
| `validator.js` | Ret / karantina kararları |
| `deduplicator.js` | Kimlik ve eşleştirme |
| `confidence.js` | Güven skoru |
| `updater.js` | Durum geçişi, birleştirme, değişim geçmişi |
| `publisher.js` | Başlık, haber gövdesi, bant öğesi, kayıt biçimi |
| `notifier.js` | Telegram + koşu özeti |

## Tekilleştirme

Kimlik: `oyuncu + eski kulüp + yeni kulüp + transfer penceresi`.

Erken haberlerde çoğu zaman yalnızca hedef kulüp bilinir. Kimlik ikisini de
şart koşsaydı aynı transfer önce `?→GS`, sonra `Y→GS` olarak iki kayıt
üretirdi. Bu yüzden eşleştirme iki aşamalı: tam kimlik, tutmazsa oyuncu +
pencere + bilinen taraflardan biri. İkincisi tutarsa kayıt birleştirilir,
eksik taraf doldurulur, **ikinci makale açılmaz**.

## Durum akışı

```
rumor → negotiation → advanced_talks → agreement_reached → official
                                    ↘ denied / cancelled ↙
```

İleri geçiş serbest, geri geçiş engellenir (bir kaydı sessizce zayıflatmak,
okuyucunun gördüğü doğru bilgiyi geri almaktır). Terminal durumlara her
aşamadan düşülebilir; terminalden çıkış "yeniden canlanma" olarak işaretlenir
ve bildirim üretir.

## Üç kapı

Hiçbir kayıt üç kapıyı birden geçmeden yayımlanmaz:

1. **İlgi** — metinde tanınan bir Türk kulübü geçmeli (Süper Lig ∪ 1. Lig ∪
   ligden düşmüş kulüpler).
2. **Oyuncu** — ad `data/players.json` / `data/super-lig-squads.json` içinde
   bulunmalı. Bulunmazsa **karantina**, ret değil: gerçekten yeni bir yabancı
   transferi olabilir.
3. **Doğrulama** — kaynak URL'si izlenebilir, tarih geçerli, durum çözülmüş,
   mevcut resmî kayıtla çelişmiyor.

Üçüncü kapı neden var: hattın canlı kaynaklara karşı ilk koşusunda ayrıştırıcı
"David", "Türk" ve "Devrim Bodrum" adlı üç oyuncu üretmişti. Kalıp
iyileştirmesi bu sınıf hatayı azaltır, bitirmez.

## Sağlık raporu

`data/transfer-ingestion-health.json` her koşuda yazılır ve hiçbir şeyi
gizlemez: son koşu, yoklanan kaynaklar, **erişilemeyen kaynaklar ve gerekçesi**,
yeni/güncellenen/atlanan/reddedilen sayıları, ortalama alım gecikmesi, son
resmî transfer.

Karantinaya alınan kayıtlar `data/transfer-quarantine.json` içinde gerekçesiyle
durur.
