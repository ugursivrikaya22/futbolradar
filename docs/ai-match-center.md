# AI Maç Merkezi

Maç detay sayfasındaki **AI Analiz** sekmesinin mimari kaydı. Sekme,
TR `/mac/<slug>` ve EN `/en/match/<slug>` sayfalarında maç sonucu
ihtimallerini, bu yüzdelerin dayandığı ölçülmüş farkları, güven
seviyesini, son 5 maç formunu, eksiklerin ve muhtemel 11'in etkisini,
hücum-savunma karşılaştırmasını, ikili rekabeti ve kısa maç özetini tek
yerde toplar.

## 1. Neden tek motor, iki sözlük

Bu depoda İngilizce maç sayfaları bir dönem kendi işaretlemesini kurdu
(`scripts/generate-en-match-pages.mjs`) ve Türkçe tarafta olan bölümler
İngilizce tarafta eksik kalabildi. AI Maç Merkezi ilk satırından itibaren
bu hatayı yapısal olarak imkânsız kılacak biçimde kuruldu:

```
                 doğrulanmış veri
                        │
        services/aiMatchCenter.js   ← DİLDEN BAĞIMSIZ motor
          (anahtar + sayı üretir, cümle üretmez)
                        │
        scripts/lib/aiMatchCenter.mjs
          AI_STR.tr ──┐        ┌── AI_STR.en
                      ▼        ▼
                /mac/<slug>   /en/match/<slug>
```

Motor cümle kurmaz; `{ key, lean, strength, values }` biçiminde **yapısal
sürücüler** döndürür. Cümleyi sözlük yazar. Sonuç: bir bileşen eklendiğinde
iki dilde birden doğar, silindiğinde ikisinden birden düşer. Bir dile
"şunu da ekleyelim" denemez — eklenecek şey motorda üretilmiyorsa iki dilde
de yoktur.

`scripts/test-ai-match-center.mjs` bunu mekanik olarak kilitler: sözlük
anahtarlarının eşliğini, anahtar **türlerinin** eşliğini ve üretilmiş 361
maç sayfasının TR/EN bileşen kümelerinin birebir aynı olduğunu doğrular.

## 2. Uydurma yasağı

Motorun birinci kuralı: kaynağı olmayan alan `null` döner ve çizen taraf o
bileşeni **hiç basmaz**. Somut karşılıkları:

- Bir sürücü ancak **iki tarafın da** ölçülmüş sayısı varken doğar. Tek
  taraflı karşılaştırma yapılmaz.
- Sakatlık **bildirimi** yoksa "eksik yok" yazılmaz. Bildirimin yokluğu,
  eksiğin yokluğu değildir.
- Hiç sürücü ölçülmediyse "başa baş bir maç" denmez; ölçülüp fark
  çıkmadıysa denir. İkisi farklı şeydir.
- Maç bitince kazanma olasılığı gösterilmez. Sonuç bellidir.
- Güvenin ham yüzdesi (0-100) ekrana yazılmaz. Model bu değeri "kaç ayaklı
  duruyorum" ölçüsü olarak üretir, ölçülmüş bir olasılık olarak değil.
  Okuyucuya düzey adı, görsel çubuk ve güvenin **dayandığı örneklem**
  verilir — sayının kendisi yerine sayının nedeni.

### Gösterilen yüzde ile açıklamanın ilişkisi

Ekrandaki 1-X-2, mevcut zincirin çözdüğü kaynaktan gelir (sağlayıcı →
piyasa → FutbolRadar modeli) ve kaynağı **ayrıca etiketlenir**. Açıklama
ise her zaman ölçülmüş girdilerin kendisini anlatır; sağlayıcının yüzdesini
geriye dönük gerekçelendirmez. O gerekçe bizim bilmediğimiz bir modele ait
olurdu ve uydurma sayılırdı.

## 3. Sürücüler ve eşikler

| Anahtar   | Kaynak (`fixtureProbabilityModel` `inputs`) | Belirgin | Hafif |
|-----------|---------------------------------------------|----------|-------|
| `attack`  | `attackStrength` (lig ortalamasına oran)     | 0.20     | 0.08  |
| `defense` | `defenseStrength` — **düşük olan iyidir**    | 0.20     | 0.08  |
| `form`    | `formDelta` (maç başına puan sapması)        | 0.60     | 0.25  |
| `absence` | bildirilen eksik sayısı — **az olan iyidir** | 3        | 1     |
| `h2h`     | maç başına ortalama gol farkı (≥2 maç)       | 1.00     | 0.34  |
| `rank`    | normalize lig sırası farkı                   | 0.35     | 0.12  |

Eşikler keyfi değil, modelin kendi ölçeğinden türetilmiştir
(`attackStrength` 0.65–1.50 aralığında sıkıştırılır, `formDelta` ±1.5 ile
sınırlıdır). Karşılaştırma **ekranda görünen** yuvarlanmış farkla yapılır:
aksi hâlde "0,20" diye basılan bir fark, kayan nokta artığı yüzünden
"hafif" etiketini alabilir ve sayı ile etiketi birbirini yalanlardı.

## 4. Canlı davranış — skor akışı asla beklemez

`ai-match-center.js` **kendi ağ isteğini atmaz**. Maç sayfasının zaten
çalışan tek yoklama döngüsü (`match-center.js` → `/api/match-detail`) her
yanıtta `futbolradar:match-detail` olayını yayınlıyor; AI istemcisi yalnızca
o olaya abone olur. Yani AI sekmesi açık olsun ya da olmasın sağlayıcıya
giden istek sayısı, yoklama aralığı ve kota **değişmez**.

İkinci koruma: olay geldiğinde hiçbir iş anında yapılmaz. `match-center.js`
skoru ve olay akışını zaten boyamış olur (olayı `render()` sonunda
yayınlar); AI çizimi `requestIdleCallback` ile tarayıcı boştayken kuyruğa
alınır. Dinleyici `passive`.

Canlıda tazelenen şey, yanıtın **gerçekten taşıdığı** veridir: maç
istatistikleri (şut, isabetli şut, topla oynama, korner, xG), skor ve
dakika. Skordan yüzde **türetilmez** — bu depoda maç içi kazanma olasılığı
modeli yoktur ve bu bilinçli bir karardır (bkz. `services/winProbability.js`,
kasıtlı olarak boş bir soket). Canlı maçta gösterilen 1-X-2 açıkça
"maç öncesi okuma, başlama vuruşunda dondurulmuş" diye etiketlenir.
Sunucuya gerçek bir canlı model takıldığı gün `radarPulse.winProbability`
dolmaya başlar ve istemci onu tek satır değişmeden çizer.

## 5. Sekme: JavaScript'siz çalışır

Sekmeler gizli radyo düğmesi + `label[role="tab"]` ile kurulur; seçim CSS
ile yapılır (`site.js` yalnızca klavye gezinmesini ve `aria-selected`
eşitlemesini ekler). Betik yüklenmese bile sekmeler çalışır ve canlı skor
yoluna tek bir işlem eklemez.

Paneller `<section>`, sekme listesi `<div>` olarak basılır. Bu tür farkı
bilinçlidir: CSS seçili paneli `section:nth-of-type(n)` ile bulur ve sekme
listesi aynı türden olsaydı sıra bir kayardı.

Seçili olmayan panel DOM'dan **kaldırılmaz**, yalnızca görsel olarak
gizlenir. Böylece arama motoru ve ekran okuyucu içeriğin tamamına erişir ve
`#form`, `#son-maclar`, `#muhtemel-11` gibi mevcut derin bağlantılar
bozulmaz. Skor tablosu sekmelerin **dışında**, üstte kalır: okuyucu AI
sekmesine geçtiğinde skoru kaybetmez.

## 6. Mobil öncelikli, masaüstünde eksiksiz

İşaretleme tek sütun için yazılır; masaüstü düzeni `page.css` içinde
yalnızca ızgara genişletilerek kurulur (`@media (min-width: 720px)` ve
`1024px`). Mobilde gizlenen bir bileşen **yoktur**: masaüstünde görünen her
kutu mobilde de basılır, sadece alt alta gelir. Ekrandan düşen tek şey,
verisi olmayan bölümdür.

## 7. PRO

AI Maç Merkezi PRO rozeti taşır ve **şimdilik tüm kullanıcılara ücretsizdir**.
Kapı (paywall) yoktur; rozetin yanındaki not bunu açıkça söyler. Ücretsizlik
notu iki dilde de sözlükten gelir (`proFree`), yani bir gün kapı eklenecekse
metin tek yerden değişir.

## 8. Dosyalar

| Dosya | İş |
|-------|-----|
| `services/aiMatchCenter.js` | Dilden bağımsız okuma motoru |
| `scripts/lib/aiMatchCenter.mjs` | TR+EN işaretleme, `AI_STR` sözlüğü, sekme kabuğu |
| `scripts/generate-match-seo-pages.mjs` | Girdi toplama + sekmelerin sayfaya basılması |
| `ai-match-center.js` | Canlı tazeleme istemcisi (kendi isteği yok) |
| `page.css` | `.ai-*` blokları — mobil öncelikli |
| `scripts/test-ai-match-center.mjs` | Sözleşme denetimi (ağsız) |
| `scripts/test-ai-match-center-browser.mjs` | TR/EN × masaüstü/mobil tarayıcı denetimi |

## 9. Test

```bash
npm run test:ai-match-center           # ağsız sözleşme denetimi
npm run test:ai-match-center-browser   # dört ortam: TR/EN × masaüstü/mobil
```

Tarayıcı denetimi dört ortamı da koşar (TR Masaüstü, TR Mobil, EN Masaüstü,
EN Mobil) ve şunları arar: sekme gerçekten çalışıyor mu, dört ortam da
**aynı** bileşenleri gösteriyor mu, yatay taşma var mı, dokunma hedefi
44px'i geçiyor mu, karşı dilin arayüz metni sızmış mı, konsol hatası var mı,
JavaScript kapalıyken sekme hâlâ açılıyor mu ve AI paneli **fazladan ağ
isteği** açıyor mu.

Son madde canlı skorun yavaşlamadığının mekanik kanıtıdır: sayfa açıkken
`/api/match-detail` çağrısı en fazla bir kez görünmelidir.
