# İndeksleme durumu

> **Veri yok uyarısı.** Search Console'a erişim yok. Aşağıdaki sayılar Google'ın indekslediği sayfa sayısı DEĞİL; depodaki işaretlerden (robots meta, canonical, sitemap üyeliği, yönlendirme kuralı) çıkan **indekslenebilirlik envanteri**dir. Google'ın gerçek durumu (indekslendi / keşfedildi, indekslenmedi / kopya) için Search Console "Sayfa indeksleme" raporuna bakılmalıdır.

## 1. Search Console bağlantı/doğrulama durumu (depodan okunabilen)

| Madde | Durum | Kanıt |
| --- | --- | --- |
| Mülk doğrulama — HTML dosyası | Var | `googlef881b0d7527a8fba.html` (içerik: `google-site-verification: googlef881b0d7527a8fba.html`); `robots.txt`/`vercel.json` engellemiyor. |
| Mülk doğrulama — meta etiketi | Var, 15.812 / 15.812 sayfada | `data/site-verification.json` → `inject-site-verification.mjs` her son işlemde yazar (token boşsa hiçbir şey basmaz). Token değeri doğru mülke ait mi, **doğrulanamadı** (GSC erişimi yok). |
| Search Console API bağlantısı | **Bağlı değil** | `data/search-demand/search-console-status.json`: `configured:false`, eksik `GSC_SITE_URL`, `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY` (son kontrol 2026-08-14). `search-console-report.json` hiç üretilmemiş. |
| Sitemap bildirimi | robots.txt'te iki satır | `Sitemap: …/sitemap.xml`, `…/news-sitemap.xml`. GSC'ye ayrıca gönderilip gönderilmediği **bilinmiyor**. |
| Hazır yapı | Var | `npm run demand:gsc` (kimlik gelince 4 rapor: en çok gösterim/tıklama, 4–15. sıra fırsatları, tıklanmayan sayfalar), `seo-icerik-firsatlari.html` paneli, `seo:review` haftalık özet, günlük `search-demand-daily.yml`. |
| GA4 | Etiket depoda **yok** (0 sayfa) | `inject-ga4.mjs` yalnızca derleme ortamında `GA4_MEASUREMENT_ID` varsa etiket basar; canlıda tanımlı mı **bilinmiyor**. |

## 2. İndekslenebilirlik envanteri (`npm run audit:seo-inventory`)

Sınıflar: **A** indekslenebilir + sitemap'te · **B** indekslenebilir ama sitemap'te değil · **C** indekslenebilir, canonical başka sayfada (kopya) · **D** `noindex,follow` · **E** `noindex,nofollow` (iç araç) · **F** dosya var ama `vercel.json` 301'i dosyadan önce çalışır (gölgeli).

| Sınıf | Önce (main) | Sonra |
| --- | ---: | ---: |
| A | 7.791 | 5.516 |
| B | 2 | 1 |
| C | 747 | 756 |
| D | 7.267 | 9.533 |
| E | 4 | 4 |
| F | 2 | 2 |
| Toplam HTML (public/ aynası hariç) | 15.814 | 15.813 |
| Sitemap URL | 7.792 | 5.517 |

Çelişki kontrolleri (ikisinde de): noindex ama sitemap'te **0**, canonical başka yerde ama sitemap'te **0**, indekslenebilir ama canonical yok **0**, canonical 200 vermiyor **0**, sitemap URL'si 200 vermiyor **0** (sonra). Yetim indekslenebilir sayfa: 1 (`fenerbahce-besiktas-ne-zaman-hangi-kanalda.html`, bkz. hata listesi O-06).

### Aile bazında (sonra)

| Aile | Sayfa | A | C | D |
| --- | ---: | ---: | ---: | ---: |
| `karsilastirma/` (oyuncu kıyası) | 2.813 | 2.813 | — | — |
| `mac-raporu/` | 7.256 | 53 | 613 | 6.590 |
| `en/news/` | 1.143 | 46 | — | 1.097 |
| `haber/` | 744 | 46 | 1 | 697 |
| `mac/` tarihli | 669 | 668 | — | 1 |
| `mac/` hafta (`-rNN`) | 306 | — | 71 | 235 |
| `en/match/` | 975 | 668 | 71 | 236 |
| `futbolcu/` | 563 | 561 | — | 2 |
| `oyuncular/` | 831 | 165 | — | 665 (yönlendirme kabuğu) |
| kök sayfalar | 132 | 121 | — | 5 (+4 E) |
| `en/player`, `en/team`, `en/columns`, `lig`, `takimlar`, `arsiv`, `mac-dosyasi`, `kose-yazilari` … | ~340 | tümü | — | — |

## 3. Politika (bu PR)

| Kural | Etki | Geri alma |
| --- | --- | --- |
| Otomatik keşif haberi + gövde < 800 karakter → noindex, sitemap/News dışı | TR 697 + EN 1.097 sayfa D'ye geçti | `services/newsIndexPolicy.js` → `THIN_BODY_CHARS = 0` |
| Tarihsiz hafta sayfası → noindex, sitemap dışı; tarih gelince Maç Merkezi'ne kanonik | TR 235 + EN 235 | üretici fonksiyonları `isDatedMatch` |
| Emekli (301'li) maç adresi sicile girmez | tam derlemede 78 URL | — |
| `/api`, `/data`, … `X-Robots-Tag: noindex` | indekslenmeyi engeller, taramayı engellemez | `vercel.json` |

Sayfa hiçbirinde silinmedi; iç bağlantılar `follow` ile izlenmeye devam eder.

## 4. Maç sayfaları indeksleme stratejisi (inceleme ve öneri)

**Bugünkü tasarım** (`docs/match-seo-pages.md`): yalnızca 12 yarışma + A Millî Takım maçı sicile girer; tek kalıcı adres `/mac/<ev>-<dep>-<gün>-<ay>-<yıl>` maç öncesi → canlı → sonrası boyunca aynı kalır; iptal/ertelenen noindex; bitmiş maç sitemap'ten çıkarılmaz; hafta numaralı eski sayfalar tarih gelince kanonikliği devreder; maç raporları (`mac-raporu/`) kapsamı %40 altındaysa noindex.

**Ölçülen sağlık:**
- Tarihli `/mac/` sayfaları kopya/ince değil: 30'ar sayfalık örnek — ana metin medyan 5.488 (maç öncesi) / 4.372 (bitmiş) karakter; ikili 5-gram benzerliği ortalama %15,5 / %23 (en yüksek %40 / %48). Şablon iskeleti ortak, içerik (saat, kanal, hakem, H2H, form, puan durumu, kadro, olaylar) maça özel.
- 669 sicil kaydının 616'sı bitmiş, 48 planlı, 5 ertelenmiş/yarıda/hükmen. Yani indeks havuzunun %92'si "sonuç" sayfası: sorgu niyeti "X Y maç sonucu / kaç kaç bitti" ile uyumlu, ama taze trafik için maç öncesi sayfaların yeterli sayıda açık olması gerekir (sicil yalnızca 35 gün ileri).
- Raporlar: 7.256 `mac-raporu` sayfasının 6.590'ı ince (noindex), 613'ü `/mac/` hedefine kanonik, yalnızca 53'ü bağımsız indekslenebilir.

**Öneriler:**
1. **Tarihsiz hafta sayfaları noindex** (uygulandı). Tarih atanınca zaten kanonikleniyor; tarihsiz dönemde ayrı bir indeks değeri yok.
2. **Eski `*-ne-zaman-hangi-kanalda.html` sayfaları** dated `/mac/` sayfasına 301 (O-06). Aksi hâlde iki sayfa aynı maçı hedefler.
3. **Sicil penceresi**: planlı maçlar için 35 günlük ileri pencere, büyük 4 takımın sonraki 3–5 maçını daha erken açmaya yetebilir; ancak tarihi doğrulanmamış maça sayfa açılmaz (mevcut kural doğru). Karar GSC "hangi sorgu hangi maç sayfasını getiriyor" verisiyle verilmeli.
4. **Düşük öncelikli yarışmalar** sicile girmiyor ve raporları noindex: doğru. Türkiye'de ilgi gören ama listede olmayan bir yarışma (ör. Türkiye Kupası zaten var; Süper Kupa, hazırlık maçları büyük takımlar için) GSC'de gösterim alıyorsa listeye eklenmeli — veri gelmeden eklenmesi önerilmez.
5. **Başlık şablonu korunmalı**; sezon içi rövanş/aynı çift için `(gün)` eki zaten var (`test-seo-integrity` mükerrer başlığa izin vermiyor).
6. **İzleme (GSC)**: "Kopya, Google farklı kanonik seçti", "Yönlendirmeli sayfa", "noindex etiketiyle hariç" ve "Sitemap'te yönlendirme" sayaçları bu PR sonrası düşmeli; `mac/` sayfalarında "Taranmış – şu anda indekslenmemiş" artıyorsa içerik benzersizliği yeniden ölçülmeli.
