/**
 * MAÇ SONU AÇIKLAMALARININ OTOMATİK TOPLANMASI — ÜÇ AYRI İDDİA, ÜÇ AYRI KANIT.
 *
 * Bir alıntıyı yayımlamak tek bir iddia değil, ÜÇ iddiadır:
 *
 *   1. Bu cümle harfi harfine böyle söylendi.
 *   2. Bunu söyleyen kişi şu kişidir ve şu roldedir.
 *   3. Bu söz şu maçtan sonra söylendi.
 *
 * Üçünden biri yanlışsa ortaya uydurma bir atıf çıkar — ve uydurma atıf,
 * uydurma cümle kadar zararlıdır: "Okan Buruk şöyle dedi" diye basılan bir
 * futbolcu sözü, kimsenin söylemediği bir cümle kadar yanlıştır.
 *
 * Bu yüzden burada HİÇBİR ŞEY ÇIKARSANMAZ. Her iddianın MEKANİK bir kanıtı
 * olmak zorunda:
 *
 *   1. CÜMLE — yalnızca tırnak içindeki span kopyalanır. Tırnak yoksa kayıt
 *      reddedilir; gazetecinin dolaylı anlatımını ("kadroyu övdü") tırnağa
 *      almak, söylenmemiş bir cümle üretmektir.
 *   2. KİŞİ ve ROL — data/managers.json ve data/super-lig-squads.json'dan
 *      ARANIR. Bulunamayan ad reddedilir; rol asla addan tahmin edilmez.
 *      Bir ad birden çok kişiye düşüyorsa (aynı soyad) yine reddedilir:
 *      belirsiz eşleşme, eşleşme değildir.
 *   3. MAÇ — kişinin takımının, haberin yayın anından ÖNCE bitmiş ve zaman
 *      penceresine giren maçı aranır. Sıfır ya da birden çok aday varsa
 *      reddedilir.
 *
 * REDDETMEK BAŞARISIZLIK DEĞİL, ÜRÜNÜN KENDİSİDİR. Bu modülün doğru çalışması
 * "çok alıntı toplaması" değil, "doğrulayamadığı hiçbir şeyi geçirmemesi"
 * demek. Her ret gerekçesiyle birlikte döner ki hangi kaynağın neden elendiği
 * görülebilsin.
 *
 * Burada I/O YOK: besleme çekme, dosya yazma ve zamanlama
 * scripts/sync-manager-quotes.mjs'te. Kural saf kalsın ki sınanabilsin.
 */
const { foldName, sameTeam } = require("./matchSpecial.js");
const { validateQuote } = require("./managerQuotes.js");

/**
 * AÇIKLAMA PENCERESİ — başlama saatine göre.
 *
 * Alt sınır ilk düdükten değil, maçın BİTİŞİNDEN sonrasını hedefler: 80
 * dakika, devre arası demeçlerini dışarıda bırakacak kadar geç, uzatmasız
 * biten bir maçın son düdüğüne yetecek kadar erken değil — bilerek. 90'dan
 * kısa tutulsaydı devre arası röportajı "maç sonu açıklaması" diye girerdi.
 *
 * Üst sınır 20 saat: gece yarısını aşan yayınları kapsıyor ama ertesi günün
 * basın toplantısını DIŞARIDA bırakıyor. O ayrı bir bağlam; "maç sonu"
 * demek olmaz.
 */
const STATEMENT_MIN_MS = 80 * 60 * 1000;
const STATEMENT_MAX_MS = 20 * 60 * 60 * 1000;

/** Bir maça otomatik olarak en fazla bu kadar alıntı girer. */
const MAX_QUOTES_PER_MATCH = 4;

/** Şeritte okunabilir olmayacak kadar kısa bir "alıntı" alıntı sayılmaz. */
const MIN_QUOTE_LENGTH = 12;
const MAX_QUOTE_LENGTH = 400;

/**
 * Başlıkta alıntıyı saran işaretler. Türk spor basını bunların hepsini
 * kullanıyor; tek bir çifti beklemek yayınların çoğunu boşa elerdi.
 */
const QUOTE_PAIRS = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
  ["‘", "’"],
  ["«", "»"]
];

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * "Nuri Şahin: \"Çok gereksiz 2 puan kaybettik\"" → {speaker, quote}
 *
 * Neden BAŞLIK okunuyor, makale gövdesi değil: gövdede birden çok kişi
 * konuşur, dolaylı anlatım ile doğrudan alıntı iç içe geçer ve hangi
 * cümlenin kime ait olduğu ancak YORUMLA çıkarılır. Başlığın bu kalıbı ise
 * yapısal: iki nokta üst üstesinden önce konuşan, tırnak içinde söylediği.
 * Yorum gerektirmeyen tek yer orası.
 */
function parseQuoteHeadline(title) {
  const raw = text(title);
  if (!raw) return { error: "başlık boş" };

  const colon = raw.indexOf(":");
  if (colon < 1) return { error: "başlıkta 'kişi: alıntı' kalıbı yok" };

  const speaker = raw.slice(0, colon).trim();
  const rest = raw.slice(colon + 1).trim();
  if (!speaker) return { error: "konuşan adı boş" };

  for (const [open, close] of QUOTE_PAIRS) {
    if (!rest.startsWith(open)) continue;
    // Kapanış tırnağı SONDAN aranır: alıntının içinde aynı işaret geçebilir.
    const end = rest.lastIndexOf(close);
    if (end <= 0) continue;
    const quote = rest.slice(open.length, end).trim();
    if (quote.length < MIN_QUOTE_LENGTH) return { error: `alıntı fazla kısa: "${quote}"` };
    if (quote.length > MAX_QUOTE_LENGTH) return { error: "alıntı fazla uzun (başlık değil)" };
    return { speaker, quote };
  }

  return { error: "alıntı tırnak içinde değil" };
}

/**
 * Konuşan kişi dizini: ad → {role, team}.
 *
 * Hem tam ad hem "baş harf + soyad" biçimi anahtarlanır, çünkü kadro verisi
 * kısaltılmış ("L. Trossard") tutarken haber tam adı yazıyor. Aynı anahtara
 * birden çok kişi düşerse o anahtar KULLANILMAZ hâle gelir — kadroda
 * "A. Yilmaz", "B. Yılmaz", "J. Yılmaz" birlikte duruyor ve soyadla
 * eşleştirmek üçünü birbirine karıştırırdı.
 */
function buildSpeakerIndex(sources = {}) {
  const index = new Map();

  const add = (key, entry) => {
    if (!key) return;
    const bucket = index.get(key) || [];
    bucket.push(entry);
    index.set(key, bucket);
  };

  const keysOf = (name) => {
    const parts = text(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return [];
    const surname = parts[parts.length - 1];
    return [
      foldName(name),
      parts.length > 1 ? foldName(`${parts[0].charAt(0)} ${surname}`) : ""
    ].filter(Boolean);
  };

  const managers = Array.isArray(sources.managers && sources.managers.managers)
    ? sources.managers.managers
    : (Array.isArray(sources.managers) ? sources.managers : []);

  for (const row of managers) {
    const name = text(row && row.manager);
    const team = text(row && row.team);
    if (!name || !team) continue;
    // Doğrulanmamış teknik direktör kaydı kimlik kanıtı sayılmaz: kaynağı
    // "confirmed" olmayan bir atama, üzerine alıntı bağlanacak kadar sağlam
    // bir zemin değil.
    if (text(row.confidence) && text(row.confidence) !== "confirmed") continue;
    for (const key of keysOf(name)) add(key, { role: "manager", team, name });
  }

  const squads = Array.isArray(sources.squads)
    ? sources.squads
    : Object.values(sources.squads || {});

  for (const squad of squads) {
    const team = text(squad && squad.teamName);
    if (!team) continue;
    for (const player of (squad && squad.players) || []) {
      const name = text(player && player.name);
      if (!name) continue;
      for (const key of keysOf(name)) add(key, { role: "player", team, name });
    }
  }

  return index;
}

/**
 * Başlıktaki adı gerçek bir kişiye bağlar.
 *
 * Başlıklar ada ön ek koyabiliyor ("Başakşehir'de Nuri Şahin"). Bu yüzden
 * ADIN SONUNDAN geriye doğru kısaltılarak denenir. Kısaltma bir TAHMİN
 * DEĞİL: her deneme yine kadro/teknik direktör listesine karşı sınanıyor ve
 * yalnızca TEK kişiye düşen bir anahtar kabul ediliyor. Hiçbiri tutmazsa
 * kayıt reddedilir.
 */
function resolveSpeaker(index, rawName) {
  const parts = text(rawName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { error: "konuşan adı boş" };
  if (parts.length > 6) return { error: `konuşan adı ad gibi değil: "${text(rawName)}"` };

  for (let start = 0; start < parts.length - 1 || start === 0; start += 1) {
    const candidate = parts.slice(start).join(" ");
    const words = parts.slice(start);

    // Haber tam adı yazar ("Leandro Trossard"), kadro kısaltılmış tutar
    // ("L. Trossard"). Aranan ad BAŞ HARF + SOYAD biçimine de indirgenir —
    // aynı köprüyü services/matchSpecial.js `keyPlayersFor` de kuruyor.
    const keys = [foldName(candidate)];
    if (words.length > 1) {
      keys.push(foldName(`${words[0].charAt(0)} ${words[words.length - 1]}`));
    }

    const bucket = keys.map((key) => index.get(key)).find(Boolean);
    if (!bucket) continue;

    // Aynı ada birden çok kişi düşüyorsa (aynı soyadlı iki oyuncu, ya da hem
    // teknik direktör hem oyuncu) eşleşme BELİRSİZDİR. Belirsiz eşleşme,
    // eşleşmemekten daha tehlikeli: yanlış takım ve yanlış rol basılır.
    const unique = new Map(bucket.map((row) => [`${row.role}|${row.team}|${foldName(row.name)}`, row]));
    if (unique.size > 1) {
      return { error: `ad birden çok kişiye düşüyor: "${candidate}"` };
    }
    return { ...bucket[0], matchedAs: candidate };
  }

  return { error: `kadroda ve teknik direktör listesinde yok: "${text(rawName)}"` };
}

function kickoffMs(match) {
  const stamp = Date.parse(text(match && (match.kickoff || match.date)));
  return Number.isFinite(stamp) ? stamp : null;
}

/**
 * Açıklamayı bir maça bağlar.
 *
 * Aday, kişinin takımının haberden ÖNCE başlamış ve pencereye giren maçıdır.
 * Sıfır aday varsa haber bir maç sonu açıklaması değildir (transfer, sakatlık,
 * genel demeç). Birden çok aday varsa hangisinden bahsedildiği BELLİ DEĞİLDİR
 * — iki maçtan birini seçmek yazı tura atmaktır.
 */
function bindMatch(options = {}) {
  const team = text(options.team);
  const publishedAt = Date.parse(text(options.publishedAt));
  const fixtures = Array.isArray(options.fixtures) ? options.fixtures : [];
  const isFinished = typeof options.isFinished === "function" ? options.isFinished : () => true;

  if (!team) return { error: "takım yok" };
  if (!Number.isFinite(publishedAt)) return { error: "haberin yayın zamanı okunamadı" };

  const candidates = fixtures.filter((match) => {
    if (!match || !text(match.id)) return false;
    if (!sameTeam(match.homeTeam, team) && !sameTeam(match.awayTeam, team)) return false;
    if (!isFinished(match)) return false;
    const kickoff = kickoffMs(match);
    if (kickoff === null) return false;
    const age = publishedAt - kickoff;
    return age >= STATEMENT_MIN_MS && age <= STATEMENT_MAX_MS;
  });

  if (!candidates.length) return { error: `${team} için pencerede bitmiş maç yok` };
  if (candidates.length > 1) {
    return { error: `${team} için pencerede birden çok maç var (${candidates.map((row) => row.id).join(", ")})` };
  }
  return { matchId: text(candidates[0].id) };
}

/**
 * Tek bir besleme öğesinden yayımlanabilir bir alıntı çıkarır.
 *
 * @returns {{quote: Object}|{error: string}} Kayıt ya TAM olarak kurulur ya
 *   da gerekçesiyle reddedilir. Yarım kayıt (rolü bilinmeyen, maçı belirsiz)
 *   ÜRETİLMEZ.
 */
function harvestQuote(item, context = {}) {
  const link = text(item && item.link);
  if (!/^https?:\/\//i.test(link)) return { error: "kaynak bağlantısı yok" };

  const sourceName = text(item && item.sourceName);
  if (!sourceName) return { error: "kaynak adı yok" };

  const publishedAt = text(item && item.publishedAt);
  const stamp = Date.parse(publishedAt);
  if (!Number.isFinite(stamp)) return { error: `yayın zamanı okunamadı: ${publishedAt}` };

  const headline = parseQuoteHeadline(item && item.title);
  if (headline.error) return { error: headline.error };

  const speaker = resolveSpeaker(context.speakerIndex, headline.speaker);
  if (speaker.error) return { error: speaker.error };

  const bound = bindMatch({
    team: speaker.team,
    publishedAt,
    fixtures: context.fixtures,
    isFinished: context.isFinished
  });
  if (bound.error) return { error: bound.error };

  const quote = {
    matchId: bound.matchId,
    // AD, KAYNAĞIN YAZDIĞI GİBİ. Kadro dosyası adları sağlayıcı kısaltmasıyla
    // tutuyor ("R. Yılmaz"); haber tam adı yazıyor ("Rıdvan Yılmaz"). Kadro
    // kaydı burada KİMLİK KANITI olarak kullanılıyor — rolü ve takımı o
    // belirliyor — ama görünen ad kaynağınki olmalı: sağlayıcı kısaltmasını
    // basmak hem okunaksız hem de kaynağın yazdığından sapma.
    // `automation.rosterName` izlenebilirlik için kaydın içinde duruyor.
    speaker: speaker.matchedAs,
    role: speaker.role,
    team: speaker.team,
    quote: headline.quote,
    at: new Date(stamp).toISOString(),
    source: { name: sourceName, url: link },
    // OTOMATİK KAYIT AÇIKÇA İŞARETLENİR. Editörün elle girdiği kayıtla
    // otomatik toplananı ayırt edememek, birleştirme sırasında el emeğinin
    // sessizce ezilmesi demek olurdu (aşağıdaki merge bu işarete bakıyor).
    automation: {
      harvestedAt: text(context.now) || new Date().toISOString(),
      feed: text(item && item.feedId) || text(item && item.sourceName),
      rosterName: speaker.name
    }
  };

  // SON KAPI: kayıt, elle girilmiş bir kayıtla aynı doğrulamadan geçmeli.
  // Otomatik üretildi diye gevşetilmiş bir yol bırakmıyoruz.
  const verdict = validateQuote(quote);
  if (!verdict.valid) return { error: `doğrulama düştü: ${verdict.errors.join("; ")}` };

  return { quote };
}

/**
 * Karşılaştırma için metin normalleştirme. Tırnak ve kesme işaretlerinin
 * tipografik varyantları (" “ ” ' ‘ ’) aynı sayılır — yayın organı başlıkta
 * düz, gövdede tipografik tırnak kullanabiliyor ve bu bir metin farkı değil.
 * Nokta, virgül, ünlem KORUNUR: onlar cümleyi değiştirir.
 */
function foldForCompare(value) {
  return text(value)
    .replace(/[«»"“”'‘’]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("tr");
}

/**
 * BAŞLIKTAKİ ALINTI GERÇEKTEN SÖYLENMİŞ Mİ?
 *
 * Türk spor basını başlığa SIKIŞTIRILMIŞ bir alıntı koyuyor ve onu yine
 * tırnak içinde veriyor. Ölçüldü: Hürriyet'in bir haberinde başlık
 * "Derbi çok önemli, puan ya da puanlar istiyoruz" derken, teknik direktörün
 * gövdedeki sözleri "Fenerbahçe derbisi herkes için çok önemli... Puan ya da
 * puanlar almak istiyoruz" idi. İkisi aynı anlamda ama AYNI CÜMLE DEĞİL —
 * ve biz tırnak içinde yayımladığımızda okuyucu onu adamın kurduğu cümle
 * sanar. Yayın organının kısaltmasını kendi kısaltmamız gibi taşımak, bu
 * deponun "alıntı olduğu gibi girilir" kuralını dolaylı yoldan çiğnemek olur.
 *
 * Bu yüzden başlık TEK BAŞINA kanıt sayılmaz: cümlenin makalenin GÖVDESİNDE
 * de geçmesi gerekir. Arama yapılmadan önce başlık kromu (title, h1, h2, h3)
 * çıkarılır — aksi hâlde başlığın kendisi bulunur ve kontrol her zaman
 * "geçti" der, yani hiçbir şey ölçmez.
 *
 * NOKTALAMA FARKI DA FARKTIR — ve bu bilinçli bir maliyet. Ölçülmüş örnek:
 * bir haberin başlığı "Sorumlusu benim!" derken gövdedeki cümle "...ama
 * sorumlusu benim." idi. Kelimeler aynı, ünlem yayın organının. Bu kayıt
 * ELENİYOR. Gevşetip geçirmek, konuşanın kurmadığı bir tonu ona mal etmek
 * olurdu; üstelik "hangi noktalama süs, hangisi anlam" diye bir muhakeme
 * açardı — tam da bu deponun kaçındığı türden bir muhakeme. Bedeli birkaç
 * geçerli alıntının kaçırılması; karşılığında yanlış hiçbir şey basılmıyor.
 * Şerit boş kalırsa "Kaynaklardan bekleniyor" der, ki doğrusu odur.
 *
 * @returns {{verified: true}|{error: string}}
 */
function verifyQuoteInBody(quote, html) {
  const needle = foldForCompare(quote);
  if (!needle) return { error: "alıntı boş" };

  const page = String(html || "");
  if (!page.trim()) return { error: "makale gövdesi okunamadı" };

  const stripped = page
    .replace(/<(script|style|title|h1|h2|h3)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<meta[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&");

  if (!foldForCompare(stripped).includes(needle)) {
    return { error: "alıntı makale gövdesinde geçmiyor (yalnızca başlıkta)" };
  }
  return { verified: true };
}

/**
 * Tekilleştirme anahtarı: MAÇ + CÜMLE. Konuşanın adı anahtara GİRMEZ.
 *
 * Aynı açıklamayı iki yayın organı farklı yazımla veriyor ("Rıdvan Yılmaz" /
 * "R. Yılmaz"); ad anahtara girseydi aynı cümle iki kayıt olur ve şeritte
 * arka arkaya iki kez görünürdü. Aynı maçta aynı cümlenin iki farklı kişiden
 * çıkması ise pratikte olmuyor; olsa bile bir kez göstermek doğru.
 */
function quoteKey(quote) {
  return [
    text(quote && quote.matchId),
    foldName(text(quote && quote.quote))
  ].join("|");
}

/**
 * Toplanan alıntıları depoya katar.
 *
 * ELLE GİRİLMİŞ KAYDA DOKUNULMAZ. `automation` işareti taşımayan her kayıt
 * editoryaldir ve olduğu gibi korunur — otomasyonun el emeğini ezmesi, bu
 * dosyanın taşıdığı güveni tek hamlede bitirirdi.
 *
 * Aynı cümle iki kaynaktan gelebilir; anahtar (maç + kişi + cümle) üzerinden
 * tekilleştirilir. Maç başına sayı sınırlanır: tek bir maçın on alıntısı
 * şeridi kaplar ve diğer maçları görünmez kılar.
 */
function mergeHarvestedQuotes(store, incoming, options = {}) {
  const limit = Number.isFinite(options.maxPerMatch) ? options.maxPerMatch : MAX_QUOTES_PER_MATCH;
  const existing = Array.isArray(store)
    ? store
    : (Array.isArray(store && store.quotes) ? store.quotes : []);

  const kept = existing.filter(Boolean);
  const seen = new Set(kept.map(quoteKey));
  const perMatch = new Map();
  for (const quote of kept) {
    const id = text(quote.matchId);
    perMatch.set(id, (perMatch.get(id) || 0) + 1);
  }

  const added = [];
  const skipped = [];

  for (const quote of Array.isArray(incoming) ? incoming : []) {
    const key = quoteKey(quote);
    if (seen.has(key)) {
      skipped.push({ quote, reason: "zaten kayıtlı" });
      continue;
    }
    const id = text(quote.matchId);
    if ((perMatch.get(id) || 0) >= limit) {
      skipped.push({ quote, reason: `maç başına sınır doldu (${limit})` });
      continue;
    }
    seen.add(key);
    perMatch.set(id, (perMatch.get(id) || 0) + 1);
    kept.push(quote);
    added.push(quote);
  }

  // Sıra: en yeni açıklama başta. Şerit de rapor da bu sırayı bekliyor.
  //
  // ANLARA GÖRE, DİZEYE GÖRE DEĞİL. Depo iki zaman biçimini birlikte taşıyor:
  // elle girilen kayıtlar yerel saat dilimiyle ("...T00:00:00+03:00"),
  // otomatik toplananlar UTC ile ("...T21:30:00.000Z"). Dizeleri
  // karşılaştırmak bu ikisini yanlış sıralıyordu — 21:00Z olan bir kayıt,
  // 21:30Z olandan sonra geldiği hâlde başa geçiyordu. services/
  // managerQuotes.js `latestQuotes` de aynı nedenle Date.parse kullanıyor.
  kept.sort((left, right) => Date.parse(right && right.at) - Date.parse(left && left.at));

  return { quotes: kept, added, skipped };
}

module.exports = {
  MAX_QUOTES_PER_MATCH,
  MIN_QUOTE_LENGTH,
  STATEMENT_MAX_MS,
  STATEMENT_MIN_MS,
  bindMatch,
  buildSpeakerIndex,
  foldForCompare,
  harvestQuote,
  mergeHarvestedQuotes,
  parseQuoteHeadline,
  quoteKey,
  resolveSpeaker,
  verifyQuoteInBody
};
