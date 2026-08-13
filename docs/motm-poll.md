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

Anket JavaScript olmadan çalışamaz — oy istemcide saklanıyor. JavaScript
kapalıyken görünen bir "Oy Ver" düğmesi, basıldığında hiçbir şey yapmayan
bir düğmedir. Blok bu yüzden `hidden` basılır ve yalnızca `site.js`
önyüklendiğinde açılır.

Yan faydası SEO'da: anket sayfalar arası tekrarlanan bir metin bloğu;
kapalı doğması onu yinelenen içerik olarak görünmekten de çıkarıyor. Blokta
JSON-LD **yok** — anket bir içerik varlığı değil, bir etkileşim.

## Oy nerede tutuluyor

`localStorage`, anahtar `futbolradar:motm:<matchId>`.

> **Gösterilen yüzde topluluk sonucu DEĞİLDİR.**
> Sitede oyları toplayan bir sunucu yok (`api/` salt-okunur, veritabanı
> yok). Yüzdeyi "herkesin oyu" gibi sunmak, tek kullanıcının oyunu kitlenin
> kararı gibi göstermek olurdu. Blok bunu **yazıyla** söyler:
> *"Oylar şimdilik yalnızca bu cihazda saklanıyor; aşağıdaki sonuç topluluk
> ortalaması değil, bu tarayıcıdaki oylardır."*
> Kullanıcının kendi seçimi ayrıca "Senin oyun" rozetiyle işaretlenir.

Aynı cihazdan tekrar oy engellenir: kayıt varsa form yerine **sonuç**
gösterilir.

`localStorage` erişilemeyebilir (gizli sekme, üçüncü taraf çerez engeli,
kota dolu). Her erişim korumalı: depo çalışmıyorsa anket yine de oy alır ve
sonucu gösterir, yalnızca oy kalıcı olmaz. Bir depolama hatası yüzünden
sayfanın kırılması, anketin kendisinden daha kötüdür.

### Topluluk sonucuna geçmek isterseniz

Gerçek topluluk yüzdesi için bir yazma yolu gerekir (ör. Vercel KV +
`api/motm-vote.js`). O geldiğinde değişmesi gereken tek yer `site.js`
içindeki `readStore`/`writeStore` çifti ve `motm-poll__note` metnidir;
seçim mantığı (`services/motmPoll.js`) ve işaretleme aynı kalır.

## Testler

```
node scripts/test-motm-poll.mjs
```

11 bölüm. İki soruyu farklı açılardan soruyor: *listeye girmemesi gereken
kim girebilir?* ve *anket çıkmaması gereken yerde çıkabilir mi?*
