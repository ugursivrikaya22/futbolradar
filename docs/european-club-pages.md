# Avrupa kulüp sayfaları

Premier Lig ve La Liga dışındaki puan satırları hâlâ `scripts/generate-standings-team-pages.mjs` taslağıdır: `noindex,follow`, site haritasında yok. Bu turda indeks yalnızca şu iki ligde, `data/european-club-dossier.json` eşiği tutan kulüplerdedir.

## Bu turda

- Ligler: Premier Lig (API-Football 39), La Liga (140). Sezon, `data/league-standings.json` içindeki sezon.
- Sayfalar: `/takimlar/{slug}` ve `/en/club/{slug}`. Kadro kaydı varsa `/takimlar/{slug}/kadro` ve `/en/club/{slug}/squad`.
- Veri: puan ve form `league-standings.json`; stadyum, kuruluş, ülke, kadro ve fikstür dosyası API-Football. TheSportsDB yok.
- İndeks (hub): sıra, en az 3 oynanmış maç, puan, form, en az 3 lig skoru, 1 kayıtlı program maçı, ülke veya stadyum. Kadro listesi yoksa o bölüm yazılmaz ve hub eşiği onu beklemez. Kadro alt sayfası ancak en az 15 isim varsa açılır ve indekslenir. Altı `noindex,follow`.
- Bu dosyadaki maçlar, depodaki API-Football maç kayıtlarından (her iki kulüp de 2026 tablosunda, yarışma adı Premier League veya La Liga) gelir. Stadyum, iç saha maçlarında en sık geçen salon adıdır. Kadro listesi bu kayıtta yoktur; `npm run sync:european-club-dossier` anahtarla kadroyu ekler.
- Liverpool, Barcelona, Real Madrid ve Atlético Madrid eldeki zengin sayfada kalır; bu üretici onları yazmaz.
- Dosyayı yenilemek: `npm run sync:european-club-dossier` (kota: canlı skor için 25 istek ayrılır, koşu tavanı 45). Derleme ağa çıkmaz.

## Sonraki tur

Aynı eşik ve aynı dosya biçimiyle, yeni istek bütçesi ayrı koşuda:

| Lig | Anahtar | API-Football |
| --- | --- | --- |
| Serie A | `serie-a` | 135 |
| Bundesliga | `bundesliga` | 78 |
| Ligue 1 | `ligue-1` | 61 |

Şampiyonlar Ligi ve Avrupa Ligi satırı, kulüp bu iki ligden birindeyse sayfada gösterilir (puan dosyasındaki satır). Kupaya özel kadro veya fikstür çekilmedi; yalnızca kupa satırı olan kulüplerin sayfası açılmaz.
