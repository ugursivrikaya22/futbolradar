# Canlı Veri Operasyonları

## Canlı skorlar

- İstemci `app.js`, açık sayfada 20 saniyede bir `/api/live-matches` çağrısı yapar.
- CDN politikası `s-maxage=5`, `stale-while-revalidate=10` saniyedir.
- `services/liveMatchFeedService.js` yalnızca `api-football` veya `football-data`
  yanıtlarını yayımlar; `mock` sağlayıcısı hiçbir koşulda canlı skor değildir.
- Türk takımı veya Türkiye organizasyonu içeren maçlar öncelik alır.
- Hata halinde son başarılı görüntü en fazla iki dakika `isStale: true` ile
  korunur; sonra bant veri bekleme durumuna döner.

Mevcut sağlayıcı ortam değişkenleri kullanılır: `APIFOOTBALL_API_KEY` veya
football-data yapılandırması. Anahtarlar tarayıcıya veya API yanıtına yazılmaz.

## Haber alma

`data/news-sources.json` başlangıçta boştur. Bir kaynağı etkinleştirmeden önce
editoryal olarak doğrulayın:

```json
{
  "id": "club-example",
  "name": "Kulüp adı",
  "hostname": "kulup.example",
  "feedUrl": "https://kulup.example/rss.xml",
  "official": true,
  "active": true,
  "club": "Kulüp adı",
  "category": "Kulüp Gündemi"
}
```

`npm run news:ingest` kuru koşudur. `node scripts/ingest-breaking-news.mjs --apply`
doğrulanmış adayları `data/news-inbox.json` içine yazar. GitHub Actions canlı
yenileme işi bunu beş dakikada bir çalıştırır. Allowlist dışındaki hostlar ve
geçersiz zaman damgalı kayıtlar yayımlanmaz; resmî olmayan kaynaklar `reported`
olarak kalır.

## İzleme

`/api/ingestion-health` yalnızca `x-futbolradar-health-token` başlığı
`INGESTION_HEALTH_TOKEN` ile eşleşirse yanıt verir. Yanıt sır içermez; son
başarı/arıza, süre, kayıt sayısı ve bayatlık bilgisini gösterir. Ölçümler
sunucusuz örnek belleğindedir; kalıcı alarm için Vercel Log Drain veya ayrı bir
gözlemleme sistemi gerekir.
