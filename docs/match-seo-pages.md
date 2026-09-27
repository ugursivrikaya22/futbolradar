# Her Maça Özel SEO Sayfası

Bu doküman "Her Maça Özel SEO Sayfası" sisteminin mimari kaydıdır: kalıcı
maç adresleri, üç hâlli sayfa (maç öncesi / canlı / maç sonrası), sitemap,
şema, iç bağlantı ve çalışma kuralları.

## Adres yapısı

| Yüzey | Adres | Dosya |
|---|---|---|
| TR maç sayfası | `/mac/fenerbahce-besiktas-5-eylul-2026` | `mac/fenerbahce-besiktas-5-eylul-2026.html` |
| EN maç sayfası | `/en/match/fenerbahce-besiktas-september-5-2026` | `en/match/fenerbahce-besiktas-september-5-2026.html` |
| TR hub | `/mac-takvimi` | `mac-takvimi.html` |
| TR ay arşivi | `/mac-takvimi/2026-09` | `mac-takvimi/2026-09.html` |
| EN hub | `/en/matches` | `en/matches.html` |
| EN ay arşivi | `/en/matches/2026-09` | `en/matches/2026-09.html` |

Uzantısız adresler `vercel.json` rewrite'larıyla dosyaya çözülür; canonical ve
hreflang her zaman uzantısız biçimi gösterir. Slug `<ev>-<deplasman>-<gün>-<ay>-<yıl>`
kalıbındadır ve Türkiye saatine göre güne bağlanır (`services/matchSeoPages.js`).

Aynı dizinde yaşayan eski hafta numaralı Süper Lig sayfaları
(`mac/<ev>-<dep>-2026-2027-rNN.html`) korunur; tarihi onaylanmış olanlar
"Canlı maç merkezi" kartıyla kalıcı sayfaya bağlanır.

## Kalıcılık: sicil

`data/match-seo-pages.json` sicildir. Bir maç ilk kez sicile girdiğinde slug'ı
yazılır ve **bir daha değişmez**: maç ertelense, sağlayıcı takvimi (3 gün geri /
35 gün ileri pencere) maçı düşürse ya da kaynak kayıt kaybolsa bile satır ve
sayfa kalır. Sicil her derlemede (`scripts/generate-match-seo-pages.mjs`)
güncellenir ve saatlik CI koşusuyla commit'e girer.

Aday kaynaklar ve öncelik: `fixture-calendar.json` (sağlayıcı) >
`matches.json` (editoryal) > `historical-match-archive.json` (arşiv) >
`super-lig-fixtures.json` (TFF). Durum geri gitmez (bitmiş maç bayat bir
"başlamadı" kaydıyla ezilmez); skor yalnızca durumu daha ileri ya da daha taze
kaynaktan alınır.

`data/match-seo-index.json` küçük çalışma zamanı dizinidir
(`af:<apiFootballId>`, `tsdb:<id>`, `id:<ev|dep|gün>` → slug). API
(`api/matches.js`) ve kürasyonlu liste (`mockProvider.curatedMatches`) bu
dizinden `matchPage` damgalar (editoryal `analysisPage` alanına dokunulmaz;
`matchReportService` raporu o yola yazar); sitenin tüm "bu maça git" bağlantıları
(`matchDetailPath`, `app.js#matchDetailHref`, takım maç sayfaları, lig sayfaları,
bugünün maçları) böylece kalıcı sayfaya gider.

## İndeks kuralı

Sicile yalnızca şu yarışmalar girer: Süper Lig, 1. Lig, Türkiye Kupası,
Şampiyonlar Ligi, Avrupa Ligi, Konferans Ligi, Premier League, La Liga,
Serie A, Bundesliga, Ligue 1 ve Türkiye A Millî Takımı maçları
(`INDEXABLE_COMPETITION_IDS`). İptal edilen veya ertelenen maçın sayfası
kalır ama `noindex,follow` olur ve sitemap'ten düşer; yeni tarih gelirse aynı
adres yeniden indekslenir.

Türkiye A Millî Takımı maçı, **yarışmadan bağımsız** olarak kabul edilir
(`isTurkiyeNationalMatch`) — millî takım her turnuvada oynar ve listeyi
turnuva turnuva büyütmek, bir sonraki eleme grubunda yine elle müdahale
demek olurdu. Muafiyet **A takımına özgüdür**: yarışma adı kadın ya da alt
yaş işareti taşıyorsa (`NON_SENIOR_NATIONAL_MARKERS`) kayıt millî maç
sayılmaz, çünkü sağlayıcı o takımları bazen "Türkiye" yazımıyla da gönderir
ve tek bir U21 kaydı A Millî Takım maçı gibi kalıcı sayfa açardı. "Kupa"
bilerek işaret listesinde **değil**: millî takım Dünya Kupası ve Avrupa
Şampiyonası oynar. Ayrıntı: [docs/milli-takim.md](./milli-takim.md).

Tabela künyesinde **VAR hakemi** ayrı bir satırdır (`varReferee`) ve
yalnızca veri varsa basılır: orta hakemle aynı satıra yazmak iki farklı
görevi tek olgu gibi göstermek olurdu, uydurma bir "açıklanmadı" iddiası da
yapılmaz.

İngilizce sayfada millî takım karşılaşmasının **ülke adı** İngilizce
gösterilir ("İtalya" → "Italy", `services/displayLabels.js#nationLabel`).
Değişen yalnızca GÖRÜNEN addır: slug, kimlik ve canlı eşleşme anahtarı
(`data-msp-home`) ham adı korur — yoksa istemci sağlayıcı kaydını maça
bağlayamazdı. Kulüp adı bu eşlemeye girmez.

## Üç hâl

`pageStateOf(entry, now)`:

| Hâl | Koşul | Title (TR) |
|---|---|---|
| `pre` | başlamadı ya da başlamaya <150 dk ve canlı sinyal yok | `X - Y Maçı Ne Zaman, Saat Kaçta, Hangi Kanalda?` |
| `live` | sağlayıcı canlı diyor **ve** skor okunabilir, kickoff +150 dk içinde | `X 1 - 0 Y Canlı Skor ve Maç Anlatımı` |
| `post` | FINISHED/AWARDED + nihai skor | `X 2-1 Y Maç Sonucu, Goller ve İstatistikler` |
| `pending` | kickoff +150 dk geçti, sonuç doğrulanmadı | `X - Y Maç Sonucu ve İstatistikler` (dürüst "doğrulanıyor" notu) |
| `postponed` / `cancelled` | durum | `X - Y Maçı Ertelendi / İptal Edildi` (noindex) |

Aynı çift aynı hâlde iki sayfa üretirse (lig + kupa) başlık tarih eki alır;
`scripts/test-seo-integrity.mjs` yinelenen başlığa izin vermez.

Bölümler veri varsa basılır; yoksa dürüst tek satır ("Henüz açıklanmadı",
"Kadrolar açıklandığında burada yayımlanır"). Saat, kanal, hakem, skor, kadro
asla tahmin edilmez. Yayın kanalı yalnızca `broadcast` alanından gelir
(TheSportsDB `strTVStation` / editoryal); sağlayıcı vermiyorsa "Henüz
açıklanmadı".

## Canlı güncelleme

`match-center.js` yalnızca maç sayfalarında yüklenir (app.js yüklenmez). Sayfa
`data-msp-query` (`fixtureId=<apiFootball>&date=...` ya da `id=<doğal id>`)
taşır; istemci `/api/match-detail` uç noktasını başlamaya 5 dk kala başlayıp
canlıyken 45 sn'de bir yoklar, maç bitince durur, sekme arka plandayken bekler.
Skor/dakika/durum/olaylar/istatistikler yalnızca sağlayıcı daha ileri bir
durum bildirdiğinde DOM'a yazılır; `document.title` canlı/bitiş şablonuna
döner, H1 ve canonical değişmez. Mevcut SSE canlı skor hub'ına ve
`app.js#initLiveMatchPolling` döngüsüne dokunulmaz.

`/api/match-detail` canlı maçta `no-store`, diğer hâllerde 30 sn CDN
önbelleğiyle yanıt verir (`api/_utils.js`); mock sağlayıcı sorguyu
`providerIds.apiFootball` ile de eşleştirir.

## SEO ve şema

Her sayfada benzersiz title, description, canonical, H1, OG/Twitter meta ve
`<!-- hreflang -->` bloğu (TR ↔ EN, x-default TR). `data/en-route-map.json`
satırları `match-seo` türüyle ve `trUrl`/`enUrl` alanlarıyla kaydedilir;
`inject-hreflang.mjs` bu alanları kullanır (`services/i18n.js#pairUrl`).

JSON-LD: `SportsEvent` (name, url, startDate `+03:00`, eventStatus —
bitmiş maçta yazılmaz —, location yalnızca gerçek stat varsa, homeTeam /
awayTeam / competitor `SportsTeam` + takım sayfası URL'si, superEvent
yarışma, publication `BroadcastEvent` yalnızca kanal doğrulanmışsa) ve
`BreadcrumbList` (Ana Sayfa → Maç Takvimi → Yarışma → Maç).

## Sitemap

`sitemap.xml` girdileri (TR ve EN, `xhtml:link` alternate'leriyle) her
derlemede yeniden yazılır; `lastmod` içerik hash'iyle
(`scripts/lib/sitemapFreshness.mjs`) yalnızca sayfa gerçekten değişince
ilerler. `changefreq`/`priority`: canlı `hourly/0.9`, 7 gün içindeki maç
`daily/0.8`, bitmiş maç `monthly/0.7→0.6`. Bitmiş maçlar sitemap'ten
**çıkarılmaz**. Eski üreticiler (`generate-match-pages.mjs`,
`generate-en-match-pages.mjs`) yalnızca kendi hafta numaralı girdilerini
değiştirir.

## İç bağlantı

Maç sayfası → takım profili (`takimlar/<slug>`, diğer Süper Lig takımları için
`takim-detay.html?team=`), takım fikstürü (`<slug>-maclari.html`), takım puan
durumu, lig puan durumu (`<lig>-puan-durumu`), lig sayfası (`lig/<id>.html`),
oyuncu sayfaları (`oyuncular/<id>.html`, yalnızca yayın kapısından geçen
oyuncular), bugünün maçları, hub. Hub → ay sayfaları → her maç. Menüye
"Maç Takvimi" (TR) / "Match Calendar" (EN) eklendi.

## Derleme ve test

- Tam derleme: `generate-match-seo-pages.mjs` `generate-post-match-pages.mjs`
  sonrasında, `prerender-core-pages.mjs` öncesinde koşar (`package.json`).
- Saatlik koşu: `scripts/run-scheduled-update.mjs` → `render-match-seo-pages`.
- Test: `node scripts/test-match-seo-pages.mjs` (senaryolar A–J), ayrıca
  `test-i18n`, `test-seo-integrity`, `test-sitemap-freshness`, `npm run lint`.
