/**
 * İNGİLİZCE YÜZEYDE TÜRKÇE METİN DEDEKTÖRÜ.
 *
 * Amaç: `/en` altındaki bir sayfada okuyucunun GÖRDÜĞÜ Türkçe metni bulmak.
 *
 * NEDEN KARAKTER TARAMASI YETMEZ: "Beşiktaş", "Başakşehir", "Çaykur Rizespor"
 * İngilizce bir metinde de aynen böyle yazılır. `ş`/`ı`/`ğ` aramak özel
 * adların tamamını yanlış pozitif yapar. Bu yüzden ölçüt KARAKTER değil,
 * İngilizcede hiçbir özel adın içinde geçmeyen Türkçe İŞLEV SÖZCÜKLERİ ve
 * site arayüzünde tekrar eden Türkçe kalıplardır.
 */

/** Görünmez metin: script/style/template + yorumlar. Okuyucu bunları görmez. */
function stripInvisible(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/**
 * GÖRÜNEN METİN = düğüm metni + okunan öznitelikler.
 *
 * `alt`, `title`, `aria-label`, `placeholder` ekranda ya da ekran
 * okuyucusunda okunur; `content` ise meta başlık/açıklama olarak arama
 * sonucunda görünür. Hepsi "görünen metin" sayılır.
 */
export function visibleText(html) {
  const body = stripInvisible(html);
  const attrs = [];
  const attrPattern = /\b(?:alt|title|aria-label|placeholder|content)\s*=\s*"([^"]*)"/gi;
  let match;
  while ((match = attrPattern.exec(body))) {
    // ADRES METİN DEĞİLDİR. `og:image` ve `canonical` gibi meta alanları
    // Türkçe slug taşıyan URL'ler basar ("...-taktik-analiz.png"). Okuyucu
    // bunu görmez; çeviri gerektiren bir dize de değildir.
    if (isUrlLike(match[1])) continue;
    attrs.push(match[1]);
  }

  const text = body.replace(/<[^>]+>/g, " ");
  return decodeEntities(`${text} ${attrs.join(" ")}`);
}

/** Tek parça, boşluksuz bir adres mi? (http(s), protokolsüz veya dosya yolu) */
function isUrlLike(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^(?:https?:)?\/\//i.test(trimmed) || /^[\w./-]+\.(?:png|jpe?g|svg|webp|gif|html|ico|json|xml|css|js)$/i.test(trimmed);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * TÜRKÇE İŞLEV SÖZCÜKLERİ.
 *
 * Tamamı tek başına bir sözcük olarak aranır (sınır eşlemesi). Hiçbiri bir
 * kulüp, oyuncu ya da şehir adının parçası değildir; bu yüzden biri geçtiyse
 * sayfada Türkçe CÜMLE var demektir.
 *
 * Listeye eklerken tek ölçüt: İngilizce bir futbol metninde bu dizi ASLA
 * geçmemeli. ("bir" gibi kısa sözcükler bile İngilizcede sözcük sınırıyla
 * eşleşmez; ama "de"/"da" gibi olanlar alınmadı — özel ad ekleri riskli.)
 */
const TURKISH_WORDS = [
  "için", "ile", "olarak", "değil", "daha", "sonra", "önce", "ancak", "çünkü",
  "gibi", "kadar", "vardı", "yoktu", "oldu", "olduğu", "yapıyor", "ediyor",
  "ve", "veya", "ama", "fakat", "hem", "hâlâ", "hala", "şimdi", "artık",
  "bütün", "tüm", "tümü", "hepsi", "bazı", "diğer", "başka", "kendi",
  "bir", "bu", "şu", "her", "çok", "hiç", "yine", "zaten",
  "maç", "maçı", "maçlar", "maçları", "takım", "takımı", "takımlar",
  "puan", "puanı", "durumu", "sıralama", "sıralaması", "golü",
  "krallığı", "kralı", "yazısı", "yazıları", "haber", "haberler", "haberi",
  "yazar", "yazarlar", "yorum", "yorumu", "analiz", "analizi", "analizler",
  "devamı", "tamamı", "oku", "okuyun", "bakın", "arama",
  "günün", "bugün", "yarın", "dün", "hafta", "haftanın", "sezon", "sezonu",
  "kanalda", "yayın", "yayını", "canlı", "skor", "sonuç", "sonuçları",
  "muhtemel", "kadro", "kadrosu", "ilk", "son", "yeni", "eski",
  "futbolcu", "futbolcular", "oyuncu", "oyuncular", "oyuncusu",
  "ligi", "kupa", "kupası", "sahibi", "karşı", "karşısında",
  "galibiyet", "mağlubiyet", "beraberlik", "yenilgi", "şampiyon",
  "şampiyonluk", "transferi", "sakatlık", "sakat", "cezalı",
  "teknik", "direktör", "hoca", "taraftar", "taraftarı", "stat", "statta",
  "dakika", "dakikada", "devre", "devrede", "saha", "sahada", "sahasında",
  "gizlilik", "iletişim", "hakkında", "şartları", "kullanım",
  "güncelleme", "güncellendi", "veri", "verileri", "kaynak", "kaynağı",
  "tarih", "tarihi", "saat", "saati", "nerede", "nezaman", "hangi",
  // "son" ve "stat" listede DURUR ama BAĞLAMA BAKARLAR — aşağıdaki
  // AMBIGUOUS_WITH_ENGLISH kuralına bakın; ikisi de aynı zamanda
  // İngilizce sözcüktür.
  // "kim"/"kimler" ve "ne"/"mi" LİSTEDE YOK: "Kim Min-Jae" gibi Korece
  // soyadları ve "Ne" ile başlayan özel adlar bu kısa dizileri yanlış
  // pozitif yapıyordu. Kısa ve belirsiz dizilerin bedeli, yakaladıkları
  // gerçek sızıntıdan büyük.
  "nasıl", "neden",
  "bilgi", "bilgileri", "detay", "detayları", "tablo", "tablosu",
  "listesi", "liste", "sayfa", "sayfası", "geri", "ileri", "anasayfa",
  "arşiv", "arşivi", "rehber", "rehberi", "özet", "özeti", "notu",
  "değerlendirme", "istatistik", "istatistikleri", "ortalama",
  "yaklaşık", "toplam", "birlikte", "arasında", "üzerine", "üzerinde",
  "altında", "yanında", "boyunca", "rağmen", "göre", "doğru", "yönelik",

  // TÜRKÇE AY VE GÜN ADLARI.
  //
  // `Intl` çağrısında dil parametresini geçirmeyi unutmak, İngilizce sayfaya
  // "14 Ağustos 2026" basar; sayfanın geri kalanı kusursuz İngilizce olduğu
  // için gözden kaçar. Tarih biçimlendirme bu yüzden ayrıca aranıyor.
  "ocak", "şubat", "mart", "nisan", "mayıs", "haziran", "temmuz",
  "ağustos", "eylül", "ekim", "kasım", "aralık",
  "pazartesi", "salı", "çarşamba", "perşembe", "cuma", "cumartesi", "pazar"
];

const WORD_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${TURKISH_WORDS.map(escapeRegex).join("|")})(?![\\p{L}\\p{N}])`,
  "giu"
);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * TÜRKÇE SÖZCÜK TAŞIYAN ÖZEL ADLAR.
 *
 * Bazı özel adların İNGİLİZCESİ YOKTUR. Sivas'taki stadın adı "Yeni 4 Eylül
 * Stadyumu"dur; İngilizce basın da "Yeni 4 Eylül Stadium" yazar. "Eylül"ü
 * "September" yapmak stadın adını değiştirmek olurdu — tıpkı "Estádio José
 * Alvalade"ı çevirmeye kalkmak gibi.
 *
 * Bu adlar taramadan ÖNCE maskelenir. Liste bilinçli olarak kısa ve
 * açıktır: bir ad buraya ancak gerçekten özel ad olduğu için girer, bir
 * sızıntıyı susturmak için değil. Maskeleme aynı uzunlukta boşlukla yapılır
 * ki çevre metni ve konumlar kaymasın.
 */
const PROPER_NOUNS = [
  "Atatürk Olimpiyat",
  // Yayın kuruluşlarının adları; kaynak künyesinde İngilizce sayfada da
  // aynen yazılır ("TRT Haber" kanalın adıdır, "TRT News" başka bir yayın).
  "Haberler.com",
  "TRT Haber"
];

const PROPER_NOUN_PATTERN = new RegExp(PROPER_NOUNS.map(escapeRegex).join("|"), "gi");

/**
 * ADIN BAŞINDAKİ "YENİ".
 *
 * Türkiye'de pek çok kulüp adı "Yeni" ile başlıyor: Yeni Malatyaspor, Yeni
 * Adana Demirspor, Yeni Mersin İdmanyurdu. Bunlar İngilizce basında da aynen
 * yazılıyor. Tek tek listelemek, liste her Türkiye Kupası turunda yeni bir
 * amatör kulüp getirdiği için eskirdi — bu dosya aynı gerekçeyle stat
 * adlarını da desenle çözüyor.
 *
 * Desen dar: yalnızca BÜYÜK harfli "Yeni" ve yalnızca ardından yine BÜYÜK
 * harfle başlayan bir sözcük gelirse, yani ad öbeğinin ilk parçasıyken
 * maskeleniyor. Cümle içindeki "yeni sezon" yakalanmaya devam ediyor.
 *
 * Başlık büyük harfiyle yazılmış gerçek bir Türkçe cümle ("Yeni Sezon
 * Başlıyor") bu maskeden geçer ama sızıntı gizlenmez: böyle bir cümlede
 * "başlıyor", "ve", "ile" gibi başka işlev sözcükleri de bulunur ve tarama
 * onları yakalar. Maske tek bir sözcüğü susturur, cümleyi değil.
 */
const LEADING_YENI_PATTERN = /(?<![\p{L}\p{N}])Yeni(?=\s+\p{Lu})/gu;

/**
 * TARİH ADI TAŞIYAN STAT ADLARI.
 *
 * Türkiye'de pek çok stat bir anma tarihini taşır: "19 Mayıs", "4 Eylül",
 * "17 Eylül", "21 Kasım". Bunları tek tek listelemek listeyi her yeni stat
 * için eskitirdi.
 *
 * Desen BİLEREK DAR: sayı + ay adı dizisi yalnızca hemen ardından bir stat
 * sözcüğü geldiğinde maskelenir. Böylece "4 Eylül Stadium" susturulurken,
 * düz metindeki gerçek bir tarih ("maç 4 Eylül'de oynandı") yakalanmaya
 * devam eder — tam olarak aranan sızıntı odur.
 */
const MONTHS = "Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık";
const VENUE_WORDS = "Stadium|Stadyumu|Stadyum|Stadı|Arena|Arenası|Park|Ground";
// Öndeki "Yeni" de adın parçası: "Yeni 4 Eylül Stadyumu", "Samsun Yeni
// 19 Mayıs Stadyumu". Maskeye dahil edilmezse ad yarım maskelenir.
const DATE_VENUE_PATTERN = new RegExp(
  `(?:Yeni\\s+)?\\d{1,2}\\s+(?:${MONTHS})(?=\\s+(?:${VENUE_WORDS})\\b)`,
  "giu"
);

function maskProperNouns(value) {
  return String(value || "")
    .replace(PROPER_NOUN_PATTERN, (match) => " ".repeat(match.length))
    .replace(DATE_VENUE_PATTERN, (match) => " ".repeat(match.length))
    .replace(LEADING_YENI_PATTERN, (match) => " ".repeat(match.length));
}

/**
 * Bir metindeki Türkçe kanıtlarını döndürür.
 *
 * `context` ile döner: hangi cümlede geçtiğini görmeden düzeltmek mümkün
 * değil — tek başına "maç" raporu, sayfada nereye bakılacağını söylemez.
 */
/**
 * İNGİLİZCE EŞSESLİLER.
 *
 * Listedeki üç sözcük aynı zamanda düpedüz İngilizcedir: "son" (oğul),
 * "stat" (istatistik) ve "her" (ona/onun). Guardian başlığındaki
 * "Bill Belichick's son resigns" bu yüzden Türkçe sayılıp İngilizce haber
 * sayfasını düşürüyordu. "her" ile aynısı oldu: Guardian'ın
 * "'We miss her the same every day': Olivia Cusack on her late footballer
 * sister" başlığı, içinde tek bir Türkçe sözcük olmadığı hâlde iki kez
 * Türkçe sayıldı. "her" İngilizcede sayılamayacak kadar sık geçen bir
 * zamirdir; kaynak künyesi taşıyan her İngilizce sayfa bu yüzden risk
 * altındaydı.
 *
 * Listeden çıkarmak da doğru değil: "maçın son dakikasında" gerçek Türkçe
 * ve o cümlede başka hiçbir liste sözcüğü yok (çekimli biçimler listede
 * durmuyor). Bu yüzden sözcük listede kalıyor ama TEK BAŞINA kanıt
 * sayılmıyor: çevresinde Türkçeye ÖZGÜ bir harf taşıyan başka bir sözcük
 * aranıyor. "ı/İ/ş/ğ" başka dillerde yok; "ç/ö/ü" var, o yüzden onlara
 * bakılmıyor.
 *
 * Özel adlar bu noktada zaten maskelenmiş durumda, yani "Beşiktaş" gibi bir
 * kulüp adı yanlışlıkla kanıt yerine geçmiyor.
 */
const AMBIGUOUS_WITH_ENGLISH = new Set(["son", "stat", "her"]);
const TURKISH_ONLY_LETTER = /[ıİşŞğĞ]/;

export function findTurkish(text, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 12;
  const source = maskProperNouns(String(text || "").replace(/\s+/g, " "));
  const hits = [];
  const seen = new Set();
  const pattern = new RegExp(WORD_PATTERN.source, "giu");
  let match;

  while ((match = pattern.exec(source)) && hits.length < limit) {
    const raw = match[1];
    // TAKIM KISALTMASI YANLIŞ POZİTİFİ. Skor kartlarında rakip adı iki-üç
    // harfli büyük harf rozetiyle basılıyor ("BU Ballymena United"). Büyük
    // harfli kısa rozet Türkçe sözcük değildir.
    if (raw.length <= 3 && raw === raw.toUpperCase()) continue;
    const word = raw.toLowerCase();
    // İNGİLİZCE KISALTMA YANLIŞ POZİTİFİ. "you’ve", "we've", "they’ve":
    // kesme işaretinden sonraki "ve" Türkçe bağlaç değil, "have"in kısası.
    // Kesmeden önce harf varsa (sözcük içi kesme) bu eşleşme sayılmaz.
    if (word === "ve" && /\p{L}['’]$/u.test(source.slice(Math.max(0, match.index - 2), match.index))) continue;
    const start = Math.max(0, match.index - 60);
    const context = source.slice(start, match.index + raw.length + 60).trim();
    const key = `${word}|${context.slice(0, 40)}`;
    if (seen.has(key)) continue;
    if (AMBIGUOUS_WITH_ENGLISH.has(word)) {
      const around = source.slice(Math.max(0, match.index - 40), match.index + raw.length + 40);
      if (!TURKISH_ONLY_LETTER.test(around)) continue;
    }
    seen.add(key);
    hits.push({ word, context });
  }

  return hits;
}

/** Sayfa düzeyinde tek çağrı: HTML al, Türkçe kanıtlarını ver. */
export function scanHtml(html, options = {}) {
  return findTurkish(visibleText(html), options);
}

export { PROPER_NOUNS, TURKISH_WORDS };
