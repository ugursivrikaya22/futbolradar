# FutbolRadar Starter MVP

Bu paket, FutbolRadar projesi için statik HTML/CSS/JS tabanlı ilk MVP iskeletidir.

## İçindeki sayfalar

- `index.html` — Ana sayfa / bugünkü maçlar
- `mac-analizi-galatasaray-fenerbahce.html` — Örnek maç analiz sayfası
- `takim-galatasaray.html` — Örnek takım sayfası
- `super-lig-form-tablosu.html` — Örnek lig form tablosu
- `data/matches.json` — Demo maç ve takım verileri
- `assets/app.js` — Veri çekme ve sayfa render işlemleri
- `assets/style.css` — Tasarım dosyası

## Nasıl çalıştırılır?

1. Klasörü bilgisayara indir.
2. `index.html` dosyasını tarayıcıda aç.
3. Bazı tarayıcılarda JSON dosyası yerelden yüklenmeyebilir. Bu durumda klasörü basit bir lokal sunucuda aç:

```bash
python -m http.server 8000
```

Sonra tarayıcıdan şunu aç:

```text
http://localhost:8000
```

## Yayına alma

Başlangıç için en hızlı seçenekler:

- Netlify: klasörü sürükle-bırak ile yayınla.
- Vercel: GitHub reposuna yükleyip bağla.
- cPanel hosting: public_html içine dosyaları yükle.

## Sonraki geliştirme adımları

1. Gerçek domain: `futbolradar.com` veya uygun alternatif.
2. Maç verisi API bağlantısı.
3. Admin panel veya otomatik içerik üretim sistemi.
4. SEO sayfa şablonları: maç, takım, lig, form tablosu.
5. Google AdSense başvurusu için özgün içerik ve politika sayfaları.

## Not

Bu MVP demo verilerle hazırlanmıştır. Gerçek fikstür veya gerçek performans verisi içermez.

## API entegrasyonu

Bu sürüm demo verilerle çalışır. Gerçek veriye bağlamak için `README_API.md` dosyasındaki adımları takip edin.

Önemli: API anahtarını asla tarayıcı tarafındaki JavaScript dosyalarına yazmayın. Anahtar sunucu tarafında veya GitHub Actions gibi kapalı bir otomasyon ortamında saklanmalıdır.
