/**
 * MAÇ DOSYASI — HANGİ MAÇ, HANGİ MODÜLLER, HANGİ VERİYLE.
 *
 * Bir maç dosyası iki farklı türde içerik taşır ve AYRIMI KORUMAK bu
 * modülün asıl işi:
 *
 *   • OLGU — fikstür (saat, stat, hafta), kadrolar, form. Veri
 *     katmanından gelir. Doğrulanmamışsa GÖSTERİLMEZ; uydurulmaz.
 *   • YORUM — taktik analiz, senaryo, skor tahmini. `data/match-specials.json`
 *     içinde elle yazılır ve ekranda YORUM olduğu belirtilir.
 *
 * İkisini aynı rafta göstermek, okuyucunun editoryal bir cümleyi doğrulanmış
 * veri sanması demek olurdu. Sitenin geri kalanı doğrulanmış veri iddia
 * ediyor; bu sayfa bir bölümünde etmiyor ve bunu yazıyor.
 *
 * KADRO VERİDEN GELİR; kaynak gösterilmiş MUHTEMEL 11 ise ayrı bir
 * editoryal katmanda tutulur ve hiçbir zaman resmî diye etiketlenmez. Kilit oyuncu kartları
 * `data/super-lig-squads.json` ile KESİŞTİRİLİR: kadroda olmayan oyuncu
 * karta girmez. Bir sezon önce ayrılmış bir futbolcuyu "kilit oyuncu" diye
 * göstermek, okuyucuya yanlış kadro bilgisi vermenin en görünür biçimi.
 *
 * FORMUN KAYNAĞI ETİKETLENİR. Arşivde kaydı olan takımın formu doğrulanmış
 * maçlardan türetilir (`source: "verified"`). Kaydı olmayan takım için
 * editoryal girdi kullanılır (`source: "editorial"`) ve ekranda öyle
 * görünür — iki kaynağı aynı görünümde sunmak, olmayan bir doğrulama
 * iddiası olurdu.
 *
 * RESMÎ İLK 11 BU MODÜLÜN İŞİ DEĞİL. Resmî kadro
 * `services/officialLineupService.js` üzerinden sağlayıcıdan gelir. Buradaki
 * `probableLineup`, adı ve kaynağı görünür bir editoryal ön izleme olarak
 * kalır; sağlayıcı onayı olmadan resmî statü kazanamaz.
 */

const LOCALES = ["tr", "en"];

/** Bir maç dosyası en az bu kadar modül taşımalı; azı "dosya" değil, sayfadır. */
const MIN_MODULES = 4;

function text(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function normalizeLocale(value) {
  return LOCALES.includes(text(value)) ? text(value) : "tr";
}

/** İki dilli alan: sunumda eksik dil Türkçeye düşer. */
function localized(field, locale) {
  if (!field) return "";
  if (typeof field === "string") return text(field);
  return text(field[normalizeLocale(locale)]) || text(field.tr) || text(field.en);
}

/** Alan bu dilde GERÇEKTEN yazılmış mı? Doğrulama yedeğe bakmaz. */
function hasLocale(field, locale) {
  if (!field || typeof field === "string") return false;
  return Boolean(text(field[normalizeLocale(locale)]));
}

function asList(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

/** Aksan ve büyük harf nötr karşılaştırma (depodaki diğer katlamalarla aynı iş). */
function foldName(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
    .replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** İki takım adı aynı kulübü mü gösteriyor? Kelime sınırlı içerme. */
function sameTeam(left, right) {
  const a = foldName(left);
  const b = foldName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 4) return false;
  return new RegExp(`(^|-)${shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`).test(longer);
}

/** Fikstür kaydını kimliğe göre bulur. Kayıt yoksa dosya üretilmez. */
function findFixture(fixturePayload, matchId) {
  const list = asList(fixturePayload, "matches");
  return list.find((match) => text(match && match.id) === text(matchId)) || null;
}

/** Takımın güncel kadrosu; yoksa boş dizi (kilit oyuncu kartı basılmaz). */
function squadFor(squadsPayload, teamName) {
  const list = Array.isArray(squadsPayload) ? squadsPayload : Object.values(squadsPayload || {});
  const hit = list.find((entry) => sameTeam(entry && entry.teamName, teamName));
  return {
    teamId: text(hit && hit.teamId),
    players: Array.isArray(hit && hit.players) ? hit.players : []
  };
}

/**
 * KİLİT OYUNCULAR — KADROYLA KESİŞTİRİLİR.
 *
 * `wanted` editoryal bir ilgi listesidir; kadroda karşılığı olmayan ad
 * karta GİRMEZ. Eşleşme tam ad ya da kısaltılmış ad üzerinden yapılır
 * (kadro verisi "V. Osimhen" biçiminde tutuyor, editör "Victor Osimhen"
 * yazabilir).
 */
function keyPlayersFor(squad, wanted, limit) {
  const players = squad.players || [];

  // Her anahtar için ADAY LİSTESİ tutulur, tek kayıt değil: aynı anahtara
  // birden çok oyuncu düşerse eşleşme BELİRSİZDİR ve sayılmaz. Kadroda
  // "A. Yilmaz", "J. Yılmaz" ve "B. Yılmaz" birlikte duruyor; soyadıyla
  // eşleştirmek üçünü birbirine karıştırırdı.
  const index = new Map();
  const add = (key, player) => {
    if (!key) return;
    const bucket = index.get(key) || [];
    bucket.push(player);
    index.set(key, bucket);
  };

  for (const player of players) {
    const name = text(player && player.name);
    if (!name) continue;
    const parts = name.split(/\s+/).filter(Boolean);
    add(foldName(name), player);
    if (parts.length > 1) add(foldName(parts.slice(1).join(" ")), player);
  }

  /**
   * Editör tam adı yazar ("Barış Alper Yılmaz"), kadro kısaltılmış tutar
   * ("B. Yılmaz"). Aranan ad BAŞ HARF + SOYAD biçimine de indirgenir.
   */
  const keysFor = (want) => {
    const parts = text(want).split(/\s+/).filter(Boolean);
    if (!parts.length) return [];
    const surname = parts[parts.length - 1];
    return [
      foldName(want),
      parts.length > 1 ? foldName(parts.slice(1).join(" ")) : "",
      parts.length > 1 ? foldName(`${parts[0].charAt(0)} ${surname}`) : ""
    ].filter(Boolean);
  };

  const picked = [];
  const seen = new Set();
  for (const want of Array.isArray(wanted) ? wanted : []) {
    // Yalnızca TEK adaya düşen anahtar kabul edilir.
    const hit = keysFor(want)
      .map((key) => index.get(key))
      .find((bucket) => bucket && bucket.length === 1);
    const player = hit && hit[0];
    if (!player || seen.has(player.name)) continue;
    seen.add(player.name);
    picked.push({
      name: text(player.name),
      position: text(player.position),
      number: player.number ?? null,
      editorial: true
    });
  }
  return picked.slice(0, limit || 12);
}

/**
 * Editoryal liste verilmemiş takım için kadrodan DENGELİ bir seçki:
 * her hattan oyuncu. Rastgele on isim listelemek yerine mevkilere
 * dağıtmak, "kilit oyuncu" iddiasını kadro yapısına bağlar.
 */
function squadHighlights(squad, limit) {
  const buckets = { Goalkeeper: [], Defender: [], Midfielder: [], Attacker: [] };
  for (const player of squad.players || []) {
    const position = text(player && player.position);
    if (buckets[position]) buckets[position].push(player);
  }
  const order = ["Goalkeeper", "Defender", "Midfielder", "Attacker"];
  const quota = { Goalkeeper: 1, Defender: 2, Midfielder: 2, Attacker: 2 };
  const picked = [];
  for (const position of order) {
    for (const player of buckets[position].slice(0, quota[position])) {
      picked.push({ name: text(player.name), position, number: player.number ?? null, editorial: false });
    }
  }
  return picked.slice(0, limit || 8);
}

/**
 * FORM — KAYNAĞIYLA BİRLİKTE.
 *
 * Arşivde kaydı olan takımın son maçları doğrulanmış veriden türetilir.
 * Kaydı olmayan takım için editoryal girdi kullanılır ve `source` alanı
 * bunu söyler; çağıran ekranda ayrımı göstermek zorunda.
 */
function formFor(archivePayload, editorialForm, teamName, limit) {
  const seasons = (archivePayload && archivePayload.seasons) || {};
  const matches = Object.values(seasons).flatMap((season) => (season && season.matches) || []);

  const own = matches
    .filter((match) => sameTeam(match.homeTeam, teamName) || sameTeam(match.awayTeam, teamName))
    .filter((match) => match.score && Number.isFinite(Number(match.score.home)) && Number.isFinite(Number(match.score.away)))
    .sort((left, right) => Date.parse(right.kickoff || 0) - Date.parse(left.kickoff || 0))
    .slice(0, limit || 5)
    .map((match) => {
      const home = Number(match.score.home);
      const away = Number(match.score.away);
      const isHome = sameTeam(match.homeTeam, teamName);
      const scored = isHome ? home : away;
      const conceded = isHome ? away : home;
      return {
        label: `${text(match.homeTeam)} ${home}-${away} ${text(match.awayTeam)}`,
        date: text(match.kickoff).slice(0, 10),
        result: scored > conceded ? "win" : (scored < conceded ? "loss" : "draw"),
        scored,
        conceded
      };
    });

  if (own.length) return { source: "verified", matches: own };

  const editorial = (editorialForm && editorialForm[teamName]) || [];
  return {
    source: editorial.length ? "editorial" : "none",
    matches: Array.isArray(editorial) ? editorial.slice(0, limit || 5) : []
  };
}

/**
 * KAYIT DOĞRULAMASI. Geçersiz dosya elenir ve NEDENİ döner — sessiz eleme,
 * hata ayıklanamaz eleme demek.
 */
function validateSpecial(record, fixture) {
  const errors = [];
  if (!record || typeof record !== "object") return { valid: false, errors: ["kayıt okunamadı"] };

  if (!text(record.matchId)) errors.push("matchId zorunlu");
  if (!text(record.slug)) errors.push("slug zorunlu");
  if (!text(record.enSlug)) errors.push("enSlug zorunlu");
  if (!fixture) errors.push(`fikstürde maç yok: ${text(record.matchId)}`);

  for (const field of ["title", "lead"]) {
    for (const locale of LOCALES) {
      if (!hasLocale(record[field], locale)) errors.push(`${field}.${locale} zorunlu`);
    }
  }

  const modules = Array.isArray(record.modules) ? record.modules : [];
  if (modules.length < MIN_MODULES) errors.push(`en az ${MIN_MODULES} modül olmalı (${modules.length})`);

  const slugs = new Set();
  for (const module of modules) {
    const id = text(module && module.id) || "(kimliksiz)";
    for (const locale of LOCALES) {
      if (!hasLocale(module.title, locale)) errors.push(`${id}: title.${locale} zorunlu`);
      if (!hasLocale(module.slug, locale)) errors.push(`${id}: slug.${locale} zorunlu`);
    }
    const sections = Array.isArray(module.sections) ? module.sections : [];
    if (!sections.length) errors.push(`${id}: en az bir bölüm olmalı`);
    for (const section of sections) {
      for (const locale of LOCALES) {
        if (!hasLocale(section.body, locale)) errors.push(`${id}: bölüm gövdesi ${locale} dilinde eksik`);
      }
    }
    // Modül adresleri benzersiz olmalı: aynı slug iki modülü birbirine ezer.
    for (const locale of LOCALES) {
      const key = `${locale}:${localized(module.slug, locale)}`;
      if (slugs.has(key)) errors.push(`${id}: slug yinelenmiş (${key})`);
      slugs.add(key);
    }
  }

  if (record.probableLineup) {
    const probable = record.probableLineup;
    if (!text(probable.formation)) errors.push("probableLineup.formation zorunlu");
    if (!text(probable.source && probable.source.name)) errors.push("probableLineup.source.name zorunlu");
    for (const field of ["title", "badge", "sourceLabel", "moduleKicker", "promoTitle", "promoSpot"]) {
      for (const locale of LOCALES) {
        if (!hasLocale(probable[field], locale)) errors.push(`probableLineup.${field}.${locale} zorunlu`);
      }
    }
    const players = Array.isArray(probable.players) ? probable.players : [];
    if (players.length !== 11) errors.push(`probableLineup.players tam 11 oyuncu olmalı (${players.length})`);
    const playerNames = new Set();
    for (const player of players) {
      const name = text(player && player.name);
      if (!name) errors.push("probableLineup oyuncu adı zorunlu");
      if (playerNames.has(name)) errors.push(`probableLineup oyuncusu yinelenmiş: ${name}`);
      playerNames.add(name);
      if (!Number.isInteger(player && player.row) || player.row < 0 || player.row > 4) {
        errors.push(`probableLineup oyuncu satırı geçersiz: ${name || "(adsız)"}`);
      }
      if (!text(player && player.profile && player.profile.tr)) {
        errors.push(`probableLineup oyuncu profili eksik: ${name || "(adsız)"}`);
      }
    }
    const analysis = Array.isArray(probable.analysis) ? probable.analysis : [];
    if (!analysis.length) errors.push("probableLineup.analysis zorunlu");
    for (const section of analysis) {
      for (const locale of LOCALES) {
        if (!hasLocale(section.heading, locale) || !hasLocale(section.body, locale)) {
          errors.push(`probableLineup.analysis ${locale} metni eksik`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * MAÇ DOSYASI — ya da `null`.
 *
 * `null` dönmek "bu maçın dosyası YOK" demektir ve çağıran bunu sessizce
 * uygular: eksik veri yer tutucuyla doldurulmaz.
 */
function selectMatchSpecial(sources = {}, options = {}) {
  const records = asList(sources.specials, "specials");
  const matchId = text(options.matchId);
  const record = matchId
    ? records.find((entry) => text(entry && entry.matchId) === matchId)
    : records[0];

  if (!record) return { special: null, rejected: [] };

  const fixture = findFixture(sources.fixtures, record.matchId);
  const verdict = validateSpecial(record, fixture);
  if (!verdict.valid) {
    return { special: null, rejected: [{ id: text(record.matchId) || "(kimliksiz)", errors: verdict.errors }] };
  }

  const homeTeam = text(fixture.homeTeam);
  const awayTeam = text(fixture.awayTeam);
  const homeSquad = squadFor(sources.squads, homeTeam);
  const awaySquad = squadFor(sources.squads, awayTeam);

  return {
    special: {
      matchId: text(record.matchId),
      slug: text(record.slug),
      enSlug: text(record.enSlug),
      kicker: record.kicker || null,
      title: record.title,
      lead: record.lead,
      probableLineup: record.probableLineup || null,
      modules: record.modules,
      fixture: {
        id: text(fixture.id),
        homeTeam,
        awayTeam,
        kickoff: text(fixture.kickoff),
        venue: text(fixture.venue),
        league: text(fixture.league),
        round: fixture.round ?? null,
        homeTeamLogo: text(fixture.homeTeamLogo),
        awayTeamLogo: text(fixture.awayTeamLogo),
        status: text(fixture.status) || "SCHEDULED"
      },
      teams: {
        home: {
          name: homeTeam,
          providerId: homeSquad.teamId,
          squadSize: homeSquad.players.length,
          keyPlayers: keyPlayersFor(homeSquad, record.keyPlayers && record.keyPlayers[homeTeam], 10),
          form: formFor(sources.archive, record.editorialForm, homeTeam, 5)
        },
        away: {
          name: awayTeam,
          providerId: awaySquad.teamId,
          squadSize: awaySquad.players.length,
          // Konuk takım için editoryal liste verilmemişse kadrodan dengeli
          // seçki: kadroda olmayan bir ad hiçbir koşulda karta girmez.
          keyPlayers: (record.keyPlayers && record.keyPlayers[awayTeam])
            ? keyPlayersFor(awaySquad, record.keyPlayers[awayTeam], 10)
            : squadHighlights(awaySquad, 7),
          form: formFor(sources.archive, record.editorialForm, awayTeam, 5)
        }
      }
    },
    rejected: []
  };
}

/** Dosyayı tek dile indirger; üreticiye giden biçim budur. */
function localizeSpecial(special, locale) {
  if (!special) return null;
  const lang = normalizeLocale(locale);
  return {
    ...special,
    locale: lang,
    slug: lang === "en" ? special.enSlug : special.slug,
    kicker: localized(special.kicker, lang),
    title: localized(special.title, lang),
    lead: localized(special.lead, lang),
    probableLineup: special.probableLineup ? {
      ...special.probableLineup,
      title: localized(special.probableLineup.title, lang),
      badge: localized(special.probableLineup.badge, lang),
      sourceLabel: localized(special.probableLineup.sourceLabel, lang),
      moduleKicker: localized(special.probableLineup.moduleKicker, lang),
      promoTitle: localized(special.probableLineup.promoTitle, lang),
      promoSpot: localized(special.probableLineup.promoSpot, lang),
      analysis: (special.probableLineup.analysis || []).map((section) => ({
        heading: localized(section.heading, lang),
        body: localized(section.body, lang)
      }))
    } : null,
    modules: special.modules.map((module) => ({
      id: text(module.id),
      slug: localized(module.slug, lang),
      kicker: localized(module.kicker, lang),
      title: localized(module.title, lang),
      summary: localized(module.summary, lang),
      editorial: Boolean(module.editorial),
      sections: (module.sections || []).map((section) => ({
        heading: localized(section.heading, lang),
        body: localized(section.body, lang)
      }))
    }))
  };
}

/** Elenen dosyaları görünür kılar. */
function logRejected(rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:match-special-rejected] id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  LOCALES,
  MIN_MODULES,
  foldName,
  formFor,
  hasLocale,
  keyPlayersFor,
  localized,
  localizeSpecial,
  logRejected,
  sameTeam,
  selectMatchSpecial,
  squadHighlights,
  validateSpecial
};
