# İlgili gezinme ve "Ekranda takip et"

Üç küçük gezinme özelliği; hepsi derleme anında ya da mevcut ortak veriyle
çalışır. Yeni servis, cron, kazıma, bağımlılık ya da ön yükleme yoktur.

## 1. Maç sayfası: "Bu maçla ilgili" (`mac/*`, `en/match/*`)

- Üretim: `scripts/generate-match-seo-pages.mjs` → `relatedSectionHtml`,
  kurallar `scripts/lib/relatedNavigation.mjs`.
- En fazla 3 kart; aynı hedef iki kez yok; sayfa kendine bağlanmaz; diskte
  olmayan hedef basılmaz. Türkçe sayfa Türkçe, İngilizce sayfa yalnızca
  İngilizce hedeflere bağlanır.
- Duruma göre öncelik:
  - maç öncesi: takımın fikstürü → lig puan durumu → bu maçın yayımlanmış önizlemesi
  - canlı: aynı ligdeki diğer maçlar → lig puan durumu → takım sayfası
  - bitmiş: maç raporu / maç sonu köşe yazısı → takımın sonraki maçı → lig puan durumu
- Puan durumu kartı yalnızca maç gerçekten o tabloya aitse basılır
  (kupa/hazırlık maçında yok; UEFA'da yalnızca lig aşaması haftaları).
- Sayfa ulaşabileceği her durum için ayrı bir set taşır
  (`[data-related-set="pre|live|post"]`); `match-center.js` durum değişince
  yalnızca görünür seti değiştirir, ek istek atmaz.

## 2. Köşe yazısı sonu (`kose-yazilari/*`, `en/columns/*`)

- Üretim: `scripts/generate-column-pages.mjs` → `relatedCardsForColumn`.
- Kartlar: yazının konusu olan maç → takım ya da turnuva sayfası → aynı
  konudaki başka bir yayımlanmış yazı. "Tüm Köşe Yazıları" bağlantısı kalır.
- Maç ilişkisi `data/columns.json` içinde isteğe bağlı **`matchSlug`**
  alanıyla kurulur: `data/match-seo-pages.json` sicilindeki Türkçe slug
  (ör. `"fenerbahce-besiktas-5-eylul-2026"`). Alan yoksa ya da biçimi
  bozuksa yazı yine yayımlanır, yalnızca maç kartı çıkmaz.
- Yazı gövdesine dokunulmaz; gövde içine bağlantı eklenmez.

## 3. "Ekranda takip et" skor çubuğu (`mini-match-bar.js`)

- Maç öncesi (başlamaya < 12 saat) ve canlı maç sayfalarında düğme.
  Bildirim aboneliğinden ayrıdır; OS bildirim izni istemez.
- `localStorage["futbolradar:screen-follow:v1"] = { id, dismissed }` — başka
  bir şey saklanmaz. Modül yalnızca bu kayıt varsa (kapatılmamışsa) ya da
  sayfada düğme varsa yüklenir (`site.js` sonu).
- Veri: `futbolradar:score-snapshot`, `futbolradar:shared-matches` olayları
  ve `window.FutbolRadarSharedMatches` (site.js / live-follow.js aynı
  `/api/matches` yanıtını paylaşır). Gelmezse tek kanonik `/api/matches`
  yoklaması: canlıyken 60 sn, maç öncesi en geç 15 dk; sekme gizliyken
  durur; bitti/ertelendi/iptal olunca tamamen durur.

## Analitik

`analytics.js` yalnızca GA4/Ads kimliği tanımlıysa ve GPC/DNT yoksa
yüklenir. Yüklüyse gerçek tıklamada tek olay: `related_card_click`
(`source_page_type`, `slot_area`, `target_type`, `position`, `lang`),
`mini_bar_follow`, `mini_bar_return`, `mini_bar_close`. Gösterim, sayfa
görüntüleme, adres ya da kişisel veri gönderilmez.

## Test

`npm run test:related-navigation` (ayrıca `npm test` zincirinde).
