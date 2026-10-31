# X (Twitter) otomatik paylaşım

Cron işi: `/api/cron/x-autopost` (her 15 dk, `CRON_SECRET` korumalı, `server/cronRoute.js`).
Kod: `services/xAutopost/` (oauth1.js, compose.js, store.js, index.js). Yeni npm bağımlılığı yok:
X API v2 `POST /2/tweets` yerleşik `fetch` + `node:crypto` HMAC-SHA1 OAuth 1.0a ile çağrılır.

## Ne paylaşılır
| Tür | Kaynak | Pencere | Anahtar |
|---|---|---|---|
| Favori takım golü | `data/fixture-calendar.json` olayları, `match-notifications-core.js#events` (web push ile aynı olay kimliği) | canlı maç, başlama +3 sa | `goal:<olay>` |
| Maç sonu | aynı dosya; skor + istatistikten kural tabanlı tek cümle | başlama +6 sa | `result:af:<id>` |
| Maç öncesi anket (X yerel anketi) | `data/fixture-calendar.json` (yalnızca takımlar + başlama saati) | başlamadan `X_PREMATCH_HOURS` (4) sa önce → 10 dk önce | `prematch-poll:af:<id>` |
| "Senin tahminin ne?" | aynı | aynı | `prematch-ask:af:<id>` |
| Köşe yazısı | `data/columns.json` (başlık + spot/özet) | yayın +48 sa | `column:<slug>` |
| Maçsız gün dolgusu | `data/transfers.json` (son 7 gün) / `data/league-leaders.json` | 12:xx ve 19:xx (İstanbul) | `slot:<gün>:noon/evening` + içerik anahtarı |

Kapsam: Süper Lig maçları, Süper Lig takımlarının tüm maçları (Avrupa dahil), Türkiye millî takımı;
yalnızca kalıcı `/mac/<slug>` sayfası olan maçlar (bağlantı her zaman var olan sayfaya gider).
Yeni API-Football isteği yok: dosyalar `SITE_URL/data/...`den okunur (saatlik iş zaten üretiyor).

## Maç öncesi anket / "Senin tahminin ne?"
- **Varsayılan KAPALI.** `X_PREMATCH_POLLS_ENABLED=1` ile açılır (ek maliyet olduğu için ayrı, bilinçli açılır);
  ayrıca `X_AUTOPOST_ENABLED=1` ve X anahtarları gerekir — aksi hâlde yalnızca kuru koşu logu.
- Kapsam: favori takımların (`X_FAVORITE_TEAMS`) ve Türkiye millî takımının `/mac/` sayfası olan maçları.
- `X_PREMATCH_MODE`: `poll` (varsayılan; "Kim kazanır?" anketi: ev sahibi / Beraberlik / deplasman),
  `ask` (anketsiz "Senin tahminin ne? Skor tahminini yanıtlara yaz 👇"), `both` (ikisi de).
- `X_PREMATCH_HOURS` (varsayılan 4, 1–24): başlamaya bu kadar saat kala ilk 15 dk'lık cron koşusunda gönderilir.
- Anket süresi = başlamaya kalan dakika (X sınırı 5–10080 dk): anket düdükle kapanır. Seçenekler ≤25 karakter.
- Maç başına her tür en fazla bir kez (`x_autopost_posts` anahtarı); genel `X_MAX_PER_RUN`/`X_MAX_PER_DAY`
  tavanlarına ek olarak `X_PREMATCH_MAX_PER_DAY` (varsayılan 3).
- Metinlerde oy/katılımcı sayısı YOK; X anketi sonucu zaten yüzde gösterir. Takım adı/saat yalnızca takvimden.
- X anketi medya/alıntı ile birleşemez; metinde bağlantı olabilir (maç sayfası). `X_INCLUDE_LINKS=0` bağlantıyı çıkarır.
- Sıra: goller → maç sonuçları → maç öncesi → köşe yazıları → dolgu.

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
   `X_MAX_PER_DAY=8`, `X_INCLUDE_LINKS=1`; maç öncesi: `X_PREMATCH_POLLS_ENABLED=1`, `X_PREMATCH_MODE=poll`,
   `X_PREMATCH_HOURS=4`, `X_PREMATCH_MAX_PER_DAY=3`).
7. Önce bayrak KAPALI bırakıp Vercel loglarında `[x-autopost] KURU KOŞU` çıktısını kontrol et.
8. Açmak için `X_AUTOPOST_ENABLED=1` ekle ve yeniden deploy et. Kapatmak: değişkeni sil/0 yap.

Bayrak kapalıysa, X anahtarlarından biri ya da Supabase eksikse iş **kuru koşu** yapar:
tweetleri loglar; X'e ve Supabase'e hiçbir şey yazmaz.

## Maliyet (Ekim 2026, https://docs.x.com/x-api/getting-started/pricing)
Ücretsiz katman yok; pay-per-use kredi: `Post: Create` $0.015, `Post: Create (with URL)` $0.200.
Varsayılan günlük 8 tweet bağlantılı → en fazla ~$1.6/gün (~$48/ay). `X_INCLUDE_LINKS=0` → ~$0.12/gün.
Anket de normal gönderi gibi ücretlenir. Maç öncesi (tavan 3/gün): bağlantılı ≤ $0.60/gün, bağlantısız ≤ $0.045/gün.
Gerçekçi kullanım (4 favori takım, haftada ~4–6 maç, `poll` modu): bağlantılı ~$3.2–4.8/ay, bağlantısız ~$0.25–0.36/ay;
`both` modunda iki katı. Maç öncesi gönderiler genel `X_MAX_PER_DAY` içinde sayılır (toplam tavan aşılmaz).

## Yerel test
`npm run test:x-autopost` (ağ yok) · `npm run x-autopost:dry-run -- --now=2026-10-20T23:40:00+03:00`
