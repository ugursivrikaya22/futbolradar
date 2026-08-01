# Son Dakika / Gündem Bandı Operasyonları

Sitenin üst şeridindeki kayan bant. Her sayfada aynı içerik görünür; farklı
sayfaların çelişen başlık göstermesi yapısal olarak imkânsız çünkü bant tek
bir yerde üretilip bütün HTML dosyalarına aynı işaretlemeyle basılır.

## 1. İçerik nereden geliyor?

Bant **dört doğrulanmış kaynaktan** beslenir. Hepsi
`scripts/lib/tickerFeed.mjs` → `buildTickerFeed()` içinde birleşir:

| # | Kaynak | Dosya | Bant etiketi |
|---|--------|-------|--------------|
| 1 | Doğrulanmış maç kaydı | `data/matches.json` | `Canlı` / `Sonuç` |
| 2 | Onaylı transferler | `data/transfers.json` (`status: "confirmed"`) | `Transfer` |
| 3 | Editoryal haberler | `data/news.json` (`status: "verified"`) | haberin kategorisi |
| 4 | Küratörlü gündem | `data/news-ticker.json` | kategori etiketi |

Dördüncü kaynak diğer üçünden farklı: **elle girilir**. Türetilmiş veride
yanlışlık bir hesaplama hatasıdır, elle girilen veride yanlışlık bir
İDDİADIR. Kural katmanı bu yüzden ayrı bir serviste:
`services/newsTicker.js`.

### `data/news.json` ile `data/news-ticker.json` ilişkisi

Bir haber kaydı isteğe bağlı bir `ticker` bloğu taşıyabilir:

```json
{
  "id": "galatasaray-musiala-resmi-aciklama",
  "title": "Galatasaray, Jamal Musiala iddialarını resmen yalanladı",
  "publishedAt": "2026-07-31T12:31:00+03:00",
  "url": "https://…",
  "sourceName": "Fanatik",
  "status": "verified",
  "ticker": {
    "category": "official",
    "confidence": "confirmed",
    "text": "Galatasaray, Jamal Musiala transferi iddialarının gerçek dışı olduğunu resmen açıkladı",
    "expiresAt": "2026-08-14T23:59:59+03:00"
  }
}
```

`scripts/refresh-news-ticker.mjs` bu bloğu `data/news-ticker.json` içine
`origin: "news.json"` işaretiyle yansıtır. **Editör tek dosya günceller,
bant peşinden gelir.** `origin` taşıyan kayıtlar her koşuda sıfırdan
üretilir; elle düzenlenmemeli. Elle yazılan kayıtlar (`origin` alanı yok)
korunur — transfer iddiaları, oyuncu/teknik direktör sözleri gibi tam bir
haber kaydı olmayan gündem maddeleri oraya yazılır.

`ticker` bloğu OLMAYAN doğrulanmış bir haber banda girmez. "Doğrulanmış
haber" ile "banda girecek kadar kesin haber" aynı şey değildir; güven
seviyesi tahmin edilmez, editörden istenir.

## 2. Güven modeli — kesinleşmemiş bilgi kesin gibi gösterilemez

Her küratörlü kayıt `confidence` taşımak ZORUNDA. Eksik alan "kesin"
sayılmaz; kayıt elenir.

| `confidence` | Rozet | Anlamı |
|---|---|---|
| `confirmed` | *(yok)* | Resmî ya da birincil kaynakla doğrulanmış |
| `reported` | `BASINDA` | Güvenilir yayın organı aktardı, kulüp doğrulamadı |
| `rumour` | `SÖYLENTİ` | Kesinleşmemiş iddia |

Doğrulama (`validateTickerItem`) beş çelişkiyi reddeder:

1. `confidence` eksik.
2. `transfer-rumour` kategorisi + `confirmed` güven (kesinleşmiş transfer
   iddia değildir; kategorisi `official` olmalı).
3. Kesinleşmemiş kaydın metninde kesinlik fiili ("resmen", "imzaladı",
   "duyurdu", "kesinleşti"…). Rozet "SÖYLENTİ" derken cümle "imzaladı"
   diyorsa okuyucu cümleye inanır.
4. Kesinleşmemiş kaydın metninde **çekince ifadesi yok** ("iddia", "öne
   sürüldü", "aktarıldı", "görüşmeler sürüyor"…). Rozet on piksel, cümle
   bandın taşıdığı asıl bilgi; çekince yalnızca rozette kalamaz.
5. `updatedAt` yayım tarihinden önce.

Rozeti ŞABLON çizer (`scripts/lib/layout.mjs` → `newsTicker()`), editör
değil: rozet metinden değil `confidence` alanından üretilir, dolayısıyla
"unutulamaz". Ekran okuyucu için çekince ve kaynak `aria-label`'a da girer.

Kaynak zorunlu: `source.name` ve `http(s)` şemalı `source.url`.

## 3. Kategoriler ve raf ömürleri

`services/newsTicker.js` → `CATEGORIES`:

| Kategori | Etiket | Raf ömrü |
|---|---|---|
| `official` | Resmî açıklama | 21 gün |
| `post-match` | Maç sonu | 4 gün |
| `fixture` | Maç programı | 14 gün |
| `squad-update` | Kadro & sakatlık | 10 gün |
| `manager-quote` | Teknik direktör | 7 gün |
| `player-quote` | Oyuncu açıklaması | 7 gün |
| `transfer-rumour` | Transfer iddiası | 7 gün |

Bayat bir transfer İDDİASI faydasızdan kötüdür: çoktan çürütülmüş olabilir
ve bant onu hâlâ gündem gibi taşır. Resmî açıklama ise transfer penceresi
boyunca geçerliliğini korur.

## 4. Bayat içerik nasıl düşüyor?

Üç bağımsız mekanizma, üçü de `services/newsTicker.js` içinde:

1. **Kategori raf ömrü** — yukarıdaki tablo. Yaşı aşan kayıt banda girmez ve
   `refresh-news-ticker.mjs --apply` onu dosyadan da siler.
2. **`expiresAt`** — sert son kullanma tarihi. "5 Ağustos'ta oynanacak"
   duyurusu 6 Ağustos'ta yanlıştır; raf ömrü değil TARİH bitirir. Maç
   duyuruları, kura sonuçları ve sezon açılışı gibi kalıcı görünen
   duyuruların bantta süresiz asılı kalmasını bu alan engeller.
3. **`breaking` penceresi** — 24 saat (`BREAKING_WINDOW_HOURS`). Süre
   dolduğunda kayıt **düşmez, rütbesi iner**: haber hâlâ doğru, artık "son
   dakika" değil. Gelişme sürüyorsa `developing: true` pencereyi uzatır.
   Sönen işaret dosyadan da silinir — yalnızca ekranda gizlemek, dosyanın
   yalan söylemeye devam etmesi olurdu.

Ayrıca geleceğe tarihli kayıt (saat hatası / yanlış giriş) reddedilir ve
`data/matches.json` üzerinden gelen skorlar 7 günlük, transferler 21 günlük
pencere ile sınırlıdır (`scripts/lib/tickerFeed.mjs`).

## 5. Sıralama

Sıra "en yeni en üstte" DEĞİL. `editorialRank` dört kaynağın hepsine
uygulanır:

| Rütbe | Kapsam |
|---|---|
| 0 | Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor |
| 1 | Avrupa kupalarındaki diğer Türk kulüpleri |
| 2 | Diğer Süper Lig / TFF gündemi |
| 3 | Büyük Avrupa kulüpleri ve turnuvaları |
| 4 | Kalanlar |

Nihai sıra: **son dakika → editoryal rütbe → kategori → tazelik.**

Kota (`scripts/lib/tickerFeed.mjs`): bant en fazla 7 öğe taşır; en fazla 2
maç sonucu, en az 4 küratörlü gündem, en az 1 transfer. Kota hangi öğelerin
gireceğini belirler, sırayı belirlemez.

## 6. Yinelenen haberler

Dört kaynak aynı olaya farklı açılardan bakabiliyor: maç kaydı çıplak skor
satırı üretir ("Inter Turku 2-0 Başakşehir"), haber kaydı o skorun ne anlama
geldiğini yazar ("Başakşehir Avrupa'ya veda etti"). Kelimesi kelimesine
karşılaştırma bu ikisini yabancı sayıyordu.

`dedupeByMeaning` iki ölçü kullanır (Türkçe çekim ekleri için kelimeler beş
harflik gövdelerine indirgenir):

- **Jaccard ≥ 0.5** ve en az 3 ortak kelime — aynı cümlenin iki yazımı.
- **Kapsama ≥ 0.8** (kesişim / küçük küme) — kısa skor satırının uzun
  başlığın içinde olması.

Kalan sürüm: **sunumu** en güvenilir/en açık sürümden (güven → editoryal
başlık → kategori → tazelik), **yerleşimi** ise en yüksek öncelikli
sürümden alır. Böylece "Beşiktaş tur atladı" başlığı hem okunur kalır hem de
maç kotasındaki yerini korur.

## 7. Otomatik tazeleme

```
npm run ticker:refresh              # kuru koşu, yazmaz
node scripts/refresh-news-ticker.mjs --apply
```

`--apply` biçimi `npm run postprocess` içinde koşar, dolayısıyla:

- `npm run build` her dağıtımda,
- `.github/workflows/match-analysis.yml` → `live-refresh` işi **beş dakikada
  bir**,
- aynı iş akışının günlük işi (05:00 ve 13:00 UTC)

bandı elle müdahale olmadan tazeler. Betik yalnızca içerik gerçekten
değiştiğinde dosyayı yazar; aksi hâlde her tur gereksiz bir commit ve
dağıtım üretirdi.

Betik **içerik uydurmaz**. Kaynağı, saati ve güven seviyesi olmayan hiçbir
şey üretmez. Bant boşalırsa boş bırakır ve uyarı basar; bandın "son
doğrulanmış içeriği koru" yedeği (`data/ticker-state.json`) devreye girer.
Okuyucu gerçek ama eski bir başlık görür, sahte bir "son dakika" görmez —
rozet de sessizce "Gündem"e döner.

Geçersiz kayıt **silinmez**, raporlanır ve dosyada bırakılır; betik 1 ile
çıkar. Silmek editoryal içeriği kimse bakmadan yok ederdi.

## 8. Arayüz

`scripts/lib/layout.mjs` → `newsTicker()` işaretlemeyi üretir,
`scripts/apply-shared-layout.mjs` bunu her HTML dosyasındaki
`<!-- shared-layout:ticker:start -->` … `:end` işaretleri arasına basar.

- Sonsuz döngü için içerik **iki kez** basılır ve şerit %50 kaydırılır; JS
  olmadan, saf CSS animasyonuyla akar (`@keyframes ticker-scroll`).
- `:hover` / `:focus-within` durumunda durur.
- `prefers-reduced-motion: reduce` altında animasyon kapanır **ve** şerit
  elle kaydırılabilir hâle gelir (`overflow-x: auto`); ikinci kopya
  gizlenir. Hareketi kapatmak içeriği gizlemek değildir.
- Her başlık tek satırda kalır (`white-space: nowrap`, öğe içindeki
  kutulara da uygulanır) — takım adları dikey kırılmaz.
- `≤760px` ekranlarda "Tümü" bağlantısı gizlenir, ızgara iki sütuna iner.
- Öğeler gerçek bağlantıdır: dış kaynaklar `target="_blank"
  rel="noopener noreferrer"`, iç sayfalar doğrudan.

## 9. Testler

| Betik | Kapsam |
|---|---|
| `scripts/test-news-ticker.mjs` | Güven modeli, çelişki reddi, çekince zorunluluğu, raf ömrü, `expiresAt`, son dakika penceresi, editoryal sıra, tekleştirme, şablon rozeti, gerçek veri dosyasının geçerliliği |
| `scripts/test-ticker-feed.mjs` | Kaynak birleştirme, kalabalık sınırı, yinelenen haber yokluğu, sıra, gündem kotası, tazelik rozeti, veri kesintisinde yedek koruma |
| `scripts/test-ticker-refresh.mjs` | Otomatik bakım: bayat kayıt düşürme, son dakika sönümü, `news.json` aynası, uydurma yasağı, kuru koşu |
