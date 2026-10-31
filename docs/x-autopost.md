# X (Twitter) otomatik paylaşım

Cron işi: `/api/cron/x-autopost` (her 15 dk, `CRON_SECRET` korumalı, `server/cronRoute.js`).
Kod: `services/xAutopost/` (oauth1.js, compose.js, store.js, index.js). Yeni npm bağımlılığı yok:
X API v2 `POST /2/tweets` yerleşik `fetch` + `node:crypto` HMAC-SHA1 OAuth 1.0a ile çağrılır.

## Ne paylaşılır
| Tür | Kaynak | Pencere | Anahtar |
|---|---|---|---|
| Favori takım golü | `data/fixture-calendar.json` olayları, `match-notifications-core.js#events` (web push ile aynı olay kimliği) | canlı maç, başlama +3 sa | `goal:<olay>` |
| Maç sonu | aynı dosya; skor + istatistikten kural tabanlı tek cümle | başlama +6 sa | `result:af:<id>` |
| Köşe yazısı | `data/columns.json` (başlık + spot/özet) | yayın +48 sa | `column:<slug>` |
| Maçsız gün dolgusu | `data/transfers.json` (son 7 gün) / `data/league-leaders.json` | 12:xx ve 19:xx (İstanbul) | `slot:<gün>:noon/evening` + içerik anahtarı |

Kapsam: Süper Lig maçları, Süper Lig takımlarının tüm maçları (Avrupa dahil), Türkiye millî takımı;
yalnızca kalıcı `/mac/<slug>` sayfası olan maçlar (bağlantı her zaman var olan sayfaya gider).
Yeni API-Football isteği yok: dosyalar `SITE_URL/data/...`den okunur (saatlik iş zaten üretiyor).

## Kurulum
1. https://developer.x.com → Developer Console → proje + uygulama oluştur.
2. Uygulama → *User authentication settings* → **App permissions: Read and write** (Web App/Automated App;
   callback olarak `https://www.futbolradar.com` yazılabilir). İzni değiştirdikten SONRA token üret.
3. *Keys and tokens*: **API Key & Secret** (consumer) ve FutbolRadar hesabı için **Access Token & Secret** üret
   (token "Read and Write" yazmalı).
4. Developer Console → Billing: kredi yükle ve **aylık harcama limiti** koy (ücretsiz katman yok, aşağıya bak).
5. Supabase SQL Editor'de `supabase/migrations/0014_x_autopost.sql` çalıştır (idempotent).
6. Vercel → Project → Settings → Environment Variables (Production):
   `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`
   (isteğe bağlı: `X_FAVORITE_TEAMS="Galatasaray,Fenerbahçe,Beşiktaş,Trabzonspor"`, `X_MAX_PER_RUN=4`,
   `X_MAX_PER_DAY=8`, `X_INCLUDE_LINKS=1`).
7. Önce bayrak KAPALI bırakıp Vercel loglarında `[x-autopost] KURU KOŞU` çıktısını kontrol et.
8. Açmak için `X_AUTOPOST_ENABLED=1` ekle ve yeniden deploy et. Kapatmak: değişkeni sil/0 yap.

Bayrak kapalıysa, X anahtarlarından biri ya da Supabase eksikse iş **kuru koşu** yapar:
tweetleri loglar; X'e ve Supabase'e hiçbir şey yazmaz.

## Maliyet (Ekim 2026, https://docs.x.com/x-api/getting-started/pricing)
Ücretsiz katman yok; pay-per-use kredi: `Post: Create` $0.015, `Post: Create (with URL)` $0.200.
Varsayılan günlük 8 tweet bağlantılı → en fazla ~$1.6/gün (~$48/ay). `X_INCLUDE_LINKS=0` → ~$0.12/gün.

## Yerel test
`npm run test:x-autopost` (ağ yok) · `npm run x-autopost:dry-run -- --now=2026-10-20T23:40:00+03:00`
