# GSC CSV ile "tıklama var, sayfa yok" analizi

Search Console API bağlı değil (`data/search-demand/search-console-status.json` → `configured: false`).
API kurulana kadar elle dışa aktarım kullanılır:

1. Search Console → **Performans** → tarih aralığı **Son 3 ay** → sağ üstte **Dışa aktar → CSV indir**.
2. Zip içinden `Sorgular.csv` ve `Sayfalar.csv` dosyalarını repo köküne yakın bir yere koy (ör. `uploads/`; commit etme).
3. Çalıştır:
   ```
   node scripts/match-gsc-export.mjs --queries=uploads/Sorgular.csv --pages=uploads/Sayfalar.csv --min-clicks=1
   ```
4. Çıktı: tıklama alan ama sitemap'te belirteç eşleşmesi %60'ın altında kalan sorgular (yeni/özel sayfa adayı)
   ve tıklama alıp sitemap'te olmayan URL'ler.

Betik hiçbir değer üretmez; CSV yoksa çalışmaz. Kalıcı çözüm: `GSC_SITE_URL`, `GSC_CLIENT_EMAIL`,
`GSC_PRIVATE_KEY` ortam değişkenleriyle `scripts/fetch-search-console.mjs` (bkz. docs/search-demand-engine.md).
