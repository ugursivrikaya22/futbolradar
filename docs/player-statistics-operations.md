# Oyuncu İstatistik Senkronu

Oyuncu Radarı ve ana sayfa oyuncu etki bloğu **ölçülmüş** veriye dayanır.
Bu belge o ölçümün nereden geldiğini ve gelmediğinde ne olduğunu anlatır.

## Neden ayrı bir koşu?

API-Football'da kimlik ve ölçüm **ayrı uç noktalardadır**:

| Uç nokta | Ne döndürür | Ne döndürmez |
| --- | --- | --- |
| `/players/squads` | ad, mevki, yaş, forma numarası, fotoğraf | derece, dakika, gol, asist |
| `/players?league=&season=` | sezon istatistiği + gerçek maç derecesi | — |

Kadro senkronu (`npm run sync:squads`) yalnızca birincisini çağırır. O
yüzden 479 oyuncu kaydı sağlayıcıdan gerçekten gelmiş, sayısal kimliği ve
lisanslı fotoğrafı olduğu hâlde tek bir ölçüm taşımıyordu:
`normalizePlayer` eksik alanları varsayılanla dolduruyor (rating 61,
aiRating 24, dakika 0, gol 0) ve sonucu `ratingStatus: "estimated"` olarak
işaretliyordu.

Yayın kapısı (`services/cardCredibility.js`) bu türetilmiş sayıları
yayımlamaz. Sonuç doğruydu ama eksikti: radar boş, sıralama yok.

## Koşu

```bash
# Ne değişeceğini gösterir, hiçbir şey yazmaz
npm run sync:player-stats

# data/players.json'a yazar
node scripts/sync-player-statistics.mjs --apply
```

CI'da `match-analysis.yml` içinde `Sync measured player statistics`
adımı olarak, kadro senkronundan sonra koşar.

## Ne yazılır, ne yazılmaz

**Yazılır** — sağlayıcının gerçekten gönderdiği alanlar:

- Sayaçlar (maç, dakika, gol, asist, kart, şut, kilit pas, ikili mücadele)
  yanlarında `statsVerifiedAt` / `statsSource` köken damgasıyla.
- Derece (`games.rating`) yanında `ratingVerifiedAt` / `ratingSource` ile,
  `ratingStatus: "provider"` olarak.

**Yazılmaz:**

- **Sağlayıcının göndermediği alan.** Eksik alan sıfırla doldurulmaz;
  yamaya hiç girmez.
- **Oynanmamış sezon.** Sağlayıcı bir oyuncuyu lig kadrosunda görüp
  `appearances: 0` döndürebilir — bu "kayıtlı ama henüz oynamadı"
  demektir. O satırı doğrulanmış istatistik saymak, sezon öncesinde
  siteyi baştan sona "Dakika 0, Gol 0" yapardı ve okuyucu bunu "oynadı,
  üretemedi" diye okurdu. Ölçüm kanıtı aranır: en az bir maç oynanmış
  olmalı.
- **Elle doğrulanmış kayıt.** `dataStatus` veya `ratingStatus` içinde
  "manual" ya da "verified" geçen kayıt sağlayıcı tarafından ezilmez;
  çakışma günlüğe yazılır.

## Güvenlik kapıları

| Durum | Davranış |
| --- | --- |
| Anahtar yok | Eksik yapılandırma **adıyla** bildirilir, çıkış kodu 1, hiçbir dosya yazılmaz. Sessiz no-op değildir. |
| Sağlayıcı hiç ölçüm döndürmedi | Yazma reddedilir (`provider-returned-no-measurements`). |
| Kapsama %50'nin altında | Yazma reddedilir. Yarısı düşmüş bir koşu "güncelleme" değil, kayıptır. |
| Tüm istekler başarısız | Yazma reddedilir. |

Yazma reddedildiğinde mevcut veri korunur ve çıkış kodu 1 olur. CI adımı
`continue-on-error: true` ile işaretlidir: bu doğru davranıştır, veri
yazılmaz ve zincirin geri kalanı (maç sonuçları, site derlemesi) durmaz.

## Ölçüm gelmediğinde ne görünür?

Uydurma sayı **üretilmez**. Bunun yerine:

- **Ana sayfa "Trend oyuncular"** → temiz boş durum. Bölümün başlığı
  ("formda ve yükselişte olan oyuncular") ölçülmüş bir iddiadır; kimlik
  doğrulaması bu iddiayı karşılamaz. Alfabetik ilk üçü basmak, o başlığın
  altında yanlış olurdu.
- **Oyuncu Radarı sayfası** → doğrulanmış kadro listesi. Bu yüzey "en
  iyi"yi seçmez, kadroyu gösterir; kimlik alanları (ad, kulüp, mevki,
  yaş) sağlayıcıdan gelir ve meşrudur. Kart üstünde ölçülmemiş hiçbir
  sayı basılmaz.
- **Radar grafiği** → çizilmez; yerine ne beklendiğini söyleyen bir not.

## Doğrulama

```bash
node scripts/test-player-radar-verified.mjs   # sözleşme
node scripts/test-client-gate-parity.mjs      # istemci/sunucu kapı eşitliği
node scripts/audit-player-surfaces.mjs        # yayımlanan HTML denetimi
```

`test-client-gate-parity` istemci kapısını `app.js`'ten söküp çalıştırır ve
tüm veri kümesi üzerinde sunucu modülüyle karşılaştırır. Kural iki yerde
yaşadığı için ayrışabilir; bu test ayrışmayı build'de kırar.
