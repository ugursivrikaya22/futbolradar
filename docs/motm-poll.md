# Maçın Adamı anketi

Maç sayfalarında okuyucunun maçın en iyi oyuncusunu seçtiği anket.

## Neden sıkı kuralları var

Anket bir okuyucu etkileşimi, ama **seçenek listesi bir veri iddiasıdır**:
ekrana bir futbolcu adı bastığımız anda "bu oyuncu bu maçta oynadı" demiş
oluyoruz. Kural bu yüzden tek ve sert:

> **Sahada olduğunu bilmediğimiz oyuncu listeye girmez.**

## Aday listesi nereden geliyor

`data/matches.json` içindeki maç kaydından, iki alandan:

| Alan | Ne demek | Listeye girer mi |
|---|---|---|
| `lineups[].players` | İlk onbir | ✅ `İlk 11` rozetiyle |
| `substitutions[].in` | Oyuna giren | ✅ `Oyuna girdi` rozetiyle |
| `lineups[].substitutes` | Yedek kulübesi | ❌ **Hayır** |
| `data/super-lig-squads.json` | Kulüp kadrosu | ❌ **Hayır** |

**Yedek kulübesi listeye girmez.** `substitutes` "kulübede oturdu" demektir,
"oynadı" demez. Onları da listeye koymak, oynamamış bir futbolcuyu maçın
adamı adayı yapardı — ve okuyucu listede gördüğü adı oynamış sayacağı için
bu, sessiz bir uydurma olurdu.

Kadro listesi de bu soruyu yanıtlamaz: kulübün kadrosunda olmak, o maçta
oynamış olmak değildir.

## Anket ne zaman çıkar

Üç koşulun **hepsi** gerekir:

1. **Maç bitmiş** — "maçın adamı" oynanmış bir maç hakkında bir yargıdır.
2. **En az bir Türk kulübü var** — yabancı-yabancı maçlarda anket yok.
   Karar `services/turkishTeams.js`teki kulüp tanımasına dayanır.
3. **En az iki aday var** — tek seçenekli oylama oylama değildir.

Koşullardan biri tutmazsa anket **hiç basılmaz**; eksik veri yer tutucuyla
doldurulmaz. Neden basılmadığı derleme günlüğüne yazılır:

```
motm-poll: 5 sayfaya anket yazıldı, 640 sayfada anket yok
  Atlama nedenleri — maç kaydı yok: 637, kadro verisi yok (0 aday): 3
```

## Hangi sayfalara girer

`scripts/inject-motm-poll.mjs`, şu dizinlerdeki sayfaları tarar:
`mac/`, `mac-raporu/`, `analiz/`.

Eşleşme dosya adı ile `data/matches.json` içindeki `id` arasında **birebir**
yapılır. Yakın bir ada "herhalde bu maçtır" diye anket iliştirmek, bir maçın
kadrosunu başka bir maçın sayfasına basma riski demektir — anketin en kötü
hata biçimi.

İngilizce sayfalara girmez: metinler ("Maçın Adamını Seç!", "Oy Ver")
çevrilmemiş Türkçe.

## Blok `hidden` doğar

Anket JavaScript olmadan çalışamaz: oy verme de sonucu çizme de istemcide.
JavaScript kapalıyken görünen bir "Oy Ver" düğmesi, basıldığında hiçbir şey
yapmayan bir düğmedir. Blok bu yüzden `hidden` basılır ve yalnızca `site.js`
önyüklendiğinde açılır.

Yan faydası SEO'da: anket sayfalar arası tekrarlanan bir metin bloğu;
kapalı doğması onu yinelenen içerik olarak görünmekten de çıkarıyor. Blokta
JSON-LD **yok** — anket bir içerik varlığı değil, bir etkileşim.

## Oy nerede tutuluyor

İki kip var ve **hangisinde olduğumuz kullanıcıya yazıyla söylenir.**

### Topluluk kipi (depo yapılandırılmışsa)

Oylar `GET/POST /api/motm-vote` üzerinden Redis'in REST arayüzünde tutulur.
Yüzdeler gerçek toplamdan hesaplanır.

Blok şunu gösterir: *"Sonuçlar tüm okuyucuların oylarından hesaplanıyor.
Her tarayıcı bir kez oy verebilir."*

### Cihaz-yerel kip (depo yoksa ya da ulaşılamıyorsa)

Uç nokta `storage: "unavailable"` döner, istemci `localStorage`a düşer
(anahtar `futbolradar:motm:<matchId>`).

Blok şunu gösterir: *"Oy deposuna ulaşılamadı; aşağıdaki sonuç topluluk
ortalaması değil, yalnızca bu tarayıcıda saklanan oylardır."*

> Aynı notu iki kipte de göstermek, gerçek topluluk sonucunu "yalnızca bu
> cihaz" diye küçültür ya da — tersi çok daha kötü — cihazdaki tek oyu
> topluluk sonucu gibi sunardı. Sıfır oyu "%0" diye göstermek de bir
> iddiadır; o iddia ancak gerçek bir sayım varsa yapılabilir.

## Uç noktayı açmak

Vercel KV (ya da herhangi bir Upstash uyumlu Redis) açıp şu ortam
değişkenlerinden bir çifti tanımlamak yeterli — **kod değişikliği gerekmez**:

| URL | Token |
|---|---|
| `KV_REST_API_URL` | `KV_REST_API_TOKEN` |
| `UPSTASH_REDIS_REST_URL` | `UPSTASH_REDIS_REST_TOKEN` |
| `MOTM_REDIS_REST_URL` | `MOTM_REDIS_REST_TOKEN` |

**Bağımlılık eklenmedi.** Depo, Redis'in REST arayüzüne düz `fetch` ile
konuşuyor; `@vercel/kv` paketine gerek yok. Depoda bugüne kadar hiç
çalışma-zamanı bağımlılığı yoktu ve bu özellik de eklemedi.

### Sunucu istemciye güvenmez

İstemci "şu maçta şu oyuncuya oy" diyor; ikisi de dışarıdan gelen dize.
Doğrulanmadan yazılsalardı depoya hiç oynamamış — hatta var olmayan — bir
oyuncu adı girebilirdi ve o ad sonuç listesinde gerçek bir aday gibi
görünürdü. Anketin bütün iddiası "listedeki herkes bu maçta oynadı" olduğu
için bu, özelliğin kendisini çürütürdü.

İki kapı da sunucuda, **aynı seçim mantığıyla** (`services/motmPoll.js`):

1. Maç anket hak ediyor mu? (bitmiş, Türk kulüplü, kadrosu var)
2. Seçenek **o maçın** gerçek aday listesinde mi?

Geçerli seçenek kümesi işaretlemeden değil veriden türetiliyor — istemci
HTML'i kurcalasa bile değişmiyor. Depoda kalmış ama artık geçerli olmayan
seçenekler sonuçtan süzülür (kadro düzeltilmiş olabilir).

### Tekrar oy

`localStorage` yalnızca bir **nezaket katmanı**: temizlenebilir, gizli
sekmede yoktur. Sayım sunucuda tutulduğu için tekrar kontrolü de sunucuda:
her oy anonim bir seçmen kimliğiyle bir kümeye yazılır (`SADD` atomik
olduğu için yarış durumu yok), küme zaten içeriyorsa oy sayılmaz.

Kimlik **kişiye bağlanmaz**: rastgele 32 karakter, `HttpOnly` çerezde.
"Kim oy verdi" sorusunu değil, "bu tarayıcı daha önce oy verdi mi"
sorusunu yanıtlar. Giriş yok, kişisel veri yok.

### Uç nokta neden `api/` altında değil

Vercel Hobby planı en fazla 12 sunucusuz işlev veriyor ve `api/` altındaki
her dosya bir işlev sayılıyor. `api/motm-vote.js` sınırı 13/12'ye çıkarıp
dağıtımı kırıyordu — `npm run qa` bunu yakaladı. Mantık
`server/motmVoteRoute.js`te, yönlendirme `api/[...route].js` üzerinden.

Yönlendirme kontrolü **en önde**: alttaki `rejectUnsupportedMethod` yalnızca
okuma yöntemlerine izin veriyor ve oy vermek bir POST.

### Arıza anketi kırmaz

Depo kapalı, ağ hatası, zaman aşımı — hepsi `storage: "unavailable"` ile
sonuçlanır ve istemci cihaz-yerel kipe düşer. `localStorage` erişimi de
korumalı (gizli sekme, kota). Sayfanın çalışması, sayımın çalışmasından
önce gelir.

## Testler

```
node scripts/test-motm-poll.mjs
```

```
node scripts/test-motm-vote-api.mjs
```

`test-motm-poll` 11 bölüm, iki soruyu farklı açılardan soruyor: *listeye girmemesi gereken kim girebilir?* ve *anket
çıkmaması gereken yerde çıkabilir mi?*

`test-motm-vote-api` 12 bölüm, tek soru: *istemci ne gönderirse göndersin,
sayıma geçersiz bir şey girebilir mi?* Sahte bir depoyla çalışır; gerçek
Redis'e çıkmaz.
