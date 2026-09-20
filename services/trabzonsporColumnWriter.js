/**
 * MAÇ SONU KÖŞE YAZISI — METİN KATMANI (saf modül).
 *
 * `trabzonsporMatchColumn.js` ölçülmüş bir analiz modeli üretir; bu modül o
 * modelden metni kurar. Ayrım bilinçli: modelde tek bir cümle, metinde tek
 * bir sayı hesabı yok. Bir cümlenin doğruluğu tartışılıyorsa bakılacak yer
 * modeldir; üslubu tartışılıyorsa burasıdır.
 *
 * ── HER CÜMLE BİR KOŞULUN ARKASINDA ─────────────────────────────────────
 *
 * Aşağıdaki her `push` bir `if`in içinde. Veri gelmediyse cümle kurulmaz;
 * "veri paylaşılmadı" diye bir dolgu cümlesi de kurulmaz — okuyucuya bölüm
 * hiç görünmez. Yorum cümleleri de veriye bağlı: "oyunu kurma sorumluluğunu
 * üstlendi" cümlesi topla oynama eşiğinin arkasında durur, maçın havasına
 * göre değil.
 *
 * ── İNGİLİZCESİ ÇEVİRİ DEĞİL ────────────────────────────────────────────
 *
 * `renderEnglish` aynı modeli okur ama kendi cümlelerini kurar. Türkçe
 * metnin sözdizimini İngilizceye taşımak ("the night's story", "in the name
 * of the game") makine çevirisi izi bırakırdı; İngilizce sürüm kendi
 * deyimleriyle yazılıyor ve bu yüzden cümle sayısı bile birebir tutmuyor.
 */

const { competitionLabel } = require("./i18n.js");
const { passRateFrom } = require("./playerMatchHistory.js");
const {
  TR_MONTHS,
  EN_MONTHS,
  normalize,
  isNumber,
  num,
  slugify
} = require("./trabzonsporMatchColumn.js");

/* ------------------------------------------------------------------ *
 * BİÇİMLEYİCİLER
 * ------------------------------------------------------------------ */

function trDate(date) {
  if (!date) return "";
  return `${date.getDate()} ${TR_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function enDate(date) {
  if (!date) return "";
  return `${date.getDate()} ${EN_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function minuteLabel(minute) {
  return minute === null || minute === undefined ? "" : `${minute}'`;
}

/** Ondalıklı ölçümler (xG) virgülle, tam sayılar olduğu gibi yazılır. */
function trNumber(value) {
  if (!isNumber(value)) return "";
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function enNumber(value) {
  return isNumber(value) ? String(value) : "";
}


/**
 * OYUNCU PAS İSABETİ BİR ORAN DEĞİL, BİR SAYIDIR.
 *
 * Sağlayıcının oyuncu satırındaki `passAccuracy` alanı İSABETLİ PAS
 * SAYISIDIR, yüzde değil. İlk sürüm bunu doğrudan "%11 pas isabeti" diye
 * bastı ve Rafael Leão'nun 13 pasın 11'ini yerine koyduğu bir maç,
 * yazıda %11'lik bir felakete dönüştü. Takım istatistiğindeki "Pas
 * isabeti" gerçekten yüzdedir; ikisi aynı ada sahip olduğu için karışıyor.
 *
 * Oran ancak toplam pas da ölçülmüşse hesaplanır; ölçülmemişse hiçbir
 * yüzde basılmaz.
 */
function playerPassRate(row) {
  return passRateFrom(num(row && row.passAccuracy), num(row && row.passes));
}

/** `[görünen](adres)` — adres yoksa düz metin döner. */
function link(label, href) {
  return href ? `[${label}](${href})` : label;
}

function playerLink(name, links) {
  const map = (links && links.players) || {};
  const href = map[normalize(name)];
  return link(name, href);
}

/** "A, B ve C" / "A, B and C" */
function joinList(items, conjunction) {
  const rows = items.filter(Boolean);
  if (!rows.length) return "";
  if (rows.length === 1) return rows[0];
  return `${rows.slice(0, -1).join(", ")} ${conjunction} ${rows[rows.length - 1]}`;
}


/**
 * İYİ VE KÖTÜ YAPILAN NOKTALAR — ölçümden çıkarılır, izlenimden değil.
 *
 * Her madde bir eşiğin arkasında: eşik tutmazsa madde yazılmaz. Böylece
 * "savunma iyiydi" gibi kaynaksız bir hüküm metne hiç giremiyor; yazılan her
 * artı ve eksi, maçın kendi sayısına bağlı.
 */
function strengthsAndWeaknesses(model) {
  const stats = model.stats;
  const good = [];
  const bad = [];
  const ourGoals = model.goals.filter((goal) => goal.forUs).length;
  const theirGoals = model.goals.length - ourGoals;

  if (stats.possession && isNumber(stats.possession.us)) {
    if (stats.possession.us >= 55) good.push({ key: "possession", value: stats.possession.us });
    else if (stats.possession.us <= 40) bad.push({ key: "possession", value: stats.possession.us });
  }
  if (stats.shots && isNumber(stats.shots.us) && isNumber(stats.shots.them)) {
    if (stats.shots.us - stats.shots.them >= 5) good.push({ key: "volume", value: stats.shots.us, other: stats.shots.them });
    else if (stats.shots.them - stats.shots.us >= 5) bad.push({ key: "volume", value: stats.shots.us, other: stats.shots.them });
  }
  if (stats.shots && stats.shotsOn && isNumber(stats.shots.us) && isNumber(stats.shotsOn.us) && stats.shots.us >= 8) {
    const ratio = Math.round((stats.shotsOn.us / stats.shots.us) * 100);
    if (ratio >= 40) good.push({ key: "accuracy", value: ratio });
    else if (ratio <= 25) bad.push({ key: "accuracy", value: ratio });
  }
  if (stats.passAccuracy && isNumber(stats.passAccuracy.us)) {
    if (stats.passAccuracy.us >= 85) good.push({ key: "passing", value: stats.passAccuracy.us });
    else if (stats.passAccuracy.us <= 72) bad.push({ key: "passing", value: stats.passAccuracy.us });
  }
  if (stats.duels && isNumber(stats.duels.us) && isNumber(stats.duels.them)) {
    if (stats.duels.us > stats.duels.them) good.push({ key: "duels", value: stats.duels.us, other: stats.duels.them });
    else if (stats.duels.them > stats.duels.us) bad.push({ key: "duels", value: stats.duels.us, other: stats.duels.them });
  }
  if (stats.boxShots && isNumber(stats.boxShots.them)) {
    if (stats.boxShots.them <= 3) good.push({ key: "box-defence", value: stats.boxShots.them });
    else if (stats.boxShots.them >= 7) bad.push({ key: "box-defence", value: stats.boxShots.them });
  }
  if (theirGoals === 0) good.push({ key: "clean-sheet", value: 0 });
  else if (theirGoals >= 3) bad.push({ key: "conceded", value: theirGoals });
  if (stats.xg && isNumber(stats.xg.us)) {
    if (ourGoals + 0.8 < stats.xg.us) bad.push({ key: "finishing", value: stats.xg.us, other: ourGoals });
    else if (ourGoals > stats.xg.us + 0.8) good.push({ key: "finishing", value: stats.xg.us, other: ourGoals });
  }
  if (model.cards.us.red.length) bad.push({ key: "discipline", value: model.cards.us.red.length });
  if (stats.fouls && isNumber(stats.fouls.us) && stats.fouls.us >= 18) bad.push({ key: "fouls", value: stats.fouls.us });

  return { good, bad };
}


/**
 * AŞAMA ADI İNGİLİZCEYE ÇEVRİLİR — ÇEVRİLEMİYORSA HİÇ YAZILMAZ.
 *
 * `stage` alanı Türkçe geliyor ("6. hafta", "2. eleme turu, rövanş") ve
 * İngilizce metne olduğu gibi basıldığında `/en` yüzeyinde Türkçe sızıntı
 * oluyordu — `scripts/test-en-language-purity.mjs`in tam olarak aradığı
 * hata. Bilinen kalıplar çevriliyor; tanınmayan bir aşama adı ise
 * UYDURULMUYOR ve İngilizce metinde hiç geçmiyor: eksik bir ayrıntı,
 * okuyucunun anlamadığı bir dildeki ayrıntıdan iyidir.
 */
function enStage(stage) {
  const raw = String(stage || "").trim();
  if (!raw) return "";

  const week = raw.match(/^(\d+)\.\s*hafta$/i);
  if (week) return `Matchday ${week[1]}`;

  const qualifying = raw.match(/^(\d+)\.\s*eleme turu(?:,\s*(ilk maç|rövanş))?$/i);
  if (qualifying) {
    const leg = qualifying[2] && /rövanş/i.test(qualifying[2])
      ? ", second leg"
      : qualifying[2] ? ", first leg" : "";
    return `Qualifying round ${qualifying[1]}${leg}`;
  }

  const playoff = raw.match(/^play-?off turu(?:,\s*(ilk maç|rövanş))?$/i);
  if (playoff) {
    const leg = playoff[1] && /rövanş/i.test(playoff[1])
      ? ", second leg"
      : playoff[1] ? ", first leg" : "";
    return `Play-off round${leg}`;
  }

  const known = {
    "sezon öncesi hazırlık": "pre-season friendly",
    "grup aşaması": "group stage",
    "çeyrek final": "quarter-final",
    "yarı final": "semi-final",
    "final": "final"
  };
  const hit = known[raw.toLocaleLowerCase("tr")];
  if (hit) return hit;

  // Türkçe işlev sözcüğü taşıyan tanınmayan aşama adı İngilizce metne
  // girmez. Latin harfli, Türkçe sözcük içermeyen adlar (örneğin
  // "Summer Series Upper Austria") olduğu gibi kalır.
  return /\b(hafta|tur|turu|eleme|maç|rövanş|kampı|sezon|aşaması|final|hazırlık)\b/i.test(raw)
    ? ""
    : raw;
}

/**
 * Turnuva adı İngilizce yüzeyde İngilizce yazılır.
 *
 * `model.competition` Türkçe geliyor ("UEFA Şampiyonlar Ligi", "Avrupa
 * Ligi") ve İngilizce metne olduğu gibi basıldığında dil saflığı denetimi
 * haklı olarak düşüyordu. Karşılıklar sitenin kendi sözlüğünden alınıyor
 * (locales/en.json); burada ikinci bir liste tutmak, iki listenin
 * ayrışması demek olurdu.
 */
function enCompetition(name) {
  return competitionLabel(name, "en");
}

/* ------------------------------------------------------------------ *
 * TÜRKÇE
 * ------------------------------------------------------------------ */


const TR_GOOD = {
  possession: (row) => `topu %${trNumber(row.value)} oranında elinde tutup oyunun zeminini kendi belirlemesi`,
  volume: (row) => `şut üretiminde ${trNumber(row.value)}-${trNumber(row.other)} gibi net bir üstünlük kurması`,
  accuracy: (row) => `vuruşlarının %${row.value}'ini kaleye göndererek üretimi tehdide çevirmesi`,
  passing: (row) => `%${trNumber(row.value)} pas isabetiyle topu kolay kaybetmemesi`,
  duels: (row) => `ikili mücadeleleri ${trNumber(row.value)}-${trNumber(row.other)} önde bitirmesi`,
  "box-defence": (row) => `rakibe ceza sahası içinden yalnızca ${trNumber(row.value)} vuruş izni vermesi`,
  "clean-sheet": () => `kalesini gole kapatması`,
  finishing: (row) => `${trNumber(row.value)}'lik gol beklentisinden ${row.other} gol çıkarmasıyla bitiricilikte beklentiyi aşması`
};

const TR_BAD = {
  possession: (row) => `topla oynamayı %${trNumber(row.value)}'de bırakıp oyunun kurulumunu rakibe devretmesi`,
  volume: (row) => `şut üretiminde ${trNumber(row.value)}-${trNumber(row.other)} geride kalması`,
  accuracy: (row) => `vuruşlarının yalnızca %${row.value}'ini kaleye gönderebilmesi`,
  passing: (row) => `%${trNumber(row.value)}'lik pas isabetiyle topu sık kaybetmesi`,
  duels: (row) => `ikili mücadeleleri ${trNumber(row.value)}-${trNumber(row.other)} geride kapatması`,
  "box-defence": (row) => `rakibe ceza sahası içinden ${trNumber(row.value)} vuruş izni vermesi`,
  conceded: (row) => `kalesinde ${row.value} gol görmesi`,
  finishing: (row) => `${trNumber(row.value)}'lik gol beklentisine karşılık ${row.other} gol üretebilmesi`,
  discipline: () => `sayısal eksikliğe düşmesi`,
  fouls: (row) => `${trNumber(row.value)} faulle oyunu sürekli kesmek zorunda kalması`
};

function renderTurkish(model) {
  const links = model.links || {};
  const body = [];
  const score = `${model.ourScore}-${model.theirScore}`;
  const scoreLine = model.isHome
    ? `${model.ourScore}-${model.theirScore}`
    : `${model.theirScore}-${model.ourScore}`;
  const ground = model.isHome ? "kendi sahasında" : "deplasmanda";
  const opponent = model.opponent;
  const stats = model.stats;

  /* — Giriş — */
  const resultWord = model.result === "win" ? "kazandı" : model.result === "loss" ? "kaybetti" : "berabere kaldı";
  const venueText = model.venue ? `${model.venue}'da` : "";
  const openParts = [
    `Trabzonspor ${ground} ${opponent} karşısında ${score} ${resultWord}.`,
    venueText ? `${trDate(model.date)} akşamı ${venueText} oynanan ${model.competition}${model.stage ? ` ${model.stage}` : ""} maçı` : `${trDate(model.date)} tarihli ${model.competition} maçı`,
    `${link("doksan dakikanın tam dökümüyle", links.report)} bitti.`
  ];
  body.push(`${openParts[0]} ${openParts[1]} ${openParts[2]}`);

  if (model.result === "win") {
    body.push(
      `Skor tabelası net görünüyor; ama bir maçın nerede kazanıldığı çoğu zaman skorun görünmediği yerlerde yazılıdır. ` +
      `Aşağıda gecenin sayıları üzerinden ilerliyoruz: kim topu tuttu, kim pozisyonu üretti, hangi dakikada maç yön değiştirdi ve bu sonuç ` +
      `${link("Trabzonspor'un lig tablosundaki yeri", links.standings)} için ne anlama geliyor.`
    );
  } else if (model.result === "loss") {
    body.push(
      `Mağlubiyetin sebebini tek bir ana bağlamak kolaycılık olur. Gecenin sayıları, maçın hangi bölümlerinde oyunun elden çıktığını ` +
      `ve hangi bölümlerinde Trabzonspor'un gerçekten iyi işler yaptığını birlikte gösteriyor. ` +
      `${link("Puan durumundaki tablo", links.standings)} da bu sonucun ağırlığını belirliyor.`
    );
  } else {
    body.push(
      `Beraberlik, çoğu zaman en çok yoruma açık sonuçtur: bir tarafa kayıp, diğerine kazanç gibi okunabilir. ` +
      `Bu yüzden gecenin dökümüne bakmak gerekiyor — üretilen pozisyon, topla oynanan bölge ve ` +
      `${link("lig tablosundaki karşılığı", links.standings)} bu tek puanın değerini birlikte belirliyor.`
    );
  }

  // RAKİP DOSYASI VARSA GİRİŞ ORAYA KÖPRÜ KURAR.
  //
  // Yazının ikinci yarısı rakibin transfer verimini ve teknik direktör
  // tercihlerini tartışıyor; okuyucu o tartışmaya hazırlıksız girmesin
  // diye giriş maçtan kulübün daha geniş dönemine geçiyor. Cümle iddia
  // taşımıyor: bir gecenin neyi gösterdiğini değil, neyi sorduğunu söylüyor.
  if (model.opponentFocus && (model.opponentFocus.signings || []).length) {
    const focus = model.opponentFocus;
    body.push(
      `Bazı maçlar yalnızca doksan dakikayı anlatmaz; bir takımın son aylarda hangi yöne gittiğini de sorar. ` +
      `${focus.team} cephesinden bakıldığında bu gece tam olarak öyle bir gece: ` +
      `${focus.signings.length} yeni transferin sahada olduğu, ` +
      `${focus.congestion ? `son 30 günde ${focus.congestion.matches30d} resmî maç oynamış` : "yoğun bir takvimden gelen"} bir kadro, ` +
      `${focus.manager ? `${focus.manager}'un ` : ""}oyuncu kullanımı hakkında konuşmayı bir kez daha açıyor. ` +
      `Yazının ikinci yarısı bu tartışmaya ayrıldı — ve orada da kural değişmiyor: ölçülen yazılır, ölçülmeyen yazılmaz.`
    );
  }

  body.push(
    `Bu yazı bir maç özeti değil. Aşağıdaki her satır, karşılaşmanın sağlayıcı tarafından ölçülmüş verisine dayanıyor: ` +
    `olay akışı, takım istatistikleri, dizilişler ve oyuncu bazlı üretim kalemleri. ` +
    `Ölçülmeyen hiçbir şey yazılmadı; teknik direktör ya da futbolcu ağzından tek bir cümle kurulmadı. ` +
    `${model.competition}${model.stage ? ` ${model.stage}` : ""} karşılaşmasının${model.city ? ` ${model.city}'da` : ""} bıraktığı tablo, bu ölçümlerin toplamıdır.`
  );

  /* — Goller — */
  if (!model.goals.length && model.ourScore === 0 && model.theirScore === 0) {
    body.push("## Golsüz geçen gece");
    const goalless = [`Doksan dakika golsüz tamamlandı.`];
    if (stats.shots && isNumber(stats.shots.us)) {
      goalless.push(`Trabzonspor ${trNumber(stats.shots.us)} şut çekti${isNumber(stats.shots.them) ? `, rakip ${trNumber(stats.shots.them)}` : ""}; yani kalenin hiç yoklanmadığı bir maç değildi.`);
    }
    if (stats.xg && isNumber(stats.xg.us)) {
      goalless.push(`Gol beklentisi ${trNumber(stats.xg.us)}${isNumber(stats.xg.them) ? `-${trNumber(stats.xg.them)}` : ""} olarak ölçüldü; bu sayı, golsüz bir tabelanın arkasında pozisyon üretiminin ne düzeyde kaldığını gösteriyor.`);
    }
    goalless.push(`Golsüz maçlar çoğu zaman yorumun en zor olduğu maçlardır: tabela hiçbir şey söylemez, söyleyecek olan yalnızca üretim kalemleridir. Aşağıda tam olarak onlara bakıyoruz.`);
    body.push(goalless.join(" "));
  }

  if (model.goals.length) {
    body.push("## Gecenin golleri ve skor çizgisi");
    const lines = [];
    for (const goal of model.goals) {
      const who = goal.scorer ? playerLink(goal.scorer, links) : "";
      const team = goal.forUs ? "Trabzonspor" : opponent;
      const extras = [];
      if (goal.penalty) extras.push("penaltıdan");
      if (goal.ownGoal) extras.push("kendi kalesine");
      if (goal.assist) extras.push(`asist ${playerLink(goal.assist, links)}`);
      const suffix = extras.length ? ` (${extras.join(", ")})` : "";
      lines.push(
        who
          ? `${minuteLabel(goal.minute)} ${who}, ${team} adına golü kaydetti${suffix}.`
          : `${minuteLabel(goal.minute)} ${team} golü buldu${suffix}.`
      );
    }
    body.push(lines.join(" "));

    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    const assisted = model.goals.filter((goal) => goal.forUs && goal.assist).length;
    const closing = [];
    if (ourGoals >= 1) {
      closing.push(
        assisted
          ? `Trabzonspor'un ${ourGoals} golünün ${assisted} tanesi asistle geldi; yani goller bireysel bir anın değil, kurulan bir hücumun sonucuydu.`
          : `Trabzonspor'un golleri kayıtlı bir asist taşımıyor; bitiriciler pozisyonları büyük ölçüde kendileri üretti.`
      );
    }
    const minuteNumber = (goal) => Number(String(goal.minute).split("+")[0]) || 0;
    const late = model.goals.filter((goal) => minuteNumber(goal) >= 75);
    if (late.length) {
      // TABELANIN GEÇ ŞEKİLLENMESİ GOL SAYMAKLA ÖLÇÜLMEZ. Önceki sürüm son
      // çeyrekte tek gol görünce "tabela geç şekillendi" diyordu; 4-0'lık
      // maçta dört golün üçü 44. dakikada bitmişken bu, yazının kendi
      // verisiyle çelişen bir cümleydi. Ölçü artık BELİRLEYİCİ gol: kazanan
      // tarafın bir daha kaybetmediği üstünlüğü kurduğu an.
      let us = 0;
      let them = 0;
      let decisive = null;
      for (const goal of model.goals) {
        if (goal.forUs) us += 1; else them += 1;
        if (decisive === null && us !== them) decisive = { minute: minuteNumber(goal), forUs: us > them };
        else if (decisive && ((decisive.forUs && us <= them) || (!decisive.forUs && them <= us))) {
          decisive = us === them ? null : { minute: minuteNumber(goal), forUs: us > them };
        }
      }
      closing.push(
        decisive && decisive.minute >= 75
          ? `Son çeyrekte (75. dakika ve sonrası) ${late.length} gol düştü ve sonucu belirleyen an da oradaydı: maçın tabelası geç şekillendi.`
          : decisive
            ? `Son çeyrekte (75. dakika ve sonrası) ${late.length} gol düştü; ancak sonucu belirleyen üstünlük ${decisive.minute}. dakikada kurulmuştu — bu goller tabelayı değiştirmedi, büyüttü.`
            : `Son çeyrekte (75. dakika ve sonrası) ${late.length} gol düştü.`
      );
    }
    if (closing.length) body.push(closing.join(" "));
  }

  /* — Skor çizgisinin ilerleyişi — */
  if (model.goals.length >= 2) {
    let us = 0;
    let them = 0;
    const states = model.goals.map((goal) => {
      if (goal.forUs) us += 1; else them += 1;
      return `${minuteLabel(goal.minute)} ${us}-${them}`;
    });
    const leadChanges = (() => {
      let a = 0;
      let b = 0;
      let last = "level";
      let changes = 0;
      for (const goal of model.goals) {
        if (goal.forUs) a += 1; else b += 1;
        const state = a === b ? "level" : a > b ? "ahead" : "behind";
        if (state !== last) { changes += 1; last = state; }
      }
      return changes;
    })();
    body.push(
      `Tabela şu sırayla ilerledi: ${states.join(" → ")}. ` +
      (leadChanges >= 3
        ? `Üstünlük ${leadChanges} kez el değiştirdi; iki takım da maçın hiçbir bölümünde sonucu güvenceye alamadı.`
        : leadChanges === 2
          ? `Durum iki kez değişti: maçın yönü tek bir anda değil, iki ayrı kırılmada belirlendi.`
          : `Skor çizgisi hiç el değiştirmedi: öne geçen taraf önde kalmayı sürdürdü ve maç tek yönde ilerledi.`)
    );
  }

  /* — Kırılma anı — */
  const turn = model.turningPoint;
  if (turn) {
    body.push("## Maçın kırılma anı");
    if (turn.kind === "red") {
      const who = turn.player ? playerLink(turn.player, links) : "bir oyuncu";
      body.push(
        turn.forUs
          ? `${minuteLabel(turn.minute)} ${who} kırmızı kart gördü ve Trabzonspor maçın kalan bölümünü on kişi oynadı. ` +
            `Sayısal eksiklik yalnızca bir oyuncu kaybı değildir; blok geriye çekilir, ikili mücadele yükü artar ve hücumda çıkış mesafesi uzar. ` +
            `Gecenin okuması bu dakikadan öncesi ve sonrası diye ikiye ayrılmak zorunda.`
          : `${minuteLabel(turn.minute)} ${opponent}, ${who} kırmızı kart görünce bir oyuncusunu kaybetti ve maçın dengesi o dakikada değişti. ` +
            `Sayısal üstünlük tek başına sonuç getirmez; getirip getirmediğini aşağıdaki hücum sayıları gösteriyor.`
      );
    } else {
      const who = turn.scorer ? playerLink(turn.scorer, links) : "";
      const stateText = turn.after === "ahead" ? "öne geçti" : turn.after === "behind" ? "geriye düştü" : "skoru eşitledi";
      body.push(
        `${minuteLabel(turn.minute)} düşen golle Trabzonspor ${stateText}${who ? ` — golün sahibi ${who}` : ""}. ` +
        `Bu, maçın durumunu değiştiren ilk andı: o dakikaya kadar iki takımın da oyunu aynı riski taşıyordu, o dakikadan sonra ` +
        `birinin kovalaması, diğerinin koruması gereken bir skor oluştu. Maçın geri kalanındaki bütün tercihler bu dakikanın gölgesinde alındı.`
      );
    }
  }

  if (turn && turn.minute !== null && turn.minute !== undefined) {
    const pivot = Number(String(turn.minute).split("+")[0]);
    if (Number.isFinite(pivot)) {
      const after = model.goals.filter((goal) => Number(String(goal.minute).split("+")[0]) > pivot);
      const afterUs = after.filter((goal) => goal.forUs).length;
      const afterThem = after.length - afterUs;
      body.push(
        after.length
          ? `O dakikadan sonra tabelaya ${afterUs}-${afterThem} daha yazıldı. ` +
            (afterUs > afterThem
              ? `Yani Trabzonspor kırılmayı lehine çevirmekle kalmadı, açılan alanı gol üretmeye de dönüştürdü.`
              : afterUs < afterThem
                ? `Yani kırılmanın ardından oyunun kontrolü karşı tarafa geçti ve bedeli doğrudan skorda görüldü.`
                : `Yani iki takım da kırılmanın ardından karşılık üretti ve maç açık bir zeminde tamamlandı.`)
          : `O dakikadan sonra tabela hiç değişmedi: maçın kalan bölümü, oluşan skoru korumak ve kırmak üzerine kurulu bir mücadeleye dönüştü ve taraflardan hiçbiri bu dengeyi bozabilecek net bir üstünlük kuramadı.`
      );
    }
  }

  /* — Taktik tablo — */
  const tactical = [];
  if (model.lineups.us && model.lineups.us.formation) {
    tactical.push(
      `Trabzonspor sahaya ${model.lineups.us.formation} dizilişiyle çıktı` +
      `${model.lineups.them && model.lineups.them.formation ? `, ${opponent} ise ${model.lineups.them.formation} tercih etti` : ""}.`
    );
  }
  if (stats.possession && isNumber(stats.possession.us)) {
    const us = stats.possession.us;
    const gap = isNumber(stats.possession.them) ? us - stats.possession.them : null;
    tactical.push(`Topla oynama oranı Trabzonspor'da %${trNumber(us)}${isNumber(stats.possession.them) ? `, ${opponent}'da %${trNumber(stats.possession.them)}` : ""}.`);
    if (isNumber(gap) && gap >= 15) {
      tactical.push(`Oyunu kurma sorumluluğu belirgin biçimde Trabzonspor'daydı; rakip derin blokta bekleyip geçiş oyununa yaslandı.`);
    } else if (isNumber(gap) && gap <= -15) {
      tactical.push(`Topun ağırlığı rakipteydi; Trabzonspor oyunu kurmak yerine bloğunu koruyup geçişlerde çıkmayı seçti.`);
    } else if (isNumber(gap)) {
      tactical.push(`Topa sahip olmada ciddi bir ayrışma yok; iki takım da oyunu kurma hakkını paylaştı ve maç orta alanda kesilen toplarla şekillendi.`);
    }
  }
  if (stats.passes && isNumber(stats.passes.us) && stats.passAccuracy && isNumber(stats.passAccuracy.us)) {
    tactical.push(
      `Trabzonspor ${trNumber(stats.passes.us)} pas denedi ve %${trNumber(stats.passAccuracy.us)} isabet yakaladı` +
      `${isNumber(stats.passAccuracy.them) ? `; rakibin isabet oranı %${trNumber(stats.passAccuracy.them)}` : ""}.`
    );
    if (stats.passAccuracy.us >= 85) {
      tactical.push(`Bu isabet oranı, topun kolay kaybedilmediği ve oyunun kontrollü bir tempoda tutulduğu anlamına geliyor.`);
    } else if (stats.passAccuracy.us <= 75) {
      tactical.push(`Görece düşük isabet, oyunun sık kesildiğini ve çok sayıda ikinci top mücadelesine girildiğini gösteriyor.`);
    }
  }
  if (tactical.length) {
    body.push("## Taktik tablo: oyun nerede kuruldu");
    body.push(tactical.join(" "));
  }

  /* — Orta saha ve savunma dengesi — */
  const balance = [];
  if (stats.duels && isNumber(stats.duels.us) && isNumber(stats.duels.them)) {
    const leading = stats.duels.us >= stats.duels.them;
    balance.push(
      `İkili mücadelelerde tablo ${trNumber(stats.duels.us)}-${trNumber(stats.duels.them)} ${leading ? "Trabzonspor'un lehine" : `${opponent} lehine`}. ` +
      `${leading ? "Orta alanda ikinci toplar büyük ölçüde toplandı ve rakibin kurulum hattı erken basıldı." : "Orta alanda üstünlük kurulamadı; ikinci toplar rakipte kaldıkça savunma hattı geri itildi."}`
    );
  }
  if (stats.fouls && isNumber(stats.fouls.us)) {
    balance.push(`Faul sayısı Trabzonspor'da ${trNumber(stats.fouls.us)}${isNumber(stats.fouls.them) ? `, rakipte ${trNumber(stats.fouls.them)}` : ""}.`);
  }
  if (model.cards.us.yellow || model.cards.them.yellow) {
    balance.push(`Sarı kart dağılımı ${model.cards.us.yellow}-${model.cards.them.yellow}; oyunun sertlik düzeyi hakem kararlarına bu şekilde yansıdı.`);
  }
  if (stats.saves && isNumber(stats.saves.us)) {
    balance.push(
      `Trabzonspor kalecisi ${trNumber(stats.saves.us)} kurtarış yaptı.` +
      (stats.saves.us >= 4
        ? ` Bu sayı, kalenin gerçekten sınandığını ve savunma hattının rakibe net vuruş izni verdiğini söylüyor.`
        : ` Kale az sınandı; savunma bloğu rakibi büyük ölçüde net vuruş mesafesinin dışında tuttu.`)
    );
  }
  if (stats.saves && isNumber(stats.saves.us) && stats.shotsOn && isNumber(stats.shotsOn.them)) {
    const faced = stats.shotsOn.them;
    const saved = stats.saves.us;
    if (faced > 0) {
      const rate = Math.round((saved / faced) * 100);
      balance.push(
        `Kaleyi bulan ${trNumber(faced)} şutun ${trNumber(saved)} tanesi kurtarıldı; kurtarış oranı %${rate}.` +
        (rate >= 80
          ? ` Kalede geçirilen gece, skorun görünenden daha yakın olmasını engelleyen unsurdu.`
          : rate >= 50
            ? ` Kaleci payına düşeni yaptı; geçen goller kurtarış hatasından çok pozisyonun kalitesinden geldi.`
            : ` Kaleyi bulan şutların çoğu ağlarla buluştu: bu oran, hem bitiricilik kalitesini hem savunmanın verdiği pozisyonların netliğini birlikte anlatıyor.`)
      );
    }
  }
  if (balance.length) {
    body.push("## Orta saha ve savunma dengesi");
    body.push(balance.join(" "));
  }

  /* — Pres ve rakip kurulumu — */
  //
  // DOĞRUDAN PRES VERİSİ YOK. Sağlayıcı "yüksek geri kazanım" ya da
  // "pres başarısı" göndermiyor; bu yüzden pres hakkında ölçüm varmış gibi
  // yazılmıyor. Yazılan şey, presin İZLERİ sayılabilecek ölçülmüş
  // göstergeler ve okuyucuya bunların gösterge olduğu açıkça söyleniyor.
  const press = [];
  if (stats.passAccuracy && isNumber(stats.passAccuracy.them)) {
    press.push(
      `Rakibin pas isabeti %${trNumber(stats.passAccuracy.them)}` +
      (stats.passAccuracy.them <= 78
        ? `: kurulum oyunu rahat işlemedi, top sık sık ayaktan çıktı.`
        : `: ${opponent} topu ayakta tutmakta zorlanmadı ve kurulum hattı büyük ölçüde rahat oynadı.`)
    );
  }
  if (stats.fouls && isNumber(stats.fouls.us)) {
    press.push(
      stats.fouls.us >= 15
        ? `Trabzonspor'un ${trNumber(stats.fouls.us)} faulü, topu geri kazanma çabasının sık sık kural dışına taştığını gösteriyor.`
        : `Trabzonspor ${trNumber(stats.fouls.us)} faulle kaldı; geri kazanım çabası oyunu bölen bir sertliğe dönüşmedi.`
    );
  }
  if (stats.offsides && isNumber(stats.offsides.them)) {
    press.push(`Rakibin ${trNumber(stats.offsides.them)} ofsaytı, savunma hattının ne sıklıkta yukarı çıktığına dair tek ölçülmüş işaret.`);
  }
  if (press.length >= 2) {
    body.push("## Pres ve rakibin kurulum oyunu");
    body.push(
      `Sağlayıcı bu maç için doğrudan bir pres ölçümü paylaşmıyor; aşağıdakiler presin izini taşıyan ölçülmüş göstergeler, presin kendisi değil. ` +
      press.join(" ")
    );
  }

  /* — Ceza sahası etkinliği — */
  const box = [];
  const outside = stats.outsideShots;
  if (stats.boxShots && isNumber(stats.boxShots.us) && outside && isNumber(outside.us)) {
    const total = stats.boxShots.us + outside.us;
    if (total > 0) {
      const share = Math.round((stats.boxShots.us / total) * 100);
      box.push(
        `Trabzonspor'un vuruşları ceza sahası içi–dışı olarak ${trNumber(stats.boxShots.us)}–${trNumber(outside.us)} dağıldı (içeriden %${share}).` +
        (share >= 60
          ? ` Hücum, şansını uzaktan aramak yerine son otuz metreye girerek kurdu.`
          : ` Vuruşların yarısından çoğu ceza sahası dışından geldi; bu, savunmanın içeriye giriş yollarını kapattığı anlamına geliyor.`)
      );
    }
  }
  if (stats.boxShots && isNumber(stats.boxShots.them) && outside && isNumber(outside.them)) {
    const total = stats.boxShots.them + outside.them;
    if (total > 0) {
      const share = Math.round((stats.boxShots.them / total) * 100);
      box.push(`Rakip tarafta aynı dağılım ${trNumber(stats.boxShots.them)}–${trNumber(outside.them)} (içeriden %${share}).`);
    }
  }
  const blocked = stats.blockedShots;
  if (blocked && isNumber(blocked.them) && blocked.them > 0) {
    box.push(`Trabzonspor savunması ${trNumber(blocked.them)} şutu bloklayarak kaleciye ulaşmadan kesti; bu sayı, ceza sahasındaki gövde savunmasının ölçülmüş karşılığı.`);
  }
  if (box.length >= 2) {
    body.push("## Ceza sahası etkinliği");
    body.push(box.join(" "));
  }

  /* — Hücum organizasyonu — */
  const attack = [];
  if (stats.shots && isNumber(stats.shots.us)) {
    attack.push(
      `Trabzonspor ${trNumber(stats.shots.us)} şut çekti${stats.shotsOn && isNumber(stats.shotsOn.us) ? `, bunların ${trNumber(stats.shotsOn.us)} tanesi isabetliydi` : ""}` +
      `${isNumber(stats.shots.them) ? `; rakibin toplam şutu ${trNumber(stats.shots.them)}` : ""}.`
    );
    if (stats.shotsOn && isNumber(stats.shotsOn.us) && stats.shots.us >= 8) {
      const ratio = Math.round((stats.shotsOn.us / stats.shots.us) * 100);
      attack.push(
        ratio >= 40
          ? `İsabet oranı %${ratio}: üretilen pozisyonların çoğu kaleyi bulan bir vuruşla sonuçlandı.`
          : `İsabet oranı %${ratio}: hacim vardı ama vuruşların önemli bölümü kaleyi bulmadı — bitiricilik, üretimin gerisinde kaldı.`
      );
    }
  }
  if (stats.boxShots && isNumber(stats.boxShots.us)) {
    attack.push(
      `Ceza sahası içinden ${trNumber(stats.boxShots.us)} vuruş çıktı; ` +
      (stats.boxShots.us >= 6
        ? `hücum, uzaktan denemeye değil son otuz metreye girmeye dayandı.`
        : `hücumun ceza sahasına girmekte zorlandığı, vuruşların büyük bölümünün dışarıdan geldiği görülüyor.`)
    );
  }
  if (stats.corners && isNumber(stats.corners.us)) {
    attack.push(`Korner sayısı ${trNumber(stats.corners.us)}${isNumber(stats.corners.them) ? `-${trNumber(stats.corners.them)}` : ""}; duran toplar hücum yükünün bir bölümünü taşıdı.`);
  }
  if (stats.crosses && isNumber(stats.crosses.us) && stats.crosses.us >= 15) {
    attack.push(`${trNumber(stats.crosses.us)} orta denendi: kanatlardan beslenen, ceza sahasına yükseklik taşıyan bir kırma tercihi öne çıktı.`);
  }
  if (stats.xg && isNumber(stats.xg.us)) {
    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    attack.push(`Gol beklentisi (xG) Trabzonspor'da ${trNumber(stats.xg.us)}${isNumber(stats.xg.them) ? `, rakipte ${trNumber(stats.xg.them)}` : ""}.`);
    if (ourGoals > stats.xg.us + 0.7) {
      attack.push(`Atılan gol sayısı beklentinin belirgin biçimde üzerinde; gecenin bitiriciliği, üretilen pozisyon kalitesinden daha verimli işledi.`);
    } else if (ourGoals + 0.7 < stats.xg.us) {
      attack.push(`Üretilen pozisyon kalitesi skora yansımadı; bu fark, sorunun pozisyon üretmekte değil bitirmekte olduğunu gösteriyor.`);
    }
  }
  if (stats.shots && isNumber(stats.shots.us) && stats.shots.us > 0) {
    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    const perGoal = ourGoals ? Math.round((stats.shots.us / ourGoals) * 10) / 10 : null;
    if (perGoal !== null) {
      attack.push(
        `Gol başına ${trNumber(perGoal)} şut düştü.` +
        (perGoal <= 6
          ? ` Bu verimlilik, pozisyonların yalnızca sayıca değil kalite olarak da iyi üretildiğini gösteriyor.`
          : ` Bu oran yüksek: tabelaya yansıyan her gol için harcanan deneme sayısı, bitiriciliğin üretimin gerisinde kaldığını söylüyor.`)
      );
    }
    if (stats.boxShots && isNumber(stats.boxShots.us)) {
      const share = Math.round((stats.boxShots.us / stats.shots.us) * 100);
      attack.push(
        `Vuruşların %${share}'i ceza sahası içinden geldi;` +
        (share >= 55
          ? ` yani hücum, şansını uzaktan denemek yerine gerçekten içeri girerek aradı.`
          : ` yani deneme hacminin önemli bir bölümü ceza sahası dışından, düşük isabet ihtimalli bölgelerden geldi.`)
      );
    }
  }
  if (attack.length) {
    body.push("## Hücum organizasyonu ve bitiricilik");
    body.push(attack.join(" "));
  }

  /* — Teknik direktörün tercihleri — */
  const coaching = [];
  if (model.lineups.us && model.lineups.us.coach) {
    coaching.push(`Trabzonspor'u ${model.lineups.us.coach} yönetti.`);
  }
  if (model.lineups.us && model.lineups.us.players.length >= 11) {
    coaching.push(`İlk 11: ${model.lineups.us.players.slice(0, 11).join(", ")}.`);
  }
  const ourSubs = model.subs.us;
  if (ourSubs.length) {
    const rows = ourSubs
      .filter((row) => row.in)
      .map((row) => `${minuteLabel(row.minute)} ${playerLink(row.in, links)}${row.out ? ` (${playerLink(row.out, links)} yerine)` : ""}`);
    if (rows.length) coaching.push(`Oyuncu değişiklikleri: ${rows.join("; ")}.`);
    const firstMinute = Number(String(ourSubs[0].minute).split("+")[0]);
    if (Number.isFinite(firstMinute)) {
      coaching.push(
        firstMinute <= 46
          ? `İlk müdahale ${firstMinute}. dakikada geldi: teknik heyet oyunun gidişatını devreye kadar beklemeden değiştirmeyi seçti.`
          : firstMinute >= 70
            ? `İlk değişiklik ancak ${firstMinute}. dakikada yapıldı; kadroya uzun süre dokunulmadı ve oyunun temposu geç değiştirildi.`
            : `İlk değişiklik ${firstMinute}. dakikada yapıldı; müdahale, ikinci yarının seyri belirginleştikten sonra geldi.`
      );
    }
  }
  if (model.subs.us.length) {
    const inNames = new Set(model.subs.us.map((row) => normalize(row.in)).filter(Boolean));
    const scoringSubs = model.goals.filter((goal) => goal.forUs && goal.scorer && inNames.has(normalize(goal.scorer)));
    const assistingSubs = model.goals.filter((goal) => goal.forUs && goal.assist && inNames.has(normalize(goal.assist)));
    coaching.push(
      scoringSubs.length || assistingSubs.length
        // SIFIRI SAYMA. Önceki sürüm her iki kalemi de yazıyordu ve "0 gol ve
        // 1 asist" gibi bir cümle kuruyor, ardından da değişiklikleri "skora
        // dokunan müdahaleler" diye niteliyordu — biri boşken abartılı.
        ? `Yedekten girenlerin katkısı ölçülebilir düzeyde: ${[
            scoringSubs.length ? `${scoringSubs.length} gol` : "",
            assistingSubs.length ? `${assistingSubs.length} asist` : ""
          ].filter(Boolean).join(" ve ")} doğrudan sonradan oyuna dahil olan isimlerden geldi.${scoringSubs.length ? " Değişiklikler, kadro tazelemenin ötesinde skora dokunan müdahalelerdi." : ""}`
        : `Sonradan oyuna giren isimler gol ya da asist kalemine yansımadı; değişikliklerin etkisi tabelada değil, oyunun dengesinde aranmalı.`
    );
  }
  if (model.lineups.them && (model.lineups.them.formation || model.lineups.them.coach)) {
    coaching.push(
      `Karşı tarafta ${model.lineups.them.coach ? `${model.lineups.them.coach} yönetimindeki ` : ""}${opponent}` +
      `${model.lineups.them.formation ? `, ${model.lineups.them.formation} dizilişiyle` : ""} sahaya çıktı ve ` +
      `${model.subs.them.length} değişiklik yaptı.`
    );
  }
  if (coaching.length) {
    body.push("## Teknik direktörün tercihleri");
    body.push(coaching.join(" "));
  }

  /* — Öne çıkanlar — */
  if (model.standouts.hasRatings && model.standouts.top.length) {
    body.push("## Öne çıkan futbolcular");
    const rows = model.standouts.top.map((row) => {
      const bits = [];
      if (num(row.goals) > 0) bits.push(`${num(row.goals)} gol`);
      if (num(row.assists) > 0) bits.push(`${num(row.assists)} asist`);
      if (num(row.saves) > 0) bits.push(`${num(row.saves)} kurtarış`);
      if (num(row.shotsOnTarget) > 0) bits.push(`${num(row.shotsOnTarget)} isabetli şut`);
      if (num(row.duelsWon) > 0) bits.push(`${num(row.duelsWon)} kazanılan mücadele`);
      if (playerPassRate(row) !== null) bits.push(`%${playerPassRate(row)} pas isabeti`);
      return `${playerLink(row.name, links)} (${trNumber(num(row.providerRating))}${bits.length ? ` — ${bits.slice(0, 3).join(", ")}` : ""})`;
    });
    body.push(
      `Sağlayıcı reytinglerine göre gecenin en yüksek notlu Trabzonsporluları: ${joinList(rows, "ve")}. ` +
      `Reyting tek başına bir hüküm değildir; ama yukarıdaki üretim kalemleriyle birlikte okunduğunda bu üç ismin maçın yükünü taşıdığı görülüyor.`
    );
  }
  if (model.standouts.hasRatings && model.standouts.under.length) {
    body.push("## Beklentinin altında kalanlar");
    const rows = model.standouts.under.map((row) => `${playerLink(row.name, links)} (${trNumber(num(row.providerRating))}, ${num(row.minutes)} dakika)`);
    body.push(
      `Aynı ölçekte geceyi en düşük notla kapatan isimler: ${joinList(rows, "ve")}. ` +
      `Bu satır bir suçlama değil, bir tespit: yeterince süre alan ama üretim kalemlerine yansımayan performanslar, bir sonraki maçın ` +
      `kadro tercihlerinde teknik heyetin önüne gelecek ilk başlık olacak.`
    );
  }

  /* — Yarı yarıya okuma — */
  if (model.goals.length) {
    const half = (goal) => (Number(String(goal.minute).split("+")[0]) <= 45 ? 1 : 2);
    const firstUs = model.goals.filter((goal) => goal.forUs && half(goal) === 1).length;
    const firstThem = model.goals.filter((goal) => !goal.forUs && half(goal) === 1).length;
    const secondUs = model.goals.filter((goal) => goal.forUs && half(goal) === 2).length;
    const secondThem = model.goals.filter((goal) => !goal.forUs && half(goal) === 2).length;
    body.push("## İlk yarı, ikinci yarı: gece ikiye bölündü mü");
    const halves = [`Goller yarılara ${firstUs}-${firstThem} ve ${secondUs}-${secondThem} biçiminde dağıldı.`];
    if (firstUs + firstThem === 0) {
      halves.push(`İlk kırk beş dakika golsüz geçti; maç, iki takımın da riski açmaktan kaçındığı bir yoklama bölümüyle başladı ve asıl oyun soyunma odası sonrasında kuruldu.`);
    } else if (secondUs + secondThem === 0) {
      halves.push(`İkinci yarıda tabela hiç değişmedi; maçın karakteri ilk kırk beş dakikada belirlendi ve sonrasında yalnızca korunmaya çalışıldı.`);
    } else if (secondUs > firstUs) {
      halves.push(`Trabzonspor ikinci yarıda daha üretken oldu; devre arasındaki müdahale ya da rakibin düşen temposu, gollerin ağırlığını oyunun ikinci bölümüne taşıdı.`);
    } else if (firstUs > secondUs) {
      halves.push(`Trabzonspor'un golleri ağırlıklı olarak ilk yarıda geldi; ikinci yarı, kurulan üstünlüğü yönetme bölümüne dönüştü.`);
    } else {
      halves.push(`Gol üretimi iki yarıya dengeli yayıldı; oyunun temposu doksan dakika boyunca benzer bir seviyede kaldı.`);
    }
    const minutes = model.goals.map((goal) => Number(String(goal.minute).split("+")[0])).filter(Number.isFinite);
    if (minutes.length >= 2) {
      const first = Math.min(...minutes);
      const last = Math.max(...minutes);
      halves.push(`İlk gol ${first}. dakikada, son gol ${last}. dakikada düştü; yani tabela ${last - first} dakikalık bir aralığa yayıldı.`);
    }
    body.push(halves.join(" "));
  }

  /* — Rakibin ürettikleri — */
  const defended = [];
  if (stats.shots && isNumber(stats.shots.them)) {
    defended.push(
      `${opponent} ${trNumber(stats.shots.them)} şutla karşılık verdi${stats.shotsOn && isNumber(stats.shotsOn.them) ? ` ve bunların ${trNumber(stats.shotsOn.them)} tanesi kaleyi buldu` : ""}.`
    );
  }
  if (stats.boxShots && isNumber(stats.boxShots.them)) {
    defended.push(
      stats.boxShots.them >= 6
        ? `Rakip ceza sahası içinden ${trNumber(stats.boxShots.them)} vuruş çıkardı; bu, savunmanın son otuz metrede sık sık geçildiği anlamına geliyor.`
        : `Rakibin ceza sahası içinden vuruş sayısı ${trNumber(stats.boxShots.them)}; savunma bloğu tehlikeli bölgeye girişi büyük ölçüde sınırladı.`
    );
  }
  if (stats.xg && isNumber(stats.xg.them)) {
    const theirGoals = model.goals.filter((goal) => !goal.forUs).length;
    defended.push(`Rakibin gol beklentisi ${trNumber(stats.xg.them)}, attığı gol ${theirGoals}.`);
    if (theirGoals > stats.xg.them + 0.7) {
      defended.push(`Yani ${opponent} elindeki pozisyon kalitesinin üzerinde bir verim aldı; savunma, verdiği az sayıda şansın bedelini ağır ödedi.`);
    } else if (theirGoals + 0.7 < stats.xg.them) {
      defended.push(`Rakip ürettiği pozisyon kalitesinin gerisinde kaldı; bu farkın bir bölümü savunmanın baskısı, bir bölümü de kalecinin müdahaleleriyle açıklanıyor.`);
    }
  }
  if (stats.offsides && isNumber(stats.offsides.them) && stats.offsides.them >= 3) {
    defended.push(`Rakip ${trNumber(stats.offsides.them)} kez ofsayta düştü; savunma hattının birlikte çıkma disiplini bu sayıda görünüyor.`);
  }
  if (defended.length >= 2) {
    body.push("## Rakip ne üretti, savunma neyi verdi");
    body.push(defended.join(" "));
  }

  /* — Bireysel üretim — */
  const production = [];
  const ours = model.players.us.filter((row) => num(row.minutes) > 0);
  const leaderOf = (field) => {
    const rows = ours.filter((row) => num(row[field]) > 0)
      .sort((left, right) => num(right[field]) - num(left[field]));
    return rows[0] || null;
  };
  const shooter = leaderOf("shotsOnTarget");
  if (shooter) production.push(`Kaleyi en çok bulan isim ${playerLink(shooter.name, links)}: ${num(shooter.shotsOnTarget)} isabetli şut.`);
  const dueller = leaderOf("duelsWon");
  if (dueller) production.push(`İkili mücadelede öne çıkan ${playerLink(dueller.name, links)} oldu (${num(dueller.duelsWon)} kazanılan mücadele).`);
  const passer = ours.filter((row) => num(row.passes) >= 30)
    .sort((left, right) => num(right.passes) - num(left.passes))[0];
  const keeper = ours.filter((row) => num(row.saves) > 0)
    .sort((left, right) => num(right.saves) - num(left.saves))[0];
  // EN ÇOK PAS ATAN KALECİYSE BU BİR ÖVGÜ DEĞİL, BULGUDUR. "Oyunun dağıtım
  // merkezi" cümlesi orta saha için kurulmuştu; kaleci o listenin başına
  // çıktığında aynı cümle topun neden geriden çevrildiğini övgüye dönüştürüyor.
  const passerIsKeeper = passer && keeper && normalize(passer.name) === normalize(keeper.name);
  if (passer) {
    const rate = playerPassRate(passer) !== null ? `, %${playerPassRate(passer)} isabet` : "";
    production.push(passerIsKeeper
      ? `Takımın en çok pas atan ismi kaleci ${playerLink(passer.name, links)} oldu: ${num(passer.passes)} pas${rate}. Topun en çok geriden çevrildiği bir gecede bu, oyun kurmanın nerede düğümlendiğini de söyler.`
      : `Oyunun dağıtım merkezi ${playerLink(passer.name, links)}: ${num(passer.passes)} pas${rate}.`);
  }
  if (keeper) production.push(`Kalede ${playerLink(keeper.name, links)} ${num(keeper.saves)} kurtarışla kaydını tamamladı.`);
  if (production.length >= 3) {
    body.push("## Sayılarla bireysel üretim");
    body.push(
      production.join(" ") +
      ` Bu dört kalem tek başına bir hüküm vermez; ama bir maçın yükünün sahada nasıl dağıldığını en sade biçimde bunlar gösterir.`
    );
  }

  /* — İyi ve kötü yapılan noktalar — */
  const verdictRows = strengthsAndWeaknesses(model);
  if (verdictRows.good.length || verdictRows.bad.length) {
    body.push("## Trabzonspor neyi iyi yaptı, nerede takıldı");
    const goodText = verdictRows.good.map((row) => (TR_GOOD[row.key] ? TR_GOOD[row.key](row) : "")).filter(Boolean);
    const badText = verdictRows.bad.map((row) => (TR_BAD[row.key] ? TR_BAD[row.key](row) : "")).filter(Boolean);
    const lines = [];
    if (goodText.length) {
      lines.push(
        `Gecenin artı hanesinde şunlar var: ${joinList(goodText, "ve")}. ` +
        `Bunlar izlenim değil ölçüm; maçın kendi sayılarından çıkıyor ve bir sonraki maça taşınabilecek işleyişin hangi parçasının çalıştığını gösteriyor.`
      );
    }
    if (badText.length) {
      lines.push(
        `Eksi hanesi ise şöyle: ${joinList(badText, "ve")}. ` +
        `Bu başlıklar bir gecelik talihsizlik olarak da okunabilir, tekrar eden bir zaaf olarak da; ikisini ayıran tek şey, aynı kalemlerin önümüzdeki haftalarda ne söyleyeceği.`
      );
    }
    if (!badText.length && goodText.length) {
      lines.push(`Ölçülen kalemlerin hiçbirinde eşik aşan bir olumsuzluk çıkmadı; bu, tabloyu tek bir zayıf başlığa indirgemenin mümkün olmadığı, bütünlüklü bir performans anlamına geliyor.`);
    }
    if (!goodText.length && badText.length) {
      lines.push(`Ölçülen kalemlerde eşik aşan bir olumluluk çıkmaması da ayrı bir veri: sorun tek bir bölgede değil, oyunun geneline yayılmış durumda.`);
    }
    body.push(lines.join(" "));
  }

  /* — Rakip dosyası — */
  if (model.opponentFocus) {
    body.push(...opponentSectionTr(model.opponentFocus, links));
  }

  /* — Lig açısından anlamı — */
  if (model.standing) {
    body.push("## Sonucun lig açısından anlamı");
    const standing = model.standing;
    const parts = [
      `Bu sonuçla Trabzonspor ${link("Süper Lig puan durumunda", links.standings)} ${standing.rank}. sırada ve ${standing.played} maçta ${standing.points} puanda.`
    ];
    if (isNumber(num(standing.goalsFor)) && isNumber(num(standing.goalsAgainst))) {
      parts.push(`Averaj tablosu ${standing.goalsFor}-${standing.goalsAgainst} (${standing.goalDifference >= 0 ? "+" : ""}${standing.goalDifference}).`);
    }
    if (isNumber(num(standing.won))) {
      parts.push(`Sezon dökümü ${standing.won} galibiyet, ${standing.drawn} beraberlik, ${standing.lost} mağlubiyet.`);
    }
    parts.push(
      model.result === "win"
        ? `Üç puan, tabloda yalnızca bir satır yukarı çıkmak değil; kovalayan tarafla aradaki mesafeyi koruma meselesidir ve sezonun bu evresinde asıl değeri buradadır.`
        : model.result === "loss"
          ? `Kaybedilen puanların sezon sonunda nerede eksileceği bugünden bilinmez; ama şu kesin: bu tabloda kayıp puan, sonraki haftalarda iki kat çalışmayla geri alınır.`
          : `Tek puan, tabloyu bozmaz ama düzeltmez de. Sezonun bu evresinde beraberliklerin toplamı, şampiyonluk yarışında galibiyetlerin toplamı kadar belirleyici olur.`
    );
    body.push(parts.join(" "));
  }

  if (model.standing && Array.isArray(model.standing.form) && model.standing.form.length) {
    const form = model.standing.form.slice(-5);
    const wins = form.filter((row) => String(row).toUpperCase() === "W").length;
    const losses = form.filter((row) => String(row).toUpperCase() === "L").length;
    body.push(
      `Son ${form.length} maçlık form çizgisi ${form.join("-")} biçiminde okunuyor: ${wins} galibiyet, ${losses} mağlubiyet. ` +
      (wins >= 3
        ? `Bu seri, tek bir maçın sonucundan daha fazlasını anlatıyor; takımın belirli bir işleyişi tekrar edebildiğini gösteriyor.`
        : losses >= 3
          ? `Bu seri, sorunun tek maçlık bir sapma olmadığını ve tekrar eden bir desene dönüştüğünü gösteriyor.`
          : `Dalgalı bir seri: takımın henüz istikrarlı bir kimliğe oturmadığını, sonuçların maçtan maça değiştiğini söylüyor.`)
    );
  }

  /* — Sıradaki maç — */
  if (model.nextMatch) {
    body.push("## Bir sonraki maç için çıkarılacak sonuç");
    const next = model.nextMatch;
    const when = next.date ? trDate(next.date) : "";
    body.push(
      `Sıradaki randevu ${next.isHome ? "kendi sahasında" : "deplasmanda"} ${next.opponent}${when ? ` (${when})` : ""}${next.competition ? `, ${next.competition}` : ""}. ` +
      `${link("Trabzonspor'un maç takvimi ve son haberleri", links.team)} bu karşılaşmanın hazırlık sürecini takip etmek için doğru yer. ` +
      `Bu gecenin bıraktığı asıl soru şu: yukarıdaki sayılarda görünen eğilim — ister üretim fazlası ister bitiricilik açığı olsun — bir maçlık bir sapma mı, ` +
      `yoksa sezonun tekrar eden bir deseni mi? Cevabı, aynı kalemlerin bir sonraki maçta nasıl okunduğu verecek.`
    );
  }

  /* — Kapanış — */
  body.push(
    `Bir maçı okumanın en dürüst yolu, tabelayı sayıların önüne koymamaktır. ` +
    `${model.venue ? `${model.venue}'da` : model.isHome ? "Trabzon'da" : "deplasmanda"} olan biten, yukarıdaki kalemlerin toplamıdır: ` +
    `üretilen pozisyon, kazanılan mücadele, verilen alan ve alınan karar. ` +
    `${model.result === "win" ? "Kazanılan maçta bile düzeltilecek bir kalem vardır; onu galibiyetin gürültüsünde kaybetmemek, sezonun geri kalanını belirler." : model.result === "loss" ? "Kaybedilen maçta bile çalışan bir kalem vardır; onu mağlubiyetin gürültüsünde kaybetmemek, sezonun geri kalanını belirler." : "Beraberlikte iki hane de doludur; hangisinin ağır bastığına tek bir maç değil, tekrar eden desen karar verir."} ` +
    `FutbolRadar bu kalemleri her maç sonunda aynı ölçekle takip etmeye devam edecek.`
  );

  return body;
}


/* ------------------------------------------------------------------ *
 * RAKİP DOSYASI — TRANSFER VERİMİ VE TEKNİK DİREKTÖR TARTIŞMASI
 *
 * Bu bölüm yazının en iddialı yeri, bu yüzden kanıt eşiği de en yüksek
 * olan yer. Tek bir kural: DÜŞÜŞ ANCAK ÖLÇÜLDÜYSE YAZILIR. Ölçülemediyse
 * ölçülemediği yazılır — "bazı oyuncularda göze çarpan düşüş" gibi
 * kanıtın yerini tutmaya çalışan bir ifade de kurulmaz.
 * ------------------------------------------------------------------ */

function opponentSectionTr(focus, links) {
  if (!focus) return [];
  const body = [];
  const team = focus.team;
  const manager = focus.manager;
  const signings = focus.signings || [];
  const evidence = focus.evidence || {};

  body.push(`## Rakip dosyası: ${link(team, links.opponentTeam)}'da transferler${manager ? ` ve ${manager} tartışması` : ""}`);

  /* — Transferler: kim, ne zaman, bu maçta ne ölçüldü — */
  if (signings.length) {
    const rows = signings.map((row) => {
      const when = row.date ? row.date.split("-").reverse().join(".") : "";
      const bits = [when, row.type, row.fromTeam ? `${row.fromTeam}'dan` : ""].filter(Boolean).join(", ");
      const age = Number.isFinite(row.daysAtClub) ? `kulüpte ${row.daysAtClub} gün` : "";
      return `${playerLink(row.name, links)} (${[bits, age].filter(Boolean).join("; ")})`;
    });
    body.push(
      `${team}'ın bu sezon kadroya kattığı ${link("doğrulanmış transferler", links.opponentTransfers)} şunlar: ${joinList(rows, "ve")}. ` +
      `Aşağıdaki değerlendirme yalnızca bu isimler ve yalnızca ölçülmüş kalemler üzerinden yapılıyor; ` +
      `kulübün adıyla anılan ama resmîleşmemiş hiçbir transfer bu tabloya girmiyor.`
    );

    const played = signings.filter((row) => row.played && row.thisMatch);
    if (played.length) {
      const lines = played.map((row) => {
        const stat = row.thisMatch;
        const bits = [];
        if (isNumber(stat.minutes)) bits.push(`${stat.minutes} dakika`);
        if (isNumber(stat.rating)) bits.push(`reyting ${trNumber(stat.rating)}`);
        if (num(stat.goals) > 0) bits.push(`${stat.goals} gol`);
        if (num(stat.assists) > 0) bits.push(`${stat.assists} asist`);
        if (num(stat.shotsOnTarget) > 0) bits.push(`${stat.shotsOnTarget} isabetli şut`);
        if (num(stat.duelsWon) > 0) bits.push(`${stat.duelsWon} kazanılan mücadele`);
        if (isNumber(stat.passRate)) bits.push(`%${trNumber(stat.passRate)} pas isabeti`);
        return `${playerLink(row.name, links)}: ${bits.join(", ")}`;
      });
      body.push(`Bu maçta sahada ölçülen değerleriyle: ${lines.join(". ")}.`);
    }
  }

  /* — ASIL SORU: ilk dönem ↔ son dönem — */
  body.push(`### İlk geldiklerinde nasıllardı, şimdi neredeler?`);

  if (evidence.windowsAvailable) {
    // Ölçüm var: pencereler karşılaştırılır ve yön AÇIKÇA söylenir.
    for (const row of signings.filter((entry) => entry.comparison && entry.comparison.sufficient)) {
      const first = row.comparison.firstWindow;
      const last = row.comparison.lastWindow;
      const size = row.comparison.size;
      const moved = (row.decline.moved || []).slice(0, 4)
        .map((item) => `${MEASURE_TR[item.measure] || item.measure} ${item.direction === "down" ? "%" + Math.abs(item.change) + " geriledi" : "%" + item.change + " arttı"} (${trNumber(item.before)} → ${trNumber(item.after)})`);
      const verdict = row.decline.verdict === "decline"
        ? `Tablo net: ${row.decline.down} üretim kaleminde gerileme var ve bu, tek bir maçın dalgalanması değil.`
        : row.decline.verdict === "improvement"
          ? `Beklenenin tersi: kalemlerin çoğu yukarı gidiyor; bu oyuncu için "düşüş" demek veriye aykırı olur.`
          : `Kalemler tek yöne gitmiyor: bu oyuncu için ne düşüş ne yükseliş denebilir, tablo yatay.`;
      body.push(
        `${playerLink(row.name, links)} — ilk ${size} maç (${row.comparison.firstDate}) ile son ${size} maç (${row.comparison.lastDate}) karşılaştırması, ` +
        `toplam ${row.comparison.sampleSize} ölçülmüş maç üzerinden: ${moved.length ? moved.join("; ") + "." : "kalemlerde eşiği aşan bir hareket yok."} ${verdict}`
      );
    }
  } else {
    // ÖLÇÜM YOK: tez kurulmaz, sebebi yazılır.
    body.push(
      `Bu sorunun dürüst cevabı bugün için şu: **bu karşılaştırmayı yapacak ölçüm henüz elimizde yok.** ` +
      `FutbolRadar'ın oyuncu–maç zaman serisinde ${team} transferleri için en uzun seri ${evidence.bestSeries} maç; ` +
      `ilk ${evidence.windowSize} maç ile son ${evidence.windowSize} maçı karşılaştırabilmek için oyuncu başına en az ${evidence.required} ölçülmüş maç gerekiyor. ` +
      `Elimizdeki veri bir eğilim değil, birkaç fotoğraf.`
    );
    body.push(
      `Bu satırı "düşüş yok" diye okumak da yanlış olur, "düşüş var" diye okumak da. Ölçülmemiş bir şey hakkında iki yönde de hüküm kurulmaz. ` +
      `Kulübün transferlerinin ilk haftalardaki etkisini koruyup koruyamadığı, ancak her oyuncunun maç maç üretim kalemleri biriktikten sonra söylenebilir — ` +
      `ve o seri her hafta biraz daha doluyor. Bu yazının bu bölümü, seri dolduğunda sayılarla konuşacak; bugün elindeki tek dürüst cümle bu.`
    );
  }

  /* — Rotasyon ve fikstür yükü: ölçüldüğü kadarıyla — */
  const load = [];
  const congestion = focus.congestion;
  if (congestion) {
    load.push(
      `${team} bu maça ${congestion.restDays} günlük dinlenmeyle geldi; son 14 günde ${congestion.matches14d}, son 30 günde ${congestion.matches30d} resmî maç oynadı.`
    );
    if (congestion.matches14d >= 4) {
      load.push(`İki haftada dört ve üzeri resmî maç, kadro derinliğini tercih meselesi olmaktan çıkarıp zorunluluğa çeviren bir tempodur.`);
    } else if (congestion.restDays <= 3) {
      load.push(`Üç gün ya da daha kısa bir aralık, aynı on birle çıkmanın fiziksel maliyetinin en yüksek olduğu aralıktır.`);
    }
  }
  const rotation = focus.rotation || {};
  if (rotation.matchesConsidered >= 3) {
    load.push(
      `Elimizdeki ${rotation.matchesConsidered} resmî maçlık dizilişte ${rotation.distinctStarters} farklı oyuncu ilk 11'de başladı, ` +
      `${rotation.everPresent} isim her maçta başladı` +
      `${isNumber(rotation.averageChanges) ? ` ve ardışık iki on bir arasında ortalama ${trNumber(rotation.averageChanges)} değişiklik yapıldı` : ""}. ` +
      (rotation.everPresent >= 8
        ? `Bu tablo rotasyonun dar olduğunu, yükün aynı isimlerde toplandığını gösteriyor.`
        : `Bu tablo, kadronun geniş bir bölümünün sahaya çıktığı bir dağılıma işaret ediyor.`)
    );
  } else if (rotation.matchesConsidered) {
    load.push(
      `Rotasyon hakkında sayı vermiyoruz: depodaki resmî maç dizilişi ${rotation.matchesConsidered} taneyle sınırlı ve ` +
      `tek dizilişten rotasyon çıkarmak, hazırlık maçlarını da sayıp "her maç on bir değişiyor" demek kadar yanıltıcı olurdu.`
    );
  }
  if (load.length) {
    body.push(`### Fikstür yükü ve rotasyon`);
    body.push(load.join(" "));
  }

  /* — SORULAR: hüküm değil, soru — */
  body.push(`### ${manager ? manager + " için" : "Teknik heyet için"} asıl sorular`);
  body.push(
    `Aşağıdakiler iddia değil, yukarıdaki ölçümlerin açtığı sorular — ve cevapları bu tek maçta yok:` +
    ` Oyuncular transfer oldukları ilk haftalarda neden daha dinamik görünüyor; bu bir uyum eğrisi mi, yoksa tempo ve yüklenme farkı mı?` +
    ` Aynı isimlerin sürekli sahada olması fiziksel ve zihinsel yıpranma üretiyor mu, üretiyorsa bu üretim kalemlerinde kaçıncı haftada görünür?` +
    ` Rotasyon, ${congestion ? `son 30 günde ${congestion.matches30d} maçlık` : "mevcut"} bir takvimi taşıyacak genişlikte mi?` +
    ` Yeni transferlerin güçlü yönleri sistemde kullanılıyor mu — oyuncu sisteme mi uyarlanıyor, sistem oyuncuya göre mi şekilleniyor?` +
    ` Değişiklikler oyunun yönü belli olmadan mı geliyor, belli olduktan sonra mı?`
  );
  body.push(
    `Bu soruların hepsinin ortak bir üst sorusu var ve tartışmayı asıl kuran o: ` +
    `**${team} oyuncu transfer etmekte mi başarılı, yoksa transfer ettiği oyuncunun performansını uzun süre korumakta mı zorlanıyor?** ` +
    `Hemen ardından gelen soru da şu: sorun oyuncularda mı, yoğun fikstürde mi, yoksa oyuncu kullanım modelinde mi? ` +
    `Üçünü tek bir sebebe indirgeyen her cevap, futbolun kendisinden daha basit olurdu. ` +
    `Dürüst yol, üç başlığın da ölçülerini ayrı ayrı biriktirip hangisinin gerçekten hareket ettiğini görmek — bu yazının yaptığı da bu.`
  );

  return body;
}

/** Ölçüm adlarının Türkçesi. Sayı hangi kalemden geliyor, okuyucu görsün. */
const MEASURE_TR = {
  goals: "gol", assists: "asist", shots: "şut", shotsOnTarget: "isabetli şut",
  keyPasses: "kilit pas", duelsWon: "kazanılan ikili mücadele", dribbles: "başarılı dripling",
  rating: "maç reytingi", minutes: "maç başına dakika", passes: "pas", passAccuracy: "pas isabeti",
  tackles: "top çalma", saves: "kurtarış", lostBalls: "top kaybı"
};

/* ------------------------------------------------------------------ *
 * İNGİLİZCE — kendi cümleleriyle
 * ------------------------------------------------------------------ */


const EN_GOOD = {
  possession: (row) => `holding ${enNumber(row.value)}% of the ball and setting the terms of the match`,
  volume: (row) => `winning the shot count ${enNumber(row.value)}-${enNumber(row.other)}`,
  accuracy: (row) => `putting ${row.value}% of their shots on target, turning volume into genuine threat`,
  passing: (row) => `keeping the ball at ${enNumber(row.value)}% passing accuracy`,
  duels: (row) => `finishing ahead in the duels, ${enNumber(row.value)}-${enNumber(row.other)}`,
  "box-defence": (row) => `allowing only ${enNumber(row.value)} shots from inside their own box`,
  "clean-sheet": () => `keeping a clean sheet`,
  finishing: (row) => `converting ${enNumber(row.value)} expected goals into ${row.other}`
};

const EN_BAD = {
  possession: (row) => `settling for ${enNumber(row.value)}% possession and handing the build-up to the opposition`,
  volume: (row) => `losing the shot count ${enNumber(row.value)}-${enNumber(row.other)}`,
  accuracy: (row) => `getting only ${row.value}% of their shots on target`,
  passing: (row) => `giving the ball away at ${enNumber(row.value)}% passing accuracy`,
  duels: (row) => `losing the duels ${enNumber(row.value)}-${enNumber(row.other)}`,
  "box-defence": (row) => `conceding ${enNumber(row.value)} shots from inside their own box`,
  conceded: (row) => `shipping ${row.value} goals`,
  finishing: (row) => `taking only ${row.other} goals from ${enNumber(row.value)} expected`,
  discipline: () => `going down to ten men`,
  fouls: (row) => `breaking the game up with ${enNumber(row.value)} fouls`
};

function renderEnglish(model) {
  const links = model.linksEn || {};
  const body = [];
  const opponent = model.opponent;
  const stats = model.stats;
  const score = `${model.ourScore}-${model.theirScore}`;

  const verb = model.result === "win" ? "beat" : model.result === "loss" ? "lost to" : "drew with";
  const place = model.isHome ? "at home" : "away";
  body.push(
    `Trabzonspor ${verb} ${opponent} ${score} ${place}${model.venue ? ` at ${model.venue}` : ""} on ${enDate(model.date)}, ` +
    `in the ${enCompetition(model.competition)}${enStage(model.stage) ? `, ${enStage(model.stage)}` : ""}. The ${link("full match report", links.report)} carries the raw numbers; this piece is about what they mean.`
  );
  body.push(
    model.result === "win"
      ? `A win reads clean on the table. Where it was actually won is usually somewhere the scoreline does not show, so the read below follows the evidence: who held the ball, who created the chances, which minute changed the game, and what the result does to ${link("Trabzonspor's league position", links.standings)}.`
      : model.result === "loss"
        ? `Pinning a defeat on a single moment is the easy version. The numbers from this night show both where the game slipped away and where Trabzonspor genuinely did good work, and ${link("the league table", links.standings)} sets the weight of it.`
        : `A draw is the most argued-over result in football: a loss to one side of the argument, a point gained to the other. The production numbers, the territory and ${link("the standings", links.standings)} decide which reading holds here.`
  );

  if (model.opponentFocus && (model.opponentFocus.signings || []).length) {
    const focus = model.opponentFocus;
    body.push(
      `Some matches describe more than ninety minutes; they ask where a team has been heading for months. ` +
      `Seen from the ${focus.team} side, this was one of them: ${focus.signings.length} new signings on the pitch, a squad ` +
      `${focus.congestion ? `that has played ${focus.congestion.matches30d} competitive matches in 30 days` : "arriving from a crowded calendar"}, and ` +
      `${focus.manager ? `${focus.manager}'s ` : "the manager's "}use of that squad open for discussion again. ` +
      `The second half of this piece is given to that argument — and the rule there does not change either: what is measured gets written, what is not does not.`
    );
  }

  body.push(
    `This is not a match summary. Every line below rests on data measured by the provider: the event feed, the team statistics, the team sheets and the per-player output. ` +
    `Nothing unmeasured has been written, and no words have been put in the mouth of a manager or a player. ` +
    `What the ${enCompetition(model.competition)}${enStage(model.stage) ? ` ${enStage(model.stage)}` : ""} fixture left behind is the sum of those measurements.`
  );

  if (!model.goals.length && model.ourScore === 0 && model.theirScore === 0) {
    body.push("## A goalless night");
    const goalless = [`Ninety minutes finished without a goal.`];
    if (stats.shots && isNumber(stats.shots.us)) {
      goalless.push(`Trabzonspor took ${enNumber(stats.shots.us)} shots${isNumber(stats.shots.them) ? ` to ${enNumber(stats.shots.them)}` : ""}, so this was not a match in which the goals went untested.`);
    }
    if (stats.xg && isNumber(stats.xg.us)) {
      goalless.push(`Expected goals came in at ${enNumber(stats.xg.us)}${isNumber(stats.xg.them) ? `-${enNumber(stats.xg.them)}` : ""}, which is the measure of how much was actually created behind a blank scoreline.`);
    }
    goalless.push(`Goalless matches are the hardest to read: the scoreboard says nothing, so the production columns have to say all of it. That is exactly what follows.`);
    body.push(goalless.join(" "));
  }

  if (model.goals.length) {
    body.push("## The goals, in order");
    const lines = model.goals.map((goal) => {
      const who = goal.scorer ? playerLink(goal.scorer, links) : "";
      const team = goal.forUs ? "Trabzonspor" : opponent;
      const extras = [];
      if (goal.penalty) extras.push("penalty");
      if (goal.ownGoal) extras.push("own goal");
      if (goal.assist) extras.push(`assist ${playerLink(goal.assist, links)}`);
      const suffix = extras.length ? ` (${extras.join(", ")})` : "";
      return who
        ? `${minuteLabel(goal.minute)} ${who} scored for ${team}${suffix}.`
        : `${minuteLabel(goal.minute)} ${team} scored${suffix}.`;
    });
    body.push(lines.join(" "));
    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    const assisted = model.goals.filter((goal) => goal.forUs && goal.assist).length;
    if (ourGoals) {
      body.push(
        assisted
          ? `${assisted} of Trabzonspor's ${ourGoals} goals came with a recorded assist, which makes them the end of a worked move rather than an individual moment.`
          : `None of Trabzonspor's goals carry a recorded assist: the finishers largely made the chances themselves.`
      );
    }
  }

  if (model.goals.length >= 2) {
    let us = 0;
    let them = 0;
    const states = model.goals.map((goal) => {
      if (goal.forUs) us += 1; else them += 1;
      return `${minuteLabel(goal.minute)} ${us}-${them}`;
    });
    let a = 0;
    let b = 0;
    let last = "level";
    let changes = 0;
    for (const goal of model.goals) {
      if (goal.forUs) a += 1; else b += 1;
      const state = a === b ? "level" : a > b ? "ahead" : "behind";
      if (state !== last) { changes += 1; last = state; }
    }
    body.push(
      `The scoreline moved in this order: ${states.join(" → ")}. ` +
      (changes >= 3
        ? `The advantage changed hands ${changes} times; neither side ever had the result secured.`
        : changes === 2
          ? `The state of the game changed twice, so the direction of this match was set at two separate breaks rather than one.`
          : `The scoreline turned once, and both sides then played as though they accepted it.`)
    );
  }

  const turn = model.turningPoint;
  if (turn) {
    body.push("## The moment the game turned");
    if (turn.kind === "red") {
      const who = turn.player ? playerLink(turn.player, links) : "a player";
      body.push(
        turn.forUs
          ? `${minuteLabel(turn.minute)}: ${who} was sent off and Trabzonspor played the rest of the match with ten. Being a man down is never only a man down — the block drops, the duel load rises, and every attack has further to travel. Everything after this minute has to be read separately from everything before it.`
          : `${minuteLabel(turn.minute)}: ${opponent} lost ${who} to a red card and the balance of the match changed there. A numerical advantage does not convert itself, and whether it converted here is what the attacking numbers below answer.`
      );
    } else {
      const who = turn.scorer ? playerLink(turn.scorer, links) : "";
      const stateText = turn.after === "ahead" ? "in front" : turn.after === "behind" ? "behind" : "level";
      body.push(
        `${minuteLabel(turn.minute)}: the goal that put Trabzonspor ${stateText}${who ? `, scored by ${who}` : ""}. Until then both sides were carrying the same risk; after it, one team had a scoreline to chase and the other one to protect. Every decision in the rest of the match was made in the shadow of that minute.`
      );
    }
  }

  if (turn && turn.minute !== null && turn.minute !== undefined) {
    const pivot = Number(String(turn.minute).split("+")[0]);
    if (Number.isFinite(pivot)) {
      const after = model.goals.filter((goal) => Number(String(goal.minute).split("+")[0]) > pivot);
      const afterUs = after.filter((goal) => goal.forUs).length;
      const afterThem = after.length - afterUs;
      body.push(after.length
        ? `The scoring after that minute finished ${afterUs}-${afterThem}. ${afterUs > afterThem ? "Trabzonspor did not merely survive the swing; they turned the space it opened into goals." : afterUs < afterThem ? "Control passed to the other side after the swing, and the scoreboard recorded it." : "Both sides answered after the swing, and the match finished on open ground."}`
        : `Nothing changed on the scoreboard after it. The rest of the match became a contest between holding a scoreline and breaking one, and neither side found the advantage to settle it.`);
    }
  }

  const tactical = [];
  if (model.lineups.us && model.lineups.us.formation) {
    tactical.push(`Trabzonspor set up in a ${model.lineups.us.formation}${model.lineups.them && model.lineups.them.formation ? `, ${opponent} in a ${model.lineups.them.formation}` : ""}.`);
  }
  if (stats.possession && isNumber(stats.possession.us)) {
    tactical.push(`Possession finished ${enNumber(stats.possession.us)}%${isNumber(stats.possession.them) ? ` to ${enNumber(stats.possession.them)}%` : ""}.`);
    const gap = isNumber(stats.possession.them) ? stats.possession.us - stats.possession.them : null;
    if (isNumber(gap) && gap >= 15) tactical.push(`The job of building the game sat clearly with Trabzonspor, while the opposition defended deep and waited for transitions.`);
    else if (isNumber(gap) && gap <= -15) tactical.push(`The ball belonged to the opposition; Trabzonspor chose to hold its shape and attack on the break rather than build.`);
    else if (isNumber(gap)) tactical.push(`Neither side owned the ball, and the match was decided largely by what happened to second balls in midfield.`);
  }
  if (stats.passes && isNumber(stats.passes.us) && stats.passAccuracy && isNumber(stats.passAccuracy.us)) {
    tactical.push(`Trabzonspor attempted ${enNumber(stats.passes.us)} passes at ${enNumber(stats.passAccuracy.us)}% accuracy${isNumber(stats.passAccuracy.them) ? `, against ${enNumber(stats.passAccuracy.them)}% for the opposition` : ""}.`);
  }
  if (tactical.length) {
    body.push("## Where the game was built");
    body.push(tactical.join(" "));
  }

  const balance = [];
  if (stats.duels && isNumber(stats.duels.us) && isNumber(stats.duels.them)) {
    const leading = stats.duels.us >= stats.duels.them;
    balance.push(`Duels won finished ${enNumber(stats.duels.us)}-${enNumber(stats.duels.them)} ${leading ? "in Trabzonspor's favour" : `to ${opponent}`}. ${leading ? "Second balls were collected in midfield and the opposition's build-up was pressed early." : "Midfield control never arrived, and with second balls going the other way the defensive line was pushed back."}`);
  }
  if (stats.fouls && isNumber(stats.fouls.us)) {
    balance.push(`Fouls: ${enNumber(stats.fouls.us)} for Trabzonspor${isNumber(stats.fouls.them) ? `, ${enNumber(stats.fouls.them)} for the opposition` : ""}.`);
  }
  if (model.cards.us.yellow || model.cards.them.yellow) {
    balance.push(`The yellow cards split ${model.cards.us.yellow}-${model.cards.them.yellow}.`);
  }
  if (stats.saves && isNumber(stats.saves.us)) {
    balance.push(`Trabzonspor's goalkeeper made ${enNumber(stats.saves.us)} saves.${stats.saves.us >= 4 ? " That is a goal genuinely tested, which means the defensive line was conceding clear sights of it." : " The goal was rarely tested; the block kept the opposition outside clear shooting range."}`);
  }
  if (stats.saves && isNumber(stats.saves.us) && stats.shotsOn && isNumber(stats.shotsOn.them) && stats.shotsOn.them > 0) {
    const rate = Math.round((stats.saves.us / stats.shotsOn.them) * 100);
    balance.push(
      `Of the ${enNumber(stats.shotsOn.them)} shots that hit the target, ${enNumber(stats.saves.us)} were saved — a ${rate}% save rate.` +
      (rate >= 80
        ? ` The goalkeeping is what kept the scoreline from being closer than it looked.`
        : rate >= 50
          ? ` The keeper did his share; the goals came from the quality of the chances rather than from errors behind them.`
          : ` Most shots on target found the net, which speaks at once to the finishing and to how clear the chances conceded were.`)
    );
  }
  if (balance.length) {
    body.push("## Midfield and the defensive balance");
    body.push(balance.join(" "));
  }

  const press = [];
  if (stats.passAccuracy && isNumber(stats.passAccuracy.them)) {
    press.push(`The opposition completed ${enNumber(stats.passAccuracy.them)}% of their passes${stats.passAccuracy.them <= 78 ? ", so the build-up never ran smoothly and the ball kept leaving their feet." : ", so they were never made uncomfortable in possession."}`);
  }
  if (stats.fouls && isNumber(stats.fouls.us)) {
    press.push(stats.fouls.us >= 15
      ? `Trabzonspor's ${enNumber(stats.fouls.us)} fouls say the attempt to win the ball back repeatedly spilled over into the referee's notebook.`
      : `At ${enNumber(stats.fouls.us)} fouls, the recovery work never turned into the kind of niggle that breaks a game up.`);
  }
  if (stats.offsides && isNumber(stats.offsides.them)) {
    press.push(`${enNumber(stats.offsides.them)} offsides against the opposition is the one measured sign of how high the defensive line stepped.`);
  }
  if (press.length >= 2) {
    body.push("## The press, and the opposition's build-up");
    body.push(`No direct pressing metric is published for this match, so what follows are measured traces of pressure rather than pressure itself. ` + press.join(" "));
  }

  const box = [];
  const outside = stats.outsideShots;
  if (stats.boxShots && isNumber(stats.boxShots.us) && outside && isNumber(outside.us)) {
    const total = stats.boxShots.us + outside.us;
    if (total > 0) {
      const share = Math.round((stats.boxShots.us / total) * 100);
      box.push(`Trabzonspor's shots split ${enNumber(stats.boxShots.us)}–${enNumber(outside.us)} inside and outside the box (${share}% from inside).${share >= 60 ? " The attack was built by getting in, not by shooting from range." : " More than half the volume came from outside, which is a defence closing the routes inside."}`);
    }
  }
  if (stats.boxShots && isNumber(stats.boxShots.them) && outside && isNumber(outside.them)) {
    const total = stats.boxShots.them + outside.them;
    if (total > 0) {
      box.push(`At the other end the same split reads ${enNumber(stats.boxShots.them)}–${enNumber(outside.them)} (${Math.round((stats.boxShots.them / total) * 100)}% from inside).`);
    }
  }
  const blocked = stats.blockedShots;
  if (blocked && isNumber(blocked.them) && blocked.them > 0) {
    box.push(`Trabzonspor blocked ${enNumber(blocked.them)} shots before they reached the goalkeeper — the measured value of bodies in the box.`);
  }
  if (box.length >= 2) {
    body.push("## Penalty-box effectiveness");
    body.push(box.join(" "));
  }

  const attack = [];
  if (stats.shots && isNumber(stats.shots.us)) {
    attack.push(`Trabzonspor took ${enNumber(stats.shots.us)} shots${stats.shotsOn && isNumber(stats.shotsOn.us) ? `, ${enNumber(stats.shotsOn.us)} on target` : ""}${isNumber(stats.shots.them) ? `, against ${enNumber(stats.shots.them)}` : ""}.`);
  }
  if (stats.boxShots && isNumber(stats.boxShots.us)) {
    attack.push(`${enNumber(stats.boxShots.us)} of those came from inside the box${stats.boxShots.us >= 6 ? ", so the attack was about getting into the final third rather than shooting from distance." : ", which says the attack struggled to get inside and settled for range."}`);
  }
  if (stats.corners && isNumber(stats.corners.us)) {
    attack.push(`Corners finished ${enNumber(stats.corners.us)}${isNumber(stats.corners.them) ? `-${enNumber(stats.corners.them)}` : ""}.`);
  }
  if (stats.xg && isNumber(stats.xg.us)) {
    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    attack.push(`Expected goals: ${enNumber(stats.xg.us)}${isNumber(stats.xg.them) ? ` to ${enNumber(stats.xg.them)}` : ""}.`);
    if (ourGoals > stats.xg.us + 0.7) attack.push(`The finishing ran well ahead of the quality of chance created.`);
    else if (ourGoals + 0.7 < stats.xg.us) attack.push(`The chances were there and the finishing was not: the problem this night was conversion, not creation.`);
  }
  if (stats.shots && isNumber(stats.shots.us) && stats.shots.us > 0) {
    const ourGoals = model.goals.filter((goal) => goal.forUs).length;
    if (ourGoals) {
      const perGoal = Math.round((stats.shots.us / ourGoals) * 10) / 10;
      attack.push(`That is ${enNumber(perGoal)} shots per goal.${perGoal <= 6 ? " Efficient: the chances were good ones, not just plentiful." : " A high number, and the sign of finishing lagging behind creation."}`);
    }
    if (stats.boxShots && isNumber(stats.boxShots.us)) {
      const share = Math.round((stats.boxShots.us / stats.shots.us) * 100);
      attack.push(`${share}% of the shots came from inside the area${share >= 55 ? ", so the attack went looking for the goal rather than settling for range." : ", meaning a large share of the volume came from low-percentage positions."}`);
    }
  }
  if (attack.length) {
    body.push("## The attack and the finishing");
    body.push(attack.join(" "));
  }

  const coaching = [];
  if (model.lineups.us && model.lineups.us.coach) coaching.push(`Trabzonspor were managed by ${model.lineups.us.coach}.`);
  if (model.lineups.us && model.lineups.us.players.length >= 11) coaching.push(`Starting XI: ${model.lineups.us.players.slice(0, 11).join(", ")}.`);
  if (model.subs.us.length) {
    const rows = model.subs.us.filter((row) => row.in)
      .map((row) => `${minuteLabel(row.minute)} ${playerLink(row.in, links)}${row.out ? ` for ${playerLink(row.out, links)}` : ""}`);
    if (rows.length) coaching.push(`Substitutions: ${rows.join("; ")}.`);
    const firstMinute = Number(String(model.subs.us[0].minute).split("+")[0]);
    if (Number.isFinite(firstMinute)) {
      coaching.push(firstMinute <= 46
        ? `The first change came on ${firstMinute} minutes — the bench did not wait for half-time to intervene.`
        : firstMinute >= 70
          ? `The first change did not arrive until ${firstMinute} minutes; the side was left alone for a long time.`
          : `The first change came on ${firstMinute} minutes, once the shape of the second half was clear.`);
    }
  }
  if (model.subs.us.length) {
    const inNames = new Set(model.subs.us.map((row) => normalize(row.in)).filter(Boolean));
    const scoringSubs = model.goals.filter((goal) => goal.forUs && goal.scorer && inNames.has(normalize(goal.scorer)));
    const assistingSubs = model.goals.filter((goal) => goal.forUs && goal.assist && inNames.has(normalize(goal.assist)));
    coaching.push(scoringSubs.length || assistingSubs.length
      ? `The bench contributed in measurable terms: ${scoringSubs.length} goals and ${assistingSubs.length} assists came directly from players introduced during the match. These were changes that touched the scoreline, not just the legs.`
      : `No goal or assist came from a substitute, so whatever the changes did, they did it in the balance of the game rather than on the scoreboard.`);
  }
  if (model.lineups.them && (model.lineups.them.formation || model.lineups.them.coach)) {
    coaching.push(`On the other bench, ${opponent}${model.lineups.them.coach ? `, managed by ${model.lineups.them.coach},` : ""} started${model.lineups.them.formation ? ` in a ${model.lineups.them.formation}` : ""} and made ${model.subs.them.length} changes.`);
  }
  if (coaching.length) {
    body.push("## The manager's decisions");
    body.push(coaching.join(" "));
  }

  if (model.standouts.hasRatings && model.standouts.top.length) {
    body.push("## Who stood out");
    const rows = model.standouts.top.map((row) => {
      const bits = [];
      if (num(row.goals) > 0) bits.push(`${num(row.goals)} goals`);
      if (num(row.assists) > 0) bits.push(`${num(row.assists)} assists`);
      if (num(row.saves) > 0) bits.push(`${num(row.saves)} saves`);
      if (num(row.duelsWon) > 0) bits.push(`${num(row.duelsWon)} duels won`);
      return `${playerLink(row.name, links)} (${enNumber(num(row.providerRating))}${bits.length ? ` — ${bits.slice(0, 3).join(", ")}` : ""})`;
    });
    body.push(`The highest provider ratings among the Trabzonspor side: ${joinList(rows, "and")}. A rating is not a verdict on its own, but read next to the production above, these are the players who carried the night.`);
  }
  if (model.standouts.hasRatings && model.standouts.under.length) {
    body.push("## Below expectation");
    const rows = model.standouts.under.map((row) => `${playerLink(row.name, links)} (${enNumber(num(row.providerRating))}, ${num(row.minutes)} minutes)`);
    body.push(`At the other end of the same scale: ${joinList(rows, "and")}. Not an accusation — an observation. Players who got the minutes without the output are the first item on the team sheet conversation before the next match.`);
  }

  if (model.goals.length) {
    const half = (goal) => (Number(String(goal.minute).split("+")[0]) <= 45 ? 1 : 2);
    const firstUs = model.goals.filter((goal) => goal.forUs && half(goal) === 1).length;
    const firstThem = model.goals.filter((goal) => !goal.forUs && half(goal) === 1).length;
    const secondUs = model.goals.filter((goal) => goal.forUs && half(goal) === 2).length;
    const secondThem = model.goals.filter((goal) => !goal.forUs && half(goal) === 2).length;
    body.push("## Two halves, or one match");
    const halves = [`The goals split ${firstUs}-${firstThem} before the break and ${secondUs}-${secondThem} after it.`];
    if (firstUs + firstThem === 0) halves.push(`Nothing was scored in the opening 45: both sides started by measuring each other, and the actual match was built after the interval.`);
    else if (secondUs + secondThem === 0) halves.push(`The scoreboard never moved in the second half. The character of this match was set before the break, and what followed was management.`);
    else if (secondUs > firstUs) halves.push(`Trabzonspor were more productive after the break — whether through the changes made or a dropping opposition tempo, the weight of the scoring sat in the second half.`);
    else if (firstUs > secondUs) halves.push(`Trabzonspor scored mostly before the break, which turned the second half into an exercise in holding what they had.`);
    else halves.push(`Scoring was spread evenly across the two halves, and the tempo held at a similar level for ninety minutes.`);
    const minutes = model.goals.map((goal) => Number(String(goal.minute).split("+")[0])).filter(Number.isFinite);
    if (minutes.length >= 2) {
      const first = Math.min(...minutes);
      const last = Math.max(...minutes);
      halves.push(`First goal on ${first} minutes, last on ${last}: the scoreline was written across a ${last - first}-minute window.`);
    }
    body.push(halves.join(" "));
  }

  const defended = [];
  if (stats.shots && isNumber(stats.shots.them)) {
    defended.push(`${opponent} replied with ${enNumber(stats.shots.them)} shots${stats.shotsOn && isNumber(stats.shotsOn.them) ? `, ${enNumber(stats.shotsOn.them)} of them on target` : ""}.`);
  }
  if (stats.boxShots && isNumber(stats.boxShots.them)) {
    defended.push(stats.boxShots.them >= 6
      ? `${enNumber(stats.boxShots.them)} of those came from inside the box, which means the defence was opened up in the final third more than once.`
      : `Only ${enNumber(stats.boxShots.them)} came from inside the box: the block largely kept the opposition out of the dangerous areas.`);
  }
  if (stats.xg && isNumber(stats.xg.them)) {
    const theirGoals = model.goals.filter((goal) => !goal.forUs).length;
    defended.push(`The opposition's expected goals read ${enNumber(stats.xg.them)} against ${theirGoals} actually scored.`);
    if (theirGoals > stats.xg.them + 0.7) defended.push(`They took more from their chances than the quality of them deserved, and the defence paid a heavy price for the few it conceded.`);
    else if (theirGoals + 0.7 < stats.xg.them) defended.push(`They fell short of what their chances were worth — part pressure from the defence, part goalkeeping.`);
  }
  if (stats.offsides && isNumber(stats.offsides.them) && stats.offsides.them >= 3) {
    defended.push(`${enNumber(stats.offsides.them)} offsides against them is the defensive line stepping up together.`);
  }
  if (defended.length >= 2) {
    body.push("## What the defence gave up");
    body.push(defended.join(" "));
  }

  const production = [];
  const ours = model.players.us.filter((row) => num(row.minutes) > 0);
  const leaderOf = (field) => {
    const rows = ours.filter((row) => num(row[field]) > 0).sort((left, right) => num(right[field]) - num(left[field]));
    return rows[0] || null;
  };
  const shooter = leaderOf("shotsOnTarget");
  if (shooter) production.push(`${playerLink(shooter.name, links)} hit the target most often, with ${num(shooter.shotsOnTarget)}.`);
  const dueller = leaderOf("duelsWon");
  if (dueller) production.push(`${playerLink(dueller.name, links)} led the duels with ${num(dueller.duelsWon)} won.`);
  const passer = ours.filter((row) => num(row.passes) >= 30).sort((left, right) => num(right.passes) - num(left.passes))[0];
  if (passer) production.push(`${playerLink(passer.name, links)} was the distribution point: ${num(passer.passes)} passes${playerPassRate(passer) !== null ? ` at ${playerPassRate(passer)}%` : ""}.`);
  const keeper = ours.filter((row) => num(row.saves) > 0).sort((left, right) => num(right.saves) - num(left.saves))[0];
  if (keeper) production.push(`${playerLink(keeper.name, links)} finished with ${num(keeper.saves)} saves in goal.`);
  if (production.length >= 3) {
    body.push("## The individual numbers");
    body.push(production.join(" ") + ` None of it settles an argument on its own, but it is the plainest picture of how the night's workload was actually shared.`);
  }

  const verdictRows = strengthsAndWeaknesses(model);
  if (verdictRows.good.length || verdictRows.bad.length) {
    body.push("## What Trabzonspor did well, and where it caught");
    const goodText = verdictRows.good.map((row) => (EN_GOOD[row.key] ? EN_GOOD[row.key](row) : "")).filter(Boolean);
    const badText = verdictRows.bad.map((row) => (EN_BAD[row.key] ? EN_BAD[row.key](row) : "")).filter(Boolean);
    const lines = [];
    if (goodText.length) {
      lines.push(`On the credit side: ${joinList(goodText, "and")}. None of that is impression — it is measurement, taken from this match, and it marks the part of the process worth carrying into the next one.`);
    }
    if (badText.length) {
      lines.push(`On the debit side: ${joinList(badText, "and")}. Any of it can be read as one bad night or as a standing weakness, and the only thing that separates the two is what the same columns say over the coming weeks.`);
    }
    if (!badText.length && goodText.length) {
      lines.push(`Nothing measured crossed the threshold into a negative, which is its own verdict: this was a rounded performance rather than one carried by a single department.`);
    }
    if (!goodText.length && badText.length) {
      lines.push(`That nothing measured crossed the threshold into a positive is a finding in itself: the problem is spread across the game rather than sitting in one area.`);
    }
    body.push(lines.join(" "));
  }

  if (model.opponentFocus) {
    body.push(...opponentSectionEn(model.opponentFocus, links));
  }

  if (model.standing) {
    body.push("## What it means for the league");
    const standing = model.standing;
    body.push(
      `Trabzonspor sit ${standing.rank}th in ${link("the Süper Lig table", links.standings)} on ${standing.points} points from ${standing.played} matches` +
      `${isNumber(num(standing.goalsFor)) ? `, with ${standing.goalsFor} scored and ${standing.goalsAgainst} conceded` : ""}. ` +
      (model.result === "win"
        ? `Three points at this stage of the season are less about climbing a row than about keeping the distance to the chasing pack intact.`
        : model.result === "loss"
          ? `Where dropped points cost a season is never clear on the night, but points lost now are recovered later only at double the effort.`
          : `A single point neither damages the table nor fixes it, and by the end of a season the draws column decides as much as the wins column.`)
    );
  }

  if (model.standing && Array.isArray(model.standing.form) && model.standing.form.length) {
    const form = model.standing.form.slice(-5);
    const wins = form.filter((row) => String(row).toUpperCase() === "W").length;
    const losses = form.filter((row) => String(row).toUpperCase() === "L").length;
    body.push(`The last ${form.length} results read ${form.join("-")}: ${wins} wins, ${losses} defeats. ${wins >= 3 ? "A run like that says more than any single result — it says the side can repeat something." : losses >= 3 ? "A run like that says the problem is not a one-match deviation but a pattern." : "An uneven run, and the sign of a team that has not yet settled on an identity."}`);
  }

  if (model.nextMatch) {
    body.push("## What to take into the next match");
    const next = model.nextMatch;
    body.push(
      `Next up: ${next.opponent}${next.isHome ? " at home" : " away"}${next.date ? ` on ${enDate(next.date)}` : ""}${next.competition ? `, ${enCompetition(next.competition)}` : ""}. ` +
      `${link("Trabzonspor's fixture list and latest news", links.team)} follows the build-up. The real question this night leaves behind is whether the pattern in the numbers above — a surplus of creation, a shortfall in finishing, whichever it was — is a one-match deviation or a running theme of the season. The same columns in the next match will answer it.`
    );
  }

  body.push(
    `The honest way to read a match is to put the numbers before the scoreboard. What happened tonight is the sum of the columns above: the chances made, the duels won, the space conceded, the decisions taken. ` +
    `${model.result === "win" ? "There is something to fix even in a win, and not losing it in the noise of the result is what shapes the rest of a season." : model.result === "loss" ? "There is something that worked even in a defeat, and not losing it in the noise of the result is what shapes the rest of a season." : "A draw fills both columns, and it takes a pattern rather than a single match to say which one weighs more."} ` +
    `FutbolRadar will keep tracking the same columns, on the same scale, after every match.`
  );

  return body;
}


function opponentSectionEn(focus, links) {
  if (!focus) return [];
  const body = [];
  const team = focus.team;
  const manager = focus.manager;
  const signings = focus.signings || [];
  const evidence = focus.evidence || {};

  body.push(`## The opposition file: ${link(team, links.opponentTeam)}'s signings${manager ? ` and the ${manager} question` : ""}`);

  if (signings.length) {
    const rows = signings.map((row) => {
      const bits = [row.date, row.type, row.fromTeam ? `from ${row.fromTeam}` : ""].filter(Boolean).join(", ");
      const age = Number.isFinite(row.daysAtClub) ? `${row.daysAtClub} days at the club` : "";
      return `${playerLink(row.name, links)} (${[bits, age].filter(Boolean).join("; ")})`;
    });
    body.push(
      `${team}'s ${link("confirmed signings", links.opponentTransfers)} this season: ${joinList(rows, "and")}. ` +
      `What follows covers those names only, and only what was measured; a transfer linked with the club but never confirmed does not enter this table.`
    );

    const played = signings.filter((row) => row.played && row.thisMatch);
    if (played.length) {
      const lines = played.map((row) => {
        const stat = row.thisMatch;
        const bits = [];
        if (isNumber(stat.minutes)) bits.push(`${enNumber(stat.minutes)} minutes`);
        if (isNumber(stat.rating)) bits.push(`rated ${enNumber(stat.rating)}`);
        if (num(stat.goals) > 0) bits.push(`${stat.goals} goals`);
        if (num(stat.assists) > 0) bits.push(`${stat.assists} assists`);
        if (num(stat.shotsOnTarget) > 0) bits.push(`${stat.shotsOnTarget} shots on target`);
        if (num(stat.duelsWon) > 0) bits.push(`${stat.duelsWon} duels won`);
        return `${playerLink(row.name, links)}: ${bits.join(", ")}`;
      });
      body.push(`Measured on the pitch in this match: ${lines.join(". ")}.`);
    }
  }

  body.push(`### How they looked on arrival, and where they are now`);

  if (evidence.windowsAvailable) {
    for (const row of signings.filter((entry) => entry.comparison && entry.comparison.sufficient)) {
      const size = row.comparison.size;
      const moved = (row.decline.moved || []).slice(0, 4)
        .map((item) => `${MEASURE_EN[item.measure] || item.measure} ${item.direction === "down" ? `down ${Math.abs(item.change)}%` : `up ${item.change}%`} (${enNumber(item.before)} → ${enNumber(item.after)})`);
      const verdict = row.decline.verdict === "decline"
        ? `That is a genuine fall across ${row.decline.down} production columns, not the noise of one bad night.`
        : row.decline.verdict === "improvement"
          ? `The opposite of the expected story: most columns are rising, and calling this a decline would contradict the data.`
          : `The columns do not move together, so neither decline nor improvement can be claimed here.`;
      body.push(
        `${playerLink(row.name, links)} — first ${size} matches (${row.comparison.firstDate}) against the last ${size} (${row.comparison.lastDate}), across ${row.comparison.sampleSize} measured matches: ` +
        `${moved.length ? moved.join("; ") + "." : "nothing moved beyond the threshold."} ${verdict}`
      );
    }
  } else {
    body.push(
      `The honest answer today: **the measurement that would settle this does not exist yet.** ` +
      `In FutbolRadar's player-by-match series, the longest run for a ${team} signing is ${evidence.bestSeries} match(es), and comparing a player's first ${evidence.windowSize} matches with their last ${evidence.windowSize} needs at least ${evidence.required} measured matches each. ` +
      `What we hold is not a trend. It is a handful of photographs.`
    );
    body.push(
      `Reading that as "there is no decline" would be as wrong as reading it as "there is one". No verdict runs in either direction on something unmeasured. ` +
      `Whether this club's signings hold their early impact can only be said once each player's production columns have accumulated match by match — and that series fills a little more every week. ` +
      `This section will speak in numbers when it can; today the only honest sentence is this one.`
    );
  }

  const load = [];
  const congestion = focus.congestion;
  if (congestion) {
    load.push(`${team} came into this match on ${congestion.restDays} days' rest, with ${congestion.matches14d} competitive matches in the last 14 days and ${congestion.matches30d} in the last 30.`);
    if (congestion.matches14d >= 4) load.push(`Four or more competitive matches in a fortnight turns squad depth from a preference into a requirement.`);
    else if (congestion.restDays <= 3) load.push(`Three days or fewer is the window in which naming the same eleven costs the most physically.`);
  }
  const rotation = focus.rotation || {};
  if (rotation.matchesConsidered >= 3) {
    load.push(
      `Across the ${rotation.matchesConsidered} competitive team sheets on record, ${rotation.distinctStarters} different players have started, ${rotation.everPresent} of them in every match` +
      `${isNumber(rotation.averageChanges) ? `, with an average of ${enNumber(rotation.averageChanges)} changes between consecutive elevens` : ""}. ` +
      (rotation.everPresent >= 8
        ? `That is a narrow rotation, with the load concentrated on the same names.`
        : `That points to a wide distribution of minutes across the squad.`)
    );
  } else if (rotation.matchesConsidered) {
    load.push(`No rotation figures are given here: only ${rotation.matchesConsidered} competitive team sheet(s) are on record, and drawing a rotation pattern from that would mislead as badly as counting pre-season friendlies would.`);
  }
  if (load.length) {
    body.push(`### Fixture load and rotation`);
    body.push(load.join(" "));
  }

  body.push(`### The real questions${manager ? ` for ${manager}` : ""}`);
  body.push(
    `These are questions the measurements open up, not claims, and one match does not answer them:` +
    ` why do players look sharper in their first weeks at a club — an adaptation curve, or a difference in tempo and load?` +
    ` Does naming the same players continuously produce physical and mental wear, and if so, in which week does it show up in the production columns?` +
    ` Is the rotation wide enough to carry ${congestion ? `a calendar of ${congestion.matches30d} matches in 30 days` : "the current calendar"}?` +
    ` Are the new signings' strengths actually used by the system — is the player adapted to the system, or the system shaped around the player?` +
    ` Do the substitutions arrive before the shape of the game is settled, or after?`
  );
  body.push(
    `All of them sit under one larger question, and that is the one worth arguing about: ` +
    `**is ${team} good at signing players, or does it struggle to hold on to the performance of the players it signs?** ` +
    `And immediately after it: is the problem the players, the congested fixture list, or the way the squad is used? ` +
    `Any answer that reduces those three to one cause would be simpler than football is. ` +
    `The honest route is to accumulate the measurements for all three separately and watch which one actually moves — which is exactly what this piece is doing.`
  );

  return body;
}

const MEASURE_EN = {
  goals: "goals", assists: "assists", shots: "shots", shotsOnTarget: "shots on target",
  keyPasses: "key passes", duelsWon: "duels won", dribbles: "successful dribbles",
  rating: "match rating", minutes: "minutes per match", passes: "passes",
  passAccuracy: "pass accuracy", tackles: "tackles", saves: "saves", lostBalls: "possession lost"
};

module.exports = {
  renderTurkish,
  playerPassRate,
  opponentSectionTr,
  opponentSectionEn,
  MEASURE_TR,
  MEASURE_EN,
  enStage,
  enCompetition,
  renderEnglish,
  trDate,
  enDate,
  trNumber,
  enNumber,
  link,
  playerLink,
  joinList,
  minuteLabel
};
