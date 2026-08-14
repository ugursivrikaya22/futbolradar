/**
 * MAÇIN ADAMI ANKETİ — KİM OYLANABİLİR, HANGİ MAÇTA, HANGİ KANITLA.
 *
 * Anket bir OKUYUCU ETKİLEŞİMİDİR ama seçenek listesi bir VERİ İDDİASIDIR:
 * ekrana bir futbolcu adı bastığımız anda "bu oyuncu bu maçta oynadı"
 * demiş oluyoruz. Bu yüzden kural tek ve sert:
 *
 *     SAHADA OLDUĞUNU BİLMEDİĞİMİZ OYUNCU LİSTEYE GİRMEZ.
 *
 * Kadro listesi (`data/super-lig-squads.json`) bu soruyu YANITLAMAZ —
 * kulübün kadrosunda olmak, o maçta oynamış olmak değildir. Anket yalnızca
 * maçın kendi kayıtlarından beslenir:
 *
 *   • İLK ONBİR — `lineups[].players`. Sahada başladıkları kayıtlı.
 *   • OYUNA GİRENLER — `substitutions[].in`. Girdiği DAKİKASIYLA kayıtlı.
 *
 * YEDEK KULÜBESİ LİSTEYE GİRMEZ. `lineups[].substitutes` "kulübede oturdu"
 * demektir, "oynadı" demez. Onları da listeye koymak, oynamamış bir
 * futbolcuyu maçın adamı adayı yapardı — ve okuyucu listede gördüğü adı
 * oynamış sayacağı için bu, sessiz bir uydurma olurdu. Ayrım veri
 * seviyesinde: `substitutions` kaydı olmayan bir maçta yalnızca ilk onbir
 * oylanır, kulübe hiç görünmez.
 *
 * MAÇ BİTMİŞ OLMAK ZORUNDA. "Maçın adamı" oynanmış bir maç hakkında bir
 * yargıdır; başlamamış maçta sorulacak bir soru değildir.
 *
 * EN AZ BİR TÜRK KULÜBÜ OLMAK ZORUNDA. Yabancı-yabancı maçlarda anket
 * gösterilmez; karar `services/turkishTeams.js`teki kulüp tanımasına
 * dayanır, takım adının içinde Türkçe harf aramaya değil.
 *
 * OY DEPOSU BU MODÜLÜN İŞİ DEĞİL. Burada yalnızca "kim oylanabilir"
 * sorusu yanıtlanır; oyun nerede tutulduğu ve sonucun nasıl gösterildiği
 * istemcinin (site.js) ve dokümantasyonun konusu.
 */

const { isTurkishTeamName } = require("./turkishTeams");

/** Anket en az bu kadar adayla anlamlı: tek seçenekli oylama oylama değil. */
const MIN_OPTIONS = 2;

/** Kayan bir liste değil; okunabilir üst sınır (iki kadro + girenler). */
const MAX_OPTIONS = 40;

/**
 * OYLAMA PENCERESİ: MAÇ SONUNDAN 24 SAAT SONRA KAPANIR.
 *
 * "Maçın adamı" taze bir yargıdır; haftalar sonra gelen oy, maçı izlemiş
 * bir okuyucunun yargısı olmaktan çıkar. Pencere kapanınca sonuç KİLİTLENİR:
 * bant değişmez, kazanan değişmez.
 *
 * Veride maçın BİTİŞ damgası yok, yalnızca başlama saati var. Bitiş bu
 * yüzden başlama + 2 saat olarak alınır (devre arası ve uzatma payıyla
 * standart bir maçın üst sınırı). Yanılma payı pencerenin lehine: kapanış
 * hiçbir maçta gerçek bitişten ÖNCE gelmez.
 *
 * Başlama saati OKUNAMAYAN maçta pencere hesaplanamaz ve oylama açık
 * kalır — "bilmiyorum" durumunda okuyucunun elinden oy alma hakkını almak,
 * uydurma bir kapanış saati ilan etmek olurdu.
 */
const MATCH_DURATION_APPROX_MS = 2 * 60 * 60 * 1000;
const VOTING_WINDOW_AFTER_MATCH_MS = 24 * 60 * 60 * 1000;

/** Ekran metinleri. Gereksinimde birebir verildi; tek yerde durur. */
const COPY = Object.freeze({
  title: "Maçın Adamını Seç!",
  subtitle: "Sence bu maçın yıldızı kimdi? Oyunu ver, sonucu hemen gör.",
  button: "Oy Ver",
  thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
  badge: "Maçın Adamı",
  starter: "İlk 11",
  substitute: "Oyuna girdi",
  // OY BU CİHAZDA TUTULUYOR VE BU YAZILI OLMAK ZORUNDA.
  //
  // Sitede oyları toplayan bir sunucu yok. Yüzdeyi "topluluk sonucu" gibi
  // sunmak uydurma olurdu: gösterilen sayı okuyucunun kendi oyundan başka
  // bir şey değil. Not bunu açıkça söyler; sayı gerçek, iddiası dürüst.
  localNote: "Oy deposuna ulaşılamadı; aşağıdaki sonuç topluluk ortalaması " +
    "değil, yalnızca bu tarayıcıda saklanan oylardır.",
  // Sayım sunucudan geldiğinde iddia değişiyor ve METİN DE DEĞİŞMEK ZORUNDA.
  // Aynı notu iki kipte de göstermek, gerçek topluluk sonucunu "yalnızca bu
  // cihaz" diye küçültür ya da — tersi çok daha kötü — cihazdaki tek oyu
  // topluluk sonucu gibi sunardı.
  communityNote: "Sonuçlar tüm okuyucuların oylarından hesaplanıyor. " +
    "Her tarayıcı bir kez oy verebilir.",
  yourVote: "Senin oyun",
  // Pencere kapanınca iddia değişir: artık bir çağrı değil, kesinleşmiş bir
  // sonuç gösteriliyor. Not bunu açıkça söyler.
  closedNote: "Oylama kapandı; sonuçlar kesinleşti. Oylama her maçta maç " +
    "sonundan 24 saat sonra kapanır."
});

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

/** Ad karşılaştırması için sadeleştirme: aksan ve büyük harf nötr. */
function foldName(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function asLineups(match) {
  return Array.isArray(match && match.lineups) ? match.lineups : [];
}

function asSubstitutions(match) {
  return Array.isArray(match && match.substitutions) ? match.substitutions : [];
}

/** Maç oynanmış mı? Yalnızca bitmiş maçta "maçın adamı" sorulabilir. */
function isFinished(match) {
  return /^(finished|ft|aet|pen|match_finished|full[- ]?time)$/i.test(text(match && match.status));
}

/** Maçın başlama damgası (ms). Okunamayan tarih 0'dır — "bilinmiyor". */
function kickoffStamp(match) {
  const parsed = Date.parse(text(match && (match.kickoff || match.date || match.time)));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Oylamanın kapandığı an (ms). Başlama saati bilinmiyorsa 0 döner —
 * "kapanış yok" değil, "kapanış HESAPLANAMIYOR" demektir ve oylama açık
 * kalır (gerekçe dosya başındaki pencere yorumunda).
 */
function votingClosesAtMs(match) {
  const stamp = kickoffStamp(match);
  return stamp ? stamp + MATCH_DURATION_APPROX_MS + VOTING_WINDOW_AFTER_MATCH_MS : 0;
}

/** Oylama şu an açık mı? `now` test edilebilirlik için dışarıdan gelebilir. */
function isVotingOpen(match, nowMs) {
  const closes = votingClosesAtMs(match);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  return !closes || now < closes;
}

/** Maçta en az bir Türk kulübü var mı? */
function hasTurkishSide(match) {
  return [match && match.homeTeam, match && match.awayTeam]
    .map(text)
    .filter(Boolean)
    .some((name) => isTurkishTeamName(name));
}

/**
 * OYNAYAN OYUNCULAR.
 *
 * İlk onbir + oyuna GİREN yedekler. Kulübede kalanlar dışarıda; gerekçe
 * dosya başlığında.
 *
 * Aynı ad iki kez girmez: bir oyuncu hem ilk onbirde hem `substitutions.in`
 * içinde görünüyorsa (veri hatası) tek kayıt olarak kalır ve ilk onbir
 * rolünü korur.
 */
function playedPlayers(match) {
  const options = [];
  const seen = new Set();

  const push = (name, team, role) => {
    const clean = text(name);
    if (!clean) return;
    const key = foldName(clean);
    // Adı sadeleştirince boşalan kayıt (yalnızca noktalama) listeye girmez.
    if (!key || seen.has(key)) return;
    seen.add(key);
    options.push({ id: key, name: clean, team: text(team), role });
  };

  for (const side of asLineups(match)) {
    const team = text(side && side.team);
    for (const player of Array.isArray(side && side.players) ? side.players : []) {
      // Oyuncu düz metin ya da { name } olabilir; ikisi de desteklenir.
      push(typeof player === "string" ? player : (player && (player.name || player.player)), team, "starter");
    }
  }

  for (const change of asSubstitutions(match)) {
    push(change && change.in, change && change.team, "substitute");
  }

  return options.slice(0, MAX_OPTIONS);
}

/**
 * ANKET NESNESİ — ya da `null`.
 *
 * `null` dönmek "bu sayfada anket YOK" demektir ve çağıran bunu sessizce
 * uygular: eksik veriyi yer tutucuyla doldurmak yasak.
 *
 * Dönüş nedeni de veriliyor (`skipReason`) — anketin neden çıkmadığı
 * derleme günlüğünden görülebilsin diye. Sessiz eleme, hata ayıklanamaz
 * eleme demek.
 */
function buildMotmPoll(match, options = {}) {
  if (!match || typeof match !== "object") return { poll: null, skipReason: "kayıt okunamadı" };

  const matchId = text(match.id || match.slug || match.matchId);
  if (!matchId) return { poll: null, skipReason: "maç kimliği yok" };

  if (!isFinished(match)) return { poll: null, skipReason: "maç bitmemiş" };
  if (!hasTurkishSide(match)) return { poll: null, skipReason: "Türk kulübü yok" };

  const candidates = playedPlayers(match);
  if (candidates.length < MIN_OPTIONS) {
    return { poll: null, skipReason: `kadro verisi yok (${candidates.length} aday)` };
  }

  // KAPANMIŞ ANKET YOK OLMAZ, KİLİTLENİR. Pencere geçince anket hâlâ
  // "var" — sonuçlar gösterilir, yalnızca oy kabul edilmez. `votingOpen`
  // bu ayrımı taşır; `closesAt` istemciye pencereyi bildirir.
  const closesAtMs = votingClosesAtMs(match);
  return {
    poll: {
      matchId,
      homeTeam: text(match.homeTeam),
      awayTeam: text(match.awayTeam),
      options: candidates,
      closesAt: closesAtMs ? new Date(closesAtMs).toISOString() : null,
      votingOpen: isVotingOpen(match, options.now)
    },
    skipReason: null
  };
}

/** Maç kayıtlarını kimliğe göre indeksler; çağıranlar sayfayı bununla eşler. */
function indexMatchesById(payload) {
  const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.matches) ? payload.matches : []);
  const index = new Map();
  for (const match of list) {
    const key = text(match && (match.id || match.slug || match.matchId));
    if (key) index.set(key, match);
  }
  return index;
}

module.exports = {
  COPY,
  MATCH_DURATION_APPROX_MS,
  MAX_OPTIONS,
  MIN_OPTIONS,
  VOTING_WINDOW_AFTER_MATCH_MS,
  buildMotmPoll,
  foldName,
  hasTurkishSide,
  indexMatchesById,
  isFinished,
  isVotingOpen,
  kickoffStamp,
  playedPlayers,
  votingClosesAtMs
};
