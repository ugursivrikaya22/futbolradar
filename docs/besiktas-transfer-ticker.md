# Beşiktaş Transfer Gündemi bandı

Tek kulübün transfer gündemini taşıyan kayan şerit. Genel haber bandının ve
Transfer Radarı bandının altına girer.

## Neden ayrı kuralları var

Dar kapsam bandı daha masum değil, **daha riskli** yapıyor: "Beşiktaş
Transfer Gündemi" başlığı altındaki her satır, okuyucu tarafından Beşiktaş'a
dair kesin bir gelişme olarak okunur. Bu yüzden kurallar genel bantla aynı
sertlikte.

## Bant nereden besleniyor

Bant hiçbir metni kendisi yazmaz. İki gerçek kaynaktan okur:

| Kaynak | Ne verir | Başlık nasıl kurulur |
|---|---|---|
| `data/transfers.json` | Gerçekleşmiş Beşiktaş hareketleri | Yapısal alanlardan şablonla: `Oyuncu: Eski Kulüp → Yeni Kulüp` |
| `data/besiktas-transfer-ticker.json` | Elle girilen küratörlü kayıtlar | Editör yazar |

Özet, transfer kaydının kendi `note` alanından gelir; yoksa yalnızca yapısal
alanlar (tür, bonservis, mevki) özetlenir. **Serbest metin üretilmez.**

## Durum üç kademedir ve kaynaktan türetilir

| Anahtar | Etiket | Ne demek | Raf ömrü |
|---|---|---|---|
| `official` | Resmî | Kulübün/federasyonun kendi ağzı (`bjk.com.tr`, `tff.org`) | 120 gün |
| `strong-rumour` | Güçlü iddia | Saygın yayın organı ya da sicilli muhabir aktardı | 14 gün |
| `rumour` | İddia | Tanınmayan kaynak; kesinleşmemiş | 7 gün |

Kademe `services/sourceTrust.js`ten gelir.

**Beyan bir talep, kanıt değil.** Bir kaydın `status: "official"` demesi onu
resmî yapmaz: arkasında kulüp ağzı yoksa kayıt, kaynağının gerçekte
bulunduğu kademeye iner. İndirmenin sabit bir hedefi yok — hak edilmemiş bir
"resmî" iddiasını her koşulda "güçlü iddia"ya indirmek, tanınmayan bir
sitenin iddiasını saygın basının kademesine *terfi ettirirdi*.

Ters yön de kapalı: **yükseltme yok.** Editör `rumour` demişse kaynak resmî
olsa bile kayıt yükselmez — editör bir şeyi bilerek geri çekmiş olabilir.

## Raf ömrü neden duruma göre değişiyor

Eskimenin anlamı duruma göre değişir:

- **Gerçekleşmiş bir transfer eskiyince yanlış olmaz**, yalnızca "son dakika"
  olmaktan çıkar ve kendi tarihiyle gösterilir. Sınır bir transfer penceresi
  kadar; geçen sezonun hareketleri bu sezonun gündemi değildir.
- **Doğrulanmamış bir iddia eskidikçe değersizleşir.** Üç hafta önce ortaya
  atılıp bir daha doğrulanmayan iddia gündem değil, gürültüdür.

> **Tarih, hareketin tarihidir — bizim doğrulama damgamız değil.**
> `lastVerifiedAt` "bu kaydı en son ne zaman kontrol ettik" demektir ve eski
> kayıtlar da düzenli olarak yeniden doğrulanır. Onu haber tarihi saymak,
> geçen sezonun transferini bu haftanın gündemi gibi gösterir. Sıralama ve
> raf ömrü `date` alanına bakar.

## Elle kayıt eklemek

`data/besiktas-transfer-ticker.json` → `items` dizisi.

```json
{
  "id": "benzersiz-kimlik",
  "headline": "Oyuncu Adı: Eski Kulüp → Beşiktaş",
  "summary": "Tek cümlelik özet.",
  "status": "strong-rumour",
  "publishedAt": "2026-08-13T10:00:00+03:00",
  "movement": "geliş",
  "source": { "name": "TRT Spor", "url": "https://www.trtspor.com.tr/..." }
}
```

Zorunlu alanlar: `headline`, `source.name`, `publishedAt`. `source.url`
varsa `http(s)` olmalı.

**Kesinleşmemiş bir öğenin başlığı kesinlik fiili taşıyamaz** — "resmen",
"imzaladı", "duyurdu", "açıkladı", "kesinleşti". Rozet ekranda küçüktür,
cümle büyüktür; rozet "İddia" derken başlık "imzaladı" diyorsa okuyucu
başlığa inanır. Böyle bir kayıt elenir ve nedeni konsola yazılır.

### Örnek kayıtlar yayına çıkmaz

Dosyadaki `_sample` anahtarı yalnızca alan şeklini gösterir ve servis
tarafından **hiç okunmaz**. Yer tutucu bir kaydın yanlışlıkla yayımlanması
mümkün olmasın diye ayrım anahtarda tutuluyor, bir bayrakta değil.

## Bant nerede çıkar

Liste `scripts/lib/besiktasTransferTicker.mjs` içinde, elle tutulur; hem
enjeksiyon hem test aynı listeyi oradan okur.

- `index.html`, `besiktas-*.html`, `transfer-radari.html`, `transfer-izleme.html`

Tek kulüplü bir bant her sayfaya ait değildir: Galatasaray maç sayfasına
Beşiktaş transfer şeridi koymak, okuyucunun aradığı şeyi ekranın dışına iten
editoryal bir gürültü olurdu.

**İngilizce sayfalara basılmaz.** Başlık, durum etiketleri ve küratörlü
başlıklar çevrilmemiş Türkçe metindir.

## Doğrulanmış öğe yoksa

Varsayılan: **bant hiç çizilmez.** Sayfanın tepesinde hiçbir şey söylemeyen
bir çubuk bırakmak, yer tutucu uydurmanın sessiz biçimidir.

İstisna, bandın sayfanın *konusu* olduğu yerler
(`besiktas-yeni-transferleri-2026-2027.html`, `transfer-radari.html`): orada
tek satırlık bir durum bildirimi gösterilir — "Şu an doğrulanmış bir Beşiktaş
transfer gelişmesi yok." Bu bir haber değil, bir durum bildirimidir; sahte
öğe hiçbir koşulda basılmaz.

## Yinelenen metin

Genel haber bandı aynı sayfada aynı transferi zaten taşıyorsa, o başlık
Beşiktaş bandına **girmez**. Aksi hâlde okuyucu iki şeritte aynı cümleyi
okur, arama motoru da sayfada tekrarlanan metin görür. Eleme
`apply-shared-layout.mjs` içinde, genel bandın başlıkları `exclude` olarak
geçirilerek yapılır.

## Testler

```
node scripts/test-besiktas-transfer-ticker.mjs
```

16 bölüm; hepsi tek bir soruyu farklı açılardan soruyor: *banda girmemesi
gereken bir şey girebilir mi?*
