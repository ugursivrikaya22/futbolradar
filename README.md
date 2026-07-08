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
- `assets/app.js` — Merkezi veri katmanı: `data-api-section` kancalarını tarar, JSON'dan kart render eder, mobil menü
- `scripts/fetch-api-football.mjs` — API-Football'dan günlük veri çeker
- `scripts/fetch-live.mjs` — Günün skorlarını `data/live.json`'a yazar
- `scripts/build-data.mjs` — `matches.json`'dan türetilmiş veri dosyalarını üretir
- `.github/workflows/gunluk-veri.yml` — Her sabah veriyi otomatik günceller

### Veri katmanı (`/data`)

Kartlar HTML'e gömülü değildir; sayfalar `data-api-section` kancasıyla ilgili JSON'u fetch edip render eder.

| Dosya | İçerik | Kaynak |
| --- | --- | --- |
| `matches.json` | Bugünkü + yaklaşan maçlar, ham takım verisi | `fetch-thesportsdb.mjs` (tek doğruluk kaynağı) |
| `live.json` | Günün canlı skorları | `fetch-live.mjs` |
| `teams.json` | Takım kataloğu (+ hücum/savunma radar puanı) | `build-data.mjs` (türetilir) |
| `momentum.json` | Momentum sıralaması | `build-data.mjs` (türetilir) |
| `signals.json` | Radar sinyalleri | `build-data.mjs` (türetilir) |
| `players.json` | Oyuncu radar önizleme | elle yazılır |
| `analyses.json` | Analiz (SEO) kartları | elle yazılır |

Kancalar: `data-api-section` (bölüm), `data-card` (kart), `data-team` / `data-player` (kimlik). Veri gelmezse: fetch/JSON hatasında statik fallback korunur, veri boşsa temiz "boş durum" gösterilir; sayfa hiçbir durumda kırılmaz.

Pipeline: `npm run fetch` → `npm run data` → `npm run pages`
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
