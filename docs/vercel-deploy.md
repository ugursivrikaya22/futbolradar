# FutbolRadar Vercel Deploy Notlari

Bu proje statik HTML/CSS/JS dosyalari ve Vercel Serverless API route'lari ile calisir. Ayrica bir frontend build framework'u yoktur.

## Production proje kurallari

- Tek canonical Vercel projesi production domainlerini tasimalidir.
- GitHub repo `ugursivrikaya22/futbolradar` olmalidir.
- Production branch `main` olmalidir.
- Root directory proje koku olmalidir; `index.html`, `package.json`, `api/`, `data/`, `page.css` ve `app.js` ayni kokte kalmalidir.
- Build command mevcut durumda no-op build adimini kullanir: `node scripts/_noop-build-step.mjs "Vercel build"`.
- Output directory bos/varsayilan kalabilir; statik dosyalar kokten servis edilir.

## API function limiti

Vercel Hobby planda serverless function sayisi sinirlidir. FutbolRadar daha once `api/` altindaki helper/provider dosyalari da function gibi sayildigi icin deployment hatasi aldi.

Kurallar:

- `api/` klasorune gereksiz `.js` dosyasi eklenmeyecek.
- Helper, provider, normalizer ve servis dosyalari `services/` altinda tutulacak.
- Provider adapter dosyalari `services/providers/` altinda kalacak.
- Yeni API endpoint gerekiyorsa once `api/[...route].js` catch-all icinde yonetmek tercih edilecek.
- `api/_utils.js` gibi underscore ile baslayan dosyalar ortak helper olarak kalabilir.
- `api/providers/` tekrar olusturulmayacak.
- Yeni endpoint eklemeden once `npm run qa` calistirilacak.

Mevcut deploy edilebilir API function dosyalari:

- `api/analyses.js`
- `api/health.js`
- `api/match-detail.js`
- `api/matches.js`
- `api/momentum.js`
- `api/players.js`
- `api/signals.js`
- `api/squad.js`
- `api/standings.js`
- `api/teams.js`
- `api/transfers.js`
- `api/[...route].js`

Mevcut sayi: 12 function.

## QA korumasi

`scripts/qa.mjs` API function sayisini kontrol eder. Sayi Vercel Hobby limitini asarsa warning basar. Bu kontrol build'i bilerek kirmiyor; ama deploy oncesi uyarinin dikkate alinmasi gerekir.

## Env guvenligi

- Gercek API key dosyaya yazilmayacak.
- `.env` ve `.env.local` commit edilmeyecek.
- Raporlarda env value yazilmayacak, sadece env isimleri ve var/yok durumu yazilacak.
- Client tarafinda provider URL, auth header veya secret degeri gosterilmeyecek.

## Domain kontrolu

Production domainleri tek canonical projede toplanmalidir:

- `futbolradar.com`
- `www.futbolradar.com`

Apex ve `www` farkli Vercel projelerine baglanirsa cache, eski deploy ve env karisikligi olusabilir. Domain tasima veya kaldirma islemi kullanici onayi olmadan yapilmaz.
