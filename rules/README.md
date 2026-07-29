# Kural Kayıt Defteri (`rules/`)

Bu klasör, FutbolRadar'ın karar kurallarının **makine okunur dizinini** tutar.

- `registry.json` — kayıtların kendisi
- `schema.json` — `registry.json`'un JSON Schema (draft-07) tanımı
- Defteri okuyan servis: [`services/brainService.js`](../services/brainService.js)

---

## Defter ne DEĞİLDİR

**Defter kural uygulamaz.** Hiçbir eşik burada "yürürlüğe girmez", hiçbir metin
buradan basılmaz. Kod her zaman kaydın `module` alanındaki servis dosyasını
çağırır; defter yalnızca "bu kural nerede yaşıyor, hangi sayılarla çalışıyor,
hangi test koruyor" sorularını cevaplar.

Bu ayrım projenin 3. ilkesinin doğrudan sonucudur: *her kural tek yetkili karar
noktasında yaşar*. Defter ikinci bir karar noktası olsaydı, aynı eşik iki yerde
tanımlı olur ve ikisi zamanla ayrışırdı — kaynakta 40, defterde 35 yazan bir
eşik, defteri okuyan herkesi yanıltırdı.

Bu yüzden tek yön vardır:

```
services/*.js  ──(gerçek)──>  rules/registry.json  ──(dizin)──>  panel, doküman, API
```

Kaynak ile defter çeliştiğinde **kaynak doğrudur**, defter düzeltilir.

---

## Defter ne İŞE YARAR

1. **Yönetim paneli** (`yonetim-paneli.html`) kuralları alanlarına göre
   listeler; hangi eşiğin nerede tanımlı olduğunu okumak için kaynağa
   inmek gerekmez.
2. **`docs/rules-catalogue.md`** tablosu defterden türetilir; doküman ile kod
   arasındaki kayma böylece tek bir dosyada toplanır.
3. **`services/brainService.js`** defteri kaynağa karşı doğrular
   (`verifyRegistry()`); bozulan bir kayıt sessizce yaşamaya devam edemez.
4. **API** (`api/analysis-brain.js`) aynı özeti dışarıya verir.

---

## Kayıt biçimi

`registry.json` iki liste taşır.

### `domains[]`

| Alan | Anlamı |
| --- | --- |
| `id` | Alan kimliği (küçük harf, tireli). Kurallar buna referans verir. |
| `title` | Alanın Türkçe başlığı — arayüzde görünür. |
| `summary` | Alanın hangi soruyu cevapladığını anlatan tek cümle. |

### `rules[]`

| Alan | Anlamı |
| --- | --- |
| `id` | Nokta ayraçlı benzersiz kimlik, ör. `match.display.gate`. |
| `domain` | `domains[].id` değerlerinden biri. |
| `title` | Türkçe kısa başlık. |
| `statement` | Kuralın NE yaptığını söyleyen Türkçe ifade. Kaynakla birebir uyumlu olmalı. |
| `rationale` | Kural NEDEN var: hangi somut hatayı önlüyor. |
| `module` | Kuralın yaşadığı gerçek dosya, ör. `services/matchEligibility.js`. |
| `entry` | O dosyada gerçekten dışa aktarılan ad (fonksiyon ya da sabit). |
| `thresholds[]` | `{ name, value, unit? }` — değerler kaynaktakiyle aynı olmak zorunda. |
| `vocabulary[]` | Kuralın basabileceği, kullanıcıya görünen Türkçe metinler. |
| `test` | Kuralı koruyan test dosyası. **Testi yoksa boş dize** — uydurma yol yazılmaz. |
| `surfaces[]` | Kuralın sonucunu gösteren ya da kuralı çağıran yüzeyler. |

`rationale` alanı NE yaptığını değil NEDEN var olduğunu anlatır. "Skoru
olmayan maçı gizler" bir `statement`tır; "skorsuz satır okuyucuya maçın 0-0
gittiğini ya da sitenin bozuk olduğunu düşündürüyordu" bir `rationale`dır.

---

## Yeni kural nasıl eklenir

Sıra önemlidir: **önce kural, sonra kayıt.**

1. **Kuralı bir servise yaz.** Karar tek bir dosyada, tek bir dışa aktarımın
   arkasında yaşasın. Yorumları Türkçe ve NEDEN'i anlatan biçimde yaz.
2. **Kuralı bir testle koru.** Yeni test dosyasını `package.json` içindeki
   `test` betiğine eklemeyi unutma.
3. **Kaydı `registry.json`'a ekle.** `module` ve `entry` alanlarını kaynaktan
   kopyala, tahmin etme. Eşik değerlerini kaynaktaki sabitlerden oku.
4. **Alan yoksa `domains[]`'e ekle.** `id` İngilizce ve tireli, `title` ile
   `summary` Türkçe.
5. **Doğrula:**

   ```bash
   node -e 'console.log(JSON.stringify(require("./services/brainService.js").verifyRegistry(), null, 1))'
   npm test
   ```

   `ok: true` görmeden bitmiş sayılmaz.

### Doğrulanamayan kayıt yazılmaz

Bir alanı kaynaktan doğrulayamıyorsan kaydı **eksik bırak ya da hiç yazma**.
Eksik bir defter dürüsttür; var olmayan bir dosyaya işaret eden kayıt ise
olmayan bir kuralı varmış gibi gösterir ve hiç defter tutmamaktan daha
zararlıdır. Aynı ilke `test` alanı için de geçerli: kuralın testi yoksa alan
boş bırakılır, böylece "korumasız kural" listesi (`registrySummary().untested`)
gerçeği söyler.

---

## `verifyRegistry()` neyi denetler

`services/brainService.js` içindeki `verifyRegistry()` her koşuda şunlara bakar:

| Denetim | Ne arar |
| --- | --- |
| Alan kimliği | `domains[].id` yinelenmiş mi? |
| Kural kimliği | `rules[].id` yinelenmiş mi? |
| Alan referansı | `rules[].domain` gerçek bir `domains[].id` mi? |
| Modül yolu | `rules[].module` dosyası depoda var mı? |
| Modül yüklenmesi | Dosya `require` edilebiliyor mu? |
| Dışa aktarım | `rules[].entry` o dosyadan **gerçekten** dışa aktarılıyor mu? |
| Test yolu | `rules[].test` boş değilse dosya var mı? |

Dönen değer:

```js
{ ok: true, problems: [], skipped: [], checked: { rules, modules, entries, tests } }
```

- `problems` — bulunan her tutarsızlık, Türkçe tek satır.
- `skipped` — **yapılamayan** denetimler. Sunucusuz derlemede yalnızca
  `require` edilen dosyalar bulunur; `scripts/` dizini oraya kopyalanmaz. Böyle
  bir ortamda "test dosyası yok" demek yanlış bir suçlama olurdu, bu yüzden
  denetim atlanır ve gerekçesi buraya yazılır.
- `ok` — "denetlenebilen her kayıt geçti" demektir. `skipped` doluysa `ok`
  tek başına yeterli bir güvence değildir; tam denetim depo kökünde koşar.

Denetim eşik **değerlerini** karşılaştırmaz — bir sayının kaynaktakiyle aynı
olduğunu makine bilemez. O sorumluluk kaydı yazana aittir; eşik değiştiğinde
defteri de güncellemek, kuralı değiştirmenin bir parçasıdır.
