# İngilizce Haber Hattı ve Haber Durumu Etiketi

İki ayrı ama birbirine bağlı iş: `/en` tarafının kendi haber akışı ve
her iki dilde de okura gösterilen **haber durumu** etiketi.

## 1. Neden var — ölçülen durum

`/en` tarafında **hiç İngilizce haber üretilmiyordu.**
`scripts/generate-en-pages.mjs` Türkçe `data/news.json` kayıtlarını alıp
İngilizce sayfalara `lang="tr"` işaretiyle basıyor, kartın altına
"Read the story (in Turkish)" yazıyordu.

| Sayfa | Türkçe düğüm (önce) | (sonra) |
| --- | --- | --- |
| `en/news.html` | 123 | 3 |
| `en/index.html` | 35 | 11 |
| `en/columns.html` | 96 | 4 |

Kalan 3–4 düğüm **çeviri bekleyen metin değil**: dil değiştirici
(`lang-switch`) ve Türkçe-only bir hedefe giden, "(TR)" etiketli gezinme
bağlantısı. İkisi de doğru işaretlenmiş çapraz dil bağlantısıdır ve tüm
`/en` sayfalarında aynı tabanda durur.

Depodaki eski karar ("makine çevirisi yapmıyoruz") **doğruydu ve
korundu.** Değişen şey: akış artık çevrilmiyor, İngilizce kaynaktan
İngilizce yazılıyor.

## 2. Boru hattı

```
services/englishNews.js          → Beslemeler, sınıflama (turnuva, kulüp,
                                    kişi, olay türü), özgün İngilizce metin
                                    üretimi, Türkçe sızıntı denetimi,
                                    önem + bayatlık sıralaması.

scripts/sync-english-news.mjs    → Beslemeleri çeker, kayıtları üretir,
                                    aynı hikâyeyi teker, data/news-en.json
                                    yazar. Türkçe dosyaya HİÇ dokunmaz.

scripts/generate-en-news-pages.mjs → en/news/<slug>.html üretir; akıştan
                                    düşen haberin sayfasını siler.
```

Üçü de yalnızca `data/news-en.json` okur. Ortak bir havuz **bilerek
yok**: tek havuz olsaydı Türkçe bir kayıt er geç İngilizce sayfaya
düşerdi — zaten olan da buydu.

### Zincirdeki yeri

`generate-en-news-pages.mjs` **`scripts/lib/postprocessChain.mjs`
içindedir**, saatlik derleme kuyruğunda değil. Sayfa yeni doğuyor ve ortak
yerleşim, favicon, tema, hreflang ve varlık damgası adımlarının hepsini
görmek zorunda. Kuyruğa konduğunda bunların hiçbirini görmüyor ve
`test-favicon`, `test-asset-version`, `test-live-scores-ticker` üçü birden
düşüyordu.

### Beslemeler

UEFA, FIFA, Premier League, Bundesliga ve lig kurumları **kendi RSS'lerini
yayınlamıyor** (bu ortamdan ölçüldü: 403/404). Türkçe hattaki çözümün
aynısı kullanılır — Google News `site:` daraltması. Guardian ayrı bir
durum: `curl` 200 alırken Node'un `fetch`i aynı adreste 403 alıyor
(yayıncı tarafında istemci parmak izi denetimi), kimlik başlığı eklemek
yetmedi; o da aynı yola alındı.

**Yayıncı kimliği `link` alanında değildir.** Google News üzerinden gelen
kayıtlarda `link` toplayıcıya gider ve özgün adres geri getirilemiyor.
Kademe kararı beslemedeki `<source url="…">` alanına bakar. Bakmadığında
UEFA'nın kendi duyurusu "news.google.com" görünüyor ve **26 kaydın tamamı
İddia rozetiyle** yayımlanıyordu; düzeltmeden sonra 16 Resmî / 13 Haber /
1 Görüşme / 6 İddia.

Açık uçlu sorgular kendini sınırlamaz: `site:` daraltması olmayan besleme
alakasız alan adları getirir (ölçüldü: Valencia Üniversitesi, fantezi lig
portalleri). İki koruma var — besleme başına `expectDomains` beklentisi ve
`requireClub` şartı.

## 3. Haber durumu — `services/editorialStatus.js`

Haberin ne kadar kesin olduğu depoda **üç ayrı sözlükle** duruyordu:
`record.status` (verified/archived — bu bir YAYIN durumu, kesinlik değil),
`discovery.confidence` ve `sync-football-news.mjs` içindeki
`lifecycleStatus()`. Sonuncusu haber kaydına hiç işlenmiyordu. Okur için
sonuç: kulübün kendi duyurduğu transfer ile "kuliste konuşuluyor"
aktarımı sayfada aynı görünüyordu.

Artık tek sözlük:

| Durum | Türkçe | İngilizce | Anlamı |
| --- | --- | --- | --- |
| `official` | Resmî | Official | Kurumun kendi ağzı |
| `negotiation` | Görüşme | In talks | Taraflar konuşuyor, bağlanmadı |
| `claim` | İddia | Claim | Yalnızca basında, doğrulanmadı |
| `reported` | Haber | Reported | Güvenilir yayıncı, çekince yok |

### İki kural

**1. Kaynak kademesi metinden önce gelir.** Bir gazete "Resmen açıkladı!"
diye başlık atabilir; başlıktaki kelime kurumu konuşturmaz. Haber ancak
kaydın kaynakları arasında gerçekten resmî bir alan adı varsa `official`
olur (`services/sourceTrust.js`). Metin yalnızca resmî OLMAYAN haberleri
birbirinden ayırmak için okunur.

**2. "Son Dakika" bu listede yoktur.** Ayrı bir alandır (`isBreaking`) ve
durumun yerine geçmez, yanında durur. Tazelik doğruluk değildir; resmî bir
duyuruyu "son dakika" diye etiketlemek resmîliğini gizlerdi. Etiket
yalnızca yayın saatine bakar (3 saat), böylece dünkü son dakika bugün
kendiliğinden düşer — başlığında "SON DAKİKA" yazsa bile.

### Karar metni başlıktan başlar

Özet ve spot, FutbolRadar'ın kendi kalıp cümlelerini taşır
("… haberine göre"). Bunlar **künyedir, çekince değil.** Kalıp çekince
sayılınca 394 haberin **365'i İddia** çıkmış, etiket ayırt ediciliğini
yitirmişti. Önce yalnızca başlığa bakılır; başlık nötrse özete inilir.

### Kademe listeleri

`sourceTrust.js` listeleri ölçülen boşluklara göre genişletildi. Hürriyet,
Fanatik, Fotomaç, Milliyet gibi **yayın kurulu olan ulusal gazeteler
listede yoktu** ve "kaynağı zayıf" sayılıp İddia rozeti alıyorlardı.
Kaynaksızlık güvenilirlik değildir — ama ulusal bir gazete de kaynaksız
değildir. KAP bildirimi (kulübün imzalı beyanı), kulüp medya kolları
(`fenermedia.com`) ve lig kurumları resmî kademeye eklendi.

394 Türkçe haberde dağılım: **365 İddia → 16 Resmî / 56 Haber /
1 Görüşme / 309 İddia.** Kalan İddia ağırlığı gerçektir: akışın çoğu
Sporx keşfinden gelen basın aktarımıdır ve başlıkları zaten "iddiası"
der.

## 4. Türkçe sızıntı denetimi

İngilizce akışın tek sert kuralı. Denetim **özel isme değil, Türkçe işlev
sözcüklerine** bakar: "Fenerbahçe and Beşiktaş meet on Sunday" temizdir,
"Fenerbahçe'de görüşme yapıldı" değildir.

Denetim `\b` **kullanmaz.** JavaScript'te `\b` yalnızca ASCII harfini
sözcük karakteri sayar; "ı", "ş", "ğ" sayılmaz, bu yüzden
`/\byapıldı\b/` "yapıldı" sözcüğünü **yakalamaz** — sınır denetimi
kelimenin sonundaki "ı"da düşer. Metin Unicode harf sınırlarından
parçalanıp sözcük kümesine bakılır.

## 5. Bayatlama

**İngilizce:** `rankEnglishNews()` önce ÖNEM sıralar (öncelikli turnuva,
resmî durum, tazelik), sonra 48 saatten eski haberlere her 12 saat için
ceza verir. **Bayat haber listeden silinmez, yalnızca aşağı iner.**

**Türkçe:** liste zaten yayın tarihine göre sıralı — eski içerik yapısal
olarak arkada kalır. Bant ayrıca kategori başına `maxAgeHours` taşır
(`services/newsTicker.js`), yani kendi kendini temizler.

## 6. Denetimler

```
npm run test:editorial-status   # durum sözleşmesi (9 senaryo)
npm run test:english-news       # akış sözleşmesi (11 senaryo)
```

İkisi de `npm test` içinde. Korudukları asıl kurallar: kaynak cümlesi
kopyalanmaz (Jaccard < 0.6), künyesiz kayıt yayımlanmaz, Türkçe kayıt
İngilizce akışa giremez, başlıktaki "resmen" haberi resmî yapmaz, bayat
haber **silinmez** yalnızca aşağı iner.

## 7. Çalıştırma

```
npm run news:en          # akışı tazele (data/news-en.json)
npm run render:en-news   # sayfaları üret (en/news/<slug>.html)
```

Saatlik `run-scheduled-update` içinde `english-news` adımı olarak koşar.
`.github/workflows/english-news.yml` buna ek güvenlik ağıdır: saatlik koşu
düşerse /en tarafı gün boyu donmasın diye :35'te kendi başına tazeler.
