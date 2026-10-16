# 30 günlük organik trafik planı

**Dayanak:** bu depo ve ölçüm sınırları. Mevcut organik trafik, gösterim, tıklama ve sıra **bilinmiyor** (GSC/GA4 bağlı değil); bu yüzden plan sayısal hedef değil, **önce ölçülebilir hâle gelme → kanıtlı fırsata yatırım** sırasını izler. Hedef değerler ilk 7 günlük taban çizgisi çıktıktan sonra yazılır.

Maliyet kuralı: yeni ücretli servis, yeni cron, yapay trafik yok. Tüm adımlar mevcut araçlarla (`demand:*`, `seo:review`, `fetch:ga4`, `report:organic`, `audit:seo-inventory`, `measure:vitals`).

## Hafta 1 — Ölçülebilir ol (gün 1–7)

| Gün | İş | Çıktı / ölçüt |
| --- | --- | --- |
| 1 | Bu PR'ı gözden geçir/birleştir; tam derleme sonrası `test:structured-data`, `test:sitemaps`, `test:index-policy` yeşil. | Sitemap ≈ 5,5 bin URL, 0 yönlendirme/noindex. |
| 1 | Search Console'da mülkü (domain ya da `www` URL-prefix) aç; doğrulama zaten hazır (dosya + meta). `sitemap.xml` ve `news-sitemap.xml` gönder. | GSC "Sitemaps": durum Başarılı; keşfedilen URL ≈ 5,5 bin. |
| 2 | Servis hesabı oluştur, Search Console API + GA4 Data API etkinleştir; `GSC_*` ve `GA4_*` değişkenlerini CI/Vercel'e gir. Vercel build ortamına `GA4_MEASUREMENT_ID` (G-…) ekle. | `npm run demand:gsc` → `configured:true`; canlı sayfada `data-futbolradar-ga4` görünür. |
| 3 | İlk `npm run fetch:ga4 && npm run report:organic`; ilk GSC raporu. | Taban çizgisi: günlük organik oturum, en çok trafik getiren 20 sayfa, en çok gösterim alan 50 sorgu. **Bu sayılar bu belgeye eklenir.** |
| 4–5 | GSC "Sayfa indeksleme" raporunu `indeksleme-durumu.md` envanteriyle karşılaştır: beklenmeyen "Kopya, Google farklı kanonik seçti", "Taranmış – indekslenmemiş" kümeleri. | Fark listesi. |
| 6–7 | `measure:vitals` taban çizgisi (bu belge) + PageSpeed Insights / CrUX (alan verisi) Core Web Vitals raporu. | Yerel sayılarla alan verisi yan yana. |

## Hafta 2 — Teknik zemin (gün 8–14)

- Üretimde `curl -I` ile `/docs/…`, `/scripts/…`, `/public/index.html` erişimini doğrula (hata listesi O-04/O-05); erişilebiliyorsa dışarı al.
- Eski `*-ne-zaman-hangi-kanalda.html` sayfalarını dated `/mac/` adreslerine 301'le (O-06).
- İç bağlantı boşlukları (`optimize-edilen-sayfalar.md`): `canli-skor`/`bugunun-maclari` → puan durumu + Büyük 4; maç sayfası → takım profili.
- Performans dalı (koordinatör): `page.css`/`app.js` küçültme, CLS, `/bugunun-maclari` DOM. Ölçüt: ana sayfa CLS < 0,1; TBT < 300 ms (yerel).
- GSC verisine göre `canli-maclar` / `canli-mac-sonuclari` birleştirme kararı.

## Hafta 3–4 — İçerik (gün 15–30)

İçerik, kanıtlı fırsata bağlanır (`seo-icerik-firsatlari.html` puanı ≥ 75 olanlar). **Kopya, otomatik çoğaltılmış veya doğrulanmamış içerik yayımlanmaz.**

| Tür | Ne | Veri kaynağı / kapı | Sıklık |
| --- | --- | --- | --- |
| Maç öncesi analiz | Büyük 4 takımın sonraki maçı: form, H2H, eksikler, **resmî** ilk 11 çıkınca güncellenen bölüm; "muhtemel 11" yalnızca kaynaklı ve etiketli | `match-analyses.json`, resmî kadro API (`official-lineup`); tahmin skoru yazılmaz | maç başına 1 sayfa (mevcut `/mac/` sayfası zenginleşir, yeni URL açılmaz) |
| Doğrulanmış ilk 11 | Resmî kadro açıklandığında sayfa içi bölüm + haber | `refresh-official-lineups` | maçtan ~60 dk önce |
| Maç sonu değerlendirme | Bitmiş Büyük 4 maçı: skor, goller, xG (sağlayıcıdan), oyuncu reytingleri, "ne söylüyor" yorumu | `post-match-reports.json`, `understat-shots` | maç başına 1 |
| Takım istatistikleri | Takım profil sayfalarına sezon bilançosu, ev/deplasman, son 5 maç, gol dağılımı (veri doğrulanmışsa) | `teams.json` | haftalık otomatik |
| Puan durumu analizi | Haftalık "lider kim, kim yükseldi, averaj" yazısı — yalnızca tablo verisinden; sayılar doğrulanmış | `league-standings.json` | haftada 1 (hafta sonu turu sonrası) |
| Özgün köşe yazıları | Editoryal imza ve kaynak notu olan yorumlar; tek yazar, görünür imza | `columns.json` mevcut akış | haftada 1–2 |

Kapılar: (1) `test:structured-data` skor kapısı (bitmiş + eşleşen skor), (2) `newsIndexPolicy` (otomatik şablon metin indekslenmez), (3) başlık/açıklama benzersizliği (`test-seo-integrity`), (4) kaynak bağlantısı ve "basında yer aldı" çekincesi mevcut haber kurallarıyla.

## Haftalık döngü (gün 8'den itibaren)

1. Pazartesi: `report:organic` + GSC raporu → en çok düşen/yükselen 10 sayfa.
2. `seo:review` ve `demand:data` çıktısından 3 fırsat seç; başlık/açıklama testleri GSC'deki tıklanma oranı < beklenen olanlarda yapılır (A/B değil, sıralı değişiklik; her değişiklik tarihle `yapilan-duzeltmeler.md`'ye işlenir).
3. Cuma: `audit:seo-inventory` ve `test:index-policy` çalıştırılır; yeni sınıf çelişkisi = sıfır olmalı.

## Başarı ölçütleri (taban çizgisi gelince doldurulur)

| Ölçüt | Kaynak | Taban (gün 3) | Gün 30 hedefi |
| --- | --- | --- | --- |
| Günlük organik oturum | GA4 `report:organic` | — (veri yok) | taban + ölçülmüş eğilim |
| Organik tıklama / gösterim / ort. sıra | GSC | — (veri yok) | — |
| İndekslenen / hariç tutulan sayfa | GSC Sayfa indeksleme | — (veri yok) | "Kopya/yönlendirme/noindex" sayaçları düşer |
| Büyük 4 sorgularında (`<takım> puan durumu`, `<takım> maçı ne zaman`) ortalama sıra | GSC | — (veri yok) | iyileşme |
| Core Web Vitals (alan) | CrUX/PSI | — (veri yok) | LCP < 2,5 sn, CLS < 0,1 |

Risk notları: ince haber ve tarihsiz sayfaların noindex'i ilk haftalarda toplam "indekslenen sayfa" sayısını düşürür — bu beklenen ve istenen bir sonuçtur, trafik kaybı olarak okunmamalı; trafik kaybı yalnızca sayfa bazında GSC tıklamasıyla yorumlanmalıdır.
