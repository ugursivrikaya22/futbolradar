# SEO araştırma raporu — futbolradar.com

> Dosya adı istek gereği böyledir. İçerik dış bir rapora dayanmaz; tamamı bu depoda yapılan ölçümlerin ve Google'ın herkese açık belgelerindeki (Search Central: sitemap, News sitemap, yapısal veri, kanonikleştirme, hreflang, "scaled content" ve spam politikaları) kurallara karşı değerlendirmesidir. Canlı site, Search Console ve GA4'e erişim **yoktu**; hiçbir tıklama, gösterim, sıra, indeks sayısı veya trafik sayısı yazılmamıştır.

## 1. Özet

Site büyük (15,8 bin HTML, 5,5 bin sitemap URL'si) ve üretimi otomatik. Teknik temel sağlam: kanonik/hreflang denetimleri, tekil başlıklar, iç bağlantı testleri zaten vardı. Sorunlar **ölçekten** geliyor: kaynakta bir hata ya da bir kural boşluğu binlerce sayfaya yayılıyor ve elle tutulan testler bunu görmüyor. Bu çalışmada bulunan ve düzeltilen başlıca üç şey:

1. **Kalite sinyali:** şablon metinli 1.394 otomatik haber (TR 697 + EN 1.097) ve 470 tarihsiz maç yer tutucusu indeksleniyor ve sitemap'teydi. İkisi de `noindex,follow` + sitemap dışı yapıldı (sayfa silinmedi, kural iki yönlü).
2. **Tam derleme ile commit arasındaki fark:** `npm run build` (Vercel'in koşusu) eski bir "Ligue 1" arşiv satırlarını sicile geri getiriyor → sitemap'te 301 veren 78 URL + 322 iç bağlantı. Saatlik commit'te görünmediği için tüm testler yeşildi. Üretimde de aynı olması muhtemel (doğrulanamadı).
3. **Yapısal veri:** 7,4 bin indekslenebilir sayfada geçersiz/eksik alan (boş adres, olmayan `EventCompleted`, yazarsız `Article`); artık tüm ağaç testle doğrulanıyor, skor yalnızca bitmiş ve eşleşen maç kaydıyla şemaya girebiliyor.

Ayrıca 301'e giden iç bağlantı 2.468 → 7, sitemap 7.792 → 5.517 (hepsi 200, yönlendirmesiz, noindex değil, canonical kendisi), başlıklar hedef sorguyu taşıyor, ana sayfada ölçülen aktarım −%39 / TBT −%57.

## 2. Yöntem ve sınırlar

- **Envanter:** `scripts/audit-seo-inventory.mjs` (her HTML'in robots/canonical/sitemap/yönlendirme sınıfı).
- **Doğrulama:** yeni `test-structured-data`, `test-sitemaps`, `test-index-policy` + mevcut `qa`, `test-internal-links`, `test-seo-integrity`. Yeni araçlar önce HEAD'de koşuldu (bulgu üretti), sonra düzeltme sonrası.
- **Gerçekçi derleme:** temiz ağaçta `npm run build` adımları + `postprocess` + `apply-brand-copy` koşuldu; commit'teki ağaç tek başına yeterli kanıt değildir (bkz. §1.2).
- **Performans:** Playwright mobil profil, 5 koşu medyanı (`performans-testleri.md`).
- **Bilinmeyenler:** Google'ın gerçek indeks durumu; GSC doğrulamasının mülkle eşleşmesi; canlıda GA4 etiketi; `public/` ve kaynak dizinlerinin üretimde sunulup sunulmadığı; gerçek kullanıcı performansı; hangi sorguların trafik getirdiği.

## 3. Bulgular (görev bazında)

**G1 — Search Console/doğrulama:** HTML dosyası ve meta etiketi (15.812 sayfa) var; API bağlı değil (`configured:false`); sitemap robots.txt'te bildirilmiş. Hazır yapı: `demand:gsc`, panel, haftalık `seo:review`. Tüm ayrıntı `indeksleme-durumu.md` §1.

**G2 — İndeks envanteri:** 5.516 A (indekslenebilir+sitemap), 756 C (kopya, kanonik başka yerde), 9.533 D (`noindex,follow`), 4 E, 2 gölgeli, çelişki 0. Ayrıntı `indeksleme-durumu.md` §2.

**G3 — robots/sitemap/News:** robots.txt siteyi kapatmıyor, iki haritayı bildiriyor (kod/CSS/veri engeli yok — Googlebot render edebilir). `sitemap.xml` iyi biçimli, 5.517 tekil URL, protokol sınırlarının çok altında, lastmod içerik özetine bağlı (yalnızca sayfa değişince ilerliyor), 1.384 kayıtta hreflang karşılıklı. `news-sitemap.xml` iyi biçimli ama **boş**: son haber 9 Ekim (7 gün). Üretici 48 saat penceresini, 1.000 kayıt sınırını, `publication/name/language`, `publication_date`, `title` alanlarını doğru yazıyor; `lastmod` yok. Düzeltilen: otomatik şablon haberler artık News haritasına giremez; harita saf işleve taşındı ve sınır değerleri testli. Gözlem: News haritasında yalnızca TR var; EN haber `en` dil kodu ve ayrı yayıncı kaydı gerektirir (Publisher Center) — veri yokken önerilmez.

**G4 — Kanonik, hreflang, yönlendirme, kopya:** `vercel.json`'da 939 yönlendirme: 0 zincir, 0 döngü, 0 ölü hedef, hepsi kalıcı (204 kaldırılmış maç sayfası, 667 taşınmış oyuncu, 28 puan durumu). Düzeltilen sorunlar: T-01, T-04, T-05, T-07, T-08 (`teknik-seo-hata-listesi.md`). Maç stratejisi: `indeksleme-durumu.md` §4.

**G5 — Türkiye sayfaları:** `optimize-edilen-sayfalar.md`. Başlıklar mükerrer değil (0 grup); metinler sayfa verisinden kurulur.

**G6 — Yapısal veri:** 15.074 JSON-LD bloğu / 15,4 bin düğüm; tür dağılımı BreadcrumbList 6.086, WebPage 2.841, Person 2.046, SportsEvent 2.017, FAQPage 1.352, NewsArticle 818, … `SportsEvent.eventStatus` tarihi geçmiş maçta `EventScheduled` (schema.org'da "tamamlandı" yok; belgelenmiş, doğru). Tavsiye uyarıları (hata değil): haber görseli yok (679), `location` yok (201 — stat bilinmiyorsa uydurulmaz), 3 başlık > 110 karakter. Zengin sonuç gerçekçiliği: Event zengin sonucu için `location.address` gerekir; veri yokken yazılmaz → Event sonuçlarına uygun olmayabilir, doğru olan budur. FAQ zengin sonucu bu site türüne gösterilmez (O-08). `aggregateRating`/`review`/`offers` hiçbir yerde yok ve testle yasak.

**G7 — Performans:** ölçüm ve iyileştirme `performans-testleri.md`. En büyük kalan kalemler `page.css` (küçültülmemiş, −%44 potansiyeli) ve `app.js`.

**G8 — İçerik stratejisi:** `30-gunluk-organik-trafik-plani.md`. Özet: yeni URL çoğaltmak yerine mevcut `/mac/` sayfalarını doğrulanmış verilerle derinleştir; otomatik şablon metinler indeks dışı; her yazıya kapı.

**G9 — Ölçümleme:** GA4 etiketi yalnızca derleme ortamında `GA4_MEASUREMENT_ID` varsa basılıyor (depoda 0 sayfa); `analytics.js` GPC/DNT'ye saygılı, `match_click` olayı var. Eklenen: `data/analytics/organic-traffic.json` (+ şema), `fetch-ga4-organic.mjs`, `report-organic-traffic.mjs`, test. Veri yokken rapor "Veri yok" der, sıfır yazmaz (örnek çıktı komutla görülür: `npm run report:organic`).

**G10 — Maliyet/güvenlik:** `maliyet-etkisi.md`.

## 4. Riskler ve dikkat

1. **Noindex etkisi:** 3.000'e yakın sayfa indeks dışına çıkıyor. GSC'de "indekslenen sayfa" düşecek; bu hedeftir. Ancak bazı otomatik haberler bugün trafik alıyor olabilir — bilinmiyor. Eşik tek sabit (`THIN_BODY_CHARS`), geri alınabilir. Güvenli sıra: önce GSC taban çizgisi (hafta 1), sonra yayına alma; PR draft olduğu için bu sıra korunabilir.
2. **Çıktılar PR'da yok:** testlerin bir kısmı üretilmiş çıktıya bakar; PR dalı yeniden üretilmeden bu testler düşer (`yapilan-duzeltmeler.md`).
3. **Paylaşılan ortam uyarısı (gözlem):** bu çalışma, ana depo klasörünün içindeki `.claude/worktrees/` altında yürüdü. Ana klasörde koşan başka bir oturumun `postprocess` adımları bu çalışma ağacındaki HTML'leri (`inject-ga4.mjs` vb. `.claude` dizinini atlamıyor) yeniden yazdı. Bu betiklerin yürüyüş listesine `.claude`/`worktrees` eklenmeli (örneğin `inject-ga4.mjs`, `inject-site-verification.mjs`, `unify-match-canonicals.mjs`), aksi hâlde başka bir ağaca yanlışlıkla yazar.

## 5. Öncelikli öneriler (özet)

| Sıra | İş | Neden |
| --- | --- | --- |
| 1 | GSC + GA4 bağla; taban çizgisi al | Her karar veri bekliyor |
| 2 | Bu PR'ı birleştir, tam derlemeyle çıktıları yeniden üret | Sitemap/yapısal veri düzeltmeleri etkin olsun |
| 3 | Üretimde kaynak dizin ve `public/` sunumunu doğrula | Güvenlik + kopya içerik |
| 4 | `page.css` / `app.js` küçültme, CLS | Çekirdek web verileri |
| 5 | Eski `-ne-zaman-hangi-kanalda` sayfalarını 301'le; iç bağlantı boşluklarını kapat | Kanibalizasyon, otorite dağılımı |
| 6 | GSC ile 3 canlı skor sayfası ve `puan-durumu` ikilisinin çakışmasını ölç | Birleştirme kararı |
