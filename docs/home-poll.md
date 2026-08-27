# Ana sayfa tahmin anketi

> **DURUM (2026-08-27):** Ana sayfa enjeksiyonu prodüksiyonda **kapatıldı**.
> Anket artık canlı sitede (`index.html`, `en/index.html`) görünmüyor.
> `home-poll` adımı `scripts/lib/postprocessChain.mjs`deki `POSTPROCESS_CHAIN`den
> çıkarıldı, bu yüzden `inject-home-poll.mjs` ne tam derlemede ne saatlik
> otomatik yenilemede koşuyor; `scripts/generate-en-pages.mjs` de İngilizce
> ana sayfaya artık anket bölümü/vitrin kartı/sabit kutu basmıyor. Aşağıdaki
> belge özelliğin altyapısını (`services/homePoll.js`, `data/home-polls.json`)
> hâlâ doğru anlatıyor — o kod silinmedi, yalnızca ana sayfaya bağlanması
> kesildi. Yeniden açmak için `postprocessChain.mjs`ye `home-poll` adımını
> geri eklemek ve `generate-en-pages.mjs`deki ana sayfa çağrılarını geri
> koymak gerekir.

Ana sayfanın en büyük etkileşimi: okuyucuya sezon hakkında bir soru sorar,
oyları toplar ve canlı yüzdeleri lider vurgusuyla gösterir. Türkçe ve
İngilizce sürümler **birebir aynı** ankettir; yalnızca dil değişir.

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
  "startsAt": "2026-08-14T00:00:00+03:00",
  "endsAt": "2026-09-15T00:00:00+03:00",
  "optionSource": "super-lig-teams",
  "question": {
    "tr": "🏆 Bu Sezon Trendyol Süper Lig Şampiyonu Sence Kim Olacak?",
    "en": "🏆 Who Will Win the Trendyol Süper Lig This Season?"
  },
  "subtitle": { "tr": "Okuyucu tahmini.", "en": "A reader prediction." }
}
```

| Alan | Zorunlu | Ne yapar |
|---|---|---|
| `id` | ✅ | Oyların toplandığı anahtar. Benzersiz olmalı. |
| `startsAt` / `endsAt` | ✅ | Anketin penceresi. Aralarında **en az 14 gün** olmalı. |
| `question.tr` / `question.en` | ✅ | Soru. **İki dil de zorunlu.** |
| `subtitle` | ➖ | Verilirse iki dilde de olmalı. |
| `optionSource: "super-lig-teams"` | ➖ | Seçenekleri güncel Süper Lig kulüplerinden otomatik doldurur. |
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

- pencere 14 günden kısa,
- `endsAt` `startsAt`ten önce,
- soru tek dilde,
- ikiden az seçenek,
- seçenek kimlikleri yinelenmiş,
- penceresi önceki anketle **çakışıyor** (sonraki elenir).

Dosyadaki `_sample` anahtarı yalnızca alan şeklini gösterir ve servis
tarafından **hiç okunmaz**.

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

Tabloyu bir kez oluşturun:

```sql
create table home_poll_votes (
  id bigserial primary key,
  poll_id text not null,
  option_id text not null,
  voter_key text not null,
  created_at timestamptz not null default now(),
  unique (poll_id, voter_key)
);
create index on home_poll_votes (poll_id, option_id);
alter table home_poll_votes enable row level security;
```

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

Türkçe kabuk `index.html` içinde elle durur; İngilizce kabuk
`scripts/generate-en-pages.mjs` içindeki `homePollSection()` tarafından her
derlemede yeniden yazılır (İngilizce sayfalar üretilen dosyalardır).

## Testler

```
node scripts/test-home-poll.mjs
```

10 bölüm üç soruyu sıkıştırıyor: *yanlış zamanda yanlış anket açılabilir
mi?*, *sayıma geçersiz bir şey girebilir mi?*, *iki sürüm ayrışabilir mi?*
Sahte bir depoyla çalışır; gerçek Supabase'e çıkmaz.
