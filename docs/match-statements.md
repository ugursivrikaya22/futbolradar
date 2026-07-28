# Maç Sonu Açıklamaları

Teknik direktör ve futbolcuların maç sonrası sözleri. Ana sayfada kısa kayan
şerit, maç detay ve maç raporu sayfalarında şerit + tam liste.

## 1. Neden ayrı ve sert bir kapı var?

Bu içerik sağlayıcıdan gelmiyor. API-Football ne basın toplantısı ne alıntı
döndürüyor; kayıt tamamen editoryal. Editoryal olması "serbestçe yazılabilir"
demek değil — tersine, uydurma riskinin en yüksek olduğu yer burası. Bir maç
istatistiğini yanlış yazmak sayı hatasıdır; bir insanın ağzına söylemediği bir
cümleyi koymak başka bir şeydir.

Kural `services/matchStatementsService.js` içinde, tek yerde.

## 2. Kayıt biçimi

`data/matches.json` içindeki maç kaydına `statements` dizisi olarak yazılır:

```json
"statements": [
  {
    "person": "Okan Buruk",
    "role": "manager",
    "team": "Galatasaray",
    "quote": "Bugün üzerinde düşünmemiz gereken konu, çok fazla kolay pozisyon vermemiz oldu.",
    "sourceName": "Hürriyet",
    "sourceUrl": "https://www.hurriyet.com.tr/...",
    "publishedAt": "2026-07-27T23:57:00+03:00",
    "status": "verified"
  }
]
```

| Alan | Zorunlu | Not |
|------|---------|-----|
| `person` | evet | Konuşan kişinin adı. Boşsa kayıt elenir. |
| `role` | evet | `manager` ya da `player`. Yazım varyantları (`teknik direktör`, `futbolcu`, `coach`, `oyuncu`) kabul edilir. |
| `team` | evet | Kişinin temsil ettiği kulüp. |
| `quote` | evet | ALINTI BİREBİR yazılır. Özetlenmez, kısaltılmaz, iki ayrı cümle birleştirilmez. |
| `sourceName` | evet | Yayımlayan kaynağın adı. |
| `sourceUrl` | evet | `http(s)://` ile başlamalı. İzlenebilir olmayan bağlantı kaydı eler. |
| `publishedAt` | hayır | ISO tarih. Yoksa kayıt listenin sonuna düşer. |
| `status` | evet | Yalnızca `"verified"` yayımlanır. |

## 3. Yayın kuralları

1. **Atıfsız alıntı geçmez.** Kişi, rol, takım, alıntı ve izlenebilir kaynak
   bağlantısı olmadan kayıt yayımlanmaz. "Bir yetkili şöyle dedi" biçiminde
   atıfsız cümle geçmez.
2. **Varsayılan yayımlamamaktır.** `status` açıkça `"verified"` değilse kayıt
   elenir; eksik alan yayımlamaya değil elemeye yol açar.
3. **Bilinmeyen rol yuvarlanmaz.** `başkan`, `menajer`, `yetkili` gibi bir
   değer "teknik direktör"e çevrilmez; kayıt elenir. Rol, alıntının ağırlığını
   belirleyen bir bilgidir ve tahminle doldurulamaz.
4. **Maç bitmeden yayımlanmaz.** Maç öncesi bir söz "maç sonu açıklaması"
   değildir; başlığın kendisi bir iddia olurdu.
5. **Tekrar elenir.** Aynı kişinin aynı alıntısı bir kez görünür.
6. **Boş bölüm gizlenmez.** Doğrulanmış açıklama yoksa yüzey kaldırılmaz,
   **"Kaynaklardan bekleniyor"** yazar. Sessiz boşluk okuyucuya "kimse
   konuşmadı" diye okunurdu; doğrusu "biz henüz doğrulamadık".

Elenen her kayıt `[futbolradar:statement-hidden]` etiketiyle iç günlüğe
yazılır — sessizce kaybolmaz.

## 4. Yüzeyler

| Yüzey | Biçim | Nereden üretilir |
|-------|-------|------------------|
| Ana sayfa (canlı maç alanının altı) | kısa kayan şerit, en yeni biten maçlardan en fazla 6 alıntı | `scripts/generate-post-match-pages.mjs` → `addHomeStatementsMarquee` |
| Maç raporu sayfası (`mac-raporu/*`) | şerit (künyenin altı) + tam liste (kendi bölümü) | aynı script → `statementsBlocks` |
| Maç detay sayfası (`mac-detay.html`) | şerit + tam liste | `app.js` → `mdStatementsMarqueeHtml`, `mdStatementsSectionHtml` |

İşaretleme `scripts/lib/statementsView.mjs` içinde; istemci tarafı aynı kuralı
`app.js` içinde tekrarlar. Kural iki yerde yaşadığı için
`scripts/test-match-statements.mjs` ikisinin aynı zorunlu alanları ve aynı
bekleme metnini kullandığını doğrular — ön renderde elenen bir alıntıyı
hidrasyon geri basamaz.

## 5. Yeni açıklama nasıl eklenir?

1. Alıntıyı yayımlayan kaynağı bul (resmî kulüp açıklaması ya da güvenilir
   ulusal basın). Alıntıyı **birebir** kopyala.
2. İlgili maç kaydına `statements` dizisini ekle/genişlet.
3. `node scripts/test-match-statements.mjs` ile doğrula.
4. `npm run build` — şerit ve liste kendiliğinden üretilir.

Kaynağı gösterilemeyen bir söz eklenmez. Kaynak erişilemez durumdaysa (503,
paywall) alıntı **beklemede bırakılır**; hatırlanan bir cümle kaynak yerine
geçmez.

## 6. Bugünkü durum

`data/matches.json` içinde yalnızca `galatasaray-venezia-2026-07-27` kaydında
doğrulanmış açıklama var (Okan Buruk, 3 alıntı, Hürriyet). Diğer maçlar için
doğrulanabilir bir maç sonu açıklaması bulunamadı; o sayfalarda bölüm
"Kaynaklardan bekleniyor" gösteriyor. Bu bir eksiklik değil, kuralın
çalıştığının göstergesi.
