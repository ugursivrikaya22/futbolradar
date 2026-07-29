# Üst Haber Bandı (Akan Yazı)

Sitenin en üstündeki akan şerit. Her sayfada görünür, mobil uyumludur ve her
öğesi tıklanabilir bir bağlantıdır.

## Tek merkez

Bandın ne göstereceğine dair **her karar** `services/tickerService.js` içinde
verilir. Sunum katmanı (`scripts/lib/layout.mjs` → `newsTicker()`) yalnızca
üretilen listeyi çizer ve hiçbir içerik kararı vermez.

```
data/*.json  ──▶  services/tickerService.js  ──▶  scripts/lib/tickerFeed.mjs  ──▶  scripts/lib/layout.mjs
 (kaynaklar)      (kural: sıra, kota, rozet)     (yedek + durum dosyası)        (HTML)
                                                          │
                                                          ▼
                                          scripts/apply-shared-layout.mjs
                                           (tüm HTML sayfalara yazar)
```

## Kaynaklar

| Kaynak | Öncelik | Kota (en az / en çok) | Dosya | Ne gösterir |
| --- | --- | --- | --- | --- |
| `live` | 0 | 2 / 4 | `matches.json`, `fixture-calendar.json` | Oynanan maçın anlık skoru |
| `today` | 1 | 2 / 4 | `matches.json`, `fixture-calendar.json` | Bugünün başlayacak maçları, saatiyle |
| `result` | 2 | 1 / 3 | `matches.json`, `fixture-calendar.json` | Biten maçların skoru |
| `transfer` | 3 | 1 / 2 | `transfers.json` | Onaylı transfer hareketleri |
| `statement` | 4 | 1 / 3 | `statements.json` | Maç sonu teknik direktör / futbolcu sözleri |
| `news` | 5 | 1 / 2 | `news.json` | Doğrulanmış editoryal haberler |

Sıra `services/agendaService.js` içindeki `TIER` sırasının aynısıdır: önce
maçlar (canlı, bugün, sonuç), sonra kesinleşmiş transferler, sonra maç sonu
açıklamaları, en sonda editoryal gündem. Bant ile bülten farklı sıra
kullansaydı okuyucu aynı günün gündemini iki farklı düzende okurdu.

Kota sistemi tek bir kategorinin bandı ele geçirmesini engeller: her dolu
kategori en az `minSlots` kadar yer alır, kalan yerler önceliğe göre dolar.
`minSlots` toplamı `MAX_ITEMS` değerini aşamaz — aşsaydı son kategoriler garantili
yerini alamazdı ve `composeTickerFeed` bunu ayrıca doğrular. Bant en fazla
`MAX_ITEMS` (10) öğe taşır.

Yaş sınırı da kaynağa göre değişir: maç ve haber içeriği için `MAX_AGE_HOURS`
(7 gün), transferler için `TRANSFER_MAX_AGE_HOURS` (21 gün). Bir maç sonucu
bir hafta sonra haber değerini yitirir, "X kulübe katıldı" bilgisi ise
transfer dönemi boyunca geçerli kalır. Bu tazelik iddiasını gevşetmez: rozet
hâlâ banttaki **en taze** öğeye bakar, eski bir transfer tek başına "Son
Dakika" üretemez.

## Öğe yapısı

`composeTickerFeed()` şu şekilde öğeler üretir:

```js
{
  kind: "live" | "today" | "result" | "transfer" | "statement" | "news",
  label: "Canlı",            // rozet metni
  text: "Fenerbahçe 1-0 Galatasaray",
  href: "canli-skor.html#mac-id",
  at: "2026-08-10T21:00:00+03:00",  // ISO 8601, sıralama ve tazelik için
  weight: 100,               // kulüp ilgisi × tazelik — kategori İÇİ sıra
  priority: 0,               // kaynağın önceliği
  source: "live"             // kaynağın kimliği (tanılama için)
}
```

Kategoriler arasındaki sırayı `priority`, kategori içindeki sırayı `weight`
belirler; ağırlık eşitse tazelik karar verir. Tazelik tek ölçüt olduğunda
aynı gün gelen iki transferden daha az aranan kulübünki öne geçebiliyordu.

Dönen nesne:

```js
{
  items: [...],
  badge: "Canlı" | "Son Dakika" | "Gündem" | "Veri Bekleniyor",
  fresh: boolean,       // en taze GERÇEKLEŞMİŞ öğe 36 saat içinde mi
  live: boolean,        // bantta canlı maç var mı
  awaiting: boolean,    // hiç doğrulanmış kayıt yok mu
  note: string | null,  // awaiting durumunda okuyucuya yazılan cümle
  sourceReport: [{ id, available, used }]
}
```

## Rozet bir iddiadır

* **Canlı** — yalnızca bantta gerçekten canlı bir maç varsa.
* **Son Dakika** — yalnızca son 36 saat içinde **gerçekleşmiş** bir öğe varsa.
  Bugünün henüz başlamamış maçı bu rozeti üretemez: zaman damgası gelecektedir
  ve program kaydı "son dakika" değildir.
* **Gündem** — içerik gerçek ama taze değil.
* **Veri Bekleniyor** — hiç doğrulanmış kayıt yok.

## Veri yoksa ne olur

1. Kaynaklar bir tur boyunca boş dönerse (senkron hatası, sağlayıcı kesintisi)
   son doğrulanmış liste `data/ticker-state.json` üzerinden korunur. Okuyucu
   gerçek ama eski bir başlık görür, sahte bir "son dakika" görmez.
2. Yedek de yoksa bant **sayfadan silinmez**: açıkça "veri bekleniyor" yazan
   sabit bir satıra dönüşür. Uydurma başlık hiçbir koşulda üretilmez.

`data/ticker-state.json` yalnızca içerik gerçekten değiştiğinde yazılır; aksi
hâlde beş dakikalık CI turu sırf zaman damgası değişti diye gereksiz bir
commit ve dağıtım tetiklerdi.

## Yeni haber nasıl eklenir

### Editoryal haber (`data/news.json`)

```json
{
  "id": "kisa-kebab-case-kimlik",
  "category": "Süper Lig",
  "title": "Görünen başlık",
  "summary": "Kart görünümünde kullanılan özet.",
  "publishedAt": "2026-08-10T21:30:00+03:00",
  "team": "Fenerbahçe",
  "url": "https://kaynak-adresi/...",
  "sourceName": "Kaynağın adı",
  "status": "verified",
  "isFeatured": false
}
```

`status` **`verified` olmalı** ve `url` bulunmalıdır; aksi hâlde kayıt banda
girmez ve gerekçe derleme günlüğüne yazılır. Yedi günden eski haber banda
alınmaz.

### Maç sonu açıklaması (`data/statements.json`)

Alan sözleşmesinin tamamı dosyanın kendi `_readme` bloğundadır. Özet:

```json
{
  "id": "kebab-case-kimlik",
  "matchId": "goztepe-rudes-2026-07-26",
  "speaker": "Konuşanın adı",
  "role": "coach",
  "team": "Göztepe",
  "quote": "Kaynakta yazan cümlenin aynısı.",
  "context": "Maç sonu basın toplantısı",
  "publishedAt": "2026-07-26T22:10:00+03:00",
  "sourceName": "Kulübün resmî sitesi",
  "url": "https://...",
  "status": "verified"
}
```

`matchId`, `data/matches.json` içindeki maç kimliğidir; maç sayfası kendi
açıklamalarını bu alana göre toplar. Söz **kısaltılabilir ama değiştirilemez**;
atlanan bölüm `…` ile gösterilir.

### Maç, skor ve transfer

Bunlar elle eklenmez. `data/matches.json`, `data/fixture-calendar.json` ve
`data/transfers.json` kendi senkron hatlarından beslenir; bant onları
kendiliğinden okur.

## Yeni bir kaynak eklemek

`services/tickerService.js` içindeki `SOURCES` dizisine tek bir giriş eklemek
yeterlidir:

```js
{ id: "yeni-kaynak", priority: 6, minSlots: 1, maxItems: 2, load: yeniKaynakItems }
```

`load(context)` yalnızca `context.now` alır ve yukarıdaki öğe yapısını
döndürür. Sıra, kota, tekilleştirme ve tazelik denetimi kendiliğinden
uygulanır.

## Sonradan API'ye bağlamak

Her kaynak `load(context)` sözleşmesine uyan saf bir fonksiyondur. Bir
sağlayıcıya geçmek için ilgili kaynağın `load` gövdesini değiştirmek yeterli;
kota, rozet, tekilleştirme ve sunum katmanına dokunulmaz.

`composeTickerFeed({ sources })` çağıranın verdiği kaynak listesini de kabul
eder, böylece API kaynağı dosya kaynağının **yanına** ya da **yerine**
takılabilir:

```js
const { composeTickerFeed, SOURCES } = require("./services/tickerService.js");

const feed = composeTickerFeed({
  sources: [...SOURCES, { id: "saglayici", priority: 0, minSlots: 2, maxItems: 4, load: providerItems }]
});
```

## Testler

`scripts/test-ticker-feed.mjs` (`npm test` içinde) şunları doğrular:
doğrulanmış kaynak zorunluluğu, kategori kotası, canlı/tazelik rozeti,
bugünün maçlarının saatiyle girmesi, açıklamaların yalnızca doğrulanmışken
girmesi, tıklanabilirlik, "veri bekleniyor" durumu ve yedek koruma.
