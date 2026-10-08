# Maç bazlı site içi bildirimler

## Akış ve maliyet

`site.js`, site genelinde `live-follow.js` dosyasını yükler. Tercihler yalnızca
tarayıcının localStorage alanındadır; üyelik, ses, bildirim izni veya sunucuya
bildirim kaydı yoktur. Eski `radar-fan.js` maç takip düğmesi artık push aboneliği
açmaz; aynı alanı yeni site içi modül kullanır. Ayrı favori takım/PWA özelliği
bu değişikliğin kapsamı dışındadır.

Modül mevcut `futbolradar:score-snapshot` ve `futbolradar:match-detail` olaylarını
dinler; sağlayıcı API'sine, SSE uç noktasına veya veritabanına istek göndermez.
Sayfa değişince de çalışmak için, takip varsa ortak statik `matches.json`,
`fixture-calendar.json` ve `super-lig-fixtures.json` dosyalarını 60 saniyede bir
okur. Maç sayısı istek sayısını değiştirmez. Sayfa gizliyken maç dosyaları
sorgulanmaz. Her istek 10 saniyede zaman aşımına uğrar.

Bu yaklaşım var olan veri toplama sıklığını artırmaz. Statik verinin yayın
aralığı canlı teslimat için yetersizse, bildirim motoru bunu gideremez.
120 saniyeden eski veya güncelliği doğrulanamayan kaynak başlangıç verisi
olarak alınır; bildirim oluşturulmaz ve panel gecikmeyi belirtir. Mevcut
sayfa akışı taze veri sağladığında aynı motor ek istek olmadan çalışır.
Eski statik görüntü yeni canlı görüntünün üzerine yazılmaz.

## Kimlik, tekrar ve kapsam

Seçimler maç kimliğiyle tutulur; aynı takımların farklı maçları eşleştirilmez.
Mevcut kalıcı maç sayfası sicilinden derlemede üretilen kimlik eşlemeleri,
fikstür ve detay kimliklerini birleştirir; yalnızca takip varken sayfada bir kez
okunur. Belirsiz eşlemeler atılır. Kaynak açık API-Football fixture kimliği sağlarsa, onunla kayıt kimliği arasında
takım adlarına bakmadan eşleme yapılır. Fikstür ve detay üreticileri maç
kimliğini HTML'e yazar. İngilizce dinamik kartlar da aynı alanları yayınlar.

İlk görüntü, yeniden açılan sayfa ve iki dakikadan uzun veri boşluğu sessiz
başlangıç oluşturur. Sağlayıcı olay kimliği önceliklidir; yoksa tür, dakika,
uzatma, oyuncu ve takım kimliklerinden anahtar oluşturulur. Son 600 gösterim
anahtarı localStorage'da tutulur. Eksik olay listesinde eski kimlikler korunur.
Geçmiş dakikalara sonradan eklenen olaylar yeni olay sayılmaz.

Desteklenen açık kayıtlar: gol, gol iptali, kırmızı kart, penaltı kararı,
penaltı golü ve kaçan penaltı. Durum geçişlerinden başlangıç, devre arası ve
kesin bitiş desteklenir. Genel VAR incelemesi gol iptali sayılmaz. Sadece skor
değişmişse “Skor güncellendi”; skor azalmışsa “Skor düzeltmesi” denir.
Golcü adı sadece olayda açıkça varsa yazılır. Sarı kart, değişiklik, genel VAR
incelemesi ve kaynağın sağlamadığı olaylar bildirilmez.

En fazla iki kart görünür, dört olay sırada kalabilir; sırada 20 saniyeyi aşan
olay atılır. Kartlar yaklaşık 7 saniyede kapanır; klavye odağı karttayken süre
uzatılır. Takip kapatılınca görünür ve bekleyen kartlar temizlenir.
Kesin bitiş ilk görüldükten 24 saat sonra seçim kaldırılır; erteleme ve
yarıda kalma bitiş sayılmaz. Tercihler en fazla 20 maçı tutar.

## Merkezi kapatma

`data/match-notifications.json` içindeki `enabled` değerini `false` yapıp
normal yayın sürecini çalıştırın. Dosyanın public kopyası derlemede eşitlenir.
Açık sekmeler en geç sonraki 60 saniyelik kontrolde görünür/sıradaki kartları
temizler. Kullanıcılar kayıtlı seçimlerini yine kaldırabilir.

## Doğrulama

- `node --test tests/match-notifications.test.cjs`: ilk görüntü, tekrar,
  iptal/düzeltme, eski olay, uzatma kimliği, penaltı, kırmızı kart, durum ve erteleme.
- `node scripts/test-match-notifications-browser.cjs`: tarayıcıda sentetik
  A/B maçları, bağımsız seçim, sıra temizleme, yenileme/rota, TR/EN, 7 saniye,
  mobil engeller, merkezi kapatma ve mevcut ortak akış. Yeni API isteği yokluğu
  ağ kayıtlarıyla doğrulanır. Test verisi yalnızca test sunucusunun belleğindedir.
- Playwright kurulu değilse `PLAYWRIGHT_MODULE` mevcut paketin tam yolunu alır.
- Gerçek sayfalarda ana sayfa, fikstür ve maç detayı düğmeleri ayrıca kontrol edilir.
  Canlı gol teslimi ancak gerçek, taze sağlayıcı olayıyla doğrulanabilir;
  sentetik testler bunun yerine geçti diye raporlanmamalıdır.
