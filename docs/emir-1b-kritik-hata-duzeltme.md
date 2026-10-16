# EMİR 1B — Kritik hata düzeltme ve sistem güvenilirliği

Kapsam: Görev 1 (İngilizce bağlantılar, P0), Görev 2 (yanlış maç durumları, P1),
Görev 3 (aynı adlı liglerin karışması, P1). Ek üretim maliyeti: koşu başına en
fazla 6 sağlayıcı isteği (aşağıda), başka maliyet yok.

## 1. /en bağlantıları

**Kök neden.** `vercel.json` `trailingSlash: false` ve `/en → en/index.html`
yeniden yazımı kullanıyor. Dosya `en/` klasöründe durur, ama tarayıcı onu
**`/en`** (eğik çizgisiz) adresinde açar. Göreli href'ler dosya yoluna değil
adrese göre çözülür:

| `/en` üzerinde yazılan | tarayıcının gittiği | sonuç |
| --- | --- | --- |
| `./todays-matches.html` | `/todays-matches.html` | 404 |
| `./match-detail.html?id=…` (341 maç kartı) | `/match-detail.html` | 404 |
| `./player/x.html`, `./team/x.html`, `news/x.html` | kök dizin | 404 |

Tek etkilenen sayfa `en/index.html` idi (390 bağlantı); `../en/...` biçimi
tesadüfen çalıştığı için diğer EN sayfalar etkilenmedi. Eski testler dosya
yoluna baktığı için hiçbiri görmedi.

**Düzeltme.**
- `scripts/lib/servedLinks.mjs` — yalnızca sunulan adreste farklı çözülen
  href'leri kök mutlağa (`/en/todays-matches.html`) çevirir; doğru çözülenlere
  dokunmaz, idempotent.
- `scripts/generate-en-pages.mjs` yazarken uygular; `normalize-served-links`
  adımı son-işlem zincirinde (`lib/postprocessChain.mjs`) sonradan eklenen
  bağlantıları da kapsar.
- Dil kutusu: lig puan durumu, anket ve hafta numaralı maç sayfalarında dil
  değiştirici karşı dilin **ana sayfasına** atıyordu (31 sayfa).
  `scripts/sync-lang-switch.mjs` kutuyu sayfanın hreflang eşine bağlar
  (zincirde `hreflang`tan sonra).
- hreflang/canonical: 66 EN oyuncu sayfası TR eşini 301 veren
  `/futbolcu/x.html` adresiyle bildiriyordu → `services/i18n.js#absoluteUrl`
  artık son adresi (`/futbolcu/x`) yazar; 1. Lig TR sayfası olmayan EN sayfayı
  alternate ilan ediyordu (404) → kaldırıldı; Süper Lig TR puan durumu EN eşine
  hreflang vermiyordu (tek yönlü) → eklendi.

**Doğrulama.** `npm run test:internal-links` (statik, 15.814 sayfa,
1,28 milyon bağlantı, sayfanın sunulduğu adrese göre) ve
`npm run test:en-links-browser` (gerçek tarayıcı, JS'in eklediği bağlantılar
dahil). İkisi de önceki HEAD'de **düşüyor** (390 kırık bağlantı), düzeltmeyle
geçiyor. `npm run audit:internal-links` raporu iki sınıfa ayırır:
`wrong-base` (üretim hatası) ve `removed` (sayfa gerçekten yok). Şu an ikisi de 0.
Site haritası 7.792 adres, hepsi 200.

Bilinen kalan: 4.324 iç bağlantı 301'e gidiyor (çoğu `/oyuncular/…` →
`/futbolcu/…`, mevcut `internal-redirect-link-baseline.json` ile izleniyor);
404 değil.

## 2. Yanlış maç durumları

Üç maçın git geçmişindeki gerçek zaman çizelgesi `scripts/test-match-status-integrity.mjs`
başında.

| Maç | Neyin yanlış olduğu | Şimdi |
| --- | --- | --- |
| Santa Fe – Jaguares | 15 Ekim 02:30 → 16 Ekim 04:05'e kaydı → PST → **TBD**. Satırda eski yer tutucu saat kaldı; günün listesinde "04:05" yazıyordu. | "Saat belirlenmedi / Time TBC", saat yok, sayfa indekslenmez |
| Caracas W – Santa Fe W | Sağlayıcı günün listesinden düşürünce 31 saat bayat NS kaldı | "Sonuç bekleniyor / Result pending"; skor/saat uydurulmaz; kimlikle yeniden sorulur |
| Ümraniyespor – Boluspor | 14 Ekim 19:31'de INT (ara verildi), iki gün sonra hâlâ karar yok; "Maç Sonucu" başlıklı sayfa | "Yarıda kaldı / Suspended"; skor kartta basılmaz, sayfada yalnızca "son doğrulanmış skor" notu; nihai sonuç ilan edilmez |

**Kök nedenler ve düzeltmeler.**
- Saatlik koşu yalnızca dün/bugün/yarını soruyor; o pencereden çıkan ya da günün
  listesinden düşen satır sonsuza dek donuyordu. `scripts/sync-live-fixtures.mjs`
  artık çözülmemiş satırları (INT → TBD → bayat NS/LIVE → PST sırasıyla) **kimlikle**
  (`/fixtures?id=`) sorar: koşu başına ≤ 6 (tam koşuda 12) istek, satır başına
  2–24 saatlik kısıtlama, 14 günlük sınır, canlı modda ve kota darken çalışmaz.
  Ada göre tahmin yok; sağlayıcı ne derse yazılır, cevap yoksa durum değişmez.
- `services/matchStatus.js`: `isTimeUnconfirmed` (TBD), `cardPhase` (kart/liste
  için tek faz kararı), "Yarıda kaldı" etiketi. Türkçe/İngilizce statik kartlar,
  `daily-fixtures-en.js` ve `app.js` aynı kuralı kullanır.
- Maç sayfası durumları `tbd` ve `interrupted` eklendi (başlık, açıklama, not).
- **Skor geri çekme.** Şili K – Bolivya K: sağlayıcı FT 7-0 dedikten sonra CANC
  dedi; takvim CANCELLED satırında 7-0'ı, arşiv FINISHED 7-0'ı tutuyordu. Birleştirme
  artık iptal/erteleme gelince skoru temizler (`scoreRetracted` izi bırakır); arşiv
  kaydı geri çekilir, silinmez (`retractedResult`). Mevcut satırlar
  `scripts/repair-unplayed-scores.mjs` ile onarıldı.
- Yer değiştiren saat izi: `rescheduledFrom`.

**Otomatik sonuç.** Hiçbir yol sağlayıcı bitiş kodu olmadan sonuç atamıyor; test
bunu takvim, rapor ve arşiv üzerinde doğrular (elle doğrulanmış 17 arşiv kaydı
`manual` kaynağıyla ayrıdır).

## 3. Liglerin karışması

**Kök neden.** `competitionId` ad eşleşmesiyle atanıyordu: "Ligue 1" adı Fransa (61),
Cezayir (186), Tunus (202), Fildişi Sahili (386), Senegal (403) için de geliyor ve
hepsi `ligue-1` oluyordu. Cezayir maç sayfaları Fransa Ligue 1 puan durumuna
bağlanıyor, büyük beş lig önceliğiyle sıralanıyordu. Aynı sınıfta 227 takvim satırı
vardı (Premier League ×125, Ligue 1 ×44, Primera División ×41, Championship ×14,
Avusturya Bundesliga'sı ×3).

**Düzeltme.** `services/competitionCatalog.js`: sağlayıcının sayısal lig kimliği
adı ezer (`isForeignNamesake`); yabancı lig `ligue-1-186` gibi ayrı kimlik ve
"Ligue 1 (Cezayir)" / "Ligue 1 (Algeria)" etiketi alır (ülke bilinmiyorsa uydurulmaz,
yalnızca ayrı kimlik verilir). Senkron yeni veriyi böyle yazar.
`scripts/repair-league-identity.mjs` mevcut veriyi onardı (takvim, tahminler,
arşivler). Fransa kulübü olmayan 51 "Ligue 1" maç sayfası kaldırıldı ve
**maç merkezine 301** verildi, site haritasından çıkarıldı; liste
`data/league-identity-report.json` içinde (ayrı rapor).

## Çalıştırma

```
npm run test:internal-links     # statik bağlantı + canonical/hreflang + site haritası + dil kutusu
npm run test:en-links-browser   # gerçek tarayıcı (Playwright)
npm run test:match-status
npm run test:league-namesake
npm run audit:internal-links    # rapor → data/internal-link-audit.json
```

## Dikkat

- Silinen 51 maç sayfasına giden kalan bağlantılar (maç takvimi/arşiv listeleri,
  rapor sayfaları) saatlik üretimde kendiliğinden temizlenir; o zamana kadar 301 ile
  maç merkezine gider, 404 vermez.
- `npm test` HEAD'de zaten düşüyor (İngilizce dil saflığı, EN dinamik sayfa sayısı,
  oyuncu reyting yüzeyi vb.); bu emirle ilgisiz.
