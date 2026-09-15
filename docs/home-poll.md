# Ana sayfa tahmin anketi

> **DURUM (2026-09-14):** Ana sayfa anketi yeniden **açık** ve artık yalnız
> değil: her anketin kendi paylaşılabilir sayfası (`/anket/<slug>`,
> `/en/poll/<slug>`), oy sonrası paylaşım paneli, tarayıcıda üretilen sosyal
> kartı (1080×1080 ve 1080×1920) ve UTM'li paylaşım bağlantıları var.
> `home-poll` ve `poll-pages` adımları `scripts/lib/postprocessChain.mjs`
> içindeki `POSTPROCESS_CHAIN`e geri eklendi, `scripts/generate-en-pages.mjs`
> İngilizce ana sayfaya kendi kopyasını basıyor.

Ana sayfanın en büyük etkileşimi: okuyucuya sezon hakkında bir soru sorar,
oyları toplar ve canlı yüzdeleri lider vurgusuyla gösterir. Türkçe ve
İngilizce sürümler **birebir aynı** ankettir; yalnızca dil değişir — oylar
da **tek havuzda** toplanır, çünkü dil başına ayrı havuz aynı soruya iki
farklı "topluluk kararı" üretirdi.

Anket kutusu ana sayfada **canlı skor bölümünün (`#hero-canli-skor`) hemen
altında** durur (`scripts/inject-home-poll.mjs` hero apankoruna yazar;
İngilizce tarafta `generate-en-pages.mjs#homePollSection()` aynı konuma).

## Ne iddia ediyor, ne iddia etmiyor

Maçın adamı anketi olmuş bir maç hakkındaydı; bu anket **gelecek**
hakkında. Sonuç bir veri iddiası değil, topluluğun beklentisidir ve ekranda
da öyle yazar:

> Bu bölüm okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrıdır.

Ama **seçenek listesi yine bir veri iddiasıdır**: "Trendyol Süper Lig
kulüpleri" başlığı altında bastığımız her ad, o kulübün gerçekten bu sezon
o ligde olduğunu söyler. Bu yüzden liste elle yazılmaz — `data/teams.json`
içindeki `isCurrentSuperLigTeam` bayrağından türetilir. Lig kadrosu
değişince (küme düşme/çıkma) anket kendiliğinden doğru olur.

## Yeni anket planlamak (admin)

Kod değişikliği **gerekmez**. `data/home-polls.json` → `polls` dizisine bir
nesne eklemek yeterlidir:

```json
{
  "id": "super-lig-2026-2027-sampiyon",
  "type": "champion",
  "surface": "home",
  "slug": {
    "tr": "super-lig-sampiyonu-2026-27",
    "en": "super-lig-champion-2026-27"
  },
  "startsAt": "2026-08-14T00:00:00+03:00",
  "endsAt": "2026-12-15T00:00:00+03:00",
  "optionSource": "super-lig-teams",
  "question": {
    "tr": "Sence 2026–27 Süper Lig şampiyonu kim olacak?",
    "en": "Who will win the 2026–27 Turkish Süper Lig?"
  },
  "subtitle": { "tr": "Okuyucu tahmini.", "en": "A reader prediction." }
}
```

| Alan | Zorunlu | Ne yapar |
|---|---|---|
| `id` | ✅ | Oyların toplandığı anahtar. Benzersiz olmalı ve **asla değişmemeli** (değişirse toplanmış oylar kaybolur). |
| `startsAt` / `endsAt` | ✅ | Anketin penceresi. Ana sayfa anketinde aralarında **en az 14 gün** olmalı. |
| `question.tr` / `question.en` | ✅ | Soru. **İki dil de zorunlu.** |
| `slug.tr` / `slug.en` | ➖ | Anket sayfasının adresi (`/anket/<slug.tr>`, `/en/poll/<slug.en>`). Verilirse **iki dilde de** olmalı; verilmezse kimlikten türetilir. |
| `surface` | ➖ | `"home"` (varsayılan) ya da `"match"`. Aşağıda. |
| `matchId` | ⚠️ | `surface: "match"` ise **zorunlu**; `data/matches.json` içindeki maç kimliği. |
| `subtitle` | ➖ | Verilirse iki dilde de olmalı. |
| `share` | ➖ | Ankete özel paylaşım metni (aşağıda). |
| `optionSource: "super-lig-teams"` | ➖ | Seçenekleri güncel Süper Lig kulüplerinden otomatik doldurur. |
| `optionSource: "match-outcome"` | ➖ | Seçenekleri maç kaydından türetir: ev sahibi / beraberlik / deplasman. |
| `options` | ➖ | Elle seçenek listesi (aşağıda). |

### Kulüp dışı anketler

"Sezonun en iyi transferi / teknik direktörü / oyuncusu kim olur?" gibi
sorularda `optionSource` yerine `options` yazılır:

```json
"options": [
  { "id": "ornek-oyuncu", "label": { "tr": "Oyuncu Adı", "en": "Player Name" }, "team": "Galatasaray" }
]
```

`team` verilirse kulüp arması aynı kuralla çözülür; verilmezse seçenek
armasız görünür (bir teknik direktör için kulüp arması zorunlu değildir).

### Yayına girmeyen kayıtlar

Kayıt **elenir** ve nedeni derleme günlüğüne yazılır (`logRejected`):

- pencere yüzeyin alt sınırından kısa (ana sayfa 14 gün, maç 1 saat),
- `endsAt` `startsAt`ten önce,
- soru tek dilde,
- `slug` tek dilde yazılmış,
- ikiden az seçenek,
- seçenek kimlikleri yinelenmiş,
- `surface: "match"` ama `matchId` yok,
- penceresi **aynı yüzeydeki** önceki anketle çakışıyor (sonraki elenir),
- adresi (`slug`) başka bir anketle aynı (sonraki elenir).

Dosyadaki `_sample` anahtarı yalnızca alan şeklini gösterir ve servis
tarafından **hiç okunmaz**.

## Yüzeyler: ana sayfa anketi ve maç anketi

Her anketin bir **yüzeyi** vardır (`surface`) ve yüzey iki şeyi belirler:
pencerenin alt sınırını ve çakışma denetiminin kapsamını.

| Yüzey | Nerede | Pencere alt sınırı | Çakışma |
|---|---|---|---|
| `home` (varsayılan) | Ana sayfa + anket sayfası | 14 gün | Aynı anda **tek** anket |
| `match` | Bir maçın sayfası | 1 saat | **Maç başına** tek anket |

Ayrım olmadan tek bir takvim listesi, aynı saatte açık olan bir maç anketi
ile sezon anketini "çakışıyor" sayıp birini eler ve ana sayfa anketi bir maç
yüzünden kaybolurdu. Maç anketi **ana sayfada gösterilmez**: oraya giren
okuyucu sezon sorusu beklerken bir maç sorusu bulurdu.

### "Bu maçı kim kazanır?"

```json
{
  "id": "gs-fb-2026-10-derbi-kazanan",
  "type": "match-winner",
  "surface": "match",
  "matchId": "galatasaray-fenerbahce-2026-10-25",
  "optionSource": "match-outcome",
  "slug": { "tr": "gs-fb-derbi-kim-kazanir", "en": "gs-fb-derby-who-wins" },
  "startsAt": "2026-10-23T12:00:00+03:00",
  "endsAt": "2026-10-25T19:00:00+03:00",
  "question": { "tr": "Bu maçı kim kazanır?", "en": "Who wins this match?" },
  "share": {
    "voted": {
      "tr": "Ben {team} kazanır dedim. Sen ne diyorsun? ⚽",
      "en": "I said {team} wins it. What do you say? ⚽"
    }
  }
}
```

`optionSource: "match-outcome"` üç seçeneği maç kaydından türetir: ev sahibi,
beraberlik, deplasman. Kulüp armaları aynı kuralla çözülür; **beraberliğin
arması yoktur ve olmamalıdır** — bir sonucu kulüp armasıyla göstermek, o
sonucu bir kulübe ait gibi okutur. Maç kaydı bulunamazsa seçenek üretilmez
ve kayıt elenir: var olmayan bir maç için "Galatasaray / Beraberlik / ?"
basmaktansa anket hiç çıkmamalıdır.

Her maç anketi de kendi paylaşılabilir sayfasını alır (`/anket/<slug>`).

## Ankete özel paylaşım metni

Varsayılan paylaşım şablonları (`services/homePoll.js` → `SHARE_COPY`) her
anket için geçerli olmak zorunda, bu yüzden bilinçli olarak yalındır
("{team} dedim"). Türkçede kulüp adına ek getirmek ses uyumu ister
("Galatasaray'ı", "Fenerbahçe'yi", "Gençlerbirliği S.K.") ve bunu kod içinde
kestirmeye çalışmak 18 kulübün birkaçında bozuk bir cümleyle biterdi — bozuk
Türkçe bir paylaşım metni, sitenin sesini paylaşan kişinin ağzına koyar.

Çözüm kodda değil veride: anket kaydı kendi cümlesini yazabilir.

```json
"share": {
  "voted": {
    "tr": "Ben 2026–27 Süper Lig şampiyonu olarak {team} dedim! ⚽ FutbolRadar anketinde {team} şu anda %{percent} oy alıyor. Sen de oyunu kullan 👇",
    "en": "I picked {team} to win the 2026–27 Süper Lig! ⚽ {team} is on {percent}% in the FutbolRadar poll. Cast your vote 👇"
  },
  "leader": { "tr": "…", "en": "…" }
}
```

| Anahtar | Ne zaman kullanılır | Yer tutucular |
|---|---|---|
| `voted` | Okuyucu oy vermiş ve sayım var | `{team}`, `{percent}` |
| `votedWithoutResult` | Oy vermiş ama sayım okunamıyor | `{team}` |
| `leader` | Oy vermemiş, ankette lider var | `{team}`, `{percent}` |
| `plain` | Ne oy ne sayım var | `{question}` |

Verilmeyen alan varsayılanda kalır. **Yüzde uydurulmaz:** sayım yoksa
yüzdesiz şablon seçilir; "%0 ile lider" demek veride olmayan bir sayı iddia
etmektir.

## Anket sayfası: paylaşılan bağlantının gittiği yer

Her anketin kendi adresi var:

```
/anket/super-lig-sampiyonu-2026-27
/en/poll/super-lig-champion-2026-27
```

Sayfayı `scripts/generate-poll-pages.mjs` üretiyor (zincirde `poll-pages`
adımı), temiz adresi `vercel.json` rewrite'ı karşılıyor. Soru `<h1>`,
alt başlık ve **seçeneklerin tamamı** derleme anında HTML'e basılıyor: arama
motoru ve paylaşım önizlemesi JavaScript'i beklemiyor.

- Sayfa **bu** anketi ister (`/api/home-poll?pollId=…`), "şu an açık olanı"
  değil — paylaşılan bağlantı, anket kapanıp sıradaki açıldığında başka bir
  soruyu göstermemeli.
- **Başlamamış** anketin sayfası da üretilir (adres paylaşılmış olabilir,
  404 vermemeli) ama `noindex` ile ve site haritasına girmeden: içinde henüz
  sonuç yok.
- Takvimden düşen anketin sayfası **silinir**; kendini hâlâ yayında sanan
  bir sayfa bırakmak, oy alamayan bir form göstermek demekti.

### Open Graph

Her sayfa `og:title` (sorunun kendisi), `og:description`, `og:url`,
`og:image`, `twitter:card` (`summary_large_image`), `twitter:title`,
`twitter:description` ve `twitter:image` bildirir. Görsel
`assets/og-poll.png` — FutbolRadar markalı, **sabit** bir anket görseli.

**Sonuca göre değişen** bir OG görseli üretmek isteği karşılayan bir
sunucusuz işlev ister ve Vercel Hobby planındaki 12 işlev sınırı dolu
(gerekçe `server/homePollRoute.js` başlığında). Sonuca özel görsel yine de
var — ama tarayıcıda, oy verildikten sonra (aşağıda).

## Paylaşım

Oy verildikten (ya da anket kapandıktan) sonra paylaşım paneli açılır.
Paylaşacak bir şey olmadan "sonucu paylaş" demek boş bir vaat olurdu.

| Kanal | Nasıl |
|---|---|
| X | `twitter.com/intent/tweet` |
| WhatsApp | `api.whatsapp.com/send` |
| Facebook | `facebook.com/sharer` |
| Telegram | `t.me/share/url` |
| Native | `navigator.share()` — yalnızca destekleniyorsa düğme görünür |
| Bağlantıyı kopyala | `navigator.clipboard` |
| Instagram | Sosyal kart + native paylaşım sayfası; desteklenmiyorsa görsel indirilir |

**Instagram'da sahte entegrasyon yok.** Instagram web'den doğrudan gönderi
paylaşımına izin vermiyor; bu yüzden "Instagram'a gönder" taklidi
yapılmıyor. Desteklenen cihazda telefonun kendi paylaşım penceresi
**görselle** açılıyor (kullanıcı oradan Instagram'ı seçiyor), desteklenmeyen
yerde görsel indiriliyor.

### Paylaşılabilir sosyal kart

Oy verildikten sonra kart **tarayıcıda** çiziliyor (`site.js` →
`drawShareCard`): soru, seçim/lider, kulüp arması, yüzde, toplam oy ve
alt bantta çağrı + adres. İki biçim var ve ikisi de aynı çizimden geliyor:

- **1080×1080** — X, Facebook, WhatsApp gönderisi
- **1080×1920** — Instagram/WhatsApp Story

Önizleme panelde görünür; kullanıcı görseli paylaşabilir
(`navigator.share({files})`) ya da indirebilir.

**Arma CORS'suz çizilmez.** Kulüp armaları başka bir alan adından geliyor;
`crossOrigin="anonymous"` olmadan çizilen bir görsel tuvali kirletir ve
`toBlob()` sessizce başarısız olur. Arma yüklenemezse baş harfli daire
çiziliyor — kart yine çıkıyor, yalnızca armasız.

### UTM ve ölçüm

Her kanal AYRI bir adres alır, yoksa hangi ağdan kaç okuyucunun geldiği
ölçülemez:

```
/anket/super-lig-sampiyonu-2026-27?utm_source=whatsapp&utm_medium=social&utm_campaign=poll_super_lig_2026_2027_sampiyon
```

Kampanya etiketi **anket kimliğinden türer**: yeni anket eklendiğinde ölçüm
etiketi de kendiliğinden doğru olur, kimse bir sabiti güncellemeyi
unutamaz. Ayrıca `window.dataLayer`a `poll_share` olayı itilir (GA4/GTM
kurulduğunda sıfır kod değişikliğiyle görünür olur) ve paylaşım niyeti
`home_poll_shares` tablosuna yazılır.

**Sayılan şey bir niyettir.** Hiçbir ağ bize paylaşımın tamamlandığını
bildirmiyor; bildirdiğini varsaymak olmayan bir veriyi raporlamak olurdu.
Tabloda **seçmen anahtarı yoktur**: "kim paylaştı" sorusunu yanıtlamaya
ihtiyacımız yok.

## Anket liderleri

Oy verildikten sonra ilk üç, sonuç listesinin üstünde madalyalarla
gösterilir (🥇🥈🥉). On sekiz satırlık bir listede "kim önde" sorusu ancak
kaydırarak yanıtlanıyordu. Tam liste altta kalmaya devam eder: kendi
takımını arayan okuyucu da var. Sayım yoksa podyum **hiç çizilmez** — boş
bir listeye madalya asmak, olmayan bir yarışın sonucunu bildirmek olurdu.

## Takvim nasıl işliyor

Aynı anda **yalnızca bir** anket açıktır: `startsAt <= şimdi < endsAt`
olan.

- **Açık** — form gösterilir, oy alınır, yüzdeler canlı tazelenir.
- **Kapalı** — pencere geçti; **sonuçlar gösterilmeye devam eder**, oy
  alınmaz. Bir sonraki anket başlayana kadar bölüm boş kalmaz.
- **Yok** — takvimde gösterilecek anket yok; bölüm **hiç çizilmez**.

Kapanan anketten sonrakine geçiş kendiliğinden olur: sıradaki anketin
`startsAt` saati geldiğinde açık anket o olur. Elle müdahale yok.

## Tek oy: üç katman, yalnızca biri sayar

| Katman | Ne yapar | Sayar mı |
|---|---|---|
| `localStorage` | "Zaten oy verdin" demenin en hızlı yolu | ❌ nezaket |
| `HttpOnly` çerez | Aynı tarayıcıyı tanır | ⚠️ anahtar üretir |
| **IP karması** | Çerezini silen aynı kişiyi tanır | ✅ tercih edilen anahtar |

Sayan katman **veritabanıdır**: `(poll_id, voter_key)` üzerinde benzersiz
kısıt vardır ve ikinci oy `409` ile döner. "Önce sorayım, sonra yazayım"
yarış durumu açardı.

**Ham IP saklanmaz.** Gizli bir tuzla (`HOME_POLL_IP_SALT`) SHA-256 karması
alınır ve yalnızca karma yazılır. Tuz tanımlı değilse IP katmanı çalışmaz
ve çerez kimliğine düşülür — tuzsuz karma, dar IP uzayında kaba kuvvetle
geri çözülebilir olurdu. Çerez kimliği kişiye bağlanmaz: rastgele 32
karakter, "kim oy verdi" sorusunu değil "bu tarayıcı daha önce oy verdi mi"
sorusunu yanıtlar.

## Depoyu açmak (Supabase)

**Bağımlılık eklenmedi.** Depo, Supabase'in PostgREST arayüzüne düz `fetch`
ile konuşuyor; `@supabase/supabase-js` paketine gerek yok.

Tabloları bir kez oluşturun — göç dosyası hazır:
`supabase/migrations/0004_poll_votes_and_shares.sql`.

```sql
create table if not exists home_poll_votes (
  id bigserial primary key,
  poll_id text not null,
  option_id text not null,
  voter_key text not null,
  created_at timestamptz not null default now(),
  unique (poll_id, voter_key)
);
create index if not exists home_poll_votes_poll_option_idx
  on home_poll_votes (poll_id, option_id);

create table if not exists home_poll_shares (
  id bigserial primary key,
  poll_id text not null,
  platform text not null,
  locale text not null default 'tr',
  created_at timestamptz not null default now()
);

alter table home_poll_votes  enable row level security;
alter table home_poll_shares enable row level security;
```

### `polls` ve `poll_options` tabloları neden yok

Klasik şema dört tablo ister: `polls`, `poll_options`, `poll_votes`,
`poll_shares`. Burada ilk ikisi yok ve bu bir eksiklik değil, bir karar:

- **Anket takvimi sürümlenmiş bir veri dosyasında** (`data/home-polls.json`).
  Anket metni bir *yayın* kararıdır; kod incelemesinden geçmesi, geri
  alınabilmesi ve iki dilde birlikte değişmesi gerekir. Veritabanı satırı
  bunların hiçbirini vermez.
- **Seçenekler türetilir, saklanmaz.** Süper Lig anketinin seçenekleri
  `data/teams.json` içindeki `isCurrentSuperLigTeam` bayrağından gelir; lig
  kadrosu değişince anket kendiliğinden doğru olur. Aynı listeyi
  `poll_options` satırlarına kopyalamak, bir gün kulüp listesinin iki yerde
  ayrışması ve ankette artık ligde olmayan bir kulübün görünmesi demekti —
  gereksinimdeki "kod içinde manuel liste değiştirmek gerekmemeli" kuralı
  tam olarak bunun tersini istiyor.

`home_poll_votes` istenen `poll_votes`un, `home_poll_shares` ise
`poll_shares`un karşılığıdır; ön ek, tabloların bu özelliğe ait olduğunu
şemada görünür kılıyor. Oy satırındaki `poll_id`/`option_id` yabancı anahtar
değil, **takvimden doğrulanan** dizelerdir: uç nokta her oyda seçeneğin
gerçekten o ankette olup olmadığına bakar.

RLS açık ve **hiçbir politika tanımlı değil**: tabloya yalnızca servis
anahtarıyla, yani bu sunucu üzerinden yazılır. Anon anahtarla tarayıcıdan
doğrudan yazılabilseydi sunucudaki doğrulama (seçenek gerçekten ankette mi,
pencere açık mı) atlanabilirdi.

Ortam değişkenleri:

| Değişken | Zorunlu | Ne için |
|---|---|---|
| `SUPABASE_URL` | ✅ | Proje adresi |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Servis anahtarı (yalnızca sunucuda) |
| `HOME_POLL_IP_SALT` | ➖ | IP karması için gizli tuz; yoksa IP katmanı kapalı |

### `anon` anahtarı çalışmaz — ve bu şemanın sonucu

Tabloda RLS açık ve **hiçbir politika tanımlı değil**, dolayısıyla `anon`
rolü ne okuyabilir ne yazabilir. `SUPABASE_ANON_KEY` tanımlamak özelliği
açmaz: her sayım okuması 0 satır döner, her oy `new row violates row-level
security policy` ile reddedilirdi.

Uç nokta bunu **açıkça söyler**. `/api/home-poll` yanıtındaki
`meta.configuration` alanı kurulum sorununu adlandırır:

| Durum | `meta.configuration` |
|---|---|
| Hiçbiri yok | `SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY tanimli degil` |
| Yalnızca anon anahtarı | `yalnizca SUPABASE_ANON_KEY tanimli; RLS anon rolune izin vermiyor, SUPABASE_SERVICE_ROLE_KEY gerekiyor` |
| Servis alanına anon anahtarı yapıştırılmış | `servis anahtari yerine anon anahtari tanimli; …` |
| Doğru kurulum | *(boş)* |

Son satır önemli: anon anahtarı **servis değişkenine** yapıştırılırsa
`isConfigured()` true döner ve hata çalışma zamanına kayar. Teşhis anahtarın
JWT `role` iddiasını okuyarak bunu da yakalar — imza doğrulanmaz, amaç
güvenlik kararı değil operatöre doğru anahtarı göstermek. Anahtarın kendisi
hiçbir koşulda yanıta yazılmaz.

`service_role` anahtarı Supabase panelinde **Project Settings → API →
Service Role / `service_role` secret** altındadır ve yalnızca sunucuda
durmalıdır.

Depo yapılandırılmamışsa anket **görünür ama oy alınmaz** (`storage:
"unavailable"`): soru statik veriden geliyor, sayım ise gerçek bir depodan
gelmek zorunda. Sıfır oyu "%0" diye göstermek de bir iddiadır.

## Sunucu istemciye güvenmez

Üç kapı da `server/homePollRoute.js` içinde:

1. **Hangi anket?** İstemcinin gönderdiği `pollId` yalnızca bir iddiadır;
   geçerli anket takvimden okunur. Kapanmış ya da başlamamış bir ankete
   oy yazdırılamaz.
2. **Pencere açık mı?** Kapanmış ankette `POLL_CLOSED` (409).
3. **Seçenek gerçekten listede mi?** Seçenek kümesi işaretlemeden değil
   veriden türetilir; istemci HTML'i kurcalasa bile değişmez.

Yanıt seçmene özel alan taşıdığı için (`alreadyVoted`, `choice`) **önbelleğe
alınmaz** (`home-poll` politikası, `no-store`).

Uç nokta `api/` altında **değil** (`server/homePollRoute.js`, yönlendirme
`api/[...route].js`): Vercel Hobby planında `api/` altındaki her dosya bir
sunucusuz işlev sayılıyor ve 12 işlev sınırı dolu.

## Anket sayfası: tüm anketler bir arada

Ana sayfa **tek** anket gösterir (açık olan, ya da son kapanmış). Anket
sayfası (`anketler.html` / `en/polls.html`) takvimin **tamamını** gösterir:

| Durum | Ne görünür |
|---|---|
| `open` | Oy formu (henüz oy verilmediyse) ya da canlı sonuçlar |
| `closed` | Kesinleşmiş sonuçlar |
| `upcoming` | Soru ve seçenek önizlemesi — **sonuç yok** |

Sıra okuyucunun ilgisine göre: **oy verilebilen üstte**, sonra kapananlar
(en yeni önce), en sonda planlananlar (en yakın önce). Kronolojik sıralamak
kapanmış bir anketi açık olanın üstüne koyar ve sayfaya giren okuyucu oy
verebileceği anketi aramak zorunda kalırdı.

Başlamamış anketin **sayımı okunmaz**: henüz oy olamaz ve boş bir sorgu her
sayfa görüntülemesinde depoya gereksiz yük olurdu.

Veri `GET /api/home-poll?scope=all` üzerinden gelir — ayrı bir uç nokta
değil, aynı yolun bir kipi: Vercel'deki işlev sayısı sabit kalıyor ve iki
yüzey aynı doğrulama ve sunum kodunu paylaşıyor. **Liste kipi POST kabul
etmez**; oy vermek her zaman tekil anket yolundan geçer, çünkü pencere
kapısı orada.

### Maçın Adamı anketleri de aynı sayfada

Sayfanın ikinci listesi maç anketleridir (`GET /api/motm-week?scope=matches`).
Her satır maçı, oylamanın açık olup olmadığını ve — gerçek sayım varsa —
önde gideni gösterir; **oy burada verilmez**, bağlantı maç sayfasına gider
çünkü 24 saatlik pencere kapısı orada.

Kapsam haftalık **değil**: ana sayfa widget'ı "bu hafta kim öne çıktı"
sorusunu sorar, anket sayfası ise bir arşivdir ve oylaması kapanmış bir maç
anketi de oraya aittir. Haftalık pencereyi buraya da uygulamak sayfayı çoğu
hafta boş bırakırdı.

**Bağlantı tahmin edilmez.** Anketin hangi sayfada olduğunu enjektör
(`scripts/inject-motm-poll.mjs`) `data/motm-poll-pages.json` dosyasına yazar
ve uç nokta onu okur. Eşlemede olmayan maç listeye **girmez**: tıklandığında
404 veren bir "oy ver" bağlantısı, bağlantı olmamasından kötüdür. Dosya
üretilendir — elle düzenlenmez; `test-motm-week` iki yönü de doğrular
(eşlemedeki her sayfa gerçekten anketi taşıyor mu, anketi olan her sayfa
eşlemede mi).

Beraberlikte önde giden **bildirilmez**: eşitken birini öne koymak, veride
olmayan bir sıra uydurmaktır.

## İki sürüm birebir aynı

Kabuk iki tarafta da aynı sınıfları ve aynı `data-*` kancalarını taşır;
tek fark `data-home-poll-locale`. Metin işaretlemeye ikinci kez yazılmaz —
soru ve seçenekler uç noktadan istenen dilde gelir, çerçeve metinleri
`services/homePoll.js` içindeki `COPY` sözlüğünden.

Türkçe kabuk `index.html` içine `scripts/inject-home-poll.mjs` tarafından
işaretli blok olarak basılır (dosya elle tutulan bir kabuktur); İngilizce
kabuk `scripts/generate-en-pages.mjs` içindeki `homePollSection()`
tarafından her derlemede yeniden yazılır (İngilizce sayfalar üretilen
dosyalardır). Anket sayfaları iki dilde de `generate-poll-pages.mjs`ten
gelir ve aynı `homePollBlock()` çıktısını kullanır.

## Testler

```
node scripts/test-home-poll.mjs             # npm test içinde
node scripts/test-poll-share-browser.mjs     # npm run test:poll-share
```

İkinci test **gerçek bir tarayıcıda, gerçek cihaz ölçülerinde** (390×844 ve
1440×900) oy → sonuç → paylaşım → sosyal kart akışını yürütür: seçenek
ızgarasının sütun sayısı, dokunma alanlarının yüksekliği, podyum, toplam
katılım satırı, dört ağın dört ayrı UTM etiketi ve tuvalin gerçekten
1080×1080 / 1080×1920 PNG üretmesi. Uç nokta sahtelenir — bir test canlı
sayıma oy yazmamalı. Playwright gerektirir (`npm ci --include=dev &&
node scripts/install-browser.mjs`) ve bu yüzden `npm test` içinde değil.

`test-home-poll.mjs`in 18 bölümü beş soruyu sıkıştırıyor: *yanlış zamanda yanlış anket açılabilir
mi?*, *sayıma geçersiz bir şey girebilir mi?*, *iki sürüm ayrışabilir mi?*,
*paylaşılan bağlantı doğru sayfaya ve doğru ölçüm etiketine gidiyor mu?*,
*maç anketi ana sayfa anketini düşürebilir mi?* Sahte bir depoyla çalışır;
gerçek Supabase'e çıkmaz.
