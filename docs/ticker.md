# Ana sayfa kayan yazısı (Transfer Radarı)

Ana sayfada üst şeritteki **Son Dakika** bandının hemen ALTINDA, Canlı
Skorlar bandının üstünde duran kayan bant (Kasım 2026'ya kadar adı
"Transfer Gündemi"ydi ve sayfanın altındaydı; Eylül 2026'da kaldırılan eski
Transfer Radarı bandının yerine bu bileşen kullanılıyor). Son Dakika
bandından (`data/news-ticker.json`, [news-ticker.md](news-ticker.md)) ayrıdır:

| | Son Dakika bandı | Transfer Gündemi (bu belge) |
|---|---|---|
| Veri | `data/news-ticker.json` (+ maç/haber/transfer kaynakları) | `data/ticker.json` |
| Kim yazar | Saatlik otomatik işler + editör | **Yalnızca editör**, otomatik iş yazmaz |
| Raf ömrü | 72 saat (otomatik silinir) | `expiresAt` ne derse o |
| Nerede | Her sayfa | Yalnızca ana sayfa |

Haftalarca geçerli kalan notlar (tescil dönemi tarihleri, FIFA tescil
yasakları vb.) Son Dakika bandına konursa 72 saat sonra otomatik silinir; bu
yüzden ayrı dosya.

## Yeni öğe eklemek: `data/ticker.json` içine bir satır

```json
{
  "id": "eyupspor-fifa-tescil-yasagi-2026-10-15",
  "text": "FIFA, Eyüpspor'a 15 Ekim 2026'dan geçerli 3 dönem transfer tescil yasağı getirdi",
  "url": "/transfer-donemi-2026-27#yasaklar",
  "date": "2026-10-17T00:29:00+03:00",
  "category": "transfer",
  "sourceUrl": "https://knowledge.fifa.com/registration-bans",
  "sourceName": "FIFA",
  "expiresAt": "2026-12-31T23:59:59+03:00"
}
```

`items` dizisine ekleyin, `npm run test:home-ticker` çalıştırın, commit edin.
Bant bir sonraki derlemede (en geç saatlik CI koşusunda) güncellenir.

### Alan kuralları

| Alan | Zorunlu | Kural |
|---|---|---|
| `id` | evet | Tekil; yalnızca küçük harf, rakam, tire |
| `text` | evet | En fazla 160 karakter. Kaynağın söylediğinden fazlasını yazmayın |
| `url` | hayır | **Site içi** olmalı (`/...` ya da `https://www.futbolradar.com/...`). Dış site buraya yazılmaz |
| `date` | evet | Saat dilimli ISO 8601 (`2026-10-17T00:29:00+03:00`). Gelecekte olamaz |
| `category` | evet | `transfer`, `mac`, `haber` ya da `iddia` (transfer söylentisi) |
| `sourceUrl` | **evet** | `http(s)`; alan adı `services/sourceLinks.js` beyaz listesinde olmalı (TFF, FIFA, kulüp siteleri, AA, NTV Spor, Fanatik, Hürriyet, beIN…) |
| `sourceName` | **evet** | Künyede görünen ad ("TFF", "FIFA", "Fanatik") |
| `breaking` | hayır | `true` ise öğe kırmızı zemin + beyaz kalın "Son dakika" vurgusuyla ve listenin başında basılır (hafif nabız; hareket azaltmada kapalı). Yalnızca resmî kaynaklı acil gelişmeler için; `expiresAt` zorunlu |
| `expiresAt` | hayır | Saat dilimli ISO 8601. Bu andan sonra öğe derlemede ve tarayıcıda gizlenir |

### Söylentiler (`category: "iddia"`)

- Metin söylenti diliyle yazılır ve "iddia" sözcüğünü taşır, kaynak adı
  metinde geçer: "Fanatik'in iddiasına göre …", "NTV Spor'un Sky Sports'a
  dayandırdığı iddiaya göre …". Kesin dille yazılmış söylenti reddedilir.
- `expiresAt` zorunlu ve en fazla `date` + 72 saat (Son Dakika bandıyla aynı
  tazelik penceresi). `breaking` kullanılamaz.
- Bantta sarı "İddia" etiketiyle basılır.
- Taraftar hesapları, X paylaşımları, Wikipedia/Transfermarkt kaynak değildir;
  kaynak beyaz listedeki bir haber sitesinin sayfası olmalıdır.

**Kaynaksız öğe yoktur.** Kuralı bozan öğe banda girmez, derleme uyarı basar
ve `scripts/test-home-ticker.mjs` kırmızı yanar. `scripts/test-source-links.mjs`
de `data/ticker.json`'daki her dış alan adını beyaz listeye karşı tarar.

## Nasıl çalışır

- `scripts/prerender-core-pages.mjs` → `homeTickerSlot()` geçerli ve süresi
  dolmamış öğeleri (en yeni önce, en fazla 16) seçip `index.html`'deki
  `<!-- prerender:home-ticker:start/end -->` yuvasına basar. Öğe yoksa yuva
  **boş** kalır, bant hiç görünmez.
- İstemci JSON çekmez: veri HTML'in içinde gelir. `home-ticker.js` yalnızca
  Durdur/Devam düğmesini bağlar ve sayfa açıkken süresi dolan öğeyi gizler.
- `sw.js` bu dosyaların hiçbirini yakalamaz (yalnızca canlı skor sayfaları,
  `page.css`/`site.js`/`app.js` ve üç API ucu); ana sayfa HTML'i ağdan gelir,
  bayat bant riski yoktur. `sw.js` değiştirilmedi.
- Erişilebilirlik: fare üstündeyken ve klavye odağında durur; görünür
  "Durdur" düğmesi (`aria-pressed`); `prefers-reduced-motion: reduce`
  altında kaymaz, düz liste olur; döngü kopyası `aria-hidden` ve sekme sırası
  dışındadır. Yükseklik CSS'te rezerve (`min-height: 44px`) ve bant derleme anında
  HTML'e basıldığı için sayfanın üstünde olsa da düzen kayması üretmez.

## Dosyalar

- `data/ticker.json` — veri
- `services/homeTicker.js` — doğrulama ve seçim
- `scripts/lib/homeTicker.mjs` — işaretleme
- `home-ticker.css`, `home-ticker.js` — görünüm ve istemci davranışı
- `scripts/test-home-ticker.mjs` — testler (`npm test` zincirinde)

## Kalıcı sayfa: `/transfer-donemi-2026-27`

Bandın transfer öğeleri, aynı doğrulanmış bilgileri tablo hâlinde taşıyan
kalıcı sayfaya bağlanır (tescil dönemi tarihleri, FIFA tescil yasağı
listesindeki Türk kulüpleri, Hatayspor notu, SSS).

- Veri: `data/transfer-donemi-2026-27.json` (her satırda kaynak; FIFA listesi
  tarihli anlık görüntüdür, güncellerken `bans.snapshotAt` ve `dateModified`
  değiştirin).
- Üretici: `scripts/generate-transfer-period-page.mjs` (postprocess zincirinde;
  sitemap girdisini de o ekler). Temiz adres `vercel.json` rewrite'ı ile
  `transfer-donemi-2026-27.html` dosyasına gider; `.html` adresi 308 ile temiz
  adrese yönlenir.
- Test: `scripts/test-transfer-period-page.mjs`.
