# İnce Kıyas Sayfaları — Noindex Etki Raporu

**Durum: KARAR ERTELENDİ.** `karsilastirma/` altındaki 2314 sayfa şu anda
`index,follow` ve site haritasında. Bu belge o kararı vermiyor; kararı
verecek insanın önüne ölçülmüş kanıtı koyuyor.

Belgedeki her sayı bu depoda, bu dal (`claude/player-radar-verified-data-gbu36b`)
üzerinde, üreticinin kendi mantığı yeniden koşturularak ölçüldü. Tahmin yok.
Ölçülmeyen hiçbir şey iddia edilmedi — özellikle sıralama kazancı.

**Ölçüm anı:** 2026-07-27. Ölçülen ağaç: çalışma kopyası (`karsilastirma/`
son üretimden sonraki hâliyle). Ölçüm sırasında ağaç bir kez yeniden
üretildi (11:08); **tüm sayımlar yeniden üretimden sonra baştan
doğrulandı** ve tek fark ≥%99 5-gram türünün 37'den 38'e çıkması oldu.
Aşağıdaki rakamların tamamı üretim sonrası hâle ait.

---

## 0. Bir sayfada özet

| Soru | Ölçülen cevap |
| --- | --- |
| Kaç sayfa? | 2314 (site haritasındaki 3281 URL'nin **%70,53**'ü) |
| Ne kadar metin? | `<main>` içinde ortanca **111 kelime** (min 100, maks 128) |
| Ne kadarı şablon? | Ortanca **%51,4** — sayfaların **%99**'unda birebir aynı 5-kelimelik dizilerden |
| Sayfaya özgü kelime | Ortanca **54** kelime; bunun büyük kısmı iki oyuncu adı + iki kulüp adı |
| Gerçekten doğrulanmış veri satırı | Sayfa başına **2, 1 veya 0** (segmente göre) — hepsi tek bir alan: kulüp |
| Ölçülmüş kıyas cümlesi taşıyan sayfa | **19** — ve o 19'unun ikisi de sağlayıcı kimliği `mock-*` olan kayıtlardan türüyor (§7.1) |
| Kaldırılırsa öksüz kalan sayfa | **0** |
| Kaldırılırsa derinliği değişen sayfa | **0** |
| İstatistik senkronu geldiğinde içerik kazanabilecek sayfa | En fazla **735** (%31,8). Kalan **1579** (%68,2) yapısal olarak kazanamaz. |

Kararı zorlaştıran tek cümle şu: **bu 2314 sayfa homojen değil, ama
heterojenliği "bazıları iyi" anlamına gelmiyor.** En iyi segment bile sayfa
başına iki kulüp adı taşıyor. Aradaki fark "zengin vs. ince" değil, "ince
vs. boş".

---

## 1. Ölçüm yöntemi

Sayfa metni `<main>` bloğundan alındı; `<script>`/`<style>` çıkarıldı,
etiketler soyuldu. Kelime = `[0-9A-Za-zÇĞİÖŞÜçğıöşü]+`.

Segmentasyon, sayfaları HTML'den geriye ayrıştırarak değil,
`scripts/generate-player-comparison-pages.mjs` içindeki
`buildPairs()`, `comparisonInsight()`, `playerMiniCard()` ve
`comparisonDescription()` fonksiyonları birebir yeniden koşturularak
üretildi; sonuç diskteki 2314 dosyayla çapraz doğrulandı (segment
büyüklükleri ile `Doğrulanmış kayıt bekleniyor` metninin sayfa başına
görülme dağılımı birebir uyuştu: 0→735, 1→1157, 2→422).

Bağlantı grafiği yalnızca `<a href>` üzerinden kuruldu. `<link
rel="canonical">` bir gezinme kenarı değildir; ilk denemede sayıldığında
grafiği kirletiyordu, dışarıda bırakıldı.

Yeniden üretilebilir sağlamalar:

```bash
# sayfa sayıları
ls karsilastirma/*.html | wc -l                                      # 2314
grep -c '<loc>' sitemap.xml                                          # 3281
grep -o '<loc>[^<]*/karsilastirma/[^<]*</loc>' sitemap.xml | wc -l   # 2314

# indekslenebilirlik  (public/ ayna ağacı hariç — yoksa her sayı ikiye katlanır)
grep -rho 'name="robots" content="[^"]*"' --include=*.html --exclude-dir=public . \
  | sort | uniq -c                                   # 3281 index,follow / 6 noindex,follow

# boş durum kartı dağılımı (segment büyüklüklerinin bağımsız kanıtı)
for f in karsilastirma/*.html; do
  grep -c 'Doğrulanmış kayıt bekleniyor' "$f"; done | sort | uniq -c
#   735 "0"   1157 "1"   422 "2"

# ölçülmüş kıyas cümlesi taşıyan sayfalar
grep -rl 'piyasa değeri okumasında daha güçlü sinyal' karsilastirma/ | wc -l   # 19
grep -rl 'overall rating tarafinda onde' karsilastirma/ | wc -l                # 0
```

---

## 2. Korpus bugün — dağılım, ortalama değil

### 2.1 Kelime dağılımı (`<main>`, 2314 sayfa)

| İstatistik | Değer |
| --- | --- |
| min | 100 |
| p10 | 107 |
| p25 | 108 |
| **ortanca** | **111** |
| p75 | 113 |
| p90 | 116 |
| maks | 128 |
| ortalama | 111,09 |

Ham dağılım (kelime sayısı → sayfa):

```
100:3  101:5  102:2  103:11  105:67  106:137 107:144 108:221 109:47
110:370 111:454 112:171 113:172 114:141 115:103 116:88  117:77  118:46
119:8  120:9  121:7  122:10  123:11  124:2  125:2  126:1  127:2  128:3
```

**Sayfaların %96,7'si (2238/2314) 105–118 kelime aralığında.** Bu bir
dağılım değil, tek bir şablonun ölçüm gürültüsü. Başlık ve altbilgi dahil
tam sayfa metni de aynı şekilde sıkışık: ortanca 294, min 282, maks 313.

Dosya boyutu neredeyse sabit: ortanca 19,5 KB, min 19,2 KB, maks 19,5 KB.
Toplam **45,14 MB** — deponun 65,16 MB'lık HTML gövdesinin **%69,3'ü**.

### 2.2 Şablon oranı

5-kelimelik dizi (5-gram) belge frekansı ile ölçüldü:

- Sayfaların **≥%99'unda** görünen 5-gram türü: **38**.
- Bu 37 dizinin sayfa metninde kapladığı kelime payı: ortanca **%51,4**
  (min %27,7, maks %57,4).
- Geriye kalan "sayfaya özgü" kelime: ortanca **54** (min 43, maks 86).
- Eşik %50'ye indirildiğinde şablon payı yalnızca %55,8'e çıkıyor — yani
  şablon keskin bir çekirdek, kademeli bir kuyruk değil.

Eşsizlik daha da net görülüyor: oyuncu ve kulüp adları maskelendiğinde,

- **2314 meta açıklama → 3 şablon**
  (1892× "iki kulüp adlı" varyant, 403× kulüpsüz varyant, 19× "ölçülmüş"
  varyant).
- **2314 "Kıyas Özeti" listesi → 29 farklı içerik**
  (21 tanesi yalnızca rol satırı varyantı, 8 tanesi piyasa cümlesi varyantı).
- Sayfaların **≥%90'ında** geçen tam cümle sayısı: **1**
  (`Performans ve piyasa okuması, doğrulanmış ölçüm geldiğinde yayımlanır.`
  — 2295 sayfa).

Buna karşılık **`<title>` ve `<h1>` 2314 sayfada da benzersiz** (0 çift).
Yani sorun "kopya başlık" değil; sorun başlıkların altında ayırt edici
gövde olmaması.

### 2.3 Her sayfada gerçekten ne var?

Her kıyas sayfası şunları basıyor:

| Öğe | Kapı | Kaç sayfada |
| --- | --- | --- |
| İki oyuncu adı (`<h1>`, breadcrumb, açıklama) | kapısız (SAFE_FIELDS) | 2314 |
| İki mevki etiketi (`Goalkeeper`, `Stoper`…) | kapısız (SAFE_FIELDS) | 2314 ("Mevki yakinda" basan: **0**) |
| Hero'daki iki kulüp adı | **kapısız** — bkz. §7.2 | 2314 |
| Mini kartta `Takım` satırı | `publicPlayerView().verified` | A'da 2, B'de 1, C'de 0 |
| Rol okuması cümlesi | kapısız (mevkiden türer) | 2314 |
| Ölçülmüş kıyas cümlesi | alan kapısı | **19** |
| İstemci tarafı kıyas ızgarası | — | 2314'ünde de boş durum (`data-empty`) |

Mini karttaki `Lig`, `Overall` ve `Piyasa` satırları **hiçbir sayfada
basılmıyor**: 479 sağlayıcı kaydının hiçbirinde `league` yok, `ratingStatus`
479'unda da `estimated`, `marketValueEur` 479'unda da `null`. Doğrulanmış
479 oyuncunun tamamı kartta **tam olarak 1 satır** üretiyor: `Takım`.

---

## 3. Segmentasyon (raporun çekirdeği)

### 3.1 Birincil kesit — sayfanın kapıdan geçirdiği veri

| Segment | Tanım | Sayfa | Pay | Sayfadaki doğrulanmış `<dl>` satırı | Meta açıklamada kulüp |
| --- | --- | --- | --- | --- | --- |
| **A** | Her iki kayıt da güvenilirlik kapısını geçiyor | **735** | %31,8 | 2 | 2 |
| **B** | Yalnızca bir kayıt geçiyor | **1157** | %50,0 | 1 | 1 |
| **C1** | Hiçbiri geçmiyor, ama **ölçülmüş piyasa cümlesi basılıyor** | **19** | %0,8 | 0 | 0 (yerine "ölçülmüş performans okuması" iddiası) |
| **C2** | Hiçbiri geçmiyor — **saf boş durum** | **403** | %17,4 | 0 | 0 |

Segment sınırları veri kaynağıyla birebir örtüşüyor:
A = sağlayıcı × sağlayıcı, B = sağlayıcı × legacy, C = legacy × legacy.

### 3.2 Kelime profili segment bazında

| Segment | Sayfa | Kelime (ortanca) | Şablon dışı kelime (ortanca) | Şablon payı |
| --- | --- | --- | --- | --- |
| A | 735 | 108 | 51 | %52,8 |
| B | 1157 | 111 | 54 | %51,4 |
| C1 | 19 | 110 | 78 | %29,1 |
| C2 | 403 | 113 | 56 | %50,4 |

**Bu tablo bir tuzak içeriyor ve raporun en önemli uyarısı burada:**
kelime eşsizliği doğrulanmış veriyle *ters* korele. En boş segment (C2, 56)
en dolu segmentten (A, 51) daha fazla "özgün" kelime taşıyor — çünkü
"Doğrulanmış kayıt bekleniyor" cümlesi kelime sayısında `Takım / Galatasaray`
satırından daha ağır. **Kelime sayısı bu korpusta değer ölçüsü değildir.**
Karar, kelime sayısına değil §3.1'deki kapı sayımına dayanmalı.

### 3.3 İkincil kesit — rol satırının bilgi içeriği

Rol satırı (`"X ve Y rolleri birlikte okunmalı..."`) 2295 sayfanın tek
gerçek analitik cümlesi. Kalitesi:

| Ölçüm | Sayfa |
| --- | --- |
| İki taraf aynı mevki grubunda | 1119 |
| Farklı mevki grubunda | 1195 |
| En az bir taraf `diger` (sınıflandırılamamış) | **494** (A: 329, B: 165, C: 0) |
| **İki taraf da `diger`** — cümle sıfır bilgi taşıyor | **204** |

Sebep ölçüldü: `playerPositionGroup()`
(`scripts/generate-player-comparison-pages.mjs:65-73`) API-Football'un
`position: "Attacker"` / `positionGroup: "forward"` değerlerini hiçbir
kalıba düşüremiyor (`forvet`, `santrfor`, `striker`, `kanat`, `wing`
aranıyor; `attacker`/`forward` aranmıyor). Sonuç: **125 sağlayıcı forveti**
`diger` grubuna düşüyor ve 204 sayfada tek analitik cümle şu hâle geliyor:

> `diger ve diger rolleri birlikte okunmalı; tek skor karar için yeterli değil.`

Bu 204 sayfanın tamamı **A segmentinde** — yani "en iyi" segmentin %27,8'i,
tek cümlesi anlamsız olduğu hâlde en yüksek doğrulanmış veri notunu alıyor.

### 3.4 Üçüncül kesit — kimlik yoğunlaşması

Sayfalar oyunculara eşit dağılmıyor:

| # | Oyuncu | Göründüğü sayfa | Pay |
| --- | --- | --- | --- |
| 1 | `ugurcan-cakir` (legacy) | 588 | %25,4 |
| 2 | `mauro-icardi` (legacy) | 378 | %16,3 |
| 3 | `abdulkerim-bardakci` (legacy) | 190 | %8,2 |
| 4 | `sebastian-szymanski` (legacy) | 185 | %8,0 |
| 5 | `c-akgun-galatasaray` | 153 | %6,6 |
| 6 | `c-guner-galatasaray` | 126 | %5,4 |
| 7 | `u-cakir-galatasaray` (1'in ikizi) | 104 | %4,5 |
| 8 | `gunay-guvenc` (legacy) | 103 | %4,5 |
| 9 | `e-elmali-galatasaray` | 86 | %3,7 |
| 10 | `k-karatas-galatasaray` | 62 | %2,7 |

Kümülatif kapsama: en çok görünen **3 oyuncu 1154 sayfada (%49,9)**,
**5 oyuncu 1488 (%64,3)**, **10 oyuncu 1959 (%84,7)**, **20 oyuncu
2244 (%97,0)**. Korpusta 589 farklı oyuncu var; ortanca oyuncu yalnızca
**4** sayfada görünüyor.

Yani "2314 farklı kıyas" ifadesi yanıltıcı: pratikte on kişilik bir
çekirdeğin etrafına örülmüş 2314 permütasyon.

Daha keskin bir alt kesit: **1393 sayfa (%60,2)**, `appearances > 0`
taşıyan **8 legacy kaydın** en az birini içeriyor. Bu 8 kayıt tam olarak
`services/cardCredibility.js` başlığındaki denetimin işaretlediği kayıtlar —
hepsinin sağlayıcı kimliği `mock-*`, dördü artık Süper Lig'de değil.

### 3.5 Dördüncül kesit — URL kararlılığı (birleştirme riski)

Ad/kimlik sezgiseliyle (aynı soyad + aynı ilk harf + aynı kulüp) ölçüldü:
**81 legacy kaydın bir sağlayıcı ikizi var** (kulüp koşulu gevşetilince 82).
Bunlar aynı gerçek kişinin iki kaydı.

| Ölçüm | Sayfa | Pay |
| --- | --- | --- |
| Her iki taraf da sağlayıcı kaydı — **URL kalıcı** | 735 | %31,8 |
| En az bir taraf legacy kimlik | 1579 | %68,2 |
| ↳ bunlardan en az biri **ikizi olan** legacy kayıt (birleştirme URL'yi öldürür) | **1071** | **%46,3** |
| ↳ yalnızca ikizi olmayan legacy (serbest oyuncu / yurt dışı, 29 kayıt) | 508 | %22,0 |
| **Bir kişiyi kendisiyle kıyaslayan sayfa** | **2** | — |

Kendisiyle kıyaslananlar:
`karsilastirma/u-cakir-galatasaray-vs-ugurcan-cakir.html` ve
`karsilastirma/a-bardakci-galatasaray-vs-abdulkerim-bardakci.html`.

Uğurcan Çakır tek başına iki kimlik altında **692 sayfada** (588 + 104)
görünüyor.

Karar açısından anlamı: **1071 URL zaten geçici.** Yinelenen kayıt
birleştirmesi yapıldığında bu slug'lar üretilemez hâle gelir (slug
`comparisonSlug()` ile oyuncu `id`'lerinden kuruluyor,
`generate-player-comparison-pages.mjs:75-77`). Onlara indeks yatırımı
yapmak, silinmesi planlanan bir kimliğe yatırım yapmaktır.

### 3.6 Beşinci kesit — lig dışı kulüp basan sayfalar

Hero satırı kulüpleri kapısız bastığı için (§7.2), **567 sayfa** Süper Lig
dışı bir kulüp ya da kulüpsüzlük dizesi gösteriyor:

| Dize | Sayfa |
| --- | --- |
| `Serbest oyuncu` | 378 |
| `Rennes` | 185 |
| `Schalke 04` | 5 |
| `Spartak Moskova` | 4 |

Örnek: `karsilastirma/gedson-fernandes-vs-sebastian-szymanski.html` hero
satırı `Spartak Moskova - Rennes`. Bir Süper Lig sitesinde, "Süper Lig
oyuncu karşılaştırması" başlığı altında.

### 3.7 Segmentlerin birleşik görünümü

| | A (735) | B (1157) | C1 (19) | C2 (403) |
| --- | --- | --- | --- | --- |
| Kapıdan geçen kulüp satırı | 2 | 1 | 0 | 0 |
| Ölçülmüş kıyas cümlesi | 0 | 0 | 1 (mock kaynaklı) | 0 |
| En az bir taraf `diger` rol | 329 | 165 | 0 | 0 |
| İkizi olan legacy kayıt içeriyor | 0 | 669 | 14 | 388 |
| 8 mock kaydın birini içeriyor | 0 | 1157 | 19 | 217 |
| İstatistik senkronundan içerik kazanabilir | **evet** | hayır | hayır | hayır |
| URL kalıcı mı | evet | hayır | hayır | hayır |

---

## 4. Noindex'in maliyeti — ölçülen

### 4.1 İç bağlantı grafiği

Yalnızca `<a href>` kenarları, 3288 HTML dosyası:

| Ölçüm | Değer |
| --- | --- |
| Site geneli iç bağlantı kenarı | 80 733 |
| `karsilastirma/`'dan **çıkan** kenar | 50 908 (%63,1) |
| `karsilastirma/`'ya **giren** kenar | **2388 (%3,0)** |
| ↳ kaynağı `oyuncular/` | 2356 |
| ↳ kaynağı kök sayfalar | 32 |
| Sıfır iç bağlantı alan kıyas sayfası | **0** |

Kıyas sayfası başına gelen bağlantı dağılımı:
`1 → 2264 sayfa`, `2 → 36`, `3 → 10`, `4/5/6/7 → 1'er`.

Yani **2264 sayfa (%97,8) siteden tek bir bağlantı alıyor** — ilgili
oyuncu profilindeki kıyas kartından.

Segment bazında gelen kenar: A 759, B 1161, C1 56, C2 412.

**Kıyas sayfaları grafikte net alıcı değil, net vericidir**: 2388 alıp
50 908 veriyorlar. Bu 50 908 kenarın 46 280'i başlık/altbilgi gezinme
bağlantısı, 4628'i oyuncu profiline giden bağlantı.

### 4.2 Öksüzlük testi

| Senaryo | Sıfır iç bağlantılı sayfa |
| --- | --- |
| Bugün | **6** |
| Tüm kıyas sayfaları grafikten çıkarılırsa | **6** (yeni öksüz: **0**) |
| Yalnızca C2 çıkarılırsa | **6** (yeni öksüz: **0**) |

Bugünkü 6 öksüz — hiçbiri kıyas sayfalarıyla ilgili değil:
`404.html`, `googlef881b0d7527a8fba.html`, `mac-detay.html`,
`oyuncu-detay.html`, `super-lig-oyuncu-radari.html`,
`oyuncular/edina-dzeko.html` (alias sayfası, tasarımı gereği `noindex`).

**Hiçbir sayfa keşif için kıyas sayfalarına bağımlı değil.**

### 4.3 Tarama derinliği

`index.html`'den BFS:

| Derinlik | Tüm site | `karsilastirma/` | `oyuncular/` |
| --- | --- | --- | --- |
| 0 | 1 | — | — |
| 1 | 24 | — | — |
| 2 | 367 | 21 | 15 |
| 3 | 614 | 25 | 580 |
| 4 | 2268 | **2268** | — |
| ulaşılamaz | 14 | 0 | 1 |

Kıyas sayfaları kaldırıldığında **hiçbir sayfanın derinliği değişmiyor**:
`oyuncular/` yine 15@2 + 580@3, `mac/` yine 306@2, kök sayfalar aynı.
Kıyas katmanı tarama zincirinde bir ara halka değil, terminal bir yaprak
katmanı — ve sitenin **en derin katmanının %100'ü** (derinlik 4'teki 2268
sayfanın tamamı) ondan ibaret.

### 4.4 596 oyuncu profiline etkisi

| Ölçüm | Kıyaslarla | Kıyaslar olmadan |
| --- | --- | --- |
| Profil başına gelen bağlantı (ortanca) | 6 | **2** |
| min / maks | 0 / 974 | 0 / 630 |
| Tam 1 bağlantı alan profil | — | **77** |
| 0 bağlantı alan profil | 1 | 1 (aynı alias sayfası) |

Ortanca profil, gelen bağlantılarının **%67'sini** kıyas sayfalarından
alıyor (p10 %50, p90 %80).

**Nüans:** `noindex,follow` bağlantıları kesmez — sayfa sunulmaya, taranmaya
ve bağlantıları izlenmeye devam eder. Yukarıdaki "kıyaslar olmadan" sütunu
**silme** senaryosudur, noindex senaryosu değil. Noindex'te bu bağlantı
akışı kısa vadede aynen kalır. Uzun vadede kalıcı `noindex` sayfaların
bağlantı geçirme değeri belirsizdir — bunu bu depodan ölçemem, bu yüzden
bir sayı vermiyorum. Ancak §4.2 ve §4.3 en kötü hâli de kapsıyor: bağlantı
akışı tamamen kesilse bile **0 öksüz, 0 derinlik değişimi**.

77 profilin tek indekslenebilir kaynağı `en-iyi-forvetler.html`. Bu bir
kırılganlık ama kıyas sayfalarından bağımsız bir kırılganlık: kıyas
sayfaları bugün de o 77 profili derinlik 3'ten yukarı taşımıyor.

### 4.5 Kıyas merkezinin kendisi

`oyuncu-karsilastirmalari.html` (354 kelime, `ItemList` JSON-LD) 20 kıyas
sayfasına bağlanıyor. Segment dağılımı:

| Segment | Bağlantı |
| --- | --- |
| C1 (mock kaynaklı iddia) | **16** |
| C2 (saf boş) | 2 |
| B | 2 |
| A | **0** |

`oyuncu-radari.html`'in 4 kıyas bağlantısının **4'ü de C1**.

Yani sitenin kendi vitrin listesi, korpusun en güvenilmez %0,8'lik dilimini
öne çıkarıyor — çünkü `comparisonIndexHtml()` `pairs.slice(0, 20)` ile
listenin başını alıyor ve listenin başı editoryal mock çiftleri
(`generate-player-comparison-pages.mjs:152-157, 491`).

**Seçenek (c) altında bu iki hub sayfası yalnızca `noindex` hedeflere
bağlanan listeler hâline gelir** ve `oyuncu-karsilastirmalari.html`'in
`ItemList` yapısal verisi 20 `noindex` URL'yi işaret eder. Bu, kıyasları
noindex'lemenin tek gerçek yan hasarı ve ölçülebilir: 20 + 4 + 8 = **32
kök-sayfa bağlantısı** hedefini kaybeder.

### 4.6 Başka bağımlılık var mı?

- `search-index.json`: 626 girdi — 37 kök sayfa + 589 oyuncu. **0 kıyas
  sayfası.** Site içi arama etkilenmez.
- `qa.mjs:446` oyuncu profillerinin `../karsilastirma/` içermesini şart
  koşuyor; `qa.mjs:488,498` hub sayfalarının `./karsilastirma/` içermesini.
  Noindex bunların hiçbirini bozmaz (bağlantılar yerinde kalır).
- **Kırılan şey site haritası tabanları** — bkz. §6.4.

---

## 5. Noindex'in kazancı — dürüst çerçeve

Ölçülebilen kazançlar:

1. **Tarama yükü yoğunlaşması.** Kıyas katmanı sitenin HTML gövdesinin
   **%69,3'ü (45,14 MB / 65,16 MB)** ve site haritası URL'lerinin
   **%70,53'ü**. Bu payın tamamı tarama derinliği 4'te; sitenin geri kalanı
   ≤3'te. Noindex, taranan bayt miktarını doğrudan düşürmez (sayfa yine
   sunulur) ama **indeksleme kuyruğundaki aday sayısını** 3281'den 967'ye
   (seçenek c) veya 2878'e (seçenek b) indirir.
2. **İnce içerik yüzeyinin küçülmesi.** 2295 sayfa, adları maskelendiğinde
   **3 meta açıklama şablonuna** ve **29 özet varyantına** iniyor. Site
   genelinde ölçülen "aynı şablon, farklı iki ad" yüzeyi bu.
3. **Yanlış beyanın indeksten çıkması.** 19 sayfa (C1) meta açıklamada
   "doğrulanmış sağlayıcı verisiyle … ölçülmüş performans okuması" vaat
   ediyor; sayfada iki kart da "Doğrulanmış kayıt bekleniyor" diyor (§7.1).
   567 sayfa lig dışı kulüp basıyor (§3.6).

**Ölçemediğim ve bu yüzden iddia etmediğim şeyler:**

- Herhangi bir sıralama kazancı. Bu depoda organik sıralama verisi yok.
- Site genelinde "kalite sinyali" iyileşmesi. Bu bir hipotez, ölçüm değil.
- Mevcut kıyas sayfalarının aldığı gösterim/tıklama. **GA4 kurulu değil** —
  `scripts/inject-ga4.mjs:9-10` yer tutucu `G-XXXXXXXXXX` kullanıyor ve
  `shouldLoad` yer tutucuda `false` dönüyor; yayınlanan HTML'de gerçek
  ölçüm kimliği yok. Yani **site içi davranış verisi hiç yok**. Tek ölçüm
  aracı Google Search Console (doğrulama mevcut:
  `data/site-verification.json` + `googlef881b0d7527a8fba.html`).

**Bu, kararın en zayıf halkası:** 2314 sayfanın bugün ne kadar gösterim
aldığını kimse ölçmedi. Karar verilmeden önce §7'deki temel ölçüm
alınmalı; aksi hâlde "işe yaradı mı" sorusunun karşılaştırma noktası olmaz.

---

## 6. Üç seçenek

### (a) Mevcut durum — 2314 sayfa indekslenebilir kalır

| Boyut | Değer |
| --- | --- |
| Etkilenen URL | 0 |
| Site haritası | 3281 URL (değişmez) |
| İç bağlantı etkisi | Yok |
| Geri alınabilirlik | Uygulanamaz |
| Maliyet | %70,5'lik indekslenebilir yüzey, ortanca 111 kelime, sayfa başına en fazla 2 doğrulanmış veri satırı |
| Devam eden risk | 1071 URL (%46,3) yinelenen kayıt birleştirmesinde ölecek; 19 sayfa yanlış beyan taşıyor; 567 sayfa lig dışı kulüp basıyor |

**İşe yarıyor sinyali:** GSC → Performans raporu, `/karsilastirma/` sayfa
filtresi, 28 günlük pencerede sıfırdan farklı ve artan gösterim; ve
GSC → Sayfa indeksleme raporunda bu ön ek için "Taranmış — şu anda
dizine eklenmedi" sayısının 2314'ün küçük bir bölümünde kalması.

### (b) Yalnızca saf boş durum segmentini noindex'le (C2)

Uygulama: `pageHtml()` içindeki `robots` meta'sı, iki kayıt da
`publicPlayerView().verified` değilse **ve** ölçülmüş kıyas satırı yoksa
`noindex,follow` olur (`generate-player-comparison-pages.mjs:370`).
Depo bu kalıbı zaten kullanıyor: `aliasHtml()`
(`generate-player-profile-pages.mjs:371-384`) `noindex,follow` + çapraz
canonical basıyor.

| Boyut | Değer |
| --- | --- |
| Etkilenen URL | **403** (%17,4) |
| Site haritası | 3281 → **2878** (−403); `karsilastirma/` 2314 → **1911** |
| İç bağlantı etkisi | 412 gelen kenar `noindex` hedefe döner; **yeni öksüz 0**, derinlik değişimi 0 |
| Profil etkisi | **102 profil**, dört kıyas bağlantısının **dördünü de** C2'ye veriyor — bu profillerin kıyas kartı bloğu tamamen `noindex` hedeflere bağlanır |
| Geri alınabilirlik | **Tam.** Koşul kaldırılıp `npm run build` koşulduğunda meta ve site haritası eski hâline döner. Kod değişikliği tek bir koşul. |
| Yan etki | `qa.mjs` iki tabanı kırar (§6.4) |

**Neyi çözmez:** 1157 B sayfası ve 19 C1 sayfası indekste kalır. B
segmenti korpusun yarısı ve tamamı bir mock kayıtla eşleşiyor (§3.7).
Yani en büyük ince yüzey dilimi dokunulmadan kalır. Bu seçenek, "en kötü
%17,4'ü kes" demektir — sorunun tamamını değil.

**İşe yarıyor sinyali:** GSC → Sayfa indeksleme, "Noindex etiketiyle
hariç tutuldu" sayısı 6'dan ~409'a çıkar (bu, uygulamanın *işlediğinin*
kanıtı, faydanın değil). Fayda sinyali: aynı raporda `/oyuncular/` ön eki
için "Taranmış — şu anda dizine eklenmedi" sayısının düşmesi ve `/oyuncular/`
gösteriminin artması. Üç aylık pencere, tek değişkenli.

### (c) 2314 sayfanın tamamını noindex'le

| Boyut | Değer |
| --- | --- |
| Etkilenen URL | **2314** (%70,5) |
| Site haritası | 3281 → **967** (−2314); `karsilastirma/` 2314 → **0** |
| İç bağlantı etkisi | 2388 gelen kenar `noindex` hedefe döner; **yeni öksüz 0**, derinlik değişimi 0; 596 profilin her biri 4 `noindex` bağlantı tutar |
| Hub etkisi | `oyuncu-karsilastirmalari.html` (20 kart + `ItemList`) ve `oyuncu-radari.html` (4 kart) yalnızca `noindex` hedeflere bağlanır — **32 kök bağlantısı** |
| Geri alınabilirlik | **Tam** (tek satır + tabanlar), ama **yeniden indekslenme süresi bilinmiyor**; buradan ölçülemez ve tahmin etmiyorum |
| Yan etki | `qa.mjs` iki tabanı kırar (§6.4); `oyuncu-karsilastirmalari.html` işlevsel olarak boşalır |

**İşe yarıyor sinyali:** GSC → Sayfa indeksleme, `/karsilastirma/` için
"Noindex etiketiyle hariç tutuldu" ≈ 2314'e çıkar; **fayda** sinyali
`/oyuncular/` ve `/mac/` ön ekleri için indekslenmiş sayfa sayısı ve
gösterim eğrisi. Karşılaştırma noktası, değişiklikten **önceki** 28 günlük
GSC anlık görüntüsü olmalı — bu görüntü henüz alınmadı.

### 6.4 Üç seçenekte de bilinmesi gereken derleme etkisi

`scripts/generate-sitemap.mjs` derlemenin **son** adımı ve site haritasını
sıfırdan yazıyor; `noindex` taşıyan sayfayı otomatik eliyor (satır 64-69).
Yani noindex kararı site haritasına **kendiliğinden** yansır;
`generate-player-comparison-pages.mjs:594-602` içindeki site haritası
yazıcısı zaten sonradan eziliyor.

Ancak `scripts/qa.mjs` iki taban tutuyor:

```js
expect(sitemapLocs.size >= 3000, ...)                    // ~satır 657
["comparisons", "karsilastirma/", 2000]                  // satır 666
```

| Seçenek | Site haritası toplam | `karsilastirma/` | `>=3000` | `>=2000` |
| --- | --- | --- | --- | --- |
| (a) | 3281 | 2314 | geçer | geçer |
| (b) | 2878 | 1911 | **kırılır** (−122) | **kırılır** (−89) |
| (c) | 967 | 0 | **kırılır** (−2033) | **kırılır** (−2000) |

Bu tabanlar kasıtlı: bir üreticinin sessizce URL düşürmesini yakalamak için
konmuşlar. (b) veya (c) uygulanırsa **aynı commit içinde yeniden
tabanlanmalılar**, yoksa gerçek bir regresyonu yakalayacak koruma
gevşetilmiş olur. Bu bir engel değil, bir kontrol listesi maddesi.

Ayrıca `qa.mjs` küme eşitliği koruyor: `noindex` sayfa site haritasında
**olmamalı**. Noindex + site haritasında bırakma kombinasyonu derlemede
kırılır — yani "yarım uygulama" mümkün değil, bu iyi.

---

## 7. Bu ölçüm sırasında bulunan iki canlı kusur

İkisi de bu raporun kapsamı dışında; **düzeltilmedi**, çünkü görev
analizle sınırlı. İkisi de kararı etkiliyor, o yüzden burada.

### 7.1 19 sayfa, mock veriden türetilmiş bir üstünlük iddiası basıyor

`fieldComparable()` (`generate-player-comparison-pages.mjs:209-215)
yalnızca **alan kapısını** (`restrictedFieldIsPublishable`) çağırıyor;
**kayıt kapısını** (`evaluatePlayerCard` / `publicPlayerView().verified`)
çağırmıyor. Dosyanın kendi yorum bloğu (satır 188-208) "kayıt kapısı alan
kapısı değildir" ayrımını doğru kuruyor ama düzeltmede kayıt kapısı iddia
cümlelerinden tamamen düşmüş.

Sonuç: `statsAreVerified()` kayıt kapısından bağımsız olarak `appearances >
0` gördüğü için, sağlayıcı kimliği `mock-*` olan 8 kayıt piyasa
karşılaştırmasına giriyor. 19 sayfada şu üçlü aynı anda yayında:

- Sol kart: `Veri durumu — Doğrulanmış kayıt bekleniyor`
- Orta kart: `Mauro Icardi piyasa değeri okumasında daha güçlü sinyal veriyor.`
- Meta açıklama: `… doğrulanmış sağlayıcı verisiyle rol, kulüp ve ölçülmüş performans okuması …`

Doğrulama:

```bash
grep -rl 'piyasa değeri okumasında daha güçlü sinyal' karsilastirma/ | wc -l   # 19
grep -rl 'piyasa değeri okumasında daha güçlü sinyal' karsilastirma/ \
  | while read f; do grep -c 'data-player-verified="false"' "$f"; done \
  | sort | uniq -c                                                   # 19 sayfada "2"
```

Yani iddia cümlesi taşıyan 19 sayfanın **hepsinde** iki kart da
doğrulanmamış olarak işaretli. Örnek:
`karsilastirma/edin-dzeko-vs-mauro-icardi.html`.

**İleriye dönük büyütme riski:** istatistik senkronu 479 sağlayıcı kaydına
`statsVerifiedAt` yazdığı anda, `fieldComparable` bu kayıtları da piyasa
kıyasına sokar. Sağlayıcı kayıtlarının **479'unda da `marketValueEur`
`null`**; `Number(null)` `0` ve `Number.isFinite(0)` `true`. O anda 8 mock
kayıt × sağlayıcı kayıt eşleşmelerinde `27 500 000 ≠ 0` olur ve
**1157 sayfa**, bir NULL'a karşı kazanılmış bir piyasa üstünlüğü iddiası
basmaya başlar. Bugün bunu engelleyen tek şey sağlayıcı kayıtlarının henüz
`statsAreVerified` olmaması — yani senkron **kusuru tetikler**.

### 7.2 Hero satırı kulübü kapısız basıyor

`generate-player-comparison-pages.mjs:432`:

```js
<span class="hero-meta">${escapeHtml(playerTeamDisplay(left))} - ${escapeHtml(playerTeamDisplay(right))}</span>
```

`playerTeamDisplay()` doğrudan `player.currentTeam || player.team` okuyor;
`publicPlayerView()` kapısından geçmiyor. Mini kart aynı bilgiyi
doğrulanmamış kayıtta **kasıtlı olarak gizlerken**, hero aynı sayfada onu
basıyor.

Ölçüm: **2314 sayfanın 2314'ü** hero'da kulüp basıyor; bunların
**1579'unda** (B + C) en az bir kulüp, kapıyı geçemeyen bir kayıttan
geliyor. `Takım bilgisi yakında` yer tutucusunu basan sayfa sayısı: **0**.

Bu, §3.1'deki segmentasyonu okurken akılda tutulmalı: A ile C arasındaki
görünür fark, mini karttaki `<dl>` bloğuyla sınırlı. Kulüp adı zaten her
sayfada var. Yani "saf boş durum" adlandırması sayfanın *kapıdan geçen*
verisi için doğru, *bastığı* veri için değil.

---

## 8. Ne zaman yeniden bakılmalı — ölçülebilir tetik

Bu sayfaların meşru değer kazanması için gereken şey belirsiz değil,
sayılabilir. Üç bağımsız tetik var; **herhangi biri** kararı yeniden açar.

### Tetik 1 — Ölçülmüş derece kapsaması (asıl tetik)

**Koşul:** İki tarafı da `ratingIsVerified()` geçen kıyas sayfası sayısı
≥ **368** (A segmentinin yarısı) olduğunda, seçenek (b)/(c) yeniden
değerlendirilmeli. Bugünkü değer: **0**.

**Tespit komutu** (yazma yapmaz):

```bash
node -e "
const fs=require('fs');
const {getPlayers}=require('./services/playerService.js');
const {ratingIsVerified}=require('./services/cardCredibility.js');
const P=getPlayers(JSON.parse(fs.readFileSync('data/players.json','utf8')));
const ok=new Set(P.filter(ratingIsVerified).map(p=>p.id));
let n=0;
for (const f of fs.readdirSync('karsilastirma')) {
  if(!f.endsWith('.html'))continue;
  const [a,b]=f.slice(0,-5).split('-vs-');
  if(ok.has(a)&&ok.has(b))n++;
}
console.log('ölçülmüş derece taşıyan kıyas sayfası:', n, '/ 2314');
console.log('rating doğrulanmış oyuncu:', ok.size, '/', P.length);
"
```

Aynı komut kapsama eğrisini de verir; §9'daki tabloyla karşılaştırılır.

### Tetik 2 — Yinelenen kayıt birleştirmesi

**Koşul:** Sağlayıcı ikizi olan 81 legacy kayıttan herhangi biri
birleştirildiğinde, **1071 kıyas URL'si** yeniden üretilemez hâle gelir.
Bu, indeksleme kararını zaten zorunlu olarak yeniden açar (yönlendirme mi,
alias mı, silme mi).

**Tespit:** `data/players.json` içinde `dataStatus !== "provider"` kayıt
sayısı 110'un altına düştüğünde. Tek satır:

```bash
node -e "const P=require('./data/players.json');console.log('legacy kayıt:',P.filter(p=>p.dataStatus!=='provider').length,'(taban 110)')"
```

### Tetik 3 — Talep kanıtı

**Koşul:** GSC Performans raporunda `/karsilastirma/` ön eki için 28 günlük
gösterim, aynı pencerede `/oyuncular/` gösteriminin **%5'ini** aşıyorsa,
sayfalar ince olsalar da gerçek bir arama talebi karşılıyor demektir ve
noindex kararı bu talebi karşılayacak bir içerik planı olmadan verilmemeli.

**Tespit:** GSC → Performans → Sayfa filtresi `karsilastirma` içerir.
**Bu ölçüm henüz alınmadı.** GA4 yapılandırılmamış olduğu için (§5) başka
kaynak yok. **Herhangi bir karardan önce bu temel anlık görüntü
alınmalıdır.**

---

## 9. Ölçüm geldiğinde ne olur — kapsama modeli

API-Football istatistik senkronu (`scripts/sync-player-statistics.mjs`,
`services/playerStatsSyncService.js`) ölçüm yazdığında kıyas sayfaları
otomatik içerik kazanır: `ratingStatus: "provider"` + `ratingVerifiedAt`
yazılır, `ratingIsVerified()` `true` döner ve `comparisonInsight()` gerçek
bir derece cümlesi kurar.

### 9.1 Tavan — sabit ve düşük

Senkron oyuncuları **sayısal `providerId` ile** eşleştiriyor
(`playerStatsSyncService` / `indexByProviderId`). 110 legacy kaydın
tamamının kimliği `mock-*`; **hiçbiri hiçbir zaman eşleşmeyecek**.

| | Sayfa | Pay |
| --- | --- | --- |
| Ölçüm kazanabilecek (sağlayıcı × sağlayıcı = A segmenti) | **735** | %31,8 |
| **Yapısal olarak kazanamayacak** (≥1 legacy/mock taraf) | **1579** | **%68,2** |

Ayrıca **piyasa değeri satırı için tavan sıfır**: 479 sağlayıcı kaydının
**hiçbirinde** `marketValueEur` yok ve kadro/istatistik uç noktaları piyasa
değeri döndürmüyor. Yani sağlayıcı × sağlayıcı çiftlerinde piyasa kıyası
asla oluşmayacak; yalnızca derece kıyası oluşabilir.

**Sonuç:** en iyi ihtimalle 2314 sayfanın 735'i "iki kulüp + bir rol
cümlesi + bir derece cümlesi" seviyesine çıkar. 1579 sayfanın tek çıkışı
içerik değil, **birleştirme/silme**.

### 9.2 Kapsama eğrisi (735 sayfalık havuz içinde)

Sağlayıcı oyuncularının derece kapsaması `p` iken kaç sayfanın iki tarafı
da ölçülü olur? Eşleşme grafiğinin gerçek derece yapısı kullanıldı
(bu alt grafikte oyuncu derecesi: maks 151, ortanca 1).

| Kapsama | Ölçülü oyuncu | **En iyi hâl** (yüksek dereceli önce) | **Rastgele beklenti** (p²·735) | En kötü hâl |
| --- | --- | --- | --- | --- |
| %10 | 48 | 102 (%4,4) | 7 (%0,3) | 0 |
| %25 | 120 | 295 (%12,7) | 46 (%2,0) | **0** |
| %50 | 240 | 496 (%21,4) | 184 (%8,0) | **0** |
| %75 | 359 | 615 (%26,6) | 413 (%17,8) | **0** |
| %90 | 431 | 687 (%29,7) | 595 (%25,7) | 3 |
| %100 | 479 | 735 (%31,8) | 735 (%31,8) | 735 |

Aralık çok geniş çünkü grafik son derece merkezîleşmiş: ortanca sağlayıcı
oyuncusu bu alt grafikte yalnızca **1** kenara sahip. Kapsama %90'a
çıkmadan **en kötü hâlde sayfa sayısı sıfırda kalıyor** — yani "istatistik
senkronu koştu" cümlesi tek başına hiçbir şey söylemez; §8 Tetik 1'deki
sayfa düzeyi sayım okunmalıdır.

### 9.3 Kararla etkileşimi

- **Seçenek (b)** C2'yi (403) hedefler. Bu 403 sayfanın **hiçbiri**
  istatistik senkronundan içerik kazanamaz (hepsi legacy × legacy). Yani
  (b), veri geldiğinde "haksız" hâle gelmeyecek tek seçenek: hedef kümesi
  ile veri yolu hiç kesişmiyor.
- **Seçenek (c)** 735 sayfayı da kapsar. Veri geldiğinde bu 735'i geri
  açmak gerekir — yani (c), veri takvimine bağlı bir geri alma borcu
  yaratır.
- Her iki durumda da §7.1'deki kusur **senkrondan önce** kapatılmalı; aksi
  hâlde senkron 19 sayfalık yanlış beyanı 1157 sayfaya çıkarır.

---

## 10. Karar için tek sayfalık özet

**Kanıtın söyledikleri:**

1. Kıyas katmanı indekslenebilir yüzeyin %70,53'ü, HTML gövdesinin %69,3'ü;
   ortanca sayfa 111 kelime ve bunun %51,4'ü tüm korpusta ortak şablon.
2. Noindex'in **gezinme maliyeti ölçülebilir biçimde sıfıra yakın**: 0 yeni
   öksüz, 0 derinlik değişimi, 0 arama indeksi bağımlılığı. Tek somut yan
   hasar 32 kök bağlantısının `noindex` hedefe dönmesi ve
   `oyuncu-karsilastirmalari.html`'in işlevsiz kalması (yalnızca seçenek c).
3. Korpus homojen değil ama **hiçbir segment kalın değil**: en iyi segment
   (A, 735) sayfa başına iki kulüp adı taşıyor ve onun da %27,8'inde tek
   analitik cümle `diger ve diger` diyor.
4. **URL'lerin %46,3'ü zaten geçici** (yinelenen kayıt birleştirmesi onları
   öldürecek), %60,2'si sekiz mock kaydın birine dayanıyor, %25,4'ü tek bir
   legacy kaydı içeriyor.
5. Veri geldiğinde iyileşme **tavanı %31,8**; kalan %68,2 yapısal olarak
   kapalı.
6. **Karar için gereken tek ölçüm henüz alınmadı:** GSC'de bu ön ekin
   gösterim/tıklama temeli. GA4 yapılandırılmadığı için başka kaynak yok.

**Bu rapor bir karar önermiyor.** Ama iki şeyi işaret ediyor: (i) §7.1'deki
kusur karardan bağımsız ve istatistik senkronundan **önce** kapatılmalı,
çünkü senkron onu 19 sayfadan 1157 sayfaya büyütüyor; (ii) §8 Tetik 3'teki
temel GSC anlık görüntüsü alınmadan (b) veya (c) uygulanırsa, sonradan
"işe yaradı mı" sorusunun cevaplanacak bir karşılaştırma noktası olmayacak.

---

## Ek — kaynak dosyalar

| Konu | Dosya |
| --- | --- |
| Kıyas sayfası üretimi, robots meta, slug | `scripts/generate-player-comparison-pages.mjs` (satır 370 robots, 75-77 slug, 209-249 iddia mantığı, 432 hero) |
| Yayın kapısı | `services/cardCredibility.js` (`publicPlayerView`, `restrictedFieldIsPublishable`, `ratingIsVerified`, `statsAreVerified`) |
| Alias / noindex kalıbı | `scripts/generate-player-profile-pages.mjs:371-384` |
| Site haritası üretimi (noindex elemesi) | `scripts/generate-sitemap.mjs:64-69` |
| Site haritası tabanları | `scripts/qa.mjs:657` (toplam ≥3000), `scripts/qa.mjs:666` (bölüm tabanları) |
| İstatistik senkronu | `scripts/sync-player-statistics.mjs`, `services/playerStatsSyncService.js`, `docs/player-statistics-operations.md` |
| Oyuncu verisi | `data/players.json` (589 kayıt: 479 `provider`, 110 legacy) |
