# X (Twitter) otomatik paylaşım — FutbolRadar

> **Varsayılan KURU KOŞU.** Gerçek gönderi için `X_AUTOPOST_ENABLED=true` **ve** geçerli kimlik bilgileri gerekir.
> Acil durdurma: `X_AUTOPOST_KILL=1` (tüm X akışları — maç günü, canlı, haber — anında kuru koşuya döner).

## Ne paylaşır?
| Gün | İçerik | Kaynak (gerçek veri) | Bağlantı |
|---|---|---|---|
| Maç günü | Her gol: `⚽ GOL! … 67' Oyuncu` | `data/fixture-calendar.json` (API-Football) | Varsayılan yok (`X_GOAL_LINKS=1` ile var) |
| Maç günü | Maç sonu özeti + golcüler | fixture-calendar / `data/match-hubs/*.json` | `/mac/<slug>` veya maç merkezi sayfası |
| Maç olmayan gün | Gol krallığı, asist krallığı, transfer, takım karşılaştırması | `data/league-leaders.json`, `data/league-standings.json` | `/gol-kralligi.html`, `/asist-kralligi.html`, `/karsilastirma/takimlar/a-vs-b`, transfer sayfası |
| Her gün | Yeni köşe yazısı | `data/columns` | yazı sayfası |

TheSportsDB **kullanılmaz**. Uydurma metin yoktur: her satır veri dosyasındaki alanlardan kurulur; veri yoksa tweet üretilmez.
Her tweetin sonunda `🤖 Otomatik` işareti vardır (`X_AUTOMATED_MARKER=0` ile kapanır; 280'i aşarsa otomatik düşülür).

## Akış ve güvenlik
- Zamanlayıcı: Vercel cron `/api/cron/x-autopost` (`*/15 * * * *`) — GitHub Actions'a bağlı **değil**.
- **Kuyruk/kısıt** (`services/xAutopost/throttle.js`): resmî sınırlar 100 istek/15 dk (kullanıcı), 10.000/24 sa (uygulama); `X_RATE_SAFETY` (varsayılan 0,8) ile %80'inde durur. Pencere sayımları Supabase `x_autopost_posts` tablosundan tohumlanır (koşular arası kalıcı).
- **429**: `Retry-After` (varsa) → `x-rate-limit-reset` (unix sn) → yoksa üstel geri çekilme (60 sn·2ⁿ, en çok 15 dk). Koşu durur, anahtarlar serbest bırakılır, sonraki cron yeniden dener.
- **Tekilleştirme**: (1) olay anahtarı (`goal:af:<fixture>:<sıra>`, `result:af:<id>` …), (2) içerik özeti `hash:<sha256>` — bağlantı/işaret/etiket/boşluk/büyük-küçük harf farkı aynı sayılır. İkisi de aynı tabloda; **yeni migration gerekmez**.
- Günlük tavan `X_MAX_PER_DAY` (varsayılan 30, **her isteği** sayar: ana gönderi + bağlantı yanıtı), koşu tavanı `X_MAX_PER_RUN` (varsayılan 6).

## Bağlantı stratejisi ve FİYAT BULGUSU (önemli)
`X_LINK_MODE=reply` (varsayılan, istenen strateji): ana tweet bağlantısız, bağlantı ilk yanıtta.
**Ancak resmî fiyat sayfası URL içeren *her* gönderiyi $0,20 sayar; kendi tweetine yanıt için istisna yazmaz.** Tek ucuz yanıt türü "summoned" ($0,01) — o da yalnızca *başkası seni etiketlediğinde/alıntıladığında*. Yani:

| Mod | Bağlantılı paylaşım başına |
|---|---|
| `reply` | $0,015 (ana) + $0,20 (bağlantılı yanıt) = **$0,215** |
| `inline` | **$0,20** |
| `none` | **$0,015** (bağlantı yok) |

Maliyet açısından `reply` tasarruf sağlamaz, `inline`'dan $0,015 pahalıdır. Erişim (algoritma) gerekçesiyle tercih edilebilir; tasarruf isteniyorsa `none`. Kod üç modu da destekler.

## Doğrulama tablosu (2026-11-04)
| İddia | Durum | Kaynak |
|---|---|---|
| Gönderi $0,015 | Doğrulandı | https://docs.x.com/x-api/getting-started/pricing · https://console.x.com/api/credits/pricing (`PostCreate 0.015`) |
| URL'li gönderi $0,20 | Doğrulandı | aynı + https://docs.x.com/changelog (20 Nisan 2026'dan itibaren) |
| Bağlantıyı yanıta koymak ucuzdur | **Farklı** — URL'li yanıt da $0,20 | pricing + changelog ("summoned replies remain $0.01") |
| 100 gönderi/15 dk (kullanıcı) | Doğrulandı | https://docs.x.com/x-api/fundamentals/rate-limits |
| 10.000/24 sa (uygulama) | Doğrulandı | aynı |
| 429'da `x-rate-limit-reset` | Doğrulandı | aynı |
| 429'da `Retry-After` | Bulunamadı (dokümanda yok; kod yine de okur) | aynı |
| OAuth 2.0 PKCE + `tweet.write` | Doğrulandı (POST /2/tweets: `tweet.read tweet.write users.read`) | https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code |
| Erişim belirteci 2 sa; yenileme için `offline.access` | Doğrulandı | aynı |
| console.x.com'da uygulama + anahtarlar (bir kez gösterilir) | Doğrulandı | https://docs.x.com/x-api/getting-started/getting-access |
| Pay-per-use'ta yanıtlar yalnızca "summoned" iken | Doğrulandı (kendi gönderine yanıt istisnası resmî dokümanda **yok**; üçüncü taraf kaynaklar istisna diyor → doğrulanmadı) | https://docs.x.com/x-api/posts/manage-tweets/integrate |
| Otomasyon: "Automated" etiketi, yönetici hesap, aynı metni tekrar etmeme | Doğrulandı (kural metni help.x.com'da; Cloudflare nedeniyle okunamadı) | https://docs.x.com/developer-guidelines |
| Ayarlar → Hesabın → Otomasyon menü yolu | Bulunamadı (yalnızca üçüncü taraf) | — |
| Aynı metni reddetme kuralı | Bulunamadı | — (biz yine de içerik özetiyle engelliyoruz) |

## Kurulum (console.x.com)
1. https://console.x.com → FutbolRadar X hesabıyla giriş → Developer Agreement'ı kabul et.
2. **Pay-per-use** krediyi yükle (Billing/Credits). Harcama limiti koy.
3. **New App** → *User authentication settings*: OAuth 2.0 aç, tür **Web App / Automated App or Bot** (gizli istemci), izin **Read and write**, Callback URI örn. `https://www.futbolradar.com/` .
4. **Keys and tokens**: OAuth 2.0 *Client ID* ve *Client Secret* (bir kez gösterilir; parola yöneticisine kaydet).
5. Kendi bilgisayarında:
   ```bash
   X_OAUTH2_CLIENT_ID=... X_OAUTH2_REDIRECT_URI=https://www.futbolradar.com/ node scripts/x-oauth2-setup.mjs authorize
   # bağlantıyı aç → onayla → adres çubuğundaki ?code=... değerini al
   X_OAUTH2_CLIENT_ID=... X_OAUTH2_CLIENT_SECRET=... X_OAUTH2_REDIRECT_URI=https://www.futbolradar.com/ \
     node scripts/x-oauth2-setup.mjs exchange --code=KOD
   ```
   Refresh token `.x-oauth2-tokens.json` (0600, gitignore'da) dosyasına yazılır; ekrana yazılmaz.
6. Vercel'e (elle) gir: `X_OAUTH2_CLIENT_ID`, `X_OAUTH2_CLIENT_SECRET`, `X_OAUTH2_REFRESH_TOKEN`. Önce `X_AUTOPOST_ENABLED` **olmadan** dağıt, cron günlüğündeki "would post" satırlarını kontrol et; sonra `X_AUTOPOST_ENABLED=true`.
7. X hesabında "Automated" etiketini aç, yönetici (insan) hesabı bağla, biyografiye "Otomatik maç bildirimleri" yaz.

OAuth 1.0a (eski 4 anahtar) hâlâ çalışır; OAuth 2.0 değişkenleri varsa öncelik onlarda.

## Ortam değişkenleri
| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `X_AUTOPOST_ENABLED` | kapalı | `true` + kimlik = gerçek gönderi |
| `X_AUTOPOST_KILL` | kapalı | `1` = acil durdurma (tüm X akışları) |
| `X_OAUTH2_CLIENT_ID` / `X_OAUTH2_CLIENT_SECRET` / `X_OAUTH2_REFRESH_TOKEN` | — | OAuth 2.0 (önerilen) |
| `X_OAUTH2_ACCESS_TOKEN` | — | isteğe bağlı, kısa ömürlü |
| `X_OAUTH2_TOKEN_STORE` | — | `supabase` = dönen yeni refresh token'ı `x_oauth_tokens`'a yaz (tablo ÖNERİ: `docs/proposals/x-oauth-tokens.sql`) |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` | — | OAuth 1.0a (alternatif) |
| `X_LINK_MODE` | `reply` | `reply` / `inline` / `none` |
| `X_INCLUDE_LINKS` | açık | `0` = `none` zorlar |
| `X_GOAL_LINKS` | kapalı | `1` = gol tweetlerine de bağlantı ($0,20+) |
| `X_GOAL_SCOPE` | `superlig` | `favorites` = yalnızca favori takımlar |
| `X_FAVORITE_TEAMS` | GS,FB,BJK,TS | virgüllü liste |
| `X_AUTOMATED_MARKER` | açık | `0` = `🤖 Otomatik` kapalı |
| `X_RATE_SAFETY` | 0,8 | resmî sınırın oranı |
| `X_MAX_PER_RUN` / `X_MAX_PER_DAY` | 6 / 30 | tavanlar (gün tavanı yanıtları da sayar) |
| `X_PREMATCH_POLLS_ENABLED`, `X_PREMATCH_MODE`, `X_PREMATCH_HOURS`, `X_PREMATCH_MAX_PER_DAY` | kapalı | maç önü anketleri |
| `X_LIVE_ENABLED` | — | `services/socialAutopost/xLive.js` canlı akışı (aynı kill switch'e bağlı) |

## Kuru koşu ve testler (ağ yok)
```bash
npm run x-autopost:dry-run                                   # bugünkü adaylar
node scripts/x-autopost-dry-run.mjs --now=2026-11-05T19:05:00+03:00
node scripts/x-autopost-dry-run.mjs --hub=data/match-hubs/galatasaray-stuttgart-2026-11-03.json
node scripts/x-autopost-dry-run.mjs --site                   # canlı sitedeki data/*.json (yalnızca GET)
X_LINK_MODE=inline npm run x-autopost:dry-run
npm run test:x-autopost        # test-x-autopost + test-x-autopost-queue
npm run test:social-autopost
```

## Aylık maliyet tahmini (sitenin kendi verisinden)
Kaynak: `data/historical-match-archive` Süper Lig — Ağustos 2026: 25 maç, 73 gol, 11 maç günü; Eylül 2026: 27 maç, 85 gol, 11 maç günü → maçsız gün ≈ 20 / 19.

Formül: `aylık = gol × 0,015 + maç × B + maçsız_gün × 2 × B` (B = bağlantılı paylaşım: reply 0,215 · inline 0,20 · none 0,015; maçsız günlerde 2 dolgu tweeti).

| Senaryo | reply (varsayılan) | inline | none |
|---|---|---|---|
| Düşük (73 gol, 25 maç, 20 gün) | 1,10 + 5,38 + 8,60 = **$15,07** | **$14,10** | **$2,07** |
| Yüksek (85 gol, 27 maç, 19 gün) | 1,28 + 5,81 + 8,17 = **$15,25** | **$14,28** | **$2,25** |

Eklemeler: favori takımların Avrupa maçı başına ≈ gol×0,015 + 0,215 (ayda ~8 maç ≈ +$2); köşe yazısı başına +$0,215; `X_GOAL_LINKS=1` gol başına +$0,20 (~+$15–17). Teorik tavan: 30 istek/gün × 30 gün × $0,20 ≈ **$180/ay** — gerçek harcamayı console.x.com harcama limitiyle sınırla.

## Bilinen kısıtlar
- **Veri bayat**: `data/fixture-calendar.json` (repo ve canlı site) ~20 Ekim'de kalmış; Süper Lig maçları hâlâ SCHEDULED. Veri hattı düzelene kadar gol/maç sonu tweeti üretilmez (dolgu tweetleri üretilir). Veri GitHub Actions ile yenileniyorsa →
- **GitHub Actions** 21 Ekim'den beri `startup_failure`. Paylaşım Vercel cron'da çalışır ama veri tazeliği Actions'a bağlı.
- Gecikme: cron 15 dakikada bir → gol tweeti 0–15 dk gecikebilir.
- Refresh token dönüşümü: X yeni refresh token döndürürse, `X_OAUTH2_TOKEN_STORE=supabase` + önerilen tablo olmadan soğuk başlangıçta eski env değeri kullanılır. Tablo uygulanana kadar OAuth 1.0a anahtarları daha az riskli.
- "Automated" etiketi ve yönetici hesap elle açılır (API yok).
- Kendi gönderine yanıtın pay-per-use'ta izinli olduğu resmî dokümanda açık değil; reddedilirse yanıt bir kez denenir, ana tweet kalır (`X_LINK_MODE=inline` ile geç).
