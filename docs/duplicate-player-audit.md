# Yinelenen Oyuncu Kimliği Denetimi (Duplicate Player Identity Audit)

**Kapsam:** `data/players.json` (589 kayıt) — sağlayıcı kayıtları ile eski (legacy) kayıtlar arasında
**AYNI GERÇEK KİŞİYE** ait olduğundan şüphelenilen çiftlerin tespiti.
**Tarih:** 2026-07-27 · **Dal:** `claude/player-radar-verified-data-gbu36b`
**Durum:** YALNIZCA ANALİZ. Bu denetim kapsamında `docs/` dışında hiçbir dosya değiştirilmedi, hiçbir birleştirme yapılmadı.

> Bu belge bir insanın 87 satırlık kimlik birleştirmesini **onaylaması veya reddetmesi** için yazıldı.
> Her sayı gerçek bir komutla ölçüldü; tahmin yok. Ölçüm yöntemleri Ek A'da.

---

## 1. Yönetici özeti

| Bulgu | Değer |
|---|---|
| Toplam oyuncu kaydı | **589** |
| `dataStatus="provider"` | **479** (hepsinde sayısal `providerId`) |
| Legacy kayıt | **110** (`verified` 104, `manually_verified` 3, `mock_needs_verification` 2, `transfer_needs_monitoring` 1) |
| `providerId` çakışması | **0** — bu yüzden kimlik yalnızca ad/takım/mevki/yaş sezgisiyle bulunabilir |
| **Şüpheli yinelenen çift** | **87** (high 73 · medium 11 · low 3) |
| Eşleşmeyen legacy kayıt | **23** (Bölüm 8'de üç gruba ayrıldı) |
| Etkilenen profil URL'si | **174** (87 provider + 87 legacy) |
| En az bir yinelenen kimlik içeren `karsilastirma/` sayfası | **1.607 / 2.314** (%69,4) |
| Aynı kişinin kendisiyle karşılaştırıldığı sayfa | **2** |
| Etkilenen sitemap girdisi | **1.781 / 3.281** (%54,3) |

> ⛔ **Onay öncesi bilinmesi gereken sert engel:** birleştirme uygulanırsa `npm run qa`
> **kırılır**. `scripts/qa.mjs` satır 656 `sitemap >= 3000` (sonra: 2.851) ve satır 665
> `karsilastirma/ >= 2000` (sonra: 1.971) eşiklerini doğruluyor. Bu eşikler "sitemap sessizce
> küçülmesin" koruması olarak konmuş; birleştirme kararıyla birlikte **gerekçeli olarak**
> düşürülmeleri gerekir. Ayrıntı: Bölüm 10.3.1.

**Tek cümlelik sonuç:** Yinelenmenin varlığı tartışmasız (73 çift birden çok bağımsız sinyalle
doğrulanıyor), ancak birleştirmenin **yönü** tartışmalıdır: sağlayıcı kaydı güvenilirlik kapısını
geçen tek taraf (87/87), legacy kaydı ise insan verisi taşıyan taraf (52/87 çiftte daha zengin).
Bu gerilim Bölüm 6'da dürüstçe çözülüyor: **sağlayıcı kimliği kanonik olur, legacy'nin insan alanları
o kayda taşınır, legacy id `aliases[]`'e düşer** — hiçbir veri silinmez, hiçbir veri uydurulmaz.

---

## 2. Yöntem — kendi eşleştiricim

Eşleştirici sıfırdan yazıldı (`services/` içindeki `matchCanonicalPlayer` kullanılmadı; o yalnızca
`providerId` ve `birthDate+ad` eşitliğine bakıyor ve bu veri kümesinde ikisi de sonuç vermiyor).

### 2.1 Türkçe aksan katlama

```
ı → i    İ → i    I → i    ğ → g    ş → s    ç → c    ü → u    ö → o
ø → o    đ → d    ł → l    æ → ae   ß → ss
```
ardından **Unicode NFD ayrıştırması + birleştirici işaretlerin (Mn) atılması**, küçük harfe indirme,
alfasayısal olmayan her şeyin boşluğa çevrilmesi, boşluk sadeleştirmesi.

> **NFD adımı zorunlu.** `o-kokcu-besiktas` kaydının adı diskte `"O. Kök\xe7ü"` — yani
> `ö`/`ü` **ayrıştırılmış** hâlde (birleştirici U+0308 ile). Basit karakter eşlemesi bu kaydı
> `Orkun Kökçü` ile eşleştiremez. Bu, gerçek bir eşleşmenin sessizce kaçtığı somut vaka.

### 2.2 Mojibake onarımı

`UTF-8` baytları `latin-1` olarak çözülmüş adlar onarılıyor
(`O. MimoviÄ‡` → `O. Mimović`). Bkz. Bölüm 9.

### 2.3 Ad kalıpları

Sağlayıcı adlarının dağılımı (479 kayıt): **384** kısaltmalı (`U. Çakır`), **85** çok parçalı tam ad,
**10** tek parçalı (`Ederson`, `Marius`).

Uygulanan kurallar ve gücü (3 = en güçlü):

| Kural | Güç | Açıklama |
|---|---|---|
| `exact-full-name` | 3 | Katlanmış adlar birebir eşit |
| `token-set-equal` | 3 | Aynı kelime kümesi, farklı sıra (`Oh Hyeon-gyu` / `Hyeon-gyu Oh`) |
| `abbrev-initial+surname` | 3 | `X. Soyad` → legacy'nin **ilk adının baş harfi** + soyadı |
| `token-subset` | 2 | `Efe Üstün` ⊂ `Efe Yiğit Üstün` |
| `mononym-token` | 2 | Tek parçalı sağlayıcı adı legacy adının içinde |
| `abbrev-initial-in-given+surname` | 2 | Baş harf ilk ad değil, ara ad ile eşleşiyor |
| `abbrev-reversed-order` | 2 | Ad-soyad sırası ters (`N. Dorgeles` / `Dorgeles Nene`) |
| `scrambled+fuzzy-token` | 2 | ≥2 kelime birebir + kalan kelimede ≤1 harf farkı (Levenshtein) |
| `surname-only` | 1 | Yalnızca soyad; baş harf **uyuşmuyor** |

### 2.4 Destekleyici sinyaller (zorunlu)

Ad benzerliği **tek başına asla yeterli sayılmadı.** Her aday için ayrıca ölçüldü:

- **Aynı güncel takım** (`currentTeam`, katlanmış) — 87 çiftin **87'sinde** sağlanıyor.
- **Mevki grubu uyumu** — sağlayıcının kaba taksonomisi (`Goalkeeper/Defender/Midfielder/Attacker`)
  legacy'nin ince Türkçe taksonomisine (`Stoper`, `Sol bek`, `Ön libero`, `10 numara`, …) eşlendi;
  legacy'nin `secondaryPosition` alanı da ikinci bir uyumlu grup olarak sayıldı.
- **Yaş uyumu** — legacy'de `birthDate` varsa yaş 2026-07-27'ye göre **hesaplandı**, yoksa `age`
  alanı kullanıldı; sağlayıcının `age` alanıyla karşılaştırıldı.

### 2.5 Güven katmanı kuralı

```
high   = ad gücü 3 + aynı takım + mevki uyumlu + (yaş farkı ≤ 1  VEYA  yaş ölçülemiyor)
medium = ad gücü 3 + aynı takım (mevki veya yaş tek başına zayıflasa da)
       | ad gücü 2 + aynı takım + mevki uyumlu + yaş farkı ≤ 1
low    = ad gücü 2 + aynı takım + (mevki uyumlu VEYA yaş farkı ≤ 2)
       | ad gücü 1 + aynı takım + mevki uyumlu + yaş farkı ≤ 1
reject = geri kalan her şey
```

Son adım **bire-bir çözümleme**: bir sağlayıcı kaydı en fazla bir legacy kaydına, bir legacy kaydı
en fazla bir sağlayıcı kaydına bağlanabilir; skoru yüksek aday önce yerleşir.

### 2.6 Katman başına sayılar

| Aşama | Sayı |
|---|---|
| Ham aday (herhangi bir ad kuralı tutan provider×legacy çifti) | **115** |
| `reject` (destekleyici sinyaller yetersiz) | **28** |
| Kalan aday | **87** |
| Bire-bir çözümlemede çakışma nedeniyle elenen | **0** |
| **Nihai çift** | **87** — `high` **73**, `medium` **11**, `low` **3** |

**Yaş farkı dağılımı (87 çift):** 0 → 26 çift · 1 → 55 çift · 2 → 1 çift · ölçülemedi → 5 çift.
Not: sağlayıcının `age` alanı sistematik olarak legacy'nin `birthDate`'inden hesaplanan yaştan
**1 küçük** (sezon başı anlık görüntüsü). Bu tutarlı sapma eşleşmeleri zayıflatmıyor, güçlendiriyor.

**birthDate ile doğrulanan:** 87 çiftin **54'ünde** legacy tarafında `birthDate` var; bunların
**48'i** `high` katmanında. Sağlayıcı kayıtlarının **hiçbirinde** `birthDate` yok (0/479) —
bu yüzden `matchCanonicalPlayer`'ın `birthDate+ad` yolu bu veri kümesinde hiç çalışmıyor.

**Takım dağılımı (87 çift):** Beşiktaş 20 · Trabzonspor 17 · Samsunspor 17 · Galatasaray 17 · Fenerbahçe 16.

---

## 3. TAM TABLO — 87 şüpheli yinelenen çift

Sıralama: önce güven katmanı, sonra takım, sonra provider id.
`zengin kayıt` sütunu, Bölüm 6'daki 12 alanlık zenginlik ölçüsüne göre hesaplandı.
Takım sütunu her satırda özdeş — çünkü "aynı takım" eşleşmenin **ön koşulu**.

| # | Güven | provider id | legacy id | provider adı | legacy adı | takım (prov / legacy) | pozisyon (prov / legacy) | providerId (prov / legacy) | dataStatus (prov / legacy) | birthDate (legacy) | yaş prov / legacy / birthDate | zengin kayıt | eşleşmeyi sürükleyen sinyaller |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | high | `a-nubel-besiktas` | `alexander-nubel` | A. Nübel | Alexander Nübel | Beşiktaş / Beşiktaş | Goalkeeper / Kaleci | 399 / mock-alexander-nubel | provider / verified | 1996-09-30 | 29 / 29 / 29 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 2 | high | `d-alemdar-besiktas` | `dogan-alemdar` | D. Alemdar | Doğan Alemdar | Beşiktaş / Beşiktaş | Goalkeeper / Kaleci | 50104 / mock-dogan-alemdar | provider / verified | 2002-10-29 | 23 / 23 / 23 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 3 | high | `e-agbadou-besiktas` | `emmanuel-agbadou` | E. Agbadou | Emmanuel Agbadou | Beşiktaş / Beşiktaş | Defender / Stoper | 135068 / mock-emmanuel-agbadou | provider / verified | 1997-06-17 | 28 / 29 / 29 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 4 | high | `e-bilgin-besiktas` | `emre-bilgin` | E. Bilgin | Emre Bilgin | Beşiktaş / Beşiktaş | Goalkeeper / Kaleci | 275090 / mock-emre-bilgin | provider / verified | yok | 21 / 22 / - | provider (+1): numericProviderId, photo | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 5 | high | `e-topcu-besiktas` | `emirhan-topcu` | E. Topçu | Emirhan Topçu | Beşiktaş / Beşiktaş | Defender / Stoper | 50046 / mock-emirhan-topcu | provider / verified | 2000-10-11 | 25 / 25 / 25 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 6 | high | `f-uduokhai-besiktas` | `felix-uduokhai` | F. Uduokhai | Felix Uduokhai | Beşiktaş / Beşiktaş | Defender / Stoper | 25406 / mock-felix-uduokhai | provider / verified | 1997-09-09 | 28 / 28 / 28 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 7 | high | `k-ouattara-besiktas` | `kassoum-ouattara` | K. Ouattara | Kassoum Ouattara | Beşiktaş / Beşiktaş | Defender / Sol bek | 333137 / mock-kassoum-ouattara | provider / verified | 2004-10-14 | 21 / 21 / 21 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 8 | high | `k-yilmaz-besiktas` | `kartal-yilmaz` | K. Yılmaz | Kartal Yılmaz | Beşiktaş / Beşiktaş | Midfielder / Merkez orta saha | 1998 / mock-kartal-yilmaz | provider / verified | yok | 25 / 26 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 9 | high | `l-trossard-besiktas` | `leandro-trossard` | L. Trossard | Leandro Trossard | Beşiktaş / Beşiktaş | Attacker / Sol kanat | 1946 / mock-leandro-trossard | provider / verified | 1994-12-04 | 31 / 31 / 31 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 10 | high | `o-kokcu-besiktas` | `orkun-kokcu` | O. Kökçü | Orkun Kökçü | Beşiktaş / Beşiktaş | Midfielder / Merkez orta saha | 37155 / mock-orkun-kokcu | provider / verified | 2000-12-29 | 25 / 25 / 25 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 11 | high | `oh-hyeon-gyu-besiktas` | `hyeon-gyu-oh` | Oh Hyeon-Gyu | Hyeon-gyu Oh | Beşiktaş / Beşiktaş | Attacker / Santrfor | 34710 / mock-hyeon-gyu-oh | provider / verified | 2001-04-12 | 24 / 25 / 25 | legacy (+1): birthDate, nationality, number | aynı kelime kümesi (sıra farklı); aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 12 | high | `r-yilmaz-besiktas` | `ridvan-yilmaz` | R. Yılmaz | Rıdvan Yılmaz | Beşiktaş / Beşiktaş | Defender / Sol bek | 1987 / mock-ridvan-yilmaz | provider / verified | 2001-05-21 | 24 / 25 / 25 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 13 | high | `s-kilicsoy-besiktas` | `semih-kilicsoy` | S. Kılıçsoy | Semih Kılıçsoy | Beşiktaş / Beşiktaş | Attacker / Forvet | 336567 / mock-semih-90 | provider / mock_needs_verification | 2005-08-15 | 20 / 20 / 20 | legacy (+6): birthDate, contractUntil, formerTeams, heightCm, marketValueEur, nationality, preferredFoot, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 14 | high | `s-ozcan-besiktas` | `salih-ozcan` | S. Özcan | Salih Özcan | Beşiktaş / Beşiktaş | Midfielder / Ön libero | 24807 / mock-salih-ozcan | provider / verified | 1998-01-11 | 27 / 28 / 28 | legacy (+2): birthDate, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 15 | high | `taylan-bulut-besiktas` | `taylan-bulut` | Taylan  Bulut | Taylan Bulut | Beşiktaş / Beşiktaş | Defender / Sağ bek | 394663 / mock-taylan-bulut | provider / verified | 2006-01-19 | 20 / 20 / 20 | legacy (+1): birthDate, nationality, number | ad birebir eşit; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 16 | high | `w-ndidi-besiktas` | `wilfred-ndidi` | W. Ndidi | Wilfred Ndidi | Beşiktaş / Beşiktaş | Midfielder / Ön libero | 18786 / mock-wilfred-ndidi | provider / verified | 1996-12-16 | 29 / 29 / 29 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 17 | high | `a-brown-fenerbahce` | `archie-brown` | A. Brown | Archie Brown | Fenerbahçe / Fenerbahçe | Defender / Sol bek | 161661 / mock-archie-brown | provider / verified | 2002-05-28 | 23 / 24 / 24 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 18 | high | `a-diouf-fenerbahce` | `amara-diouf` | A. Diouf | Amara Diouf | Fenerbahçe / Fenerbahçe | Attacker / Sol kanat | 417861 / mock-amara-diouf | provider / verified | 2008-06-07 | 17 / 18 / 18 | legacy (+2): birthDate, formerTeams, nationality, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 19 | high | `c-soyuncu-fenerbahce` | `caglar-soyuncu` | Ç. Söyüncü | Çağlar Söyüncü | Fenerbahçe / Fenerbahçe | Defender / Stoper | 18776 / mock-caglar-soyuncu | provider / verified | 1996-05-23 | 29 / 30 / 30 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 20 | high | `i-egribayat-fenerbahce` | `irfan-can-egribayat` | İ. Eğribayat | İrfan Can Eğribayat | Fenerbahçe / Fenerbahçe | Goalkeeper / Kaleci | 62137 / mock-irfan-can-egribayat | provider / verified | 1998-06-30 | 27 / 28 / 28 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 21 | high | `i-yuksek-fenerbahce` | `ismail-yuksek` | İ. Yüksek | İsmail Yüksek | Fenerbahçe / Fenerbahçe | Midfielder / Merkez orta saha | 214463 / mock-ismail-yuksek | provider / verified | 1999-01-26 | 27 / 27 / 27 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 22 | high | `j-oosterwolde-fenerbahce` | `jayden-oosterwolde` | J. Oosterwolde | Jayden Oosterwolde | Fenerbahçe / Fenerbahçe | Defender / Sol bek | 272721 / mock-jayden-oosterwolde | provider / verified | 2001-04-26 | 24 / 25 / 25 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 23 | high | `k-akturkoglu-fenerbahce` | `kerem-akturkoglu` | K. Aktürkoğlu | Kerem Aktürkoğlu | Fenerbahçe / Fenerbahçe | Midfielder / Sol kanat | 142959 / mock-kerem-7 | provider / manually_verified | 1998-10-21 | 27 / 27 / 27 | legacy (+7): birthDate, contractUntil, formerTeams, fullName!=name, heightCm, marketValueEur, nationality, preferredFoot, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 24 | high | `m-greenwood-fenerbahce` | `mason-greenwood` | M. Greenwood | Mason Greenwood | Fenerbahçe / Fenerbahçe | Attacker / Sağ kanat | 897 / mock-mason-greenwood | provider / verified | 2001-10-01 | 24 / 24 / 24 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 25 | high | `m-guendouzi-fenerbahce` | `matteo-guendouzi` | M. Guendouzi | Mattéo Guendouzi | Fenerbahçe / Fenerbahçe | Midfielder / Merkez orta saha | 1454 / mock-matteo-guendouzi | provider / verified | 1999-04-14 | 26 / 27 / 27 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 26 | high | `m-muldur-fenerbahce` | `mert-muldur` | M. Müldür | Mert Müldür | Fenerbahçe / Fenerbahçe | Defender / Sağ bek | 1719 / mock-mert-muldur | provider / verified | yok | 26 / 27 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 27 | high | `m-skriniar-fenerbahce` | `milan-skriniar` | M. Škriniar | Milan Škriniar | Fenerbahçe / Fenerbahçe | Defender / Stoper | 198 / mock-milan-skriniar | provider / verified | 1995-02-11 | 30 / 31 / 31 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 28 | high | `n-ake-fenerbahce` | `nathan-ake` | N. Aké | Nathan Aké | Fenerbahçe / Fenerbahçe | Defender / Stoper | 18861 / mock-nathan-ake | provider / verified | 1995-02-18 | 30 / 31 / 31 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 29 | high | `n-kante-fenerbahce` | `ngolo-kante` | N. Kanté | N'Golo Kanté | Fenerbahçe / Fenerbahçe | Midfielder / Merkez orta saha | 2290 / mock-ngolo-kante | provider / verified | 1991-03-29 | 34 / 35 / 35 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 30 | high | `v-muriqi-fenerbahce` | `vedat-muriqi` | V. Muriqi | Vedat Muriqi | Fenerbahçe / Fenerbahçe | Attacker / Santrfor | 50048 / mock-vedat-muriqi | provider / verified | 1994-04-24 | 31 / 32 / 32 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 31 | high | `a-bardakci-galatasaray` | `abdulkerim-bardakci` | A. Bardakcı | Abdülkerim Bardakcı | Galatasaray / Galatasaray | Defender / Stoper | 61837 / mock-abdulkerim-42 | provider / mock_needs_verification | 1994-09-07 | 31 / 31 / 31 | legacy (+6): birthDate, contractUntil, formerTeams, heightCm, marketValueEur, nationality, preferredFoot, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 32 | high | `b-yilmaz-galatasaray` | `baris-alper-yilmaz` | B. Yılmaz | Barış Alper Yılmaz | Galatasaray / Galatasaray | Attacker / Sol kanat | 63274 / mock-baris-alper-yilmaz | provider / verified | 2000-02-23 | 25 / 26 / 26 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 33 | high | `d-sanchez-galatasaray` | `davinson-sanchez` | D. Sánchez | Davinson Sánchez | Galatasaray / Galatasaray | Defender / Stoper | 168 / mock-davinson-sanchez | provider / verified | 1996-06-12 | 29 / 30 / 30 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 34 | high | `e-elmali-galatasaray` | `eren-elmali` | E. Elmalı | Eren Elmalı | Galatasaray / Galatasaray | Defender / Sol bek | 50057 / mock-eren-elmali | provider / verified | yok | 25 / 26 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 35 | high | `g-guvenc-galatasaray` | `gunay-guvenc` | G. Güvenç | Günay Güvenç | Galatasaray / Galatasaray | Goalkeeper / Kaleci | 61950 / mock-gunay-guvenc | provider / verified | yok | 34 / 35 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 36 | high | `i-gundogan-galatasaray` | `ilkay-gundogan` | İ. Gündoğan | İlkay Gündoğan | Galatasaray / Galatasaray | Midfielder / Merkez orta saha | 633 / mock-ilkay-gundogan | provider / verified | 1990-10-24 | 35 / 35 / 35 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 37 | high | `i-jakobs-galatasaray` | `ismail-jakobs` | I. Jakobs | Ismail Jakobs | Galatasaray / Galatasaray | Defender / Sol bek | 158121 / mock-ismail-jakobs | provider / verified | 1999-08-17 | 26 / 26 / 26 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 38 | high | `k-ayhan-galatasaray` | `kaan-ayhan` | K. Ayhan | Kaan Ayhan | Galatasaray / Galatasaray | Defender / Stoper | 25448 / mock-kaan-ayhan | provider / verified | 1994-10-15 | 31 / 31 / 31 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 39 | high | `k-karatas-galatasaray` | `kazimcan-karatas` | K. Karataş | Kazımcan Karataş | Galatasaray / Galatasaray | Defender / Sağ bek | 145057 / mock-kazimcan-karatas | provider / verified | yok | 23 / 23 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (age alanından) |
| 40 | high | `l-sane-galatasaray` | `leroy-sane` | L. Sané | Leroy Sané | Galatasaray / Galatasaray | Attacker / Sol kanat | 644 / mock-leroy-sane | provider / verified | 1996-01-11 | 30 / 30 / 30 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 41 | high | `l-torreira-galatasaray` | `lucas-torreira` | L. Torreira | Lucas Torreira | Galatasaray / Galatasaray | Midfielder / Ön libero | 1462 / mock-lucas-torreira | provider / verified | 1996-02-05 | 29 / 30 / 30 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 42 | high | `l-ugochukwu-galatasaray` | `lesley-ugochukwu` | L. Ugochukwu | Lesley Ugochukwu | Galatasaray / Galatasaray | Midfielder / Merkez orta saha | 270508 / mock-lesley-ugochukwu | provider / verified | 2004-03-26 | 21 / 22 / 22 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 43 | high | `u-cakir-galatasaray` | `ugurcan-cakir` | U. Çakır | Uğurcan Çakır | Galatasaray / Galatasaray | Goalkeeper / Kaleci | 49866 / mock-ugurcan-1 | provider / manually_verified | 1996-04-05 | 29 / 30 / 30 | legacy (+6): birthDate, contractUntil, formerTeams, heightCm, marketValueEur, nationality, preferredFoot, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 44 | high | `v-osimhen-galatasaray` | `victor-osimhen` | V. Osimhen | Victor Osimhen | Galatasaray / Galatasaray | Attacker / Santrfor | 2780 / mock-victor-osimhen | provider / verified | 1998-12-29 | 27 / 27 / 27 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 45 | high | `w-singo-galatasaray` | `wilfried-singo` | W. Singo | Wilfried Singo | Galatasaray / Galatasaray | Defender / Sağ bek | 30504 / mock-wilfried-singo | provider / verified | 2000-12-25 | 25 / 25 / 25 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 46 | high | `y-akgun-galatasaray` | `yunus-akgun` | Y. Akgün | Yunus Akgün | Galatasaray / Galatasaray | Attacker / Sağ kanat | 454 / mock-yunus-akgun | provider / verified | 2000-05-24 | 25 / 26 / 26 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 47 | high | `a-makoumbou-samsunspor` | `antoine-makoumbou` | A. Makoumbou | Antoine Makoumbou | Samsunspor / Samsunspor | Midfielder / Ön libero | 290046 / mock-antoine-makoumbou | provider / verified | yok | 27 / 28 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 48 | high | `b-bayazit-samsunspor` | `bilal-bayazit` | B. Bayazıt | Bilal Bayazıt | Samsunspor / Samsunspor | Goalkeeper / Kaleci | 37111 / mock-bilal-bayazit | provider / verified | 1999-04-08 | 26 / 27 / 27 | eşit (2); legacy-özel: birthDate, nationality | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 49 | high | `c-holse-samsunspor` | `carlo-holse` | C. Holse | Carlo Holse | Samsunspor / Samsunspor | Midfielder / 10 numara | 15837 / mock-carlo-holse | provider / verified | yok | 26 / 27 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 50 | high | `c-ndiaye-samsunspor` | `cherif-ndiaye` | C. Ndiaye | Cherif Ndiaye | Samsunspor / Samsunspor | Attacker / Santrfor | 14379 / mock-cherif-ndiaye | provider / verified | yok | 30 / 31 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 51 | high | `c-yuksel-samsunspor` | `celil-yuksel` | C. Yüksel | Celil Yüksel | Samsunspor / Samsunspor | Midfielder / Ön libero | 453 / mock-celil-yuksel | provider / verified | yok | 28 / 29 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 52 | high | `e-albak-samsunspor` | `enes-albak` | E. Albak | Enes Albak | Samsunspor / Samsunspor | Defender / Stoper | 638543 / mock-enes-albak | provider / verified | yok | 20 / 21 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 53 | high | `e-kilinc-samsunspor` | `emre-kilinc` | E. Kılınç | Emre Kılınç | Samsunspor / Samsunspor | Midfielder / 10 numara | 50091 / mock-emre-kilinc | provider / verified | yok | 31 / 32 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 54 | high | `e-tavsan-samsunspor` | `elayis-tavsan` | E. Tavşan | Elayis Tavşan | Samsunspor / Samsunspor | Attacker / Sol kanat | 93001 / mock-elayis-tavsan | provider / verified | yok | 24 / 25 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 55 | high | `f-kaya-samsunspor` | `fatih-kaya` | F. Kaya | Fatih Kaya | Samsunspor / Samsunspor | Attacker / Santrfor | 25223 / mock-fatih-kaya | provider / verified | 1999-11-13 | 26 / 26 / 26 | provider (+1): numericProviderId, photo | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 56 | high | `j-mendes-samsunspor` | `joe-mendes` | J. Mendes | Joe Mendes | Samsunspor / Samsunspor | Defender / Stoper | 310029 / mock-joe-mendes | provider / verified | yok | 23 / 24 / - | provider (+1): numericProviderId, photo | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 57 | high | `l-tomasson-samsunspor` | `logi-tomasson` | L. Tómasson | Logi Tómasson | Samsunspor / Samsunspor | Defender / Stoper | 28806 / mock-logi-tomasson | provider / verified | yok | 25 / 26 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 58 | high | `o-kocuk-samsunspor` | `okan-kocuk` | O. Kocuk | Okan Kocuk | Samsunspor / Samsunspor | Goalkeeper / Kaleci | 50217 / mock-okan-kocuk | provider / verified | yok | 30 / 31 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 59 | high | `y-cift-samsunspor` | `yunus-emre-cift` | Y. Çift | Yunus Emre Çift | Samsunspor / Samsunspor | Defender / Sağ bek | 273762 / mock-yunus-emre-cift | provider / verified | yok | 22 / 23 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 60 | high | `y-kayan-samsunspor` | `yalcin-kayan` | Y. Kayan | Yalçın Kayan | Samsunspor / Samsunspor | Midfielder / Merkez orta saha | 50181 / mock-yalcin-kayan | provider / verified | yok | 27 / 28 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 61 | high | `a-batagov-trabzonspor` | `arseniy-batagov` | A. Batagov | Arseniy Batagov | Trabzonspor / Trabzonspor | Defender / Stoper | 63627 / mock-arseniy-batagov | provider / verified | 2002-03-05 | 23 / 24 / 24 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 62 | high | `a-onana-trabzonspor` | `andre-onana` | A. Onana | Andre Onana | Trabzonspor / Trabzonspor | Goalkeeper / Kaleci | 526 / mock-andre-onana | provider / verified | 1996-04-02 | 29 / 30 / 30 | legacy (+3): birthDate, formerTeams, nationality, number, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 63 | high | `a-yildirim-trabzonspor` | `ahmet-dogan-yildirim` | A. Yıldırım | Ahmet Doğan Yıldırım | Trabzonspor / Trabzonspor | Goalkeeper / Kaleci | 479721 / mock-ahmet-dogan-yildirim | provider / verified | yok | 19 / None / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş karşılaştırılamadı |
| 64 | high | `b-bouchouari-trabzonspor` | `benjamin-bouchouari` | B. Bouchouari | Benjamin Bouchouari | Trabzonspor / Trabzonspor | Midfielder / Merkez orta saha | 274355 / mock-benjamin-bouchouari | provider / verified | yok | 24 / 25 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 65 | high | `e-muci-trabzonspor` | `ernest-muci` | E. Muçi | Ernest Muçi | Trabzonspor / Trabzonspor | Attacker / Sol kanat | 3638 / mock-ernest-muci | provider / verified | yok | 24 / None / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş karşılaştırılamadı |
| 66 | high | `o-tufan-trabzonspor` | `ozan-tufan` | O. Tufan | Ozan Tufan | Trabzonspor / Trabzonspor | Midfielder / Merkez orta saha | 49942 / mock-ozan-tufan | provider / verified | yok | 30 / 31 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 67 | high | `o-yokuslu-trabzonspor` | `okay-yokuslu` | O. Yokuşlu | Okay Yokuşlu | Trabzonspor / Trabzonspor | Midfielder / Ön libero | 47443 / mock-okay-yokuslu | provider / verified | yok | 31 / 32 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 68 | high | `p-onuachu-trabzonspor` | `paul-onuachu` | P. Onuachu | Paul Onuachu | Trabzonspor / Trabzonspor | Attacker / Santrfor | 15812 / mock-paul-onuachu | provider / verified | 1994-05-28 | 31 / 32 / 32 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 69 | high | `r-malinovskyi-trabzonspor` | `ruslan-malinovskyi` | R. Malinovskyi | Ruslan Malinovskyi | Trabzonspor / Trabzonspor | Midfielder / 10 numara | 1938 / mock-ruslan-malinovskyi | provider / verified | 1993-05-04 | 32 / 33 / 33 | legacy (+1): birthDate, nationality, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 70 | high | `s-akaydin-trabzonspor` | `samet-akaydin` | S. Akaydin | Samet Akaydın | Trabzonspor / Trabzonspor | Defender / Stoper | 62490 / mock-samet-akaydin | provider / verified | 1994-03-13 | 31 / 32 / 32 | legacy (+1): birthDate, nationality, transferHistory | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (birthDate'ten) |
| 71 | high | `s-savic-trabzonspor` | `stefan-savic` | S. Savić | Stefan Savić | Trabzonspor / Trabzonspor | Defender / Stoper | 39 / mock-stefan-savic | provider / verified | 1991-01-08 | 35 / 35 / 35 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 72 | high | `t-jabol-folcarelli-trabzonspor` | `tim-jabol-folcarelli` | T. Jabol-Folcarelli | Tim Jabol-Folcarelli | Trabzonspor / Trabzonspor | Midfielder / Merkez orta saha | 22408 / mock-tim-jabol-folcarelli | provider / verified | yok | 26 / None / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş karşılaştırılamadı |
| 73 | high | `u-nayir-trabzonspor` | `umut-nayir` | U. Nayir | Umut Nayir | Trabzonspor / Trabzonspor | Attacker / Santrfor | 50246 / mock-umut-nayir | provider / verified | yok | 32 / 33 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 74 | medium | `i-fakili-besiktas` | `ilhan-fakili` | I. Fakili | İlhan Fakılı | Beşiktaş / Beşiktaş | Midfielder / Sol kanat | 446824 / mock-ilhan-fakili | provider / verified | 2006-01-20 | 19 / 20 / 20 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 1 (birthDate'ten) |
| 75 | medium | `m-rashica-besiktas` | `milot-rashica` | M. Rashica | Milot Rashica | Beşiktaş / Beşiktaş | Midfielder / Kanat | 25324 / mock-milot-rashica | provider / verified | 1996-06-28 | 29 / 30 / 30 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 1 (birthDate'ten) |
| 76 | medium | `v-cerny-besiktas` | `vaclav-cerny` | V. Černý | Vaclav Černý | Beşiktaş / Beşiktaş | Midfielder / Sol kanat | 549 / mock-vaclav-cerny | provider / verified | 1997-10-17 | 28 / 28 / 28 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 0 (birthDate'ten) |
| 77 | medium | `ederson-fenerbahce` | `ederson-santana-de-moraes` | Ederson | Ederson Santana de Moraes | Fenerbahçe / Fenerbahçe | Goalkeeper / Kaleci | 617 / mock-ederson-santana-de-moraes | provider / verified | 1993-08-17 | 32 / 32 / 32 | legacy (+1): birthDate, nationality, number | tek parçalı sağlayıcı adı legacy içinde; aynı takım; mevki grubu uyumlu; yaş farkı 0 (birthDate'ten) |
| 78 | medium | `r-sallai-galatasaray` | `roland-sallai` | R. Sallai | Roland Sallai | Galatasaray / Galatasaray | Defender / Sağ kanat | 26252 / mock-roland-sallai | provider / verified | 1997-05-22 | 28 / 29 / 29 | legacy (+1): birthDate, nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 1 (birthDate'ten) |
| 79 | medium | `badra-diabbate-ali-samsunspor` | `ali-badra-diabate` | Badra Diabbate Ali | Ali Badra Diabaté | Samsunspor / Samsunspor | Defender / Stoper | 631673 / mock-ali-badra-diabate | provider / verified | yok | 19 / 20 / - | eşit (2); legacy-özel: nationality, number | karışık sıra + 1 harf farkı; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 80 | medium | `efe-ustun-samsunspor` | `efe-yigit-ustun` | Efe Üstün | Efe Yiğit Üstün | Samsunspor / Samsunspor | Goalkeeper / Kaleci | 525877 / mock-efe-yigit-ustun | provider / verified | yok | 17 / 18 / - | eşit (2); legacy-özel: nationality, number | kelime kümesi altküme; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 81 | medium | `marius-samsunspor` | `marius-mouandilmadji` | Marius | Marius Mouandilmadji | Samsunspor / Samsunspor | Attacker / Santrfor | 531370 / mock-marius-mouandilmadji | provider / verified | yok | 28 / 29 / - | eşit (2); legacy-özel: nationality, number | tek parçalı sağlayıcı adı legacy içinde; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 82 | medium | `c-nwaiwu-trabzonspor` | `chibuike-nwaiwu` | C. Nwaiwu | Chibuike Nwaiwu | Trabzonspor / Trabzonspor | Midfielder / Sağ bek | 371027 / mock-chibuike-nwaiwu | provider / verified | yok | 22 / None / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş karşılaştırılamadı |
| 83 | medium | `m-eskihellac-trabzonspor` | `mustafa-eskihellac` | M. Eskihellaç | Mustafa Eskihellaç | Trabzonspor / Trabzonspor | Midfielder / Sol bek | 62323 / mock-mustafa-eskihellac | provider / verified | yok | 28 / 29 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 1 (age alanından) |
| 84 | medium | `o-cevikkan-trabzonspor` | `onuralp-cevikkan` | O. Çevikkan | Onuralp Çevikkan | Trabzonspor / Trabzonspor | Goalkeeper / Kaleci | 394215 / mock-onuralp-cevikkan | provider / verified | yok | 19 / 21 / - | eşit (2); legacy-özel: nationality, number | kısaltma başharf+soyad; aynı takım; mevki grubu uyumlu; yaş farkı 2 (age alanından) |
| 85 | low | `a-murillo-besiktas` | `michael-murillo` | A. Murillo | Michael Murillo | Beşiktaş / Beşiktaş | Defender / Sağ bek | 2973 / mock-michael-murillo | provider / verified | yok | 29 / 30 / - | eşit (2); legacy-özel: nationality, number | YALNIZCA soyad; aynı takım; mevki grubu uyumlu; yaş farkı 1 (age alanından) |
| 86 | low | `n-dorgeles-fenerbahce` | `dorgeles-nene` | N. Dorgeles | Dorgeles Nene | Fenerbahçe / Fenerbahçe | Midfielder / Sol kanat | 302869 / mock-dorgeles-nene | provider / verified | 2002-12-23 | 23 / 23 / 23 | legacy (+1): birthDate, nationality, number | ad-soyad sırası ters; aynı takım; mevki grubu UYUMSUZ (kanat/bek taksonomi farkı); yaş farkı 0 (birthDate'ten) |
| 87 | low | `erol-colak-trabzonspor` | `erol-can-colak` | Erol Colak | Erol Can Çolak | Trabzonspor / Trabzonspor | Goalkeeper / Kaleci | 593479 / mock-erol-can-colak | provider / verified | yok | 20 / None / - | eşit (2); legacy-özel: nationality, number | kelime kümesi altküme; aynı takım; mevki grubu uyumlu; yaş karşılaştırılamadı |

---

## 4. SEO patlama yarıçapı

### 4.1 Sayfa envanteri (diskteki gerçek dosyalar)

| Dizin | Dosya | Sitemap girdisi |
|---|---|---|
| kök | 62 | 55 |
| `oyuncular/` | 596 (589 profil + 6 kategori + 1 alias) | 595 (alias `edina-dzeko` noindex olduğu için hariç) |
| `karsilastirma/` | 2.314 | 2.314 |
| `mac/` | 306 | 306 |
| `mac-raporu/` | 8 | 8 |
| `players/` | 2 | 2 |
| **Toplam** | — | **3.281** |

### 4.2 Yinelenen kimliğe dokunan yüzeyler

| Ölçüm | Sayı |
|---|---|
| Yinelenen kimlik taşıyan profil URL'si | **174** (87 provider + 87 legacy) — hepsi sitemap'te |
| En az bir yinelenen id içeren `karsilastirma/` sayfası | **1.607** (%69,4) |
| — yalnızca legacy tarafı geçen | 1.075 |
| — yalnızca provider tarafı geçen | 657 |
| — her iki taraftan da id geçen | 125 |
| Hiç yinelenen id içermeyen karşılaştırma sayfası | **707** |
| **Aynı kişinin kendisiyle karşılaştırıldığı sayfa** | **2** |
| Etkilenen toplam sitemap girdisi | **1.781 / 3.281 (%54,3)** |

Güven katmanı başına dokunulan karşılaştırma sayfası:
`high` (73 çift) → **1.562** · `medium` (11 çift) → **94** · `low` (3 çift) → **26**.

### 4.3 Aynı kişi kendisiyle karşılaştırılıyor — iki somut sayfa

```
karsilastirma/u-cakir-galatasaray-vs-ugurcan-cakir.html
  <title>U. Çakır vs Uğurcan Çakır | Oyuncu Karşılaştırması | FutbolRadar</title>
  <meta name="description" content="U. Çakır ve Uğurcan Çakır oyuncu karşılaştırması:
        Galatasaray, mevki ve rol karşılaştırması. ...">

karsilastirma/a-bardakci-galatasaray-vs-abdulkerim-bardakci.html
  <title>A. Bardakcı vs Abdülkerim Bardakcı | Oyuncu Karşılaştırması | FutbolRadar</title>
```

Birincisi **kendi profil sayfasından linkleniyor**: `oyuncular/u-cakir-galatasaray.html` içinde
`../karsilastirma/u-cakir-galatasaray-vs-ugurcan-cakir.html` bağlantısı var. Yani okuyucu
Uğurcan Çakır'ın profilinden "Uğurcan Çakır vs Uğurcan Çakır" sayfasına gidebiliyor.
İkisi de sitemap'te ve indekslenebilir.

### 4.4 Aynı kişiyi iki kez listeleyen hub sayfaları

| Sayfa | Toplam oyuncu linki | Yinelenen id | **Aynı kişi iki kez** |
|---|---|---|---|
| `en-iyi-orta-sahalar.html` | 183 | 47 | **20 kimlik** |
| `en-iyi-forvetler.html` | 302 | 69 | **18 kimlik** |
| `en-iyi-kaleciler.html` | 66 | 28 | **14 kimlik** |
| `genc-yetenekler.html` | 197 | 26 | **11 kimlik** |
| `en-iyi-defanslar.html` | 38 | 30 | 0 (yalnızca legacy tarafı listeleniyor) |

Bu dört sayfa aynı futbolcuyu iki ayrı kart olarak gösteriyor — biri kısaltmalı adla, biri tam adla.
Okuyucu için doğrudan görünür bir güvenilirlik hatası.

### 4.5 Gelen bağlantı yüzeyleri (kırılabilecek linkler)

| Yüzey | Yinelenen id linkleyen sayfa | legacy link örneği | provider link örneği |
|---|---|---|---|
| kök sayfalar | 15 | 122 | 103 |
| `mac/` | 150 | 136 | 238 |
| `karsilastirma/` | 1.607 | 1.353 | 720 |
| `mac-raporu/`, `players/` | 0 | 0 | 0 |

`oyuncular/` altındaki 174 eşleşme profil sayfalarının **kendi canonical URL'leri**dir
(`<link rel="canonical">`, `og:url`, `twitter` etiketleri) — profil sayfaları birbirine
`oyuncular/` önekiyle link vermiyor, `./id.html` göreli biçimini kullanıyor. Yani bunlar
"gelen bağlantı" değil, kaydın kendi kimliği. Doğru kırılma riski `mac/` (150 sayfa) ve
kök hub sayfalarında (15 sayfa).

### 4.6 Tek bir kayıt karşılaştırma grafiğini ele geçirmiş

`karsilastirma/` dosya adlarından sayılan katılım (ilk 10):

```
588  ugurcan-cakir          <- legacy, 2.314 sayfanın %25,4'ü
378  mauro-icardi           <- legacy (lig dışı, serbest oyuncu)
190  abdulkerim-bardakci    <- legacy
185  sebastian-szymanski    <- legacy (lig dışı, Rennes)
153  c-akgun-galatasaray    <- provider
126  c-guner-galatasaray    <- provider
104  u-cakir-galatasaray    <- provider
103  gunay-guvenc           <- legacy
 86  e-elmali-galatasaray   <- provider
 62  k-karatas-galatasaray  <- provider
```

`ugurcan-cakir` tek başına karşılaştırma sayfalarının dörtte birinde. Sebebi
`profileCompareCandidates()`'in "rating yakınlığı" düşüşü: legacy kayıtların türetilmiş
`overallRating` değerleri sağlayıcı kayıtlarınkinden farklı bir aralıkta olduğu için bu kayıt
neredeyse herkesin "en yakın rating" adayı oluyor. Birleştirme yönü seçilirken bu tek kayıt
churn'ün en büyük belirleyicisi.

### 4.7 Birleştirme sonrası sayfa churn'ü — simüle edildi, tahmin edilmedi

`scripts/generate-player-comparison-pages.mjs` içindeki `buildPairs()` mantığı **birebir**
yeniden uygulanıp (salt-okunur, hiçbir dosya yazılmadan) iki senaryo çalıştırıldı.
Doğrulama: simülasyon mevcut veri kümesinde tam olarak **2.314** sayfa üretiyor — üreticinin
diskteki çıktısıyla birebir aynı.

| Senaryo | Kalan sayfa | Silinen | Yeni oluşan | Değişmeyen | Slug'ında düşen id **olmayan** silinen (kolateral) |
|---|---|---|---|---|---|
| **A — provider kalır** (87 legacy kayıt düşer) | 1.971 | **1.088** | 745 | 1.226 | 13 |
| **B — legacy kalır** (87 provider kayıt düşer) | 1.968 | **712** | 366 | 1.602 | 55 |
| C — yalnızca `high` çiftler, provider kalır (73 kayıt düşer) | 2.025 | 1.082 | 793 | 1.232 | 17 |

Sitemap sonucu: A senaryosunda 3.281 → **2.851**, B senaryosunda 3.281 → **2.848**.

> **Kritik uyarı:** `generate-player-comparison-pages.mjs` (satır 575-581) beklenen küme dışındaki
> her `.html` dosyasını **siliyor** (`fs.unlinkSync`). Yani A senaryosunda 1.088 URL, hiçbir
> yönlendirme konmazsa doğrudan **404** olur. Bu sayfaların 2.314'ünün tamamı şu anda sitemap'te
> ve indekslenmeye açık.

---

## 5. Güvenilirlik kapısı — gerilimin sayısal hâli

`services/cardCredibility.js` içindeki `evaluatePlayerCard()` bütün 174 kayda uygulandı
(salt-okunur, `now = 2026-07-27T12:00:00Z`):

| Küme | Kapıyı geçen | Geçemeyen | Gerekçeler |
|---|---|---|---|
| 87 provider kaydı | **87** | 0 | — |
| 87 legacy kaydı | **0** | **87** | `sağlayıcı kimliği yer tutucu (mock)` ×87, `kaynak bağlantısı yok` ×4, `dataStatus "mock_needs_verification"` ×2 |
| Tüm veri kümesi (589) | 479 | 110 | — |

`publicPlayerView(...).verified`: provider tarafı **87/87**, legacy tarafı **0/87**.
`verifiedRadarAxes(...).length > 0`: **her iki tarafta da 0/87** — yani legacy kayıtların
taşıdığı radar/rating sayıları zaten hiçbir yüzeyde yayımlanmıyor.

**Bunun anlamı:** legacy kaydın "zenginliği" **yayımlanabilir zenginlik değil.** Kapının reddettiği
tek ve yeterli sebep `mock-*` `providerId`. Legacy kaydı kanonik yapmak (Senaryo B), 87 kimliğin
tamamını yayımlanamaz hâle getirirdi.

### 5.1 Hangi taraf gerçekten daha zengin?

12 alanlık zenginlik ölçüsü (`birthDate`, `fullName≠name`, `transferHistory`, `formerTeams`,
`heightCm`, `marketValueEur`, `nationality`, `number`, `preferredFoot`, `contractUntil`,
`photo`, sayısal `providerId`):

| Ölçüm | Sonuç |
|---|---|
| Ortalama zenginlik — provider | 2,00 |
| Ortalama zenginlik — legacy | 3,03 |
| Legacy daha zengin | **52 / 87 çift** |
| Provider daha zengin | 3 / 87 çift |
| Eşit | 32 / 87 çift |

**Yalnızca legacy'de olan alanlar** (87 çift içinde kaç kez):
`nationality` **85** · `number` **77** · `birthDate` **54** · `transferHistory` **17** ·
`formerTeams` **14** · `contractUntil` **4** · `heightCm` **4** · `marketValueEur` **4** ·
`preferredFoot` **4** · `fullName≠name` **1**

**Yalnızca provider'da olan alanlar:** sayısal `providerId` **87** · lisanslı `photo` **87**.

---

## 6. Kanonik yön önerisi ve gerekçesi

### 6.1 Kural

> **Sağlayıcı kaydının `id`'si kanonik olur. Legacy `id` `aliases[]`'e düşer.
> Legacy kaydın insan alanları (yalnızca sağlayıcıda BOŞ olanlar) kanonik kayda taşınır.
> Hiçbir alan silinmez, hiçbir alan uydurulmaz.**

Bu, 87 çiftin **87'si** için önerilen yön. İstisna yok — gerekçe her satırda aynı ve ölçüldü.

### 6.2 Gerekçe — gerilimin dürüst analizi

Görev tanımında işaret edilen gerilim gerçek ama **simetrik değil**:

| | Sağlayıcı kaydı | Legacy kaydı |
|---|---|---|
| Sayısal `providerId` | ✅ 87/87 | ❌ 0/87 (hepsi `mock-*`) |
| Güvenilirlik kapısını geçiyor | ✅ 87/87 | ❌ 0/87 |
| Lisanslı fotoğraf | ✅ 87/87 | ❌ 0/87 |
| `birthDate` | ❌ 0/87 | ✅ 54/87 |
| `nationality` | ❌ 0/87 | ✅ 85/87 |
| Forma numarası | ❌ 0/87 | ✅ 77/87 |
| `transferHistory` | ❌ 0/87 | ✅ 17/87 |
| Tam ad (kısaltmasız) | ❌ 85/87'de kısaltma | ✅ 87/87 |
| Yayımlanabilir radar ekseni | 0/87 | **0/87** |

Asimetrinin çekirdeği şu: **sağlayıcı tarafının eksikleri doldurulabilir, legacy tarafının eksiği
doldurulamaz.**

- Legacy'nin `birthDate`, `nationality`, `number`, `transferHistory`, `formerTeams`, `fullName`
  alanları **taşınabilir veridir** — kanonik kayda kopyalanınca hiçbir şey kaybolmaz ve hiçbir
  şey uydurulmuş olmaz (bunlar zaten elle doğrulanmış, `dataStatus: "verified"` kayıtlar).
- Sağlayıcı tarafındaki sayısal `providerId` **üretilemez**. `mock-ugurcan-1` bir kimlik değil,
  yer tutucudur. Kanonik yönü legacy'ye çevirmek, 87 kimliğin `cardCredibility` kapısından
  düşmesi ve sitede görünmez olması demektir — üstelik bu, sitenin bilinçli olarak koyduğu
  "kimliği gösterilemeyen kayıt yayımlanmaz" kuralının doğru çalışması olurdu.
- Legacy tarafın "daha zengin" görünen **rating/piyasa/istatistik** alanları zaten
  yayımlanamıyor (`verifiedRadarAxes` = 0/87). Yani karşı tarafın avantajı, ölçülünce
  büyük ölçüde buharlaşıyor.

### 6.3 Kanonik yön seçiminin churn maliyeti — ve neden yine de A

Senaryo B (legacy kalır) daha az sayfa yıkıyor (712 vs 1.088). Bu **tek başına** B'yi cazip
gösteriyor. Ama:

1. B, 87 kimliği yayımlanamaz yapar → SEO kazancı değil, 87 profilin içeriksizleşmesi.
2. B'nin 55 kolateral silmesi var (A'da 13) — yani B, slug'ında düşen id **bulunmayan** daha çok
   sayfayı da yeniden sıralamayla yok ediyor.
3. B'de sağlayıcı senkronu bir sonraki koşusunda aynı sağlayıcı kayıtlarını **yeniden yaratır**
   (Bölüm 11) — yani B kalıcı değil.

A'nın 1.088 sayfalık silmesi ise **yönlendirilebilir** bir maliyettir (Bölüm 10.4).

### 6.4 Alan taşıma kuralı (uydurma üretmeyen tek biçim)

```
kanonik = sağlayıcı kaydı
for alan in [fullName, birthDate, nationality, number, heightCm, marketValueEur,
             preferredFoot, contractUntil, formerTeams, transferHistory, secondaryPosition]:
    if kanonik[alan] boş  ve  legacy[alan] dolu:
        kanonik[alan] = legacy[alan]          # yalnızca boşluk doldurma
    # dolu alanın üzerine YAZILMAZ; iki taraf da doluysa çatışma kaydı açılır
```

**Taşınmaması gerekenler:** `rating`, `aiRating`, `overallRating`, `marketValue*` dışındaki tüm
sayısal performans alanları, `radar.*`, `form`, `trend*`, `*Score`, `*Rating`. Bunlar legacy
kayıtlarda türetilmiş/varsayılan değerlerdir; `cardCredibility` zaten hiçbirini yayımlamıyor
(0/87 doğrulanmış radar ekseni). Bunları sağlayıcı kaydına taşımak, **yalnızca kimliği doğrulanmış
bir kaba doğrulanmamış sayı koymak** olurdu — yani kimlik birleştirmesini bir güvenilirlik
gerilemesine çevirirdi. **Taşınmaz.**

`marketValueEur` (4 çift) ve `heightCm` (4 çift) sınır vakadır: bunlar `RESTRICTED_FIELDS`
içinde ve `marketValueIsVerified` kapısına tabi. Taşınabilirler, ama kapı onları yine
yayımlamaz; taşımanın tek faydası veriyi kaybetmemek.

---

## 7. Emin OLMADIĞIM eşleşmeler ve gereken kanıt

### 7.1 `low` katmanı — 3 çift (insan kararı olmadan birleştirilmemeli)

| # | provider | legacy | Neden emin değilim | Gereken kanıt |
|---|---|---|---|---|
| 85 | `a-murillo-besiktas` (A. Murillo, 29, Defender) | `michael-murillo` (Michael Murillo, 30, Sağ bek) | Baş harf **uyuşmuyor**: `A` ≠ `M`. Eşleşme yalnızca soyad + takım + mevki + yaş(1) üzerinden. Kişinin tam adında ikinci bir ad varsa (`Michael Amir Murillo`) sağlayıcı ikinci adı kısaltmış olabilir; ama bunu **veriden doğrulayamıyorum** — legacy `fullName` alanı `Michael Murillo`, ara ad taşımıyor. | API-Football `providerId=2973` kaydının tam adı ve doğum tarihi; ya da Beşiktaş kadro listesinde ikinci bir Murillo olmadığının teyidi. |
| 86 | `n-dorgeles-fenerbahce` (N. Dorgeles, 23, Midfielder) | `dorgeles-nene` (Dorgelès Nene, 23, Sol kanat) | Ad-soyad sırası ters. Sağlayıcı `Dorgeles`'i **soyad**, legacy `Nene`'yi soyad kabul ediyor. Yaş birebir (23/23, `birthDate` 2002-12-23'ten). Mevki grubu uyumsuz (Midfielder ↔ Sol kanat). | `providerId=302869` kaydının doğum tarihi. `2002-12-23` çıkarsa eşleşme kesinleşir. |
| 87 | `erol-colak-trabzonspor` (Erol Colak, 20, Goalkeeper) | `erol-can-colak` (Erol Can Çolak, yaş yok, Kaleci) | Kelime kümesi altküme (`erol colak` ⊂ `erol can colak`) ama legacy'de **ne `age` ne `birthDate`** var; yaş karşılaştırması hiç yapılamadı. Trabzonspor'da başka bir Erol Çolak olmadığını veriden doğrulayamıyorum. | Legacy kayda `birthDate` girilmesi veya `providerId=593479`'un doğum tarihi. |

### 7.2 `medium` katmanı — 11 çift

Bunların **7'sinde** tek zayıflık **mevki taksonomisi**: sağlayıcı kanat oyuncularını
`Midfielder`/`Defender` olarak sınıflandırırken legacy `Sol kanat`/`Sağ bek` diyor.
Bu bir **çelişki değil, taksonomi farkı** — hepsi geniş alan (kanat/bek) oyuncusu:

`m-eskihellac-trabzonspor` (Midfielder ↔ Sol bek) · `c-nwaiwu-trabzonspor` (Midfielder ↔ Sağ bek) ·
`r-sallai-galatasaray` (Defender ↔ Sağ kanat) · `v-cerny-besiktas` (Midfielder ↔ Sol kanat) ·
`m-rashica-besiktas` (Midfielder ↔ Kanat) · `i-fakili-besiktas` (Midfielder ↔ Sol kanat) ·
`n-dorgeles-fenerbahce` (Midfielder ↔ Sol kanat, `low`)

Bunların 4'ünde legacy `birthDate` de var (Sallai 1997-05-22, Černý 1997-10-17,
Rashica 1996-06-28, Fakılı 2006-01-20) ve yaş farkı ≤ 1 — pratikte `high` sayılabilirler.
**Gereken kanıt:** hiçbiri; mevki taksonomisi eşlemesinin kanat oyuncularını
`Midfielder`+`FW` olarak çift gruplaması yeterli. Yine de insan gözüyle bakılması ucuz.

Kalan 4 `medium` çift ayrı ayrı ele alınmalı:

| # | provider | legacy | Zayıflık | Gereken kanıt |
|---|---|---|---|---|
| 79 | `badra-diabbate-ali-samsunspor` (Badra Diabbate Ali, 19, Defender) | `ali-badra-diabate` (Ali Badra Diabaté, 20, Stoper) | Kelime sırası karışık **ve** `diabbate` ≠ `diabate` (1 harf). Samsunspor kadrosunda **ikinci bir Diabaté var**: `cheick-tidiane-diabate` (19, Santrfor) — eşleştirici onu 0,93 benzerlikle bu kayda yakın buldu ama mevki ve ad çekirdeği farklı olduğu için eşleştirmedi. **Yanlış kişiyi birleştirme riski burada en yüksek.** | `providerId=631673` kaydının tam adı + doğum tarihi. İki Diabaté'nin doğum tarihleri ayrıştırıcı olur. |
| 80 | `efe-ustun-samsunspor` (Efe Üstün, 17, Goalkeeper) | `efe-yigit-ustun` (Efe Yiğit Üstün, 18, Kaleci) | Legacy'de `birthDate` yok; yaş yalnızca `age` alanından. Genç kaleci — akademide aynı soyadlı ikinci bir Efe olması mümkün. | Doğum tarihi veya forma numarası eşleşmesi. |
| 81 | `marius-samsunspor` (Marius, 28, Attacker) | `marius-mouandilmadji` (Marius Mouandilmadji, 29, Santrfor) | Sağlayıcı tek parçalı ad göndermiş (`Marius`); eşleşme yalnızca ilk ad + takım + mevki + yaş. | `providerId=531370` kaydının tam adı. |
| 84 | `o-cevikkan-trabzonspor` (O. Çevikkan, 19, Goalkeeper) | `onuralp-cevikkan` (Onuralp Çevikkan, 21, Kaleci) | **Yaş farkı 2** — 87 çift içinde tek. Legacy'de `birthDate` yok, yani fark gerçek mi yoksa `age` alanı bayat mı ayırt edilemiyor. | Doğum tarihi. |

### 7.3 `high` içindeki 5 çift — aynı takımda aynı soyad uyarısı

Bu 5 çiftte eşleşme doğru görünüyor ama **kısaltma tek başına ayırt edici değil**; baş harf
ayrımı olmasa yanlış birleşirdi. Kural değişirse ilk kırılacak yer burası:

| Çift | Aynı takımdaki aynı soyadlı diğer kayıt |
|---|---|
| `y-akgun-galatasaray` ↔ `yunus-akgun` | `c-akgun-galatasaray` (C. Akgun, 16, Midfielder) |
| `b-yilmaz-galatasaray` ↔ `baris-alper-yilmaz` | `a-yilmaz-galatasaray` (A. Yilmaz, 17, Goalkeeper) |
| `s-ozcan-besiktas` ↔ `salih-ozcan` | `y-ozcan-besiktas` (Y. Ozcan, 19, Defender) |
| `r-yilmaz-besiktas` ↔ `ridvan-yilmaz` | `k-yilmaz-besiktas` (K. Yılmaz, 25, Midfielder) + legacy `kartal-yilmaz` |
| `k-yilmaz-besiktas` ↔ `kartal-yilmaz` | `r-yilmaz-besiktas` (R. Yılmaz, 24, Defender) + legacy `ridvan-yilmaz` |

Son iki satır **birbirinin aynası**: Beşiktaş'ta iki Yılmaz var (R. ve K.), ikisinin de legacy
karşılığı var (Rıdvan ve Kartal). Baş harf + mevki + yaş üçlüsü ikisini doğru ayırıyor
(R→Rıdvan/Defender/24-25, K→Kartal/Midfielder/25-26). Ama `kartal-yilmaz` kaydında `birthDate`
**yok**; bu çift için doğum tarihi istemek makul.

### 7.4 Sağlayıcının kendi içinde kanıtladığı risk

`data/player-sync-review-queue.json` içinde **aynı kısaltmayı taşıyan ama FARKLI kişiler** var
(kadro anlık görüntüsünden doğrulandı):

| Kısaltma | Kayıt 1 | Kayıt 2 |
|---|---|---|
| `E. Aydın` | Konyaspor, providerId 478077, Goalkeeper, 18 | Gençlerbirliği, providerId 62166, Goalkeeper, 25 |
| `E. Dogan` / `E. Doğan` | Konyaspor, 645517, Midfielder, 17 | Rizespor, 333526, Goalkeeper, 21 |
| `A. Traoré` | Gençlerbirliği, 3347, Attacker, 30 | Amed, 3343, Midfielder, 30 |
| `A. Şimşir` | Trabzonspor, 161790, Attacker, 23 | Çorum FK, 339958, Goalkeeper, 20 |

Bunların hiçbiri benim 87 çiftimde değil (farklı takımlar), ama **kısaltmanın kimlik olmadığını**
kanıtlıyorlar. "Aynı takım" ön koşulunu kaldırmak yanlış birleştirme üretir.

---

## 8. Eşleşmeyen 23 legacy kaydı

### 8.1 Süper Lig dışı — 4 kayıt (yinelenme değil, doğru davranış)

| id | Ad | Takım |
|---|---|---|
| `mauro-icardi` | Mauro Icardi | Serbest oyuncu |
| `edin-dzeko` | Edin Dzeko | Schalke 04 |
| `sebastian-szymanski` | Sebastian Szymanski | Rennes |
| `gedson-fernandes` | Gedson Fernandes | Spartak Moskova |

Bunlar hiçbir Süper Lig kadrosunda olmadığı için sağlayıcı karşılıkları yok. `edin-dzeko`
zaten sitedeki tek `aliases[]` kullanıcısı (`edina-dzeko`).

### 8.2 Senkron tarafından zaten bloklanmış — 8 kayıt

`data/player-sync-review-queue.json` → `nameCollisions`. Sağlayıcı bu 8 oyuncuyu **tam adıyla**
gönderiyor; `matchCanonicalPlayer()` `name-only-review-required` döndürüyor ve
`reconcileSquadPlayer()` **yeni kayıt açmıyor**. Yani mekanizma burada doğru çalıştı —
yinelenme oluşmadı, insan kararı bekleniyor:

| legacy id | Sağlayıcı kadro satırı | providerId |
|---|---|---|
| `gabriel-sara` | Galatasaray / Gabriel Sara / Midfielder / 26 | 80552 |
| `nelson-semedo` | Fenerbahçe / Nélson Semedo / Defender / 32 | 130 |
| `fred` | Fenerbahçe / Fred / Midfielder / 32 | 905 |
| `talisca` | Fenerbahçe / Talisca / Attacker / 32 | 12724 |
| `marco-asensio` | Fenerbahçe / Marco Asensio / Midfielder / 30 | 746 |
| `tiago-djalo` | Beşiktaş / Tiago Djaló / Defender / 25 | 1479 |
| `wagner-pina` | Trabzonspor / Wagner Pina / Defender / 23 | 332056 |
| `afonso-sousa` | Samsunspor / Afonso Sousa / Midfielder / 25 | 130262 |

**Bunlar bir birleştirme değil, bir `providerId` iliştirmesi ister:** legacy kayıt zaten doğru
kişidir, tek eksiği sayısal kimlik. `mock-*` yerine yukarıdaki `providerId` yazılırsa 8 kayıt
güvenilirlik kapısını **hemen** geçer ve yeni URL üretilmez, hiçbir sayfa silinmez.
**Bu, 87 satırlık birleştirmeden bağımsız, çok daha düşük riskli bir kazanç.**

### 8.3 Sağlayıcı kadrosunda hiç yok — 11 kayıt

| legacy id | Ad | Takım |
|---|---|---|
| `victor-nelsson` | Victor Nelsson | Galatasaray |
| `elias-jelert` | Elias Jelert | Galatasaray |
| `mario-lemina` | Mario Lemina | Galatasaray |
| `dominik-livakovic` | Dominik Livaković | Fenerbahçe |
| `mert-hakan-yandas` | Mert Hakan Yandaş | Fenerbahçe |
| `cenk-ozkacar` | Cenk Özkaçar | Trabzonspor |
| `arda-ozturk` | Arda Öztürk | Trabzonspor |
| `bedirhan-cetin` | Bedirhan Çetin | Samsunspor |
| `elliot-watt` | Elliot Watt | Samsunspor |
| `samed-onur` | Samed Onur | Samsunspor |
| `cheick-tidiane-diabate` | Cheick Tidiane Diabate | Samsunspor |

Hiçbirinin adı 496 kadro satırının hiçbiriyle yakın eşleşme vermiyor — muhtemelen ayrılmış
veya kiralanmış oyuncular. Yinelenme değiller; ayrı bir "kadro dışı" temizliği konusu.

> **`cheick-tidiane-diabate` özel not:** ad benzerliği bakımından `badra-diabbate-ali-samsunspor`
> kaydına 0,93 yakın. Eşleştirici onu **kasıtlı olarak** eşleştirmedi (79. çift `ali-badra-diabate`
> ile eşleşti). Bu iki Diabaté karıştırılırsa **iki farklı gerçek kişi** birleştirilmiş olur.

---

## 9. Veri hijyeni bulguları (birleştirmeden bağımsız, ama birleştirmeyi bozan)

Ad alanlarında 9 kayıtta kodlama/boşluk bozukluğu var. Bunlar sessizce yinelenme üretiyor
çünkü `slug` üretimi bozuk karakterden türetiliyor:

| Tür | Sayı | Kayıtlar |
|---|---|---|
| NFD (ayrıştırılmış birleştirici işaret) | 2 | `o-kokcu-besiktas` = `"O. Kök̈çü"` · `t-ince-trabzonspor` = `"T. İnce"` |
| Mojibake (UTF-8 → latin-1) | 4 | `o-mimovia-fenerbahce` = `"O. MimoviÄ‡"` (→ Mimović) · `b-baa-kan-trabzonspor` = `"B. BaÅ\x9fkan"` (→ Başkan) · `c-inao-oulaa-trabzonspor` = `"C. Inao OulaÃ¯"` (→ Oulaï) · `u-ii-slamoa-lu-genclerbirligi-s-k` = `"U. IÌ\x87slamoÄ\x9flu"` (→ İslamoğlu) |
| Sondaki NBSP (U+00A0) | 1 | `tahsin-bulbul-samsunspor` = `"Tahsin Bülbül\xa0"` |
| Çift boşluk | 2 | `taylan-bulut-besiktas` = `"Taylan  Bulut"` · `adedire-emmanuel-awokoya-mebude-rizespor` |

Mojibake vakalarında **slug da bozuk**: `mimovia`, `baa-kan`, `oulaa`, `ii-slamoa-lu`.
Bunlar kalıcı URL'ler ve sitemap'te.

`"Taylan  Bulut"` çift boşluk vakası, `squadSyncService.normalizedName()`'in yorum satırında
zaten belgelenmiş bir hata (boşluk sadeleştirmesi eklenmiş) — ama **o hatanın ürettiği yinelenen
kayıt hâlâ duruyor**: `taylan-bulut-besiktas` (provider) + `taylan-bulut` (legacy).
Bu, tablodaki tek `exact-full-name` eşleşmesi (59. satır). Düzeltme kodda yapılmış, veride yapılmamış.

---

## 10. Birleştirme prosedürü (mevcut `aliases[]` + `aliasHtml()` mekanizmasıyla)

Yeni mekanizma **gerekmiyor**. `edin-dzeko` → `edina-dzeko` için kurulmuş olan yol aynen kullanılabilir.

### 10.1 Mekanizmanın bugünkü hâli

`scripts/generate-player-profile-pages.mjs`:

- satır 431-435: her oyuncu için `player.aliases || []` gezilir, her alias için `aliasHtml()`
  çıktısı `oyuncular/<alias>.html` ve `public/oyuncular/<alias>.html` olarak yazılır.
- satır 371-384 (`aliasHtml`): alias sayfası `<link rel="canonical" href=".../oyuncular/<kanonik>.html">`,
  `<meta name="robots" content="noindex,follow">`, `<meta http-equiv="refresh" content="0; url=./<kanonik>.html">`
  ve bir `window.location.replace()` taşır.
- `scripts/generate-sitemap.mjs` (satır 68): `content="noindex` gören her sayfayı sitemap dışında
  bırakır. Yani alias sayfaları **kendiliğinden** sitemap'ten düşer — ek iş yok.
- `vercel.json` `redirects`: `edina-dzeko` için ayrıca **kalıcı 301** tanımlı
  (`/oyuncular/edina-dzeko` ve `/oyuncular/edina-dzeko.html` → `/oyuncular/edin-dzeko.html`).

### 10.2 Çift başına adımlar

Her onaylanmış çift için, `data/players.json` üzerinde:

1. **Kanonik kaydı seç:** sağlayıcı kaydı (örn. `u-cakir-galatasaray`).
2. **Alias ekle:** kanonik kayda `"aliases": ["ugurcan-cakir"]` (varsa listeye ekle).
3. **Alanları taşı:** Bölüm 6.4'teki boşluk-doldurma kuralı. Performans/rating alanları **taşınmaz**.
4. **Legacy kaydı sil:** `data/players.json`'dan legacy nesne çıkarılır.
   (Silinmezse 589 kayıt kalır ve alias sayfası ile gerçek profil sayfası **çakışır** —
   `aliasHtml()` aynı dosya adına yazar ve profil üretim döngüsünde hangisinin sonra yazıldığına
   bağlı bir yarış oluşur.)
5. **`vercel.json`'a 301 ekle:**
   ```
   { "source": "/oyuncular/ugurcan-cakir",      "destination": "/oyuncular/u-cakir-galatasaray.html", "permanent": true },
   { "source": "/oyuncular/ugurcan-cakir.html", "destination": "/oyuncular/u-cakir-galatasaray.html", "permanent": true }
   ```
   87 çift → 174 yönlendirme kuralı. `vercel.json` şu anda **12** yönlendirme kuralı taşıyor
   (ölçüldü); 12 + 174 = **186** olur. Vercel'in kural sayısı üst sınırı bu denetimde
   **ölçülmedi** — dağıtımdan önce platform limitinin doğrulanması gerekir.

### 10.3 Sonrasında kendiliğinden olanlar

- `generate-player-profile-pages.mjs`: 589 → **502** profil + **87** alias sayfası üretir.
  Toplam dosya sayısı `oyuncular/` altında değişmez (596 → 596: 502 profil + 88 alias + 6 kategori).
- `generate-sitemap.mjs`: alias sayfaları `noindex` olduğu için sitemap 595 → **508** `oyuncular/` girdisi.
- `generate-search-index.mjs`: 589 → 502 `player` girdisi.
  ⚠️ `scripts/test-player-surface-enforcement.mjs` satır 214 `entries.length === players.length`
  eşitliğini ve satır 211 `>= 110` tabanını doğruluyor. 502 ≥ 110 olduğu için taban geçer,
  eşitlik de korunur (ikisi de veri kümesinden türüyor). **Kırılmaz.**

### 10.3.1 ⛔ `npm run qa` BU HÂLİYLE KIRILIR — birleştirmenin sert engeli

`scripts/qa.mjs` sitemap üzerinde sabit taban eşikleri doğruluyor. Senaryo A sonrası ölçülen
değerlerle karşılaştırma:

| `qa.mjs` satırı | Kontrol | Bugün | Senaryo A sonrası | Sonuç |
|---|---|---|---|---|
| 656-658 | `sitemapLocs.size >= 3000` | 3.281 | **2.851** | ❌ **KIRILIR** |
| 665 | `karsilastirma/ >= 2000` | 2.314 | **1.971** | ❌ **KIRILIR** |
| 664 | `oyuncular/ >= 500` | 595 | 508 | ✅ geçer (8 girdi marj) |
| 666 | `mac/ >= 250` | 306 | 306 | ✅ geçer |
| 667 | `mac-raporu/ >= 5` | 8 | 8 | ✅ geçer |

Bu eşikler bilinçli konmuş "sitemap sessizce küçülmesin" korumaları. Birleştirme onaylanırsa
**bu iki eşiğin kasıtlı olarak düşürülmesi** ve düşürme gerekçesinin yorum satırına yazılması
gerekir — aksi hâlde build/QA zinciri durur. Bunu bir "test düzeltmesi" gibi sessizce yapmak
tam da eşiklerin engellemek için var olduğu şeydir; kararın belgeli olması şart.

`oyuncular/ >= 500` eşiği ise **8 girdilik marjla** hayatta kalıyor. Birleştirmeye ek olarak
Bölüm 8.3'teki 11 kadro dışı kayıt da temizlenirse 497 olur ve **o eşik de kırılır**.

### 10.4 Karşılaştırma sayfaları — asıl iş burada

`generate-player-comparison-pages.mjs` beklenen küme dışındaki dosyaları **siler** (satır 575-581).
Simülasyona göre Senaryo A'da **1.088 URL kaybolur, 745 yeni URL doğar** (Bölüm 4.7).

Önerilen ele alış:

1. **Silinen 1.088 URL'nin 1.075'i** slug'ında düşen bir legacy id taşıyor. Bunlar için
   `karsilastirma/<eski-slug>.html` → yeni kanonik slug (`legacy-id` → `provider-id` ikamesiyle
   hesaplanan) 301 kuralı **hesaplanabilir**. Ancak 1.075 statik kuralı `vercel.json`'a yazmak
   pratik değil. `/karsilastirma/:slug` rewrite'ı zaten var; slug normalizasyonunu sunucu
   tarafında yapan küçük bir `api/` fonksiyonu daha temiz olur. Bu, bu denetimin kapsamı
   dışında bir mimari karar.
2. **Alternatif ve daha ucuz yol:** karşılaştırma sayfalarını birleştirmeden **önce**
   kademeli olarak azaltmak — 2.314 sayfanın 707'si zaten hiçbir yinelenen kimlik içermiyor.
   `ugurcan-cakir` (588 sayfa), `mauro-icardi` (378), `sebastian-szymanski` (185) üçlüsü
   tek başına 1.151 sayfayı besliyor ve **üçünün ikisi Süper Lig'de bile değil.**
   `profileCompareCandidates()`'in lig dışı oyuncuları aday havuzundan çıkarması,
   birleştirmeden bağımsız olarak indeks şişkinliğini ciddi biçimde azaltır.
3. **Kalan 13 kolateral silme** (slug'ında düşen id olmayan) için yönlendirme hedefi
   belirsizdir; bunlar `oyuncu-karsilastirmalari.html` dizinine yönlendirilebilir.

> **Kardeş analizle kesişim:** Aynı dalda `docs/thin-comparison-noindex-impact.md` adlı ayrı bir
> denetim, `karsilastirma/` altındaki 2.314 sayfanın tamamının **noindex** yapılması kararını
> inceliyor (kendi ölçümüne göre: `<main>` içinde ortanca 111 kelime, ortanca %51,4 şablon,
> ölçülmüş kıyas cümlesi taşıyan sayfa 19). **İki karar birbirini sadeleştiriyor:** eğer
> karşılaştırma sayfaları noindex'e alınırsa bu bölümdeki 1.088 URL'lik silme maliyeti büyük
> ölçüde **ortadan kalkar** — indekste olmayan bir URL'nin 404 olması SEO kaybı değildir — ve
> `qa.mjs`'in `karsilastirma/ >= 2000` sitemap eşiği de zaten sıfırlanmış olur. Kimlik
> birleştirmesini onaylayacak kişinin o belgeyi **birlikte** okuması önerilir; sıralama:
> önce noindex kararı, sonra birleştirme, en ucuz yol budur.

### 10.5 Sıralama önerisi (riski aşamalandırmak için)

| Aşama | İçerik | Risk | Geri alınabilir mi |
|---|---|---|---|
| 0 | Bölüm 9'daki 9 kodlama bozukluğunu düzelt (slug'lar dâhil) | düşük | evet |
| 1 | Bölüm 8.2'deki 8 kayda gerçek `providerId` yaz (birleştirme yok, URL değişmiyor) | çok düşük | evet |
| 2 | `low` + belirsiz `medium` 7 çift için doğum tarihi kanıtı topla | yok | — |
| 3 | `qa.mjs` sitemap eşiklerini gerekçeli olarak düşür (Bölüm 10.3.1) | düşük | evet |
| 4 | 73 `high` çifti birleştir | orta | evet (alias + 301) |
| 5 | Kanıtlanan `medium`/`low` çiftleri birleştir | orta | evet |
| 6 | Karşılaştırma grafiği yönlendirme stratejisi | yüksek | kısmen |

---

## 11. `detectCanonicalDuplicates()` neden yeni yinelenme üretilmesini durdurmuyor

### 11.1 Bugünkü hâli (`services/playerCanonicalService.js`)

```js
function detectCanonicalDuplicates(players) {
  const seenProviderIds = new Map();
  const seenSlugs = new Map();
  ...
  if (player.providerId)  { if (seenProviderIds.has(player.providerId)) duplicates.push({type:"providerId", ...}); }
  if (player.slug)        { if (seenSlugs.has(player.slug))             duplicates.push({type:"slug", ...}); }
}
```

Yalnızca **birebir eşitlik** arıyor: aynı `providerId`, aynı `slug`.

Bu veri kümesinde her ikisi de sıfır sonuç verir:
- `providerId` çakışması: **0** (479 sayısal + 110 `mock-*`, hiçbiri örtüşmüyor).
- `slug` çakışması: **0** (`u-cakir-galatasaray` ≠ `ugurcan-cakir`).

Yani fonksiyon **87 yinelenmenin hiçbirini görmüyor** ve "temiz" raporluyor.
Yinelenmeler tam olarak bu kör noktadan doğdu.

### 11.2 Neden `reconcileSquadPlayer()` yeni kayıt açtı

Zincir şu:

```
matchCanonicalPlayer(canonical, squadPlayer, birthDate)
  1) providerId eşitliği   -> legacy'de mock-*, sağlayıcıda sayısal  => eşleşmez
  2) birthDate + ad        -> squadPlayer.birthDate her zaman null   => hiç denenmez
  3) ad birebir eşitliği   -> "U. Çakır" ≠ "Uğurcan Çakır"           => eşleşmez
  => { match: null, method: "no-match" }
     => reconcileSquadPlayer: action "create", id = slug("U. Çakır-Galatasaray")
```

Üçüncü adım (`name-only-review-required`) **çalışsaydı** yeni kayıt açılmazdı — Bölüm 8.2'deki
8 oyuncuda tam olarak bu oldu. Kısaltma yüzünden ad eşitliği tutmayınca güvenlik ağı devre dışı kaldı.

`squadSyncService.js` içindeki `/players/squads` yanıtı `birthDate` **döndürmüyor**
(`buildSquadSnapshot` yalnızca `providerId, name, number, position, age, photo` saklıyor) —
bu yüzden 2. adım yapısal olarak ölü kod.

### 11.3 Önerilen değişiklikler

**(a) `detectCanonicalDuplicates()` — kimlik sezgisi ekle (rapor eder, birleştirmez):**

```js
function identityKey(player) {
  // 1) normalize: Türkçe katlama + NFD + mojibake onarımı
  // 2) kısaltma tespiti: /^\S\s*\./  -> { initial, surname }
  // 3) anahtar: `${takım}|${mevkiGrubu}|${soyad}|${adBasHarfi}`
}

function detectCanonicalDuplicates(players) {
  // ... mevcut providerId + slug kontrolleri AYNEN kalır ...

  const byIdentity = new Map();
  for (const player of players) {
    const key = identityKey(player);
    if (!key) continue;
    const previous = byIdentity.get(key);
    if (previous && ageCompatible(previous, player, 1)) {
      duplicates.push({
        type: "identity-heuristic",
        value: key,
        players: [previous.id, player.id],
        signals: ["same-team", "same-position-group", "surname", "initial", "age<=1"],
        confidence: previous.birthDate || player.birthDate ? "high" : "medium",
        resolution: "review-required"       // ASLA otomatik birleştirme
      });
    }
    byIdentity.set(key, player);
  }
  return duplicates;
}
```

Kritik: `type: "identity-heuristic"` çıktısı **`review-required`** olmalı, `merge` değil.
Bölüm 7.4'teki dört sağlayıcı-içi çakışma (`E. Aydın`, `E. Doğan`, `A. Traoré`, `A. Şimşir`)
aynı kısaltmayı taşıyan **farklı kişiler**; anahtar takımı içerdiği için onlar tetiklenmez,
ama benzeri bir vaka her an gelebilir.

**(b) `matchCanonicalPlayer()` — kısaltma farkındalığı:**
`squadSyncService.matchCanonicalPlayer` içine 3. adımdan **önce** bir "kısaltma uyumlu"
kontrolü eklenmeli. Sonuç yine `name-only-review-required` (yani **kayıt açılmaz, kuyruğa düşer**)
olmalı — otomatik birleştirme değil. Bu tek değişiklik, bugünkü 87 yinelenmenin
78'ini (`abbrev-initial+surname` tipindekiler) baştan engellerdi.

**(c) `buildSquadSnapshot()` — `birthDate`'i sakla:**
API-Football `/players` uç noktası doğum tarihi döndürüyor. `providers/apiFootballProvider`
katmanında doğum tarihi alınabiliyorsa anlık görüntüye eklenmeli; o zaman
`matchCanonicalPlayer`'ın 2. adımı gerçekten çalışır ve kimlik sezgisine hiç gerek kalmaz.
**Uzun vadeli doğru çözüm bu.**

**(d) `sync-canonical-players.mjs` — yazma kapısı:**
`detectCanonicalDuplicates()` `identity-heuristic` bulgusu döndürdüğünde, senkron
`evaluatePlayerCountGuard` gibi **yazmayı bloklamalı** veya en azından kaydı
`player-sync-review-queue.json`'a düşürüp yeni profil açmamalı.

---

## 12. Ne ters gidebilir

### 12.1 Yanlış-pozitif birleştirme (iki farklı gerçek kişi)

**En yüksek riskli 3 vaka:**
1. **`badra-diabbate-ali-samsunspor` ↔ `ali-badra-diabate`** — Samsunspor'da **iki Diabaté** var
   (`cheick-tidiane-diabate` de kadroda). Yanlış eşleşme iki farklı futbolcuyu tek profilde birleştirir.
2. **`a-murillo-besiktas` ↔ `michael-murillo`** — baş harf uyuşmuyor (`A` ≠ `M`).
3. **Beşiktaş'ın iki Yılmaz'ı** (`R.` / `K.`) — ayrım yalnızca tek bir harfe dayanıyor;
   `kartal-yilmaz`'da `birthDate` yok.

**Etkisi geri alınabilir mi?** Veri düzeyinde evet (git). URL düzeyinde **kısmen**: 301
yönlendirme kondu ve arama motoru sindirdiyse, geri alma ikinci bir 301 zinciri gerektirir.
Yanlış birleştirilen kişinin profili bir süre **başka birinin adını taşır** — bu, kredibilite
revizyonunun tam tersi bir hata.

**Azaltma:** `low` ve belirsiz `medium` çiftleri (toplam 7) doğum tarihi kanıtı olmadan
birleştirilmemeli.

### 12.2 Sağlayıcı bağlantısının kaybı

Kanonik yön yanlış seçilirse (legacy kalırsa) sayısal `providerId` kaybolur:
- `cardCredibility` 87 kimliği reddeder → 87 profil içeriksizleşir.
- `sync-player-statistics.mjs` ve `refresh-official-lineups.mjs` sağlayıcıya bu kayıtlar için
  istek atamaz; `providerId` olmadan istatistik gelmez.
- Bir sonraki `sync:squads` koşusunda `matchCanonicalPlayer` yine `no-match` döner ve
  **87 sağlayıcı kaydı yeniden yaratılır** — yinelenmeler geri gelir.

Önerilen yön (A) bu riski taşımıyor, **ama** alan taşıma adımında `providerId` alanının
yanlışlıkla legacy değeriyle ezilmesi bir uygulama hatası olarak mümkün. Taşıma kuralı
`providerId`'yi açıkça dışlamalı.

### 12.3 Kırılan gelen bağlantılar

| Yüzey | Risk |
|---|---|
| `karsilastirma/` | **1.088 URL siliniyor** (Senaryo A). Hepsi şu anda sitemap'te. Yönlendirme planı olmadan doğrudan 404. Vercel 1.024 kural limiti tek tek 301'i imkânsız kılıyor (Bölüm 10.4). |
| `mac/` | 150 sayfa yinelenen profillere link veriyor (136 legacy + 238 provider link örneği). Legacy hedefler alias sayfasına düşer → `noindex,follow` + canonical, yani **404 değil**. Kabul edilebilir. |
| kök hub sayfaları | 15 sayfa; yeniden üretildiklerinde düzelir. |
| Dış siteler / Search Console | Legacy profil URL'leri alias + 301 ile korunuyor. Karşılaştırma URL'leri korunmuyor — **asıl kayıp burada.** |
| `oyuncular/` | 174 eşleşme kendi canonical'ı; gelen bağlantı değil. Risk yok. |

### 12.4 Karşılaştırma slug'ı churn'ü

Slug `[leftId, rightId].sort().join("-vs-")` ile üretiliyor; kanonik id değişince slug da değişiyor.
Ölçülen (Senaryo A): 2.314 → 1.971; **1.088 silinir, 745 doğar, yalnızca 1.226'sı yerinde kalır.**
Yani karşılaştırma indeksinin **%47'si** el değiştiriyor. Bunun **13'ü** slug'ında düşen id
bulunmayan sayfalar — yani eşleştirme mantığının yeniden sıralanmasından doğan **öngörülemeyen**
kayıplar. `high`-only birleştirmede bile bu sayı 17.

### 12.5 Test ve doğrulama etkisi

- `scripts/test-player-surface-enforcement.mjs:214` `search-index` girdi sayısı ile veri kümesi
  boyutunun eşitliğini doğruluyor; ikisi de aynı kaynaktan türediği için **kırılmaz**.
- `scripts/test-player-canonical-merge.mjs:80` `detectCanonicalDuplicates(duplicated).length === 1`
  ile yalnızca `providerId` çakışmasını test ediyor. Bölüm 11.3'teki `identity-heuristic`
  eklentisi bu sayıyı değiştirebileceği için test güncellenmeli.
- **`scripts/qa.mjs` iki sabit eşikte kırılır** (Bölüm 10.3.1): `sitemap >= 3000` ve
  `karsilastirma/ >= 2000`. Bu, birleştirmenin en somut operasyonel engeli.

### 12.6 Yapılmaması gerekenler

- **Eksik alanı doldurmak için sayı üretmek.** Legacy'nin `overallRating` / `radar.*` /
  `*Score` değerleri sağlayıcı kayda **taşınmamalı**; bunlar ölçüm değil varsayılan.
  Kimlik birleştirmesi bir güvenilirlik gerilemesine dönüşmemeli.
- **Sağlayıcı kaydını "zenginleştirmek" için `birthDate` tahmin etmek.** 87 çiftin 33'ünde
  hiçbir tarafta doğum tarihi yok; boş kalmalı.
- **`aliases[]` kullanmadan legacy kaydı silmek.** Alias yoksa 87 URL doğrudan 404 olur.

---

## Ek A — Ölçüm yöntemi ve tekrarlanabilirlik

Tüm sayılar aşağıdaki salt-okunur işlemlerle üretildi. Depoda `docs/` dışında hiçbir dosya
değiştirilmedi; hiçbir `npm build` / `npm test` çalıştırılmadı.

| Ölçüm | Yöntem |
|---|---|
| Kayıt/alan sayıları, `dataStatus`, `providerId` kalıpları | `python3` + `json` üzerinde `data/players.json` |
| Ad katlama, kısaltma çözümleme, çift eşleştirme | Bölüm 2'deki eşleştirici (`python3`, `unicodedata`, Levenshtein) |
| Sayfa envanteri | `ls oyuncular \| wc -l`, `ls karsilastirma \| wc -l`, `ls mac \| wc -l` |
| Sitemap girdileri | `grep -c "<loc>" sitemap.xml` + `<loc>` ayrıştırması |
| Karşılaştırma çiftleri | `karsilastirma/*.html` dosya adlarının `-vs-` ile, geçerli id kümesine karşı çözümlenmesi (2.314/2.314 çözüldü, 0 belirsiz) |
| Sayfa churn simülasyonu | `scripts/generate-player-comparison-pages.mjs` `buildPairs()` mantığının Node ile salt-okunur yeniden uygulanması; mevcut veri kümesinde **2.314** üreterek doğrulandı |
| Güvenilirlik kapısı | `services/cardCredibility.js` `evaluatePlayerCard` / `publicPlayerView` / `verifiedRadarAxes` doğrudan `require` edilip 589 kayda uygulandı |
| Gelen bağlantılar | `oyuncular/([a-z0-9-]+)\.html` deseninin kök + `oyuncular/` + `mac/` + `mac-raporu/` + `players/` altındaki tüm HTML'lerde taranması |
| Kodlama bozuklukları | `unicodedata.normalize('NFC', ad) != ad`, mojibake deseni, `\xa0`, çift boşluk kontrolleri |
| Sağlayıcı kadro çapraz kontrolü | `data/super-lig-squads.json` (496 satır) ve `data/player-sync-review-queue.json` |

**Eşleştiricinin bilinen sınırları:**
- Sağlayıcı `birthDate` göndermediği için tarih doğrulaması yalnızca legacy tarafında mümkün
  (54/87 çift).
- Mevki eşlemesi elle yazılmış bir sözlük; kanat oyuncularında sağlayıcı taksonomisi
  tutarsız (7 çiftte `pos_ok=false` üretti, hepsi taksonomi artefaktı).
- Forma numarası karşılaştırılamadı: `super-lig-squads.json` içindeki `number` alanı
  **496 satırın tamamında `null`**.
- Eşleştirici yalnızca provider×legacy çiftlerine bakar; legacy×legacy ve provider×provider
  yinelenmeleri kapsam dışıdır (`slug` çakışması 0 olduğu için ilki zaten yok).

## Ek B — Önceki denetimle fark

Görev tanımında "~82 çift" geçiyordu; bu denetim **87** buluyor. Fark muhtemelen şu 5 vakadan
geliyor — hepsi basit ad eşleştirmesinin kaçıracağı türden:

| Çift | Neden kaçmış olabilir |
|---|---|
| `o-kokcu-besiktas` ↔ `orkun-kokcu` | Sağlayıcı adı **NFD** kodlu (`Kök̈çü`); NFD katlaması olmadan eşleşmez |
| `n-dorgeles-fenerbahce` ↔ `dorgeles-nene` | Ad-soyad sırası ters |
| `a-murillo-besiktas` ↔ `michael-murillo` | Baş harf uyuşmuyor (`A` ≠ `M`) |
| `badra-diabbate-ali-samsunspor` ↔ `ali-badra-diabate` | Kelime sırası karışık + 1 harf yazım farkı |
| `erol-colak-trabzonspor` ↔ `erol-can-colak` | Legacy'de ara ad var, yaş alanı boş |

Son üçü zaten bu raporda `low`/`medium` olarak işaretli ve insan kanıtı isteniyor.
Farkın yönü önemli: **daha fazla** yinelenme bulundu, daha az değil.

---

*Bu belge yalnızca denetim çıktısıdır. Hiçbir birleştirme uygulanmadı; `data/players.json`,
`services/`, `scripts/` ve üretilmiş HTML dosyaları değiştirilmedi.*
