/**
 * OYUNCU URL KİMLİĞİ — TAM İSİMLİ ADRESLER.
 *
 * Adres `/futbolcu/victor-osimhen` biçimine geçiyor. İki sorun var ve
 * ikisinin de çözümü burada:
 *
 * 1. TAM AD ÇOĞU KAYITTA YOK. Sağlayıcının kadro uç noktası adı kısaltarak
 *    gönderiyor ("V. Osimhen") ve `fullName` alanı 801 kayıtta adın
 *    kopyası. Ama tam ad deponun BAŞKA yerlerinde duruyor: maç olayı
 *    kayıtları gol/kart/oyuncu değişikliğini tam adla yazıyor ("Victor
 *    Osimhen"), haber etiketleri ve transfer kayıtları da öyle. Bu modül o
 *    yazımları toplayıp kayda bağlar — UYDURMAZ, deponun kendi sağlayıcı
 *    verisinden kurtarır.
 *
 * 2. SLUG ÜRETİCİSİ LATİN GENİŞLETİLMİŞ HARFLERDE BOZUK.
 *    `playerService.slug` yalnızca NFD ayrıştırmasıyla çözülen aksanları
 *    siliyor; tek kod noktası olan harfler (ł, ø, đ, ı, ß) eleniyor ve
 *    yerine tire giriyor: "Kacper Kozłowski" → "k-koz-owski". Mevcut
 *    kimlikler bu yüzden bozuk ve kimliği düzeltmek 806 kaydı taşımak
 *    demek; bu yüzden ESKİ üretici olduğu gibi bırakılıyor, yeni adresler
 *    buradaki doğru çeviriciyi kullanıyor.
 *
 * ÜÇ SERT KURAL — hepsi "yanlış oyuncuya adres yazma" ilkesinden:
 *
 *   • Aday ad, kaydın adının GENİŞLETİLMİŞ hâli olmalı: aynı soyadı, ilk
 *     harf uyumlu (services/playerMatchLogService.js'teki aynı eşleştirici).
 *   • Aday TEK olmalı. Aynı kayda iki farklı tam ad işaret ediyorsa
 *     (bağdaşmayan ilk adlar) kurtarma reddedilir.
 *   • Aday BAŞKA bir kayda da uyuyorsa reddedilir: "K. Ayhan" iki ayrı
 *     oyuncuya karşılık geliyorsa, birine "Kaan Ayhan" adresini vermek
 *     diğerini yanlış adrese bağlamak olur.
 *
 * TAM ADI OLMAYAN KAYIT ADRES DEĞİŞTİRMEZ. Yarı yolda bir geçiş — önce
 * kısaltmalı yeni adres, sonra tam adlı bir başkası — aynı sayfayı İKİ KEZ
 * taşımak demek. Bir sayfa en fazla bir kez taşınır; tam ad geldiği gün o
 * kayıt da tek seferde geçer.
 */

const { nameKey, namesMatch, normalizeName } = require("./playerMatchLogService.js");
const { sameCanonicalPlayer } = require("./duplicatePlayerService.js");

/**
 * Tek kod noktası olan harfler. NFD ayrıştırması bunları çözmez; elle
 * eşlenmezse slug üreticisi harfi atıp yerine tire koyar.
 */
const LETTER_MAP = Object.freeze({
  ł: "l", Ł: "l",
  ø: "o", Ø: "o",
  đ: "d", Đ: "d", ð: "d", Ð: "d",
  ı: "i", İ: "i",
  ß: "ss",
  æ: "ae", Æ: "ae",
  œ: "oe", Œ: "oe",
  þ: "th", Þ: "th",
  ŉ: "n"
});

/**
 * URL parçası. Aksanlar ayrıştırılır, tek kod noktalı harfler eşlenir,
 * kalan her şey tireye iner.
 *
 * "İlkay Gündoğan"    → "ilkay-gundogan"
 * "Kacper Kozłowski"  → "kacper-kozlowski"
 * "Davinson Sánchez"  → "davinson-sanchez"
 */
function toSlug(value) {
  return String(value ?? "")
    .replace(/[łŁøØđĐðÐıİßæÆœŒþÞŉ]/g, (char) => LETTER_MAP[char] || char)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ad kısaltmalı mı? ("V. Osimhen", "İ. Gündoğan") */
function isAbbreviated(value) {
  return /(^|\s)\p{Lu}\.\s/u.test(String(value ?? ""));
}

/** Kayıtta yayımlanabilir bir tam ad zaten var mı? */
function storedFullName(player) {
  const value = String((player && player.fullName) || "").trim();
  if (!value || isAbbreviated(value)) return null;
  return value.split(/\s+/).length >= 2 ? value : null;
}

/**
 * Depodaki tam ad yazımlarını toplar.
 *
 * KAYNAKLAR — hepsi sağlayıcının ya da editöryel sürecin kendi kaydı:
 *   • maç olayları (`value`: "Victor Osimhen · Asist: ... · Normal Goal")
 *   • haber etiketleri ve `discovery.subject`
 *   • transfer kayıtlarındaki `playerName`
 *
 * @returns {string[]} benzersiz aday adlar
 */
function collectFullNameCandidates(sources = {}) {
  const found = new Set();

  const push = (value) => {
    const text = String(value ?? "").trim();
    if (!text || isAbbreviated(text)) return;
    if (text.split(/\s+/).length < 2) return;
    found.add(text);
  };

  const matchRecords = []
    .concat(Array.isArray(sources.matches) ? sources.matches : [])
    .concat((Array.isArray(sources.archive) ? sources.archive : []).map((row) => (row && row.match) || row));

  for (const match of matchRecords) {
    for (const event of (match && match.events) || []) {
      for (const part of String((event && event.value) || "").split("·")) {
        const text = part.trim();
        if (!text) continue;
        if (/^(asist|assist)\s*:/i.test(text)) {
          push(text.replace(/^(asist|assist)\s*:\s*/i, ""));
          continue;
        }
        // Olay türü/detayı ("Normal Goal", "Yellow Card") ad değildir.
        if (/goal|card|subst|penalty|kart|gol|substitution/i.test(text)) continue;
        push(text);
      }
    }
  }

  for (const item of Array.isArray(sources.news) ? sources.news : []) {
    for (const tag of (item && item.tags) || []) push(tag);
    if (item && item.discovery) push(item.discovery.subject);
  }

  for (const transfer of Array.isArray(sources.transfers) ? sources.transfers : []) {
    push(transfer && transfer.playerName);
  }

  // YAPISAL AD ALANLARI — serbest metin DEĞİL.
  //
  // Tam ad, deponun başka dosyalarında da yapısal alanlarda duruyor:
  // resmî kadro uyarıları, maç özel sayfaları, sezon arşivi, lig
  // liderleri, maç raporları. Bunlar `name`/`playerName` gibi DEĞERİ
  // ZATEN BİR AD OLAN alanlar.
  //
  // Gövde metni KASITLI OLARAK taranmıyor. Denendi: haber ve analiz
  // metinlerinden "Ad Soyad" kalıbı çekmek kapsamı ikiye katlıyor ama
  // Türkçe tamlamaları ad sanıyor ("Kartal'ın Fred"). Adres kalıcıdır;
  // bir kez yanlış yazılan ad, yanlış bir URL olarak kalır.
  for (const record of Array.isArray(sources.structured) ? sources.structured : []) {
    collectFromNameFields(record, push);
  }

  return [...found];
}

/** Değeri ad olan alan adları. */
const NAME_FIELDS = new Set(["playerName", "name", "subject", "scorer", "player"]);

function collectFromNameFields(value, push, key = null) {
  if (typeof value === "string") {
    if (key && NAME_FIELDS.has(key)) push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFromNameFields(item, push, key);
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      collectFromNameFields(child, push, childKey);
    }
  }
}

/**
 * ADRESTE YASAL AD DEĞİL, YAYGIN AD.
 *
 * `fullName` sağlayıcının nüfus kaydına yakın hâli: "Muhammed Kerem
 * Aktürkoğlu", "Mauro Emanuel Icardi". Adres bunu taşırsa hem uzar hem de
 * kimsenin aramadığı bir dizge olur. Okuyucunun ve aramanın kullandığı ad
 * kaydın `name` alanındadır — kısaltılmamışsa adres onu kullanır.
 *
 * Sıra: yaygın ad → depodan kurtarılan ad → yasal tam ad.
 */
function commonName(player) {
  const value = String((player && player.name) || "").trim();
  if (!value || isAbbreviated(value)) return null;
  return value.split(/\s+/).length >= 2 ? value : null;
}

/**
 * Bir kaydın tam adını kurtarır.
 *
 * AYNI OYUNCUNUN İKİNCİ KAYDI DA BİR KAYNAKTIR. Kadro senkronu elle
 * kürasyonlu kaydın yanına yeni bir sağlayıcı kaydı yazıyor:
 * "victor-osimhen" (tam ad, mock kimlik) ve "v-osimhen-galatasaray"
 * (kısaltmalı ad, gerçek sağlayıcı kimliği) aynı kişi. Kanonik kayıt
 * ikincisi ama tam ad birincisinde duruyor — grup içinden okunur.
 *
 * @returns {{fullName: string, source: string} | null}
 */
function recoverFullName(player, candidates, players) {
  const list = Array.isArray(players) ? players : [];
  const group = list.filter((row) => row && (row.id === player.id || sameCanonicalPlayer(player, row)));

  // 1. Grup içindeki yaygın ad.
  for (const row of group) {
    const name = commonName(row);
    if (name) return { fullName: name, source: row.id === player.id ? "record" : "duplicate-record" };
  }

  // 2. Depo kaynaklarından kurtarma.
  const key = nameKey(player && player.name);
  if (key) {
    const matches = (Array.isArray(candidates) ? candidates : [])
      .filter((candidate) => namesMatch(nameKey(candidate), key));

    // Tek aday şartı: bağdaşmayan iki yazım varsa hangisinin bu kayda ait
    // olduğunu bilemeyiz.
    const distinct = [...new Set(matches.map((value) => normalizeName(value)))];
    if (distinct.length === 1) {
      // Aday BAŞKA BİR OYUNCUYA da uyuyorsa reddedilir. Ölçüt kayıt değil
      // OYUNCU: aynı kişinin iki kaydı "iki talip" değildir, yoksa tam adı
      // ikinci kayıtta duran her oyuncu elenirdi.
      const claimants = list.filter((row) => row && namesMatch(nameKey(row.name), nameKey(matches[0])));
      const distinctPlayers = claimants.filter((row, index) =>
        claimants.findIndex((other) => other.id === row.id || sameCanonicalPlayer(other, row)) === index);

      if (distinctPlayers.length <= 1) return { fullName: matches[0], source: "derived" };
    }
  }

  // 3. Son çare: yasal tam ad.
  const stored = storedFullName(player);
  return stored ? { fullName: stored, source: "record-fullname" } : null;
}

/**
 * Bütün kayıtlar için tam ad haritası.
 *
 * @returns {Map<string, {fullName: string, source: string}>}
 */
function buildFullNameMap(players, sources = {}) {
  const candidates = collectFullNameCandidates(sources);
  const map = new Map();

  for (const player of Array.isArray(players) ? players : []) {
    if (!player || !player.id) continue;
    const recovered = recoverFullName(player, candidates, players);
    if (recovered) map.set(player.id, recovered);
  }

  return map;
}

/**
 * URL ADRESLERİ — çakışmasız, transferden etkilenmez.
 *
 * Slug YALNIZCA addan türer, kulüpten değil: kulüp slug'a girseydi her
 * transfer bir URL taşıması olurdu. Aynı tam adı taşıyan iki oyuncu varsa
 * ayırt edici olarak kulüp, o da yetmezse sağlayıcı kimliği eklenir —
 * yalnızca çakışan kayıtlara, diğerleri sade adresini korur.
 *
 * @returns {Map<string, string>} oyuncu kimliği → URL slug'ı
 */
function buildSlugMap(players, fullNames) {
  const names = fullNames instanceof Map ? fullNames : new Map(Object.entries(fullNames || {}));
  const bySlug = new Map();

  for (const player of Array.isArray(players) ? players : []) {
    // KOPYA KAYIT ADRES ALMAZ. Aynı gerçek oyuncunun iki kaydı aynı tam adı
    // taşır; ikisine de adres verilseydi çakışma çözücü devreye girip
    // ikisini de bozardı ("victor-osimhen-galatasaray-2780"). Adres
    // kanonik kaydındır (services/duplicatePlayerService.js), kopya kayıt
    // ona yönlendirilir.
    if (player && player.isDuplicate) continue;
    const entry = player && names.get(player.id);
    if (!entry) continue;
    const base = toSlug(entry.fullName);
    if (!base) continue;
    if (!bySlug.has(base)) bySlug.set(base, []);
    bySlug.get(base).push(player);
  }

  const slugs = new Map();
  for (const [base, group] of bySlug) {
    if (group.length === 1) {
      slugs.set(group[0].id, base);
      continue;
    }

    // Çakışma: kulüple ayır.
    const used = new Map();
    for (const player of group) {
      const club = toSlug(player.currentTeam || player.team || "");
      const candidate = club ? `${base}-${club}` : base;
      if (!used.has(candidate)) used.set(candidate, []);
      used.get(candidate).push(player);
    }

    for (const [candidate, sameClub] of used) {
      if (sameClub.length === 1) {
        slugs.set(sameClub[0].id, candidate);
        continue;
      }
      // Kulüp de ayırmadı: sağlayıcı kimliği son ayırt edici.
      for (const player of sameClub) {
        slugs.set(player.id, `${candidate}-${toSlug(player.providerId || player.id)}`);
      }
    }
  }

  return slugs;
}

module.exports = {
  buildFullNameMap,
  buildSlugMap,
  collectFullNameCandidates,
  isAbbreviated,
  recoverFullName,
  storedFullName,
  toSlug
};
