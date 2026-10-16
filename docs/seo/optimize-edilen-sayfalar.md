# Optimize edilen sayfalar (Türkiye odaklı)

Önce = `origin/main` çıktısı, sonra = bu PR'ın üreticileriyle yeniden üretilmiş ağaç (2026-10-16 verisi). Uzunluklar karakter. Metinler yalnızca sayfada gerçekten bulunan veriden kurulur (sıra, puan, lider); veri yoksa genel cümleye düşer, hiçbir sayı uydurulmaz.

## Başlık / açıklama / H1

| Sayfa | Önce | Sonra | Gerekçe |
| --- | --- | --- | --- |
| Ana sayfa `/` | T: "FutbolRadar — Ücretsiz. Reklamsız. Doğrudan Futbol." (51) · D: "FutbolRadar ile canlı skorları, maç sonuçlarını ve futbol gündemini ücretsiz ve reklamsız takip edin. Hızlı, sade ve doğrudan futbol deneyimi." | T: "FutbolRadar \| Canlı Skor, Maç Sonuçları ve Süper Lig – Reklamsız" (64) · D: "Canlı skor, bugünün maçları, Süper Lig puan durumu ve maç sonuçları tek yerde. Ücretsiz, reklamsız ve üyeliksiz: futbolu doğrudan takip edin." (≤160) · **H1 değişmedi** | Başlıkta hiç hedef sorgu yoktu. H1 marka sloganı; marka kararı olduğu için dokunulmadı; hero altındaki ilk paragraf ("Canlı skorları, maçları ve futbol gündemini ücretsiz takip et.") anahtar sözcükleri taşıyor. |
| Canlı skor `/canli-skor` | T: "Ücretsiz ve Reklamsız Canlı Skor \| FutbolRadar" · H1: "Ücretsiz ve reklamsız canlı skor" | değişmedi | Benzersiz, hedef sorguyu içeriyor. |
| Bugünün maçları `/bugunun-maclari` | T: "Bugünkü Futbol Maçları ve Program \| FutbolRadar" · H1: "Bugünkü Futbol Maçları ve Maç Programı" | değişmedi | Benzersiz, niyetle örtüşüyor. |
| Süper Lig puan durumu `/super-lig-puan-durumu` | D: "Süper Lig 2026/27 puan durumunu; oynanan maç, … inceleyin." (119, statik) | D: "Süper Lig 2026/27 puan durumu: Galatasaray 7 maç sonunda 16 puanla lider, Beşiktaş 15 puanla ikinci. Averaj ve puan dahil tüm sütunlarla tam tablo." (≈150) · T/H1 aynı | Açıklama güncel liderle dinamik; sezon başlamadıysa statik cümleye döner. |
| Puan durumu merkezi `/puan-durumu` | T: "Süper Lig: Galatasaray 16 puan \| FutbolRadar" · H1: "Puan Durumu" | T: "Puan Durumu: Süper Lig ve Avrupa Ligleri Tabloları \| FutbolRadar" (64) · D: "Süper Lig ve Avrupa liglerinin güncel puan durumu tabloları. Süper Lig 2026/27: Galatasaray 7 maç sonunda 16 puanla 1. sırada, Beşiktaş 15 puanla takipte." (154) | `/super-lig-puan-durumu` ile aynı sorguyu hedefliyordu (kanibalizasyon). Merkez = tüm ligler, Süper Lig'in kendi sayfası = "süper lig puan durumu". |
| Galatasaray / Fenerbahçe / Beşiktaş / Trabzonspor puan durumu `/<takım>-puan-durumu` | T: "Galatasaray 16 puan, 1. sıra \| Süper Lig" (40) · D: "Galatasaray, 2026/27 Süper Lig'de 7 maç sonunda 16 puanla 1. sırada." (68) | T: "Galatasaray Puan Durumu 2026/27: 1. Sıra, 16 Puan \| FutbolRadar" (63) · D: aynı cümle + "Güncel tabloda rakiplerle puan farkını, averajı ve oynanan maç sayısını inceleyin." (≈150) | Hedef sorgu ("<takım> puan durumu") başlıkta yoktu; marka eki yoktu. 4 takım için aynı kalıp, verisi sayfadan. |
| Lig puan durumu sayfaları (9: Premier Lig, La Liga, Serie A, Bundesliga, Ligue 1, Şampiyonlar/Avrupa/Konferans Ligi, 1. Lig) | T: "Premier Lig: Manchester City 18 puan \| FutbolRadar" · D 65–83 karakter | T: "Premier Lig Puan Durumu: Manchester City 18 puanla lider \| FutbolRadar" (56–60) · D ≈150: "…güncel puan durumu: … 6 maç sonunda 18 puanla 1. sırada. Averaj ve puan dahil tüm sütunlarla tam tablo." | Aynı gerekçe; lider 1. değilse "lider" yazılmaz. |
| Takım profili `/takimlar/galatasaray` (+ Fenerbahçe, Beşiktaş, Trabzonspor) | D: "Galatasaray takım profili: kayıtlı Süper Lig sırası, puanı, maç bilançosu, form durumu ve FutbolRadar oyuncu profilleri." (120, 18 sayfada kalıbın aynısı) | D: "Galatasaray takım profili: Süper Lig'de 1. sırada, 16 puan (7 maç: 5G 1B 1M). Form durumu, kadro ve oyuncu profilleri." · T/H1 aynı | 18 takımın açıklaması yalnızca ad değiştiren tek cümleydi; artık her biri kendi verisini taşıyor. |
| Takım maçları `/<takım>-maclari` | T: "Galatasaray Maçları, Puan Durumu ve Fikstür 2026/27" (65) | değişmedi | Zaten niyetle örtüşüyor, benzersiz. |
| Maç detay şablonu `/mac/<slug>` | Durum bazlı başlık: "X - Y Maçı Ne Zaman, Saat Kaçta, Hangi Kanalda?", "X 3-1 Y Maç Sonucu, Goller ve İstatistikler", canlı/ertelendi/iptal/saat belirsiz/yarıda kaldı | **Şablon değişmedi** (bilinçli) | Ölçüm: 30 tarihli sayfa örneğinde ana metin 3.500–9.700 karakter, ikili 5-gram örtüşmesi ortalama %15–23 (maks %48) → kopya/ince değil. Başlık niyetle birebir. Tek eksik iç bağlantı: maç → `takimlar/<takım>` (aşağıda). |
| `anketler.html` | robots meta'sı **yoktu** | `index,follow,max-image-preview:large,…` + CollectionPage/BreadcrumbList şeması | Çekirdek sayfalar arasında JSON-LD'siz tek indekslenebilir sayfaydı. |
| `en/match-detail.html` | `index,follow` (istemci kabuğu) | `noindex,follow` | TR eşi `mac-detay.html` zaten noindex idi. |

Başlıklar mükerrer değil: `audit-seo-inventory` → tekrar eden başlık grubu **0**, açıklama grubu **0** (indekslenebilir 5.517 sayfa). Metinler şablon çarpımı değil, her sayfanın kendi sıra/puan verisinden kurulur; kopya metin üretilmedi.

## İç bağlantı denetimi (ölçüm)

Gelen bağlantı (benzersiz kaynak sayfa): Ana sayfa 13.962, `/canli-skor` ve `/bugunun-maclari` 12.806 (global menü), `/super-lig-puan-durumu` 658, `galatasaray-maclari` 208 / `galatasaray-puan-durumu` 198, **`takimlar/<büyük 4>` yalnızca 10–14**, `canli-maclar` 4, `canli-mac-sonuclari` 3.

| Kaynak → hedef | Durum | Öneri |
| --- | --- | --- |
| Ana sayfa → canlı skor, bugünün maçları, Süper Lig puan durumu, 4 takım sayfası, haberler | var | — |
| `/canli-skor` → Süper Lig puan durumu, Galatasaray profili | **yok** | Sayfa altına "Puan durumu" ve "Büyük 4" bağlantı şeridi (ana sayfadaki `popular-links` bileşeni yeniden kullanılabilir). |
| `/bugunun-maclari` → Süper Lig puan durumu, takım profilleri | **yok** | Aynı şerit. |
| `/super-lig-puan-durumu` → `<takım>-puan-durumu` | **yok** (takım profiline var) | Tablo satırlarındaki takım adı ya da altına 4 takım bağlantısı. |
| `takimlar/<takım>` → form durumu, oyuncu radarı | **yok** (maçlar ve puan durumuna var) | İlgili sayfalar ızgarasına ekle. |
| `/mac/<slug>` → `takimlar/<takım>` | **yok** (`<takım>-maclari` var) | Takım adı bağlantısını profil sayfasına ya da yan bağlantı olarak ekle. |
| `canli-maclar`, `canli-mac-sonuclari` | 3–4 gelen bağlantı | Birleştirme/yönlendirme kararı GSC verisiyle (bkz. hata listesi O-09). |

Bu bağlantılar şablon düzenlemesi gerektirir (elle yazılmış HTML + `app.js` bileşenleri) ve ölçülmüş bir SEO kazancı olmadan riskli olduğundan bu PR'da uygulanmadı.

## Tahmin Ligi (`/tahmin-ligi`) — yalnızca şablon önerisi

Sayfa başka dalda geliştiriliyor; dokunulmadı. Öneri:

| Alan | Öneri |
| --- | --- |
| Başlık / H1 | T: "Tahmin Ligi: Süper Lig Maç Tahminleri ve Puan Tablosu \| FutbolRadar" · H1: "Süper Lig Tahmin Ligi" (benzersiz, "tahmin oyunu" niyeti). |
| Açıklama | Yalnızca sayfada gerçekten bulunan veriyi söyler: "Bu haftanın maçlarına tahmin yap, puan topla, sıralamada yüksel. Ücretsiz; para ya da bahis yok." — "kazan/ödül" vaadi ve bahis diline yakın ifadelerden kaçın. |
| Kanonik | Tek adres `/tahmin-ligi` (uzantısız; `vercel.json` redirect/rewrite zaten bu desende). Hafta sayfaları (`/tahmin-ligi/hafta-8`) açılırsa kendi kanoniği; sıralamanın sayfalı/filtreli varyantları ana adrese kanonik. |
| robots | Ana sayfa ve hafta özet sayfaları `index`. Kullanıcıya özel/profil/sonuç sayfaları ve ince liderlik tabloları `noindex,follow` (kişisel veri + ince içerik). Kullanıcı kaynaklı bağlantılar `rel="ugc nofollow"`. |
| Yapısal veri | `WebPage` + `BreadcrumbList`. `SportsEvent` yalnızca tarihi doğrulanmış maçlar için ve **tahmin sonucu içermeden**; `aggregateRating`/`review`/`offers` yok; kullanıcı puanları şemaya girmez. `test-structured-data` bu kuralları zaten zorlar. |
| İç bağlantı | Ana sayfa vitrini, `/bugunun-maclari` ve `/mac/<slug>` maç öncesi bölümü (tahmin CTA), `/super-lig-fikstur`, `/canli-skor`. Tahmin Ligi'nden maç sayfalarına ve puan durumuna geri bağlantı. |
| Sitemap | Yalnızca indekslenebilir sayfalar; `test-sitemaps` noindex/yönlendirme/canonical uyuşmazlığını yakalar. |
| Veri hakkı | Ölçüm (`data-futbolradar-ga4`) Tahmin Ligi olaylarını kişisel veri taşımadan göndermeli; bkz. `analytics.js` (GPC/DNT'ye saygılı). |
