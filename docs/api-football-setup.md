# API-Football Kurulumu

Bu belge tek bir soruyu yanıtlar: kadro, oyuncu ve teknik ekip verisinin
gerçekten akması için nereye ne yazılır?

Kısa cevap: **tek zorunlu değer `APIFOOTBALL_API_KEY`.** Geri kalan her şey
ya türetilir ya da sağlayıcıya sorularak çözülür.

---

## 1. Değişkenler

| Değişken | Zorunlu mu? | Yoksa ne olur? |
| --- | --- | --- |
| `APIFOOTBALL_API_KEY` | **Evet** | Hiçbir kadro/oyuncu verisi çekilemez. Kadro senkronu hiç çalışmaz. |
| `APIFOOTBALL_LEAGUE_ID` | Hayır | Sağlayıcının `/leagues` uç noktasından otomatik çözülür ve `data/api-football-league.json` dosyasına önbelleklenir. |
| `APIFOOTBALL_SEASON` | Hayır | Tarihten türetilir. Avrupa sezonu başladığı yılla anılır, yani temmuz–aralık arası o yıl, ocak–haziran arası bir önceki yıl. 2026-27 sezonu için **2026**. |
| `APIFOOTBALL_API_BASE_URL` | Hayır | `https://v3.football.api-sports.io` kullanılır. |
| `APIFOOTBALL_COUNTRY` | Hayır | `Turkey` kullanılır. Lig çözümlemesi bu ülkeye göre arar. |

Her değişken birkaç yaygın yazım varyantını da kabul eder (`API_FOOTBALL_*`,
`APISPORTS_*` gibi) — tam liste `.env.example` içinde. Bunun sebebi, farklı
adla tanımlanmış bir Vercel değişkeninin canlı sağlayıcıyı sessizce devre
dışı bırakmasını engellemek.

### Sezon neden sabit 2026 değil?

`.env.example` içinde `APIFOOTBALL_SEASON=2026` yazar ve bugün doğru değer
budur. Ama değer koda gömülü **değildir**: `seasonForDate()` tarihten türetir.
Sabit bir 2026, takvim döndüğü an sessizce yanlış sezonu çeker — daha önce
tam olarak bu oldu. Belirli bir sezonu zorlamak isterseniz değişkeni
tanımlayın; tanımlıysa türetmeyi ezer.

### Lig kimliği neden koda gömülü değil?

Sabit bir lig numarası, sağlayıcı katalogunu değiştirdiğinde ya da başka bir
plana geçildiğinde sessizce yanlış ligi çeker — on sekiz takımın kadrosunu
yanlış ligden doldurup bunu doğrulanmış veri gibi yayımlar. Bu yüzden
`services/leagueResolver.js` şu sırayı izler:

1. `APIFOOTBALL_LEAGUE_ID` tanımlıysa **o** kullanılır (operatörün açık tercihi).
2. Değilse `data/api-football-league.json` önbelleği okunur.
3. Değilse `/leagues?country=Turkey&type=League` sorulur, "Süper Lig" adıyla
   **tam olarak bir** eşleşme bulunursa kullanılır ve önbelleğe yazılır.

Birden fazla eşleşme çıkarsa ya da hiç çıkmazsa **tahmin edilmez**: çözümleme
durur ve adaylar kimlikleriyle listelenir. Yanlış bir lig kimliği, kimliğin
hiç olmamasından daha kötüdür.

Kadınlar ligi, altyapı (U19/U21) ve play-off turnuvaları da adında "Süper Lig"
taşıyabilir. Genişletilmiş arama bunları hiçbir koşulda seçmez — tek aday
olarak kalsalar bile.

### Yanlış lig kimliğine karşı üç katman

Kimlik yalnızca doğru çözülmekle kalmaz, sonucu da denetlenir:

1. **Kimlik doğrulaması.** Çekilen takım listesi, TFF fikstüründen bilinen on
   sekiz Süper Lig takımıyla karşılaştırılır. Örtüşme %60'ın altındaysa sorun
   "lig küçüldü" değil "yanlış ligi çektik"tir: yazma durur, hiçbir dosyaya
   dokunulmaz. Bu, yanlış bir ligin *doğru sayıda* takım döndürdüğü durumu
   yakalar — sayı koruması tek başına bunu göremez. Boş çekim de koşulsuz
   reddedilir; Süper Lig'in sıfır takımı olduğu meşru bir durum yok.

   Eşleştirme içeren biçimdedir, birebir değil: sağlayıcı "Gaziantep FK" ya
   da "Fatih Karagumruk" derken fikstür "Gaziantep" / "Karagümrük" diyebilir.
   Ölçüldü — sağlayıcı yazımıyla örtüşme %83, bambaşka bir ligde %0.
2. **Önbellek kendini iptal eder.** Kimlik doğrulaması önbellekten gelen bir
   kimlikle başarısız olursa önbellek silinir; sonraki koşu sıfırdan çözer.
3. **Yeniden doğrulama penceresi.** Önbellek 30 günden eskiyse sağlayıcıya
   yeniden sorulur. Yanlış çözülmüş bir kimlik depoya kalıcı olarak donmaz.

---

## 2. Nereye yazılır?

Anahtar üç ayrı ortama ayrı ayrı tanımlanır. Biri diğerini görmez — canlı
sitede anahtarın tanımlı olması, GitHub Actions'ın onu görmesi anlamına
gelmez. Kadro senkronu CI'da koştuğu için asıl gereken yer ikincisidir.

### 2.1 Vercel (çalışma anındaki `/api/*` uç noktaları)

1. Vercel → ilgili proje → **Settings** → **Environment Variables**
2. **Add New**:
   - Name: `APIFOOTBALL_API_KEY`
   - Value: API-Football panelindeki anahtar (tırnaksız, başında/sonunda boşluk olmadan)
   - Environments: **Production** ve **Preview**
3. **Save**, ardından yeni bir dağıtım tetikle (değişkenler dağıtım anında okunur).

Doğrulama: `https://www.futbolradar.com/api/health` → `apiFootball.configured`
alanı `true` olmalı. Bu uç nokta anahtarı **yazmaz**, yalnızca varlığını,
uzunluğunu ve biçiminin geçerli görünüp görünmediğini raporlar.

### 2.2 GitHub Actions (kadro senkronunun asıl koştuğu yer)

1. Depo → **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**:
   - Name: `APIFOOTBALL_API_KEY`
   - Secret: aynı anahtar
3. İsteğe bağlı: `APIFOOTBALL_LEAGUE_ID`, `APIFOOTBALL_SEASON`

Secret eklendikten sonra kod değişikliği gerekmez. Bir sonraki zamanlanmış
koşuda (ya da **Actions** → *Match Analysis Automation* → **Run workflow**)
ön kontrol `ready=true` üretir ve kadro adımları çalışmaya başlar.

### 2.3 Yerel geliştirme

```bash
cp .env.example .env
# .env içinde APIFOOTBALL_API_KEY satırını doldur
```

`.env` `.gitignore` içindedir ve depoya girmez. Anahtarı asla bir dosyaya
gömmeyin, commit etmeyin, log'a yazdırmayın.

---

## 3. Kurulumu doğrulama

```bash
node scripts/preflight-api-football.mjs          # kontrol + lig kimliğini çöz
node scripts/preflight-api-football.mjs --probe  # ek olarak anahtarı sağlayıcıya doğrulat
node scripts/preflight-api-football.mjs --json   # makine okunur çıktı
```

Anahtar tanımlıysa lig kimliği her koşuda çözülür ve
`data/api-football-league.json` dosyasına yazılır; komut salt okunur
değildir. (`--resolve` hâlâ kabul edilir ama artık bir şeyi değiştirmez.)

`--probe` yalnızca bilgi amaçlı değildir: sağlayıcı hiçbir anahtarı kabul
etmezse bu bir engeldir. Anahtarın VAR OLMASI kullanılabilir olması demek
değil — iptal edilmiş ya da limiti dolmuş bir anahtar, lig kimliği env'de
tanımlıyken hiç ağa çıkılmadığı için fark edilmeden kapıyı açardı. CI bu
yüzden `--resolve --probe` koşar.

Ön kontrol anahtarın kendisini hiçbir çıktı yoluna yazmaz. Yalnızca hangi
değişkenin dolu olduğunu, uzunluğunu ve biçiminin geçerli görünüp
görünmediğini bildirir; `--probe` ile sağlayıcıya gidilirken bile başlık
maskeli raporlanır.

Eksik yapılandırmada çıktı, neyin eksik olduğunu ve nereye yazılacağını tek
tek listeler; çıkış kodu 1'dir.

### Kadroları doldurma

```bash
node scripts/sync-super-lig-squads.mjs --apply     # 18 takım + kadrolar
node scripts/sync-canonical-players.mjs --apply    # canonical oyuncu verisine birleştir
npm run build                                      # sayfaları ve arama dizinini yeniden üret
```

Senkron yalnızca çözülen lig kimliğini yazar (`Lig kimliği: <id> (env|cache|provider)`).

---

## 4. Sık karşılaşılan durumlar

**"API anahtarı tanımlı ama biçimi beklenen gibi değil"**
API-Sports anahtarları tam olarak 32 onaltılık karakterdir. Genellikle eksik
kopyalanmıştır, tırnak içinde kalmıştır ya da başına/sonuna boşluk
yapışmıştır. `--probe` ile hangi değişkenin reddedildiğini görebilirsiniz.

**"Lig kimliği belirsiz — birden fazla eşleşme var"**
Sağlayıcı aynı isimle birden çok lig döndürmüş. Listelenen adaylardan doğru
olanı `APIFOOTBALL_LEAGUE_ID` ile tanımlayın.

**"Sağlayıcı katalogunda Süper Lig bulunamadı"**
Genellikle paketin ilgili sezona erişimi yoktur (ücretsiz planlar güncel
sezonu vermez). Panelden plan kapsamını kontrol edin.

**CI koşuyor ama kadrolar hâlâ boş**
Actions koşusunun özetine bakın. Ön kontrol eksik değişkeni adıyla yazar. En
sık sebep, anahtarın Vercel'de tanımlı olup depo secret'ı olarak
eklenmemesidir — ikisi ayrı ortamdır.

---

## 5. Test kapsamı

Gerçek anahtar olmadan da kurulum yolunun çalıştığı sınanır. İki test
API-Football protokolünü konuşan yerel bir sunucu kurar; bu bir test
çiftidir, siteye giden bir veri kaynağı değildir ve ürettiği hiçbir kayıt
`data/` altına yazılmaz.

- `scripts/test-api-football-config.mjs` (16 senaryo) — anahtar yokluğu, env
  önceliği, otomatik çözümleme, önbellek kullanımı ve yeniden doğrulama,
  belirsizlikte durma, eşleşmeme, sponsorlu ad, kadınlar/altyapı ligi
  süzgeci, dar sorgu geri dönüşü, lig kimliği koruması, çalışma anında
  önbellek okuma, sağlayıcı hatası, anahtar sızıntısı, sezon türetme.
- `scripts/test-squad-sync-e2e.mjs` (6 senaryo) — gerçek senkron ve ön
  kontrol scriptlerini geçici bir çalışma dizininde koşturur; 18 takımın ve
  kadrolarının yazıldığını, canonical oyuncu verisine geçtiğini, yanlış bir
  ligin *doğru sayıda* takım döndürdüğünde bile reddedildiğini, yapılandırma
  eksikken hiçbir dosyaya dokunulmadığını, CI kapısının `ready=false`
  yazdığını ve anahtarın stdout/stderr/dosyalara sızmadığını doğrular.

İkisi de `npm test` zincirindedir ve ortam değişkenine duyarlı testlerden
önce koşarlar, böylece yerelde bir anahtar tanımlıyken de çalışırlar.
