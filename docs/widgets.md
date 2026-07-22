# FutbolRadar Widget'ları

Widget özelliği ana sitede buton olarak açılmaz. Yayıncı, `FEATURE_WIDGETS=true` kararı ve kullanım koşulları kontrolünden sonra aşağıdaki iframe'leri kendi sayfasına ekleyebilir.

## Günün Maçları

```html
<iframe
  src="https://www.futbolradar.com/widgets/gunun-maclari.html?theme=dark"
  title="FutbolRadar Günün Maçları"
  loading="lazy"
  width="100%"
  height="640"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

## Türk Takımları Avrupa'da

```html
<iframe
  src="https://www.futbolradar.com/widgets/turk-takimlari-avrupada.html?theme=dark"
  title="FutbolRadar Türk Takımları Avrupa'da"
  loading="lazy"
  width="100%"
  height="640"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

## Parametreler

- `theme=dark|light`: Widget renk temasını seçer.
- `league=super-lig`: Maçları canonical turnuva kimliğine göre süzer.
- `team=Fenerbahçe`: Ev veya deplasman takım adına göre süzer.
- `status=live|finished|upcoming`: Durum filtresini uygular.

Parametre değerleri yalnızca istemci filtrelemesinde ve aynı origin API isteğinde kullanılır. HTML olarak sayfaya yazılmaz.

## Cache ve güncellik

- Maç API yanıtı CDN'de 60 saniye cache'lenir ve 180 saniye stale-while-revalidate kullanır.
- Widget üzerinde veri durumu görünür; provider hatası “maç yok” olarak sunulmaz.
- Kanal verisi doğrulanmamışsa yayın yokmuş gibi gösterilmez.

## Güvenlik ve gizlilik

- Widget yalnızca HTTPS sayfalarda iframe olarak kullanılmalıdır.
- Gizli API anahtarı istemciye gönderilmez.
- Widget HTML'ine GA4 etiketi enjekte edilmez ve ek takip script'i yüklenmez.
- Kaynak bağlantısı görünürdür ve gizli backlink üretilmez.
# Production security note

Widgets are disabled by default. Current security headers only allow framing on
the FutbolRadar origin. Before third-party publishing is enabled, widgets must
move to a separate host or use an explicit allowlist in `frame-ancestors`.
