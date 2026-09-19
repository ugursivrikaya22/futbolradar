# Ana sayfa maç vitrini (featured match spotlight)

> **DURUM (2026-09-16):** Sistem açık ve yapılandırmadaki kulüp **Beşiktaş**.
> `featured-match-spotlight` adımı `scripts/lib/postprocessChain.mjs`
> içindeki `POSTPROCESS_CHAIN`e eklendi; saatlik güncelleme de tam derleme
> de aynı zinciri koştuğu için kutu kendiliğinden açılır ve kapanır.

Bir kulübün maçı, maçtan **48 saat önce** ana sayfanın en üstünde açılır;
maç öncesi, maç sırasında ve maç sonrasında **aynı kutuda** kalır ve maçın
**gerçek bitiş düdüğünden tam 2 saat sonra** ana sayfadan düşer.

Vitrinin bağlandığı maç sayfası **kalıcıdır**. Kutu kapandıktan sonra da
`/mac/<slug>` ve `/en/match/<slug>` aynı adreste, `index,follow` olarak
yayında kalır; "maç sonucu", "golleri", "maç özeti" gibi maç sonrası
aramalardan trafik toplamaya devam eder. Bu betik maç sayfasını **ne siler,
ne `noindex` yapar, ne de yönlendirir** — yalnızca ana sayfadaki *geçici
öne çıkarmayı* yönetir.

## Parçalar

| Dosya | İş |
| --- | --- |
| `data/featured-match-spotlight.json` | Yapılandırma: kulüpler, pencere, bekleme süresi. |
| `data/featured-match-spotlight-state.json` | **Üretilir.** Gözlenmiş bitiş düdüğü damgaları. |
| `services/featuredMatchSpotlight.js` | Seçim ve yaşam döngüsü (saf mantık, test edilebilir). |
| `scripts/lib/featuredMatchSpotlight.mjs` | İki dilli işaretleme (kutu + şerit) — tek kaynak. |
| `scripts/generate-featured-match-spotlight.mjs` | Enjeksiyon: ana sayfa, takım sayfası, lig sayfası. |
| `featured-match-spotlight.css` / `.js` | Sunum + istemci (son kullanma damgası, canlı skor). |
| `scripts/test-featured-match-spotlight.mjs` | Sözleşme testleri (`npm run test:featured-match`). |

## Yapılandırma

```json
{
  "enabled": true,
  "teams": ["Beşiktaş"],
  "openBeforeHours": 48,
  "dwellAfterFinishMinutes": 120,
  "assumedDurationMinutes": 150
}
```

`teams` listesi değiştirilerek sistem **başka bir kulübe** (ya da birden çok
kulübe) çevrilir; kod hiçbir yerde kulüp adına bağlı değildir. Aynı anda
birden çok aday varsa sıra: canlı → başlıyor → yaklaşan → ertelenmiş →
biten; eşitlikte başlama saatine yakınlık kazanır.

`enabled: false` yapıldığında blok bir sonraki koşuda sökülür.

## 2 saatlik sayaç gerçek düdükten başlar

"Başlama saati + 2 saat" yanlış bir kısayoldur: uzatmaya giden, devre arası
uzayan ya da ertelenen maçta kutu erken düşer. Bitiş anı bu yüzden
**sağlayıcıdan gözlenir**:

1. **Gözlenmiş damga.** Kayıt ilk kez `FINISHED`/`AWARDED` görüldüğünde o an
   `data/featured-match-spotlight-state.json` içine yazılır ve **bir daha
   değişmez** — ikinci bir "bitti" bildirimi sayacı yeniden başlatamaz.
2. **Sağlayıcının güncelleme damgası.** Gözlem yoksa (ör. ilk koşu maç
   bittikten sonra yapıldıysa) ve damga makul aralıktaysa (başlama saatinden
   sonra, en çok 6 saat içinde) kullanılır.
3. **Tavan.** Hiçbiri yoksa `kickoff + assumedDurationMinutes`. Bu bir
   iddia değil, kutunun sonsuza kadar açık kalmasını önleyen sınırdır.

Maç **ertelenirse** ya da kayıt yeniden canlıya dönerse damga silinir;
sayaç gerçek düdüğü bekler. Ertelenen maç vitrinde kalır ve "ertelendi"
der — okuyucunun o an aradığı bilgi budur.

### Derlemeler arası kesinlik

Derleme saatlik koşuyor, yani sunucu bloğu en geç bir saat içinde söker.
Kutunun **tam** 2 saatte düşmesi için işaretleme kendi son kullanma damgasını
taşır (`data-fms-expires-at`) ve `featured-match-spotlight.js` o anda kutuyu
DOM'dan kaldırır. Maç bitmeden gerçek düdük bilinmediği için damga o sırada
tavan değerini taşır; sağlayıcı bitişi bildirince bir sonraki koşu damgayı
gerçek düdüğe çeker.

## Nereye basılır

| Yüzey | Blok | Çapa |
| --- | --- | --- |
| `index.html`, `en/index.html` | Büyük kutu | `#hero-canli-skor` bölümünün ardı |
| `<takım>-maclari.html`, `en/team/<takım>.html` | İnce şerit | Sayfa yolu (breadcrumb) ardı |
| `lig/<competitionId>.html` + İngilizce puan durumu eşi | İnce şerit | Sayfa yolu ardı |

Vitrin değişince eski şeritler taranıp sökülür; başka bir takım/lig
sayfasında geçen maçın şeridi kalmaz.

**Adres türetilmez, sicilden okunur.** Kutudaki bağlantı
`data/match-seo-pages.json` sicilinden gelir; o sicili maç sayfalarını
gerçekten yazan üretici (`scripts/generate-match-seo-pages.mjs`) tutuyor.
Burada ikinci bir slug kuralı yazmak, üretici bir adres değiştirdiğinde ana
sayfayı 404'e bağlamak olurdu.

## Kutuda ne yazar, ne yazmaz

* **Skor yalnızca okunabilir skor varken** basılır. Maç öncesi ve
  "saat geçti ama sağlayıcı sessiz" bandında skor satırı gizlidir; tahmini
  skor hiç yazılmaz.
* **Muhtemel 11 / ilk 11 ayrımı** maç sayfasının sözleşmesidir; kutu
  yalnızca oraya yönlendirir ve maç öncesinde "kesin kadrolar açıklandığında
  ilk 11'ler otomatik olarak yerini alır" der.
* **Canlılık sinyali** rozette ve başlıkta taşınır (`CANLI`, `X-Y · canlı
  skor`). **Adres hiçbir evrede değişmez.**
* Stadyum, hakem ve yayın satırları veri yoksa hiç basılmaz.

## Canlı güncelleme

`featured-match-spotlight.js`, maç sayfasındaki `match-center.js` ile aynı
sözleşmeyi izler: `/api/match-detail` yalnızca gerektiğinde yoklanır
(başlamaya bir saatten çok varsa hiç, maç öncesi 120 sn, canlıyken 45 sn,
bitince durur, sekme arka plandayken bekler); sağlayıcı **daha ileri** bir
durum bildirmedikçe DOM'a dokunulmaz; skorsuz bir "canlı" iddiası çizilmez;
bitmiş kutu geri gitmez.

Sorgu kimliği takvim kaydından gelir. Kimlik yoksa sorgu hiç yazılmaz ve
istemci yoklama yapmaz — uydurma bir kimlikle yanlış maçı çizmektense hiç
çizmemek doğru davranıştır.

## Maç sayfası tarafı

Vitrin maç sayfasını değiştirmez; maç sayfasının kendi SEO sözleşmesi
`docs/match-seo-pages.md` içinde. Bu iş kapsamında oradaki bölüm başlıkları
**maçın adını taşıyacak** biçimde genelleştirildi
(`scripts/lib/matchSeoPage.mjs#fixtureHeading`): "Maç istatistikleri" yerine
"Beşiktaş - Marseille maç istatistikleri". Kural tek yerde ve **tüm** maç
sayfaları için aynıdır; kulübe özel istisna yoktur. Ayrıca skor okunabilir
olduğunda SSS'ye "maçı kaç kaç?" (canlı) / "maç sonucu ne oldu?" (bitmiş)
sorusu eklenir — skor yoksa soru hiç eklenmez.

## Elle koşturma

```bash
npm run generate:featured-match     # vitrini yaz / kaldır
node scripts/generate-featured-match-spotlight.mjs --check   # CI kapısı
npm run test:featured-match         # sözleşme testleri
```
