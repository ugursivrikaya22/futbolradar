# FutbolRadar

FutbolRadar, futbol maçlarını form, momentum, gol eğilimi ve takım ritmi üzerinden sunan statik HTML/CSS/JS analiz sitesidir.

## Dosya Yapısı

- `index.html` — Ana sayfa ve bugünkü maç radarları
- `mac-analizi.html` — Örnek maç analizi
- `*-formu.html` — Takım profilleri (GS, FB, BJK, TS)
- `form-tablosu.html` — Süper Lig form tablosu
- `super-lig-momentum.html` — Momentum sıralaması
- `takim-formu.html` — Takım sayfaları dizini
- `assets/style.css` — Tasarım
- `assets/app.js` — JSON veri okuma ve mobil menü
- `data/matches.json` — Maç ve takım verisi (script otomatik üretir)
- `scripts/fetch-api-football.mjs` — API-Football'dan günlük veri çeker
- `scripts/fetch-live.mjs` — Günün skorlarını `data/live.json`'a yazar
- `.github/workflows/gunluk-veri.yml` — Her sabah veriyi otomatik günceller
- `.github/workflows/canli-skor.yml` — Akşamları 30 dk'da bir skorları günceller; ana sayfa skorları 60 sn'de bir tazeler
- `vercel.json`, `robots.txt`, `sitemap.xml` — Deploy ve SEO ayarları

## Lokal Çalıştırma

```bash
npm run dev
# http://localhost:8080
```

## Gerçek Veri Çekme

1. https://dashboard.api-football.com adresinden ücretsiz hesap açıp API anahtarı alın.
2. `env.example` dosyasını kopyalayıp `.env` yapın, anahtarınızı yazın.
3. Çalıştırın:

```bash
export $(grep -v '^#' .env | xargs)
npm run fetch
```

`data/matches.json` gerçek Süper Lig verisiyle güncellenir. Script günde sadece 2 API isteği yapar (ücretsiz planın 100 istek/gün limitine rahat sığar).

## Otomatik Günlük Güncelleme (GitHub Actions)

1. GitHub'da repo → Settings → Secrets and variables → Actions → New repository secret
2. İsim: `API_FOOTBALL_KEY`, değer: API anahtarınız
3. Workflow her sabah 09:00'da (TR) veriyi çekip commitler; Vercel otomatik yeniden deploy eder.

Not: API-Football ücretsiz planında bazı sezonlar/özellikler kısıtlı olabilir; Süper Lig güncel sezon verisi ücretsiz planda yoksa Pro plan ($19/ay) gerekebilir. Script hata mesajıyla bunu açıkça bildirir.
