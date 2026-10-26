# Vercel Cron iş motoru

Bu belge saatlik/günlük güncellemenin GitHub Actions'tan Vercel Cron'a
taşınmasının mimarisini, kurulumunu ve geri dönüşünü anlatır. GitHub Actions
iş akışları (Scheduled Updates, Daily Health Check, Search Demand Daily)
**açık kalır** ve paralel çalışır; ikisi aynı saatte API-Football'a gitmez
(bkz. "Paylaşılan kilit").

## Mimari

```
Vercel Cron ──► /api/cron/scheduled-update (07)      ─┐  veri çek (parçalı)
            ──► /api/cron/scheduled-update?phase=resume (17,27,37) ─┘  kalan adımlar
            ──► /api/cron/deploy (50)  ─► Deploy Hook ─► build (prebuild: Supabase'ten veri)
            ──► /api/cron/health (47)
            ──► /api/cron/search-demand (06:15 hafta içi)
            ──► /api/cron/full-update (02:00) + ?phase=resume (02:10–03:50, 10 dk'da bir)
```

Tüm saatler UTC. Uç noktalar **yeni işlev açmaz**: `api/[...route].js`
(maxDuration 300) → `server/cronRoute.js`. Hobby'nin 12 işlev sınırı
korunur.

### 1. Kimlik doğrulama
Her `/api/cron/*` isteği `Authorization: Bearer $CRON_SECRET` taşımalıdır
(Vercel Cron bunu otomatik ekler). `CRON_SECRET` tanımlı değilse ya da
başlık eşleşmezse **401** döner, hiçbir iş yapılmaz. Karşılaştırma sabit
zamanlıdır (`server/cronAuth.js`).

### 2. Veri çekme — parçalı (resumable) koşu
`scripts/lib/cronJobEngine.mjs`:

- Adım listesi `scripts/run-scheduled-update.mjs`'in **kendi**
  `sourceSteps` / `transformSteps` / `validationSteps` /
  `fullMaintenanceSteps` fonksiyonlarından gelir → aynı betikler, aynı
  argümanlar, aynı bütçe/ledger korumaları, aynı mod/devre kesici kuralları.
  **Ek API-Football isteği yoktur.**
- Fonksiyon `/tmp/futbolradar-cron/<anahtar>` altında yazılabilir bir kök
  kurar (`data/` paketten kopyalanır, diğer dizinler salt-okunur bağ),
  Supabase'teki eserleri uygular ve adımları **alt süreç** olarak koşturur.
- Her çağrı bir zaman bütçesiyle sınırlıdır (`CRON_TIME_BUDGET_MS`,
  varsayılan 240000 ms). Kalan süre 45 sn'nin altına inince yeni adım
  başlatılmaz; imleç `cron_runs.cursor`'a yazılır ve `?phase=resume`
  çağrısı (17, 27, 37. dakikalar) kaldığı yerden devam eder.
- Her adımdan sonra değişen `data/` dosyaları gzip'lenip
  `cron_data_artifacts` tablosuna yazılır (fonksiyonun diski kalıcı değil).
- **Kaynak adımları asla tekrarlanmaz.** Bir adım fonksiyon sınırında
  kesilirse sonraki çağrı onu `interrupted-by-function-limit` olarak kapatıp
  geçer (bugünkü `stepAttemptLimit` = 1 kuralı).
- **HTML üretimi fonksiyonda yapılmaz** (`hourlyBuildSteps`, `npm run build`):
  süre ve salt-okunur dosya sistemi nedeniyle mümkün değil. Sayfalar Deploy
  Hook ile tetiklenen build'de üretilir.

Fonksiyonda gerçekçi olarak koşabilenler: kaynak senkronları (live-fixtures,
standings, predictions, squads, news …), dönüşümler (analizler, arşiv,
post-match store, oyuncu puanları, prediction-league, supabase-ingest) ve
doğrulamalar. **Uyarı:** `live-fixtures` adımının zaman aşımı 20 dk;
Hobby'de (300 sn) uzun süren bir live-fixtures koşusu kesilir ve o saat
eksik kalır. Bu yüzden Pro + `maxDuration` 800 + `CRON_TIME_BUDGET_MS=740000`
önerilir.

### 3. Paylaşılan kilit (çifte istek yok)
`cron_runs.run_key` = `hourly:YYYY-MM-DDTHH` (İstanbul saati; Actions'ın
`dedupeKey`'i ile aynı) ya da `full:YYYY-MM-DD`. İlk INSERT kazanır:

- Vercel kazanırsa Actions'taki zamanlanmış koşu (`claimSharedRunLock`)
  API-Football'a gitmeden "skipped" yazar.
- Actions kazanırsa Vercel atlar.
- Supabase/tablo yoksa Actions bugünkü gibi çalışır (fail-open); Vercel ise
  hiç çalışmaz (fail-closed).
- Actions kilidi aldığında Vercel'in yazdığı daha yeni eserler de depo
  verisinin üzerine uygulanır; böylece "her fikstür her basamakta bir kez"
  gibi depolar eski durumdan başlayıp aynı isteği tekrarlamaz.
- Elle tetiklenen (workflow_dispatch), `--force`, `--match`, `--backfill`
  koşuları kilitten etkilenmez.

### 4. Deploy adımı
`/api/cron/deploy` (her saat :50): tamamlanmış, `changed=true`, henüz deploy
istenmemiş bir koşu varsa `VERCEL_DEPLOY_HOOK_URL`'e POST atar. Son 55 dk
içinde deploy istendiyse atlar (saatte en fazla bir). Değişiklik yoksa
atlar. URL kodda yok, yalnızca ortam değişkeninde.

`scripts/lib/buildDecision.mjs` artık aynı commit'in yeniden derlenmesini
(Deploy Hook) atlamıyor; önceden fark boş olduğu için atlanırdı.

### 5. Build tarafı
`package.json` → `"prebuild": "node scripts/hydrate-data-from-supabase.mjs"`.
`npm run build` öncesi Supabase eserleri `data/` üzerine **koşullu**
uygulanır. Kural (`lineage`): depo dosyasının özeti eserin atalarından
biriyse eser uygulanır; depo dosyası bağımsız değiştiyse (elle commit,
Actions commit'i) **depo kazanır**. Supabase ortamı yoksa / tablo yoksa /
hata olursa build bugünkü gibi depo verisiyle devam eder.
`FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1` ile kapatılır. Build API-Football'a
gitmez.

### 6. Sağlık ve search-demand
- `/api/cron/health`: `services/dailyHealthCheckService.js` raporunu üretir
  (site erişimi, bayat kart/ticker sayımı, canlı skor gecikmesi).
  `scripts/monitor-operations.mjs` `gh` CLI ve GitHub API'sine bağlı
  olduğundan fonksiyonda koşamaz; **Actions'ta kalır**.
- `/api/cron/search-demand`: `fetch-search-signals`, `fetch-search-console`,
  `build-search-demand-data` betiklerini çalışma dizininde koşturur;
  `data/search-demand/*` değişiklikleri eser olarak yazılır, sayfayı bir
  sonraki build (`generate-search-demand-pages.mjs`) üretir. Actions'taki
  iş akışı paralel çalışmaya devam eder (API-Football kullanmaz, çifte koşu
  zararsız).

## Sahibin eklemesi gerekenler

### Vercel ortam değişkenleri (Production; yalnızca adlar)
- `CRON_SECRET` (en az 16 karakter rastgele)
- `VERCEL_DEPLOY_HOOK_URL` (Project → Settings → Git → Deploy Hooks, dal: `main`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `APIFOOTBALL_API_KEY` (ve Actions'ta kullanılan diğer `APIFOOTBALL_*` / sağlayıcı değişkenleri)
- İsteğe bağlı: `CRON_TIME_BUDGET_MS` (Pro'da `740000`), `SITE_URL`,
  `GSC_SITE_URL`, `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY` (search-demand)
- Actions'taki zamanlanmış koşunun kilidi görebilmesi için repo
  secret'larında `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` zaten tanımlı
  olmalı (supabase-sync adımı bunları kullanıyor).

### Supabase migration
`supabase/migrations/0012_cron_job_engine.sql` — SQL Editor'da elle
uygulanır. Yalnızca iki yeni tablo (`cron_runs`, `cron_data_artifacts`),
RLS açık, politika yok (yalnızca service_role).

### Plan: Pro gerekli
Hobby yalnızca **günde bir kez** çalışan cron'a izin verir; saatlik ifadeler
deploy'u **başarısız** yapar ("Hobby accounts are limited to daily cron
jobs"). Bu PR, proje Pro'ya geçmeden (ya da saatlik girdiler çıkarılmadan)
**birleştirilmemeli**. Pro'da `functions["api/[...route].js"].maxDuration`
800'e çıkarılabilir.

## Devreye alma
1. Migration'ı uygula.
2. Ortam değişkenlerini ekle; Deploy Hook oluştur.
3. Pro'ya geç (ya da saatlik cron'ları çıkar).
4. **Önizleme deploy'unda** fonksiyon boyutunu kontrol et:
   `includeFiles` `data/**` (~230 MB) içeriyor; 250 MB sıkıştırılmamış
   sınırı aşılırsa `includeFiles` saatlik adımların okuduğu dosyalarla
   daraltılmalı (bkz. "Kalan işler").
5. Birleştir; ilk saatlerde Vercel → Logs'ta `[cron]` satırlarını ve
   Supabase'te `select * from cron_runs order by started_at desc` çıktısını
   izle.
6. Birkaç gün sorunsuz giderse Actions Scheduled Updates kapatılır (ayrı PR).

## Geri dönüş
- Hızlı: Vercel'de `CRON_SECRET`'ı sil → tüm cron uç noktaları 401 döner,
  iş yapılmaz. Actions zaten paralel çalışıyor.
- Build'i Supabase'ten ayırmak: `FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1`.
- Tam: PR'ı geri al (revert). Tablolar zararsızdır; istenirse
  migration sonundaki `drop table` satırları.

## Build süresini ölçme

### Vercel dashboard
Project → **Deployments** listesi: her satırda süre (ör. "12m 34s")
görünür. Ayrıntı için deployment → **Build Logs**: ilk satır ile
"Build Completed" / "Deployment completed" satırı arasındaki fark. Filtre:
Environment = Production.

### GitHub API ile
```
gh api "repos/ugursivrikaya22/futbolradar/deployments?environment=Production&per_page=10" \
  --jq '.[] | [.id, .sha[0:7], .created_at] | @tsv'
gh api repos/ugursivrikaya22/futbolradar/deployments/<id>/statuses \
  --jq '.[] | [.state, .created_at] | @tsv'
```
Süre ≈ `success` (ya da `failure`) durumunun `created_at`'i − `pending`
durumunun `created_at`'i (ignoreCommand'ın atladığı deploy'lar da
`success` görünür ama süresi çok kısadır; bunlar build değildir).

> Not: Vercel, GitHub `deployments` kaydını build BİTİNCE oluşturur; bu
> yüzden deployment statülerinin `pending` ile `success` farkı 0 çıkar.
> Doğru ölçüm commit statüsünden yapılır (bağlam `Vercel`):
> ```
> gh api "repos/ugursivrikaya22/futbolradar/commits/<sha>/statuses" \
>   --jq '.[] | select(.context=="Vercel") | [.state, .created_at] | @tsv'
> ```
> Süre = son durum (`success`/`failure`) − `pending`. Kuyrukta bekleme dahildir.

### Ölçülen son production deploy'lar (26.10.2026, TSİ)

| Commit | Başlangıç (TSİ) | Sonuç | Süre |
|---|---|---|---|
| 0344129 | 26.10 09:48 | failure | 16,5 dk |
| 9ebd189 | 25.10 23:35 | success | 16,6 dk |
| 745609f | 25.10 22:18 | failure | 12,2 dk |
| 2342c55 | 22.10 08:00 | success | 22,6 dk |
| 013e747 | 21.10 22:56 | success | 18,3 dk |
| d118d05 | 21.10 20:01 | success | 17,3 dk |
| e69b818 | 20.10 23:39 | success | 17,9 dk |
| cf6fb5c | 20.10 23:09 | failure | 26,3 dk |
| 498e513 | 20.10 23:01 | success | 22,7 dk |
| 8053a2d | 20.10 22:33 | success | 31,5 dk |
| 8e63a7e | 20.10 22:27 | success | 18,1 dk |
| c393e3b | 20.10 22:01 | success | 28,7 dk |

Başarılı build'ler 16–32 dk (medyan ~18 dk); 45 dk sınırının altında
ama en yavaşı (31,5 dk, eşzamanlı build kuyruğu dahil) %70'ine yakın.
Saatlik Deploy Hook build'leri eklendiğinde günde ~24 build demek;
Pro'da eşzamanlı build sayısı ve build dakikası maliyeti ayrıca izlenmeli.

### 45 dakikayı aşarsa
Vercel build sınırı Hobby'de de Pro'da da **45 dk**'dır (Pro'da daha büyük
build makineleri alınabilir ama sınır aynı).
1. Zaten yapılmış adımları atla: girdisi değişmeyen üreticiler için özet
   (hash) kontrolü, değişmediyse çıktıyı yeniden yazma.
2. Önbellek: üretilen HTML'i Vercel build cache'te (`node_modules/.cache`
   benzeri bir dizin) tut, yalnızca değişen varlıkları yeniden üret.
3. Prerender'ı böl: `prerender-core-pages` / `prerender-player-content`
   gibi tarayıcı gerektiren adımları paralelleştir ya da yalnızca değişen
   sayfalar için koştur.
4. Artımlı üretim: Deploy Hook build'inde yalnızca `cron_runs.cursor.changedFiles`
   içindeki dosyalara bağlı sayfaları üret (ör. `players.json` değişmediyse
   oyuncu sayfalarını atla — saatlik hattaki `hourlyBuildSteps` mantığı).
5. Ağır üretimi fetch adımının çıktısına taşı: hesaplama (analiz, puan,
   arşiv) zaten fetch adımında yapılıyor; build yalnızca şablonlama yapsın.
6. Pro'da **Enhanced/Turbo build machines** (daha fazla CPU/RAM).

## Kalan işler / bilinen sınırlar
- `includeFiles` boyutu önizlemede doğrulanmalı (250 MB). Aşarsa saatlik
  adımların okuduğu `data/` dosyalarının listesi çıkarılıp desen
  daraltılmalı.
- `update-status.json` (operasyon defteri) Vercel koşularında yazılmıyor;
  durum `cron_runs` tablosunda. Admin monitörünün bu tabloyu okuması ayrı iş.
- Eser yükleme tek dosya başına tek satır; çok büyük dosyalar (ör.
  `post-match-reports.json` ~61 MB, gzip ile ~birkaç MB) Supabase istek
  boyutuna yakınsa parçalı yükleme gerekir.
- Bir hydrate hatası kısmi uygulama bırakabilir (her dosya bağımsız);
  doğrulama build içindeki mevcut kontrollere bırakıldı.
