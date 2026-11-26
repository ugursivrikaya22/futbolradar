/**
 * FUTBOLCU 360 MODELİNİN İNGİLİZCE YÜZÜ.
 *
 * Model (`services/player360Service.js`) kayıttaki değerleri olduğu gibi
 * taşır ve kayıt Türkçe tutulur: mevki "Stoper", uyruk "Brezilya", transfer
 * türü "Bonservis", kulüp "Serbest oyuncu". İngilizce sayfa yalnızca 24
 * oyuncu için üretilirken bu değerler gözden kaçıyordu; her oyuncuya sayfa
 * yazılınca İngilizce profilde Türkçe alanlar görünür hâle geldi.
 *
 * Buradaki sözlükler ELLE yazılmıştır. Kural tektir: karşılığı sözlükte
 * olan değer İngilizcesiyle basılır; karşılığı olmayan ve Türkçe kalan
 * değer HİÇ basılmaz (alan boş bırakılır). Özel adlar (kulüp, oyuncu)
 * çevrilmez. Sayı, tarih ve bağlantılara dokunulmaz.
 */
import { createRequire } from "node:module";
import { findTurkish } from "./turkish-detector.mjs";

const requireFromHere = createRequire(import.meta.url);
const { positionLabelTr } = requireFromHere("../../services/playerLabels.js");
const { clubDisplayName } = requireFromHere("../../services/turkishNames.js");

const POSITIONS = {
  "santrfor": "Centre-forward", "forvet": "Forward", "sol kanat": "Left winger", "sağ kanat": "Right winger",
  "sag kanat": "Right winger", "kanat": "Winger", "attacker": "Attacker", "10 numara": "Attacking midfielder",
  "on numara": "Attacking midfielder", "ofansif orta saha": "Attacking midfielder", "8 numara": "Central midfielder",
  "merkez orta saha": "Central midfielder", "orta saha": "Midfielder", "midfielder": "Midfielder",
  "ön libero": "Defensive midfielder", "defansif orta saha": "Defensive midfielder",
  "kanat / geniş orta saha": "Winger / wide midfielder", "stoper": "Centre-back", "defans": "Defender",
  "defender": "Defender", "sağ bek": "Right-back", "sag bek": "Right-back", "sol bek": "Left-back", "bek": "Full-back",
  "kaleci": "Goalkeeper", "goalkeeper": "Goalkeeper"
};

const COUNTRIES = {
  "brezilya": "Brazil", "portekiz": "Portugal", "güney kore": "South Korea", "hırvatistan": "Croatia",
  "ispanya": "Spain", "fransa": "France", "almanya": "Germany", "hollanda": "Netherlands", "ingiltere": "England",
  "italya": "Italy", "belçika": "Belgium", "arjantin": "Argentina", "nijerya": "Nigeria", "fas": "Morocco",
  "cezayir": "Algeria", "tunus": "Tunisia", "mısır": "Egypt", "gana": "Ghana", "kamerun": "Cameroon",
  "fildişi sahili": "Côte d'Ivoire", "sırbistan": "Serbia", "bosna hersek": "Bosnia and Herzegovina",
  "arnavutluk": "Albania", "kosova": "Kosovo", "yunanistan": "Greece", "macaristan": "Hungary", "polonya": "Poland",
  "romanya": "Romania", "bulgaristan": "Bulgaria", "rusya": "Russia", "ukrayna": "Ukraine", "isveç": "Sweden",
  "norveç": "Norway", "danimarka": "Denmark", "isviçre": "Switzerland", "avusturya": "Austria", "çekya": "Czechia",
  "slovakya": "Slovakia", "slovenya": "Slovenia", "gürcistan": "Georgia", "azerbaycan": "Azerbaijan",
  "japonya": "Japan", "abd": "United States", "kolombiya": "Colombia", "şili": "Chile", "meksika": "Mexico",
  "galler": "Wales", "iskoçya": "Scotland", "irlanda": "Republic of Ireland", "kuzey makedonya": "North Macedonia",
  "karadağ": "Montenegro", "gambiya": "Gambia", "gine": "Guinea", "kongo": "Congo", "özbekistan": "Uzbekistan",
  "izlanda": "Iceland", "finlandiya": "Finland", "ermenistan": "Armenia", "kıbrıs": "Cyprus", "kanada": "Canada",
  "avustralya": "Australia", "güney afrika": "South Africa", "jamaika": "Jamaica", "türkiye": "Türkiye"
};

const FEET = { "sağ": "Right", "sag": "Right", "sol": "Left", "her iki ayak": "Both", "iki ayak": "Both", "çift ayak": "Both" };

const LEAGUES = { "kulüpsüz": "Without a club", "rusya premier ligi": "Russian Premier League", "süper lig": "Süper Lig" };

/** Transfer türü ve bedel alanında tek başına duran terimler. */
const TRANSFER_TERMS = {
  "bonservis": "Permanent transfer", "kiralık": "Loan", "kiralik": "Loan", "serbest transfer": "Free transfer",
  "bedelsiz": "No fee", "açıklanmadı": "Undisclosed", "aciklanmadi": "Undisclosed",
  "sözleşme feshi": "Contract terminated", "sözleşme sonu": "End of contract", "kiralıktan dönüş": "Return from loan"
};

/** Bileşik bedel metninin içindeki Türkçe ifadeler ("€3.75M satın alma opsiyonu"). */
const FEE_PHRASES = [
  [/gelecekteki satıştan %\s*(\d+(?:[.,]\d+)?) pay/gi, "$1% of a future sale"],
  [/satın alma opsiyonu/gi, "purchase option"],
  [/kiralama/gi, "loan fee"],
  [/garanti/gi, "guaranteed"],
  [/\bKDV\b/g, "VAT"]
];

const CLUBS = { "serbest oyuncu": "Free agent", "kulüpsüz": "Without a club", "lokomotiv moskova": "Lokomotiv Moscow" };

const key = (value) => String(value || "").trim().toLocaleLowerCase("tr-TR");
const clean = (value) => findTurkish(String(value || ""), { limit: 1 }).length === 0;

/** Sözlükte varsa karşılığı, yoksa temizse kendisi, Türkçe kalıyorsa `null`. */
function fromDictionary(value, dictionary) {
  if (value === null || value === undefined || String(value).trim() === "") return value;
  const mapped = dictionary[key(value)];
  if (mapped) return mapped;
  return clean(value) ? value : null;
}

/** Özel ad: sözlükteki birkaç genel ifade dışında olduğu gibi kalır. */
export function englishClubName(value) {
  return clubName(value);
}

function clubName(value) {
  if (value === null || value === undefined) return value;
  return CLUBS[key(value)] || value;
}

export function englishFee(value) {
  if (value === null || value === undefined || String(value).trim() === "") return value;
  const direct = TRANSFER_TERMS[key(value)];
  if (direct) return direct;
  let text = String(value);
  for (const [pattern, replacement] of FEE_PHRASES) text = text.replace(pattern, replacement);
  return clean(text) ? text : null;
}

/**
 * Modeli yerinde İngilizceye uyarlar ve geri döndürür. Yalnızca İngilizce
 * üretici çağırır; Türkçe sayfa modeli olduğu gibi kullanmaya devam eder.
 */
export function englishPlayer360(model) {
  const identity = model && model.identity;
  if (identity) {
    identity.position = fromDictionary(identity.position, POSITIONS);
    identity.secondaryPosition = fromDictionary(identity.secondaryPosition, POSITIONS);
    identity.nationality = fromDictionary(identity.nationality, COUNTRIES);
    identity.preferredFoot = fromDictionary(identity.preferredFoot, FEET);
    identity.league = fromDictionary(identity.league, LEAGUES);
  }
  const rows = model && model.transfers && Array.isArray(model.transfers.rows) ? model.transfers.rows : [];
  for (const row of rows) {
    row.fromTeam = clubName(row.fromTeam);
    row.toTeam = clubName(row.toTeam);
    row.type = englishFee(row.type);
    row.fee = englishFee(row.fee);
  }
  const career = model && model.career;
  if (career) {
    for (const stint of Array.isArray(career.stints) ? career.stints : []) {
      stint.club = clubName(stint.club);
      stint.type = englishFee(stint.type);
      stint.fee = englishFee(stint.fee);
    }
    if (Array.isArray(career.formerTeams)) career.formerTeams = career.formerTeams.map(clubName);
  }
  return model;
}

/** İngilizce sağlayıcı etiketlerini Türkçe sayfada sunum karşılığıyla basar. Uydurma değil, mevcut sözlüğün tersidir; karşılığı yoksa değer olduğu gibi kalır. */
// Mevki karşılıkları TEK tablodan (services/playerLabels.js): hero, kimlik kartı,
// başlık, meta ve schema.org aynı Türkçe etiketi basar.
const COUNTRIES_TR = Object.fromEntries(Object.entries(COUNTRIES).map(([trName, enName]) => [key(enName), trName.charAt(0).toLocaleUpperCase("tr-TR") + trName.slice(1)]));
// Elle düzeltilen özel adlar (baş harf / ı-i).
Object.assign(COUNTRIES_TR, {
  nigeria: "Nijerya", brazil: "Brezilya", portugal: "Portekiz", "south korea": "Güney Kore",
  croatia: "Hırvatistan", spain: "İspanya", france: "Fransa", germany: "Almanya",
  netherlands: "Hollanda", england: "İngiltere", italy: "İtalya", belgium: "Belçika",
  argentina: "Arjantin", morocco: "Fas", algeria: "Cezayir", tunisia: "Tunus",
  egypt: "Mısır", ghana: "Gana", cameroon: "Kamerun", serbia: "Sırbistan",
  "bosnia and herzegovina": "Bosna Hersek", albania: "Arnavutluk", kosovo: "Kosova",
  greece: "Yunanistan", hungary: "Macaristan", poland: "Polonya", romania: "Romanya",
  bulgaria: "Bulgaristan", russia: "Rusya", ukraine: "Ukrayna", sweden: "İsveç",
  norway: "Norveç", denmark: "Danimarka", switzerland: "İsviçre", austria: "Avusturya",
  czechia: "Çekya", slovakia: "Slovakya", slovenia: "Slovenya", georgia: "Gürcistan",
  azerbaijan: "Azerbaycan", japan: "Japonya", "united states": "ABD", colombia: "Kolombiya",
  chile: "Şili", mexico: "Meksika", wales: "Galler", scotland: "İskoçya",
  "republic of ireland": "İrlanda", "north macedonia": "Kuzey Makedonya",
  montenegro: "Karadağ", gambia: "Gambiya", guinea: "Gine", congo: "Kongo",
  uzbekistan: "Özbekistan", iceland: "İzlanda", finland: "Finlandiya",
  armenia: "Ermenistan", cyprus: "Kıbrıs", canada: "Kanada", australia: "Avustralya",
  "south africa": "Güney Afrika", jamaica: "Jamaika", türkiye: "Türkiye", turkey: "Türkiye"
});

function fromDictionaryKeep(value, dictionary) {
  if (value === null || value === undefined || String(value).trim() === "") return value;
  return dictionary[key(value)] || value;
}

export function turkishPlayer360(model) {
  const identity = model && model.identity;
  if (identity) {
    identity.position = positionLabelTr(identity.position);
    identity.secondaryPosition = positionLabelTr(identity.secondaryPosition);
    identity.nationality = fromDictionaryKeep(identity.nationality, COUNTRIES_TR);
    identity.team = clubDisplayName(identity.team);
  }
  // Kulüp yazımı modelde de tek tablodan: sağlayıcı satırları ASCII gelebilir.
  const rows = model && model.transfers && Array.isArray(model.transfers.rows) ? model.transfers.rows : [];
  for (const row of rows) {
    row.fromTeam = clubDisplayName(row.fromTeam);
    row.toTeam = clubDisplayName(row.toTeam);
  }
  const career = model && model.career;
  if (career) {
    for (const stint of Array.isArray(career.stints) ? career.stints : []) stint.club = clubDisplayName(stint.club);
    if (Array.isArray(career.formerTeams)) career.formerTeams = career.formerTeams.map(clubDisplayName);
  }
  return model;
}
