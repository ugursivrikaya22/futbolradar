# İzlerken skor — YouTube yayınına canlı skor paneli

`/izle/<slug>.html` sayfası resmi bir YouTube yayınını (youtube-nocookie.com, tıkla-yükle) ve yanında/altında
FutbolRadar'ın **mevcut** canlı skor akışını (`/api/live-score-stream`, SSE; ek API-Football isteği yok) gösterir:
skor, dakika, goller. Maç bitince final skor ve **"Yayını tekrar izle"** arşiv linki kalır.

## Bir maça video eklemek (site sahibi)

Yalnızca **resmi** kulüp / lig / yayıncı / federasyon kanallarındaki, gömülmeye izin verilen videolar eklenir.
Otomatik arama/keşif yoktur; liste tamamen elle yönetilir.

1. `data/youtube-watch.json` içindeki `streams` dizisine bir kayıt ekle:

```json
{
  "slug": "galatasaray-fenerbahce-2026-2027-r10",
  "youtubeId": "XXXXXXXXXXX",
  "homeTeam": "Galatasaray",
  "awayTeam": "Fenerbahçe",
  "kickoff": "2026-11-01T20:00:00+03:00",
  "providerId": "1234567",
  "competition": "Süper Lig",
  "channelName": "Kanal Adı (resmi)",
  "channelUrl": "https://www.youtube.com/@resmikanal",
  "source": "yayinci",
  "kind": "live",
  "title": "İsteğe bağlı başlık",
  "matchPath": "/mac/galatasaray-fenerbahce-2026-2027-r10.html"
}
```

| Alan | Açıklama |
|---|---|
| `slug` | Sayfa adresi: `/izle/<slug>.html`. `/mac/` sayfasının dosya adıyla (uzantısız) aynı verilirse o maç sayfasına otomatik "İzlerken skor" kartı eklenir. |
| `youtubeId` | `youtube.com/watch?v=` sonrasındaki 11 karakter (canlı yayın kimliği de aynı biçimde). |
| `providerId` | (Önerilir) API-Football fikstür kimliği; canlı akıştaki maçı kesin eşler. Yoksa takım adlarıyla eşlenir. |
| `source` | `kulup`, `lig`, `yayinci` veya `federasyon`. |
| `channelUrl` | `https://www.youtube.com/@kanal` ya da `/channel/UC…` biçiminde resmi kanal adresi. |

2. Kaydet ve doğrula: `node scripts/test-youtube-watch.mjs` (geçersiz kayıt hatası listelenir) ve
   `node scripts/generate-watch-pages.mjs` (sayfa `izle/` ve `public/izle/` altına üretilir). Build zaten bu adımı çalıştırır.
3. Geçersiz kayıtlar (yanlış ID, resmi olmayan adres vb.) atlanır; sayfa ve kart üretilmez, boş kutu oluşmaz.
4. Kaydı silmek sayfayı bir sonraki build'de kaldırır.

## Notlar
- Gömme kapalıysa oynatıcı YouTube'un hata ekranını gösterir; sayfada her zaman "YouTube'da aç" linki vardır.
- CSP: `frame-src https://www.youtube-nocookie.com` eklendi. Kapak görseli `i.ytimg.com` (mevcut `img-src https:`).
- Service worker yabancı kökenleri yakalamaz; PWA önbelleği etkilenmez.
- Final skor build anında mevcut takvim/arşiv verisinden (`findFinalResult`), canlıda SSE'den gelir; maç bittiğinde
  `providerId` varsa mevcut `/api/match-detail` (CDN önbellekli) bir kez okunur.
