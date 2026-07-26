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
node scripts/preflight-api-football.mjs            # yapılandırma kontrolü
node scripts/preflight-api-football.mjs --resolve  # lig kimliğini çöz, önbelleğe yaz
node scripts/preflight-api-football.mjs --probe    # anahtarı sağlayıcıya doğrulat
node scripts/preflight-api-football.mjs --json     # makine okunur çıktı
```

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

- `scripts/test-api-football-config.mjs` — anahtar yokluğu, env önceliği,
  otomatik çözümleme, önbellek kullanımı, belirsizlik, eşleşmeme, sağlayıcı
  hatası, anahtar sızıntısı, sezon türetme.
- `scripts/test-squad-sync-e2e.mjs` — gerçek senkron scriptini geçici bir
  çalışma dizininde koşturur; 18 takımın ve kadrolarının yazıldığını,
  yapılandırma eksikken hiçbir dosyaya dokunulmadığını ve anahtarın
  stdout/stderr/dosyalara sızmadığını doğrular.

İkisi de `npm test` zincirindedir.
