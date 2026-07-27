# Maç Sonu Zenginleştirme

Tamamlanmış her fikstür için sağlayıcı kimliğini çözer ve **doğrulanmış**
maç sonu verisini çeker: olaylar, dizilişler, takım istatistikleri, oyuncu
istatistikleri.

## Koşu

```bash
npm run enrich:post-match                          # dry-run, yazmaz
node scripts/enrich-post-match.mjs --apply         # data/match-enrichment.json
node scripts/enrich-post-match.mjs --apply --match=<id>
node scripts/enrich-post-match.mjs --apply --refresh   # önbelleği yok say
```

## Sağlayıcı kimliği nasıl çözülür?

Kürasyonlu maçların çoğunda API-Football fikstür kimliği yok. Çözümleme
**muhafazakâr**: yanlış maça bağlanmak, hiç bağlanmamaktan çok daha kötüdür
— başka bir karşılaşmanın golleri ve dizilişi bu maçın raporuna yazılırdı.

Her maç için önce o günün fikstür listesi çekilir (`/fixtures?date=`),
sonra aşağıdaki sıra uygulanır:

| Sıra | Koşul | Sonuç |
| --- | --- | --- |
| 1 | Kayıtta **sayısal** `providerId` var, listede bulunuyor, **takımlar + tarih + skor** tutuyor | Kabul (`high`) |
| 2 | Aynı, ama kürasyonda skor yok (takım + tarih tutuyor) | Kabul (`medium`) |
| 3 | Kayıttaki kimlik listede **yok** ya da takım/tarih/skor **tutmuyor** | **REDDEDİLİR**, 4. adıma düşülür |
| 4 | **İki takım adı** + **tarih** eşleşir **ve skor uyuşur** | Çözülür (`high`) |
| 5 | Ad eşleşir, skor uyuşmaz | **Bağlanmaz** |
| 6 | Kürasyonlu skor yok | **Bağlanmaz** (tek sinyal yetmez) |
| 7 | Birden çok aday aynı skorla eşleşir | **Bağlanmaz** (belirsiz) |

### Kayıttaki kimlik neden doğrulanıyor?

`data/matches.json` içindeki `providerId` elle girilebiliyor ve **bir iddia,
kanıt değil**. `goztepe-rudes-2026-07-26` kaydındaki `2542013` kimliği
sağlayıcının o tarihteki 73 fikstürünün hiçbirine karşılık gelmiyordu; eski
çözümleyici onu doğrulamadan "yüksek güven" ile kabul ediyor, dört uç nokta
da boş dönüyor ve maç **%0 kapsamla doğrulanmış görünüyordu**. Sessiz bir
yanlış bağlama, gürültülü bir çözümsüzlükten daha zararlıdır.

3. adımda reddedilen kimlik aday havuzundan **çıkarılır**: doğrulamada
elenen fikstürün denetimi daha zayıf olan 4. yoldan geri sızması, reddin
kendisini anlamsız kılardı. Kuru koşu günlüğü bunu ayrı bir satırla basar:

```
KAYITTAKİ KİMLİK KULLANILMADI: 2542013 → 1598546
```

Harfli kimlikler (ör. TheSportsDB'nin `blx8udpk…` biçimi) API-Football
fikstür kimliği sayılmaz; o kayıtlar doğrudan 4. adımdan geçer.

Takım adı karşılaştırması ek/kısaltma toleranslıdır (`Beşiktaş` ↔
`Besiktas JK`), ama tek başına asla yeterli değildir. Tarih karşılaştırması
Europe/Istanbul takvim gününe indirgenir ve **bir gün** tolerans taşır —
gece yarısını aşan başlama saatleri sağlayıcının UTC gününde bir gün
öncesine düşebiliyor.

## Bölümler ve doldurma kuralı

| Bölüm | Uç nokta |
| --- | --- |
| Maç özeti | olaylardan türetilir |
| Goller | `/fixtures/events` (kart ve **kaçan penaltı** hariç) |
| Maç olayları | `/fixtures/events` |
| Dizilişler | `/fixtures/lineups` |
| Takım istatistikleri | `/fixtures/statistics` |
| Oyuncu istatistikleri | `/fixtures/players` |

**Yalnızca ölçülmüş alan yayımlanır.** Sağlayıcının göndermediği alan yamaya
girmez; sıfırla veya tireyle doldurulmaz. Somut kurallar:

- Dakikası olmayan olay atılır.
- Gönderilmeyen asist alanı **hiç yazılmaz** (null asist, "asist yok" değil
  "asist ölçülmedi" demek).
- İlk on biri olmayan diziliş bölüm açmaz — yalnızca yedek listesi diziliş
  değildir.
- Tek taraflı takım istatistiği tablo kurmaz.
- **Oynamamış oyuncu satır açmaz**: 0 dakika + sıfır ölçüm, "oynadı ve
  üretemedi" gibi okunur.

## Kısmi kapsam mesajı

Dolmayan bölüm **gizlenmez**. Sessizce kaybolan bir bölüm okuyucuya "bu
maçta diziliş yoktu" gibi görünür; oysa olan şey verinin gelmemesi.

Sayfa iki katmanda bildirir:

1. Bölüm başına: *"Dizilişler için sağlayıcıdan doğrulanmış veri gelmedi."*
2. Rapor başına, eksikleri **adıyla** sayan tek cümle:
   *"Şu bölümler için doğrulanmış veri bekleniyor: Dizilişler, Oyuncu
   istatistikleri…"*

Kapsam yüzdesi `data-enrichment-coverage` olarak da basılır.

### `dataStatus`: "tam", eksik bölüm yok demektir

| Durum | Koşul |
| --- | --- |
| `complete` | **Altı bölümün altısı da dolu** |
| `partial` | En az bir bölüm dolu, en az biri eksik |
| `unavailable` | Hiçbir bölüm dolu değil |

Bu alan bir dönem rapor katmanının yüzdelik eşiğini (`coverage >= 70`)
kopyalıyordu. Sonuç kendi kendisiyle çelişen bir kayıttı:
Beşiktaş–Midtjylland %83 ile `complete` damgası alıyor, aynı kayıt
`partialMessage` alanında "Oyuncu istatistikleri bekleniyor" diyordu.
`dataStatus === "complete"` kontrolüne bakan bir tüketici o mesajı
gizlemekte haklı olurdu — ve sayfa ölçülmemiş bir bölümü ölçülmüş gibi
gösterirdi.

Yüzdelik eşik burada zaten yanlış araçtı: altı bölümün üçü (`summary`,
`goals`, `events`) **tek bir uç noktadan** (`/fixtures/events`) türüyor.
Yani `coverage` bağımsız sinyalleri saymıyor; dört uç noktanın katkısı
3/1/1/1. "%50 kapsam" pratikte "dört uç noktadan biri veri döndürdü"
demek.

Değişmez: `dataStatus === "complete"` ⟺ `partialMessage === null`.
%70–99 bandı testlerle sabitlenmiştir.

## Sayfa entegrasyonu (salt okunur)

`scripts/generate-post-match-pages.mjs` depoyu **yalnızca okur**;
`services/postMatchEnrichmentView.js` tek bir kaydı HTML'e çevirir.

- **Kayıt yoksa bölüm de yok.** Zenginleştirilmemiş maçın raporunda boş
  bir "veri bekleniyor" kutusu açılmaz: o maç için sağlayıcıdan veri
  *istenmedi*, gelmemiş değil.
- **Dolu bölüm kökenini taşır**: sağlayıcı adı, fikstür kimliği, gözlem
  zamanı.
- **Eksik bölüm rakam taşımaz.** "0 oyuncu" yazmak, sağlayıcı oyuncu
  verisi göndermediğinde "hiç oyuncu oynamadı" gibi okunur. Eksik satırda
  hiçbir sayı üretilmez — bu bir testle zorlanır.

Depo dosyası yoksa üretim durmaz; hiçbir rapora bölüm eklenmez.

## Köken (provenance)

Her dolu bölüm kaynağını taşır: `API-Football` veya `FutbolRadar kürasyon
(manuel)`, gözlem tarihi ve fikstür kimliğiyle birlikte.

## Manuel kürasyon geçersiz kılma

`data/match-enrichment-overrides.json` bölüm bazında elle değer taşıyabilir.
Bu değer sağlayıcıyı **ezer** ve sayfada kaynağı manuel olarak işaretlenir.

```json
{
  "goztepe-rudes-2026-07-26": {
    "events": [
      { "minute": 21, "type": "Goal", "detail": "Normal Goal",
        "team": "Göztepe", "player": "Ege Yıldırım" }
    ]
  }
}
```

**Ne zaman kullanılır:** sağlayıcı ölçülebilir biçimde yanlış veri
gönderdiğinde. **Ne zaman kullanılmaz:** eksik bölümü doldurmak için —
buraya uydurulmuş değer girmek, sitenin tamamında kaldırılan doğrulanmamış
iddiayı geri getirir.

## Önbellek ve kota

- **Kalıcı önbellek:** bitmiş maçın verisi değişmez. Kapsamı %100 olan kayıt
  için sağlayıcıya bir daha gidilmez (`--refresh` bunu ezer).
- **İstek önbelleği:** tüm çağrılar `services/providerCache.js` üzerinden
  geçer (TTL, tek uçuş, 429'da bayat servis).
- **Aralık:** çağrılar arasında 250 ms.

Maç başına 4 çağrı + 1 kimlik doğrulaması. Tarih sorgusu önbellekten geçtiği
için aynı güne düşen maçlar tek çağrıyı paylaşır. Dokuz tamamlanmış fikstür
için ilk tam koşu ≈ 43 istek.

## Güvenlik kapıları

| Durum | Davranış |
| --- | --- |
| Anahtar yok | Adıyla bildirilir, çıkış kodu 1, hiçbir dosya yazılmaz |
| Kimlik çözülemedi | Maç atlanır, kürasyonlu rapor korunur, gerekçe listelenir |
| **Kayıttaki `providerId` doğrulanamadı** | **Reddedilir**, aday havuzundan çıkarılır, günlüğe ayrı satır düşer |
| **Dört uç noktanın dördü de hata verdi** | **Hiçbir şey yazılmaz** — kesinti, kapsam değildir |
| Kapsam düştü | Yazma reddedilir, mevcut kayıt korunur |
| Kürasyon müdahalesi var | Kapsam düşse bile yazılır (bilinçli karar) |

Dördüncü satır önemli: bir anahtar/kota kesintisini "sağlayıcıda veri yok"
diye kaydetmek, geçici bir bağlantı sorununu kalıcı bir kapsam olgusuna
çevirirdi.

## Doğrulama

```bash
node scripts/test-post-match-enrichment.mjs
npm run lint
```
