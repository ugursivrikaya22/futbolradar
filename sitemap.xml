# FutbolRadar API Bağlantı Planı

Bu paket şu anda statik sitedir. Site `data/matches.json` dosyasını okur. Gerçek otomasyon için yapılacak iş, bu JSON dosyasını her gün API'den otomatik üretmektir.

## Önerilen veri kaynağı

Başlangıç için en pratik seçenek: API-Football / API-SPORTS.

Gerekli endpointler:

- `/fixtures?date=YYYY-MM-DD&timezone=Europe/Istanbul` — günlük maçlar
- `/fixtures?team=TEAM_ID&last=5` — takımın son 5 maçı
- `/standings?league=LEAGUE_ID&season=YYYY` — puan durumu
- `/teams?league=LEAGUE_ID&season=YYYY` — takım listesi
- `/fixtures/statistics?fixture=FIXTURE_ID` — maç istatistikleri
- `/players/squads?team=TEAM_ID` — kadro bilgisi

## Kurulum

1. API-Football / API-SPORTS hesabı aç.
2. API anahtarını al.
3. Bu klasörde `.env.example` dosyasını kopyalayıp `.env` yap.
4. `.env` içine API anahtarını yaz.
5. Terminalde çalıştır:

```bash
npm install
npm run fetch:api-football
npm run dev
```

Sonuç: `data/matches.json` gerçek API verisiyle güncellenir.

## Güvenlik

API anahtarını doğrudan `assets/app.js` içine koyma. Frontend kodu herkes tarafından görülebilir. Anahtar ya sunucu tarafında ya da GitHub Actions / cron gibi kapalı ortamda kullanılmalıdır.

## İlk otomasyon modeli

En basit model:

API-Football → günlük veri çekme scripti → `data/matches.json` → statik site

Daha profesyonel model:

API-Football → backend/veritabanı → momentum motoru → SEO sayfa üretimi → site
