# Oyuncu Radarı Modülü

Oyuncu profili tek bir veri sözleşmesi ve tek bir görünüm katmanı üzerinden
üretilir. Amaç: aynı HTML'in hem arama motoru için statik olarak basılması hem
de tarayıcıda canlı API verisiyle tazelenmesi.

## Katmanlar

| Katman | Dosya | Sorumluluk |
| --- | --- | --- |
| Güvenilirlik kapısı | `services/cardCredibility.js` | Hangi alanın yayımlanabilir olduğunun tek yetkilisi (main'de tanımlı, profil onu kullanır) |
| Metrik sözlüğü | `services/playerMetricsService.js` | Sağlayıcı alan adlarını kanonik metriklere indirger, 90 dakikalık değerleri ve pozisyon referanslarını üretir |
| Skor motoru | `services/playerScoreService.js` | 0-100 Oyuncu Skoru; puan, form, istikrar, katkı, istatistik bileşenleri |
| Yorum katmanı | `services/playerInsightService.js` | Form eğrisi, performans trendi, analiz özeti, güçlü/zayıf yönler, benzer oyuncular, alternatifler, transfer söylentileri |
| Profil derleyici | `services/playerProfileService.js` | Tüm blokları tek sözleşmede toplar (`buildPlayerProfile`) |
| Görünüm | `player-profile.js` | Sözleşmeyi HTML'e çevirir; Node (prerender) ve tarayıcı (hydration) ortak |
| API | `api/[...route].js` → `/api/player-detail` | Profil sözleşmesini JSON olarak sunar |
| Sağlayıcı | `services/providers/apiFootballProvider.js` | Sezon istatistikleri, son maç kırılımı, forma numarası |

## Veri akışı

```
data/players.json ─┐
                   ├─ playerService.normalizePlayer ─ ratingService.enrichPlayerRating ─┐
API-Football ──────┘                                                                    │
                                                                                        ▼
                                        playerProfileService.buildPlayerProfile ◀── playerMetricsService
                                                    │                          ◀── playerScoreService
                                                    │                          ◀── playerInsightService
                    ┌───────────────────────────────┴───────────────────────────────┐
                    ▼                                                               ▼
  scripts/prerender-player-content.mjs (statik HTML, SEO)          /api/player-detail (tarayıcı tazelemesi)
                    └───────────────── player-profile.js renderProfileHtml ─────────┘
```

Statik sayfa `data-api-target="player-detail"` ve `data-prerendered="1"` taşır.
Tarayıcıda `player-profile.js` API'yi çağırır; istek başarısız olursa basılı
içerik yerinde kalır (`data-state="static"`), boş sayfa gösterilmez.

## Kart güvenilirliği kapısı

`services/cardCredibility.js` bir kaydın hangi alanlarının yayımlanabilir
olduğunun tek yetkilisidir; profil derleyicisi kendi kuralını yazmaz, o kapıdan
geçen alanları görür. Üç kademe arka arkaya çalışır:

1. **Kayıt doğrulaması** (`publicPlayerView`): gerçek sağlayıcı kimliği, kaynak
   bağlantısı ve 45 günden yeni doğrulama yoksa yalnızca kimlik alanları
   (`SAFE_FIELDS`: ad, mevki, yaş, boy, ayak, uyruk) kalır. Kulüp dâhil her
   iddia düşer; profil tek bir gerekçe kartı basar.
2. **Sayım istatistikleri** (`statsAreVerified`): kadro senkronu istatistik uç
   noktasını çağırmadığı için o kayıtlarda maç/dakika/gol sıfırdır. "0 maçta 0
   dakika" ölçülmüş bir iddia gibi okunur, bu yüzden ölçüm kanıtı olmadan
   sezon tablosu, skor ve analiz özeti hiç üretilmez.
3. **Model skorları** (`ratingIsVerified`): 0-100 rating ve radar eksenleri
   yalnızca `ratingStatus` bakımı yapılan bir değerse yayımlanır.

Havuzdaki oyuncular da aynı kapıdan geçer: benzer oyuncu ve alternatif
kartlarında doğrulanmamış bir rating basılmaz. Profil çıktısındaki
`profile.credibility` bloğu kararı, gerekçeleri ve gizlenen alanları taşır;
görünüm katmanı bunu `data-player-verified` işaretiyle HTML'e yazar.

## Boş durum kuralı

Sözleşmedeki her blok `available` bayrağı ve `note` metni taşır. Veri yoksa:

- metrik `value: null`, `available: false` döner; kart "Veri yok" gösterir,
- skor bileşeni ağırlıktan düşer, güven oranı (`confidence.ratio`) buna göre raporlanır,
- güven `0.45` altına inerse skor `null` olur ve gerekçe yazılır,
- analiz özeti yalnızca dolu metriklerden cümle kurar, eksik veri için cümle yazılmaz,
- transfer söylentisi yalnızca kaynağı işaretlenmiş kayıt geldiğinde listelenir.

Hiçbir alan varsayılan/nötr bir değerle doldurulmaz.

## Oyuncu Skoru

```
Skor = Σ(bileşen × ağırlık) / Σ(dolu bileşenlerin ağırlığı)
```

| Bileşen | Kaynak | Not |
| --- | --- | --- |
| Puan | Sağlayıcı maç reytingi (0-10) → 0-100 | Reyting yoksa FutbolRadar rating modeli, `source: "model"` olarak işaretlenir |
| Form | Son maç reytinglerinin ortalaması | Sağlayıcı yoksa veri katmanındaki kürasyonlu form eğrisi |
| İstikrar | Reyting sapması + dakika payı + ilk 11 oranı | Dalgalanma arttıkça düşer |
| Katkı | Pozisyona göre gol/asist/xG/xA veya ikili mücadele, top kapma, kurtarış | Referans üretim değerine göre ölçeklenir |
| İstatistik | Pozisyona ait metriklerin referansa göre ortalaması | 90 dakikaya normalize edilmiş değerler |

Ağırlıklar pozisyon grubuna göre değişir (`COMPONENT_WEIGHTS`). Referans
üretim değerleri `PER90_BENCHMARKS` içindedir; bir metrik referansı yoksa
skora hiç girmez.

## Son 5-10 maç

API-Football'da oyuncu bazlı maç geçmişi uç noktası yok. `getPlayerMatchLog`
takımın son N maçını çeker (`/fixtures?team=&last=`), her fikstür için
`/fixtures/players` yanıtından oyuncunun satırını ayıklar. İstek sayısı maç
sayısıyla sınırlıdır (en fazla 10) ve yanıt `players` önbellek politikasıyla
servis edilir. Sağlayıcı kimliği olmayan kürasyonlu kayıtlarda çağrı hiç
yapılmaz; bölüm boş durum gösterir.

```bash
# pencere seçimi (varsayılan 5, en fazla 10)
curl "https://www.futbolradar.com/api/player-detail?id=kerem-akturkoglu&last=10"
```

## Genişletme

- **Yeni metrik**: `METRIC_CATALOG` içine bir satır ekleyin, gerekiyorsa
  `PER90_BENCHMARKS` altına pozisyon referansı yazın. UI otomatik gösterir.
- **Yeni bölüm**: `player-profile.js` içindeki `SECTION_RENDERERS` listesine
  bir fonksiyon ekleyin; sıra sayfadaki sıradır. Fonksiyon boş durumu kendi
  içinde `emptyBlock` ile basmalıdır.
- **Yeni sağlayıcı**: adaptör `getPlayers` çıktısını `services/playerService.js`
  modeline göre üretmeli; maç kırılımı için `getPlayerMatchLog(query)` ve forma
  numarası için `getSquadEntry(query)` uygulanmalıdır.

## Testler

```bash
node scripts/test-player-profile.mjs   # npm test zincirinde
node scripts/qa.mjs
```

Test kapsamı: metrik normalizasyonu ve 90 dakika kuralı, skor bileşenleri ve
veri güveni eşiği, form trendi yönü, boş durum garantileri (uydurma veri
üretilmemesi), kart güvenilirliği kapısının üç kademesi (doğrulanmamış kayıt,
kadro senkronundan gelen ölçülmemiş sıfırlar, doğrulanmış kayıt), görünüm
çıktısının deterministliği ve HTML kaçışı, sağlayıcı istatistik toplaması,
`/api/player-detail` sözleşmesi.
