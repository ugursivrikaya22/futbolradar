# Türkiye A Millî Takım sistemi

> **DURUM (2026-09-27):** Sistem açık. `/milli-takim` ve
> `/en/turkey-national-team` kalıcı merkez sayfaları yayında;
> `national-team-pages` adımı `scripts/lib/postprocessChain.mjs` içindeki
> `POSTPROCESS_CHAIN`e eklendi. Saatlik güncelleme de tam derleme de aynı
> zinciri koştuğu için merkez, maç sayfaları ve ana sayfa vitrini
> kendiliğinden ilerler — **ayrı bir cron, ayrı bir yoklama döngüsü ve yeni
> bir sağlayıcı çağrısı yok** (bkz. [Maliyet](#maliyet)).

Millî takım **ayrı bir boru hattına konmadı**. Türkiye'nin resmî maçı,
kulüp maçlarıyla aynı uygunluk kuralından, aynı kalıcı maç sayfası
sicilinden ve aynı canlı veri altyapısından geçer. Bu belge yalnızca
farkları anlatır.

## Yaşam döngüsü

Maç programa düştüğü anda başlar ve elle hiçbir adım gerektirmez:

| Evre | Ne olur | Nerede |
| --- | --- | --- |
| Programa düşer | Kayıt sicile girer, `/mac/<slug>` ve `/en/match/<slug>` açılır | `scripts/generate-match-seo-pages.mjs` |
| 48 saat kala | Ana sayfanın en üstünde vitrin açılır, geri sayım işler | `scripts/generate-featured-match-spotlight.mjs` |
| Maç günü | Vitrin **büyük kart** olarak durur (`majorTeams`) | `services/featuredMatchSpotlight.js#isMajorSpotlight` |
| İlk 11 gelince | Resmî kadro maç sayfasının üst bölümüne taşınır | mevcut `muhtemel-11` bölümü, resmî kadro önceliklidir |
| Başlama | Kutu `CANLI · X-X` olur, geri sayım düşer | `featured-match-spotlight.js` + `/api/match-detail` |
| Bitiş | Kutu `MAÇ SONUCU` olur ve **normal boyuta döner** | büyük kart `post` evresinde kapanır |
| Bitiş + 2 saat | Kutu ana sayfadan düşer | `dwellAfterFinishMinutes` |
| Sonrası | Maç sayfası **kalıcı** kalır: sonuç, goller, istatistik, puan durumu | sayfa silinmez, `noindex` yapılmaz, yönlendirilmez |

Sayaç **gerçek bitiş düdüğünden** başlar, "başlama + 2 saat"ten değil;
gerekçesi `services/featuredMatchSpotlight.js` başında.

## Parçalar

| Dosya | İş |
| --- | --- |
| `data/national-team.json` | Merkez yapılandırması + **saati doğrulanmamış** program satırları, kadro, grup durumu. |
| `data/matches.json` | Elle doğrulanmış millî maç kayıtları (saat, stat, hakem, VAR). |
| `data/competitions.json` → `uefa-uluslar-ligi` | Sağlayıcı lig kimliği **5**. Millî maçların takvime girmesini sağlayan tek satır. |
| `scripts/generate-national-team-pages.mjs` | İki dilli merkez sayfası (TR + EN, tek üretici). |
| `services/matchSeoPages.js` | `isTurkiyeNationalMatch` + alt seviye takım koruması. |
| `services/displayLabels.js` → `nationLabel` | Ülke adının İngilizce sunumu ("İtalya" → "Italy"). |
| `data/featured-match-spotlight.json` | `teams` / `priorityTeams` / `majorTeams`. |
| `scripts/test-national-team.mjs` | Sözleşme testleri (`npm run test:national-team`). |

## Neden `uefa-uluslar-ligi` katalogda olmak zorunda

`services/providers/apiFootballProvider.js#getFixtures`, **tarih** sorgusunun
sonucunu `filterSupportedCompetitions` ile süzüyor: katalogda olmayan
yarışma takvime hiç girmiyor. Millî maçlar bu yüzden yalnızca `live=all`
anlık görüntüsünden düşüyordu ve bir daha güncellenmiyordu — 25 Eylül
Türkiye–France kaydı iki gün boyunca depoda `LIVE 0-0` olarak dondu.

Katalog satırı bunu düzeltir ve **ek maliyet getirmez**: aynı tarih sorgusu
zaten atılıyor, yanıtın içindeki millî maçlar artık elenmiyor.

## Alt seviye takım koruması

Sicil, millî maçı yarışmadan bağımsız olarak kabul eder. Tek başına
bırakıldığında bu muafiyet bir **kadın** ya da **U21** karşılaşmasını da
içine alırdı: sağlayıcı o takımları çoğu zaman "Turkey W" / "Turkey U21"
diye adlandırdığı için ad kümesi genelde tutmaz, ama "Türkiye" yazımıyla
gelen tek bir U21 kaydı A Millî Takım maçı gibi kalıcı sayfa açardı.

`services/matchSeoPages.js#NON_SENIOR_NATIONAL_MARKERS` yarışma adını da
denetler. **"Kupa" bilerek listede değil:** millî takım Dünya Kupası ve
Avrupa Şampiyonası oynar.

## Vitrinde öncelik

`priorityTeams` **yalnızca aynı evredeki** adaylar arasında uygulanır:

- Yaklaşan millî maç, yaklaşan kulüp maçını geçer.
- **Gerçekten canlı** bir kulüp maçı, yaklaşan millî maçın önünde kalır —
  okuyucunun o an aradığı şey canlı skordur.

Bayat "canlı" kaydı vitrine canlı diye **girmez**: `phaseOf` kararı
`services/matchStatus.js#liveVerdict` kapısından geçirir (gün, başlama
saati ve veri tazeliği). Kapıdan geçmeyen kayıt maç süresi penceresinin
içindeyse "başlıyor" bandında kalır (skor yazılmaz), pencere kapandıysa
bitmiş sayılır ve kutu kendiliğinden düşer.

## Veri dürüstlüğü

- **Saat uydurulmaz.** Resmî programda açıklanmış ama başlama saati
  doğrulanmamış maç `data/national-team.json#announcedProgram` içinde
  `kickoff: null` ile durur; merkezde tarihiyle listelenir ve "Saat henüz
  açıklanmadı" der. Kalıcı maç sayfası **ancak saat doğrulandığında**
  açılır. Aynı gün için saatli bir kayıt göründüğü an bu satır düşer.
- **Kadro uydurulmaz.** TFF duyurmadıkça kadro bölümü "Henüz açıklanmadı"
  gösterir; tahmini kadro yazılmaz.
- **Puan durumu uydurulmaz.** Tablo `data/league-standings.json` içindeki
  sağlayıcı kaydından ya da doğrulanmış elle girişten gelir; ikisi de yoksa
  bölüm bunu söyler.
- **İngilizce sayfada Türkçe haber listelenmez:** TR merkez
  `data/news.json`, EN merkez `data/news-en.json` okur.

## Maliyet

Bu sistem **sıfır yeni sağlayıcı çağrısı** ile çalışır:

- Fikstür: mevcut tarih sorgusunun içinde geliyor (katalog satırı sayesinde
  artık elenmiyor).
- Puan durumu: `scripts/sync-league-standings.mjs` yalnızca **günlük** full
  koşuda ve yalnızca sağlayıcı `coverage.standings === true` dediğinde
  soruyor. Katalog satırı `coverage: null` ile doğdu; alan
  `scripts/resolve-league-registry.mjs --apply` bir sonraki koşuda
  sağlayıcıdan dolduracak.
- Canlı skor: mevcut `/api/match-detail` yoklaması. Vitrin istemcisi maçtan
  **bir saat** önce başlar, bitişten 150 dakika sonra durur ve sekme
  gizliyken istek atmaz.
- Geri sayım: **tamamen yerel** (tarayıcı saati), tek bir istek atmaz.
- Yeni cron yok. Merkez, `POSTPROCESS_CHAIN` içindeki mevcut saatlik koşuya
  bindi.

## Elle işlemler

```bash
# Merkez sayfalarını yeniden bas
npm run generate:national-team

# Sözleşme testleri
npm run test:national-team

# Vitrini yayına çıkmadan denetle (maçı beklemeden canlı/sonrası hâlini gör)
node scripts/generate-featured-match-spotlight.mjs --dry-run --now=2026-09-28T22:20:00+03:00
```

Yeni bir millî maçın saati doğrulandığında yapılacak tek şey:
`data/matches.json`'a `source: "manual_verified"` kaydı eklemek (ya da
sağlayıcı takviminin getirmesini beklemek). Sayfa, vitrin, site haritası ve
merkez satırı kendiliğinden gelir.
