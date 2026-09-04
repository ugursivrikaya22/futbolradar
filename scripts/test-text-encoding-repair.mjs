/**
 * BOZUK KODLAMA ONARIMI TESTLERİ
 *
 * Sözleşme:
 *   1. Sağlam bir ad ASLA değiştirilmez. Türkçe, Boşnakça, Fransızca ve
 *      Çekçe aksanlı adlar onarımdan geçtiğinde birebir aynı kalmalı.
 *   2. Bozuk kodlanmış ad mekanik olarak onarılır — tahmin edilmez.
 *   3. Onarım kayıplıysa (bayt eksikse) girdiye dokunulmaz; yarım bir
 *      tahmin yazılmaz.
 *   4. Onarılamayan ad yayın kapısından geçemez: bozuk bir ad eksik bir
 *      alan değil, YANLIŞ bir bilgidir ve URL'ye kadar sızar.
 *   5. Depodaki veri kümesinde bozuk ad kalmamalı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { hasMojibake, repairMojibake, repairRecordText } = require("../services/textEncodingRepair.js");
const { evaluatePlayerCard } = require("../services/cardCredibility.js");

// --- 1. Sağlam adlar dokunulmadan geçer ---
{
  const clean = [
    "Uğurcan Çakır",
    "Barış Alper Yılmaz",
    "Çağlar Söyüncü",
    "İlkay Gündoğan",
    "N'Golo Kanté",
    "Mattéo Guendouzi",
    "Milan Škriniar",
    "Vaclav Černý",
    "Victor Osimhen",
    "Göztepe",
    ""
  ];

  for (const name of clean) {
    assert.equal(hasMojibake(name), false, `"${name}" bozuk sayılmamalı`);
    assert.equal(repairMojibake(name), name, `"${name}" onarımdan değişmeden geçmeli`);
  }
}

// --- 2. Bozuk kodlama mekanik olarak onarılır ---
{
  // Girdiler gerçek veri kümesinde bulunan bozulmanın birebir aynısı:
  // UTF-8 baytları Latin-1 olarak çözülmüş hâli.
  const corrupt = (value) => Buffer.from(value, "utf8").toString("latin1");

  for (const expected of ["B. Başkan", "O. Mimović", "C. Inao Oulaï", "U. İslamoğlu"]) {
    const broken = corrupt(expected);
    assert.notEqual(broken, expected, `test kurulumu: "${expected}" gerçekten bozulmalı`);
    assert.equal(hasMojibake(broken), true, `"${broken}" bozuk olarak tanınmalı`);
    assert.equal(repairMojibake(broken), expected.normalize("NFC"), `"${broken}" -> "${expected}" onarılmalı`);
  }
}

// --- 3. Kayıplı bozulmada tahmin yazılmaz ---
{
  // İkinci bayt kaybolmuş bir dizi geri çözülemez; onarım girdiyi aynen
  // döndürmeli, yarım bir sonuç ya da değiştirme karakteri yazmamalı.
  const truncated = "O. MimoviÄ";
  const result = repairMojibake(truncated);
  assert.equal(result, truncated, "geri çözülemeyen metin değiştirilmemeli");
  assert.ok(!result.includes("�"), "onarım değiştirme karakteri üretmemeli");
}

// --- 4. Kayıt alanları seçici onarılır ---
{
  const record = { id: "keep-me", name: Buffer.from("B. Başkan", "utf8").toString("latin1"), age: 19 };
  const repaired = repairRecordText(record, ["name", "fullName"]);
  assert.equal(repaired.name, "B. Başkan", "ad alanı onarılmalı");
  assert.equal(repaired.id, "keep-me", "kimlik alanına dokunulmamalı");
  assert.equal(repaired.age, 19, "sayısal alana dokunulmamalı");

  const clean = { id: "x", name: "Victor Osimhen" };
  assert.equal(repairRecordText(clean, ["name"]), clean, "temiz kayıt aynı nesne olarak dönmeli");
}

// --- 5. Onarılamayan ad yayımlanmaz ---
{
  const base = {
    providerId: "493968",
    sourceUrl: "https://example.com/kaynak",
    lastVerifiedAt: new Date().toISOString(),
    dataStatus: "provider",
    currentTeam: "Trabzonspor"
  };

  const healthy = evaluatePlayerCard({ ...base, name: "B. Başkan" });
  assert.equal(healthy.publishable, true, "ön koşul: sağlam adlı kart yayımlanabilir olmalı");

  const broken = evaluatePlayerCard({ ...base, name: "B. BaÅkan" });
  assert.equal(broken.publishable, false, "bozuk adlı kart yayımlanmamalı");
  assert.ok(
    broken.reasons.some((reason) => reason.includes("kodlama")),
    `eleme gerekçesi kodlamayı söylemeli, alınan: ${JSON.stringify(broken.reasons)}`
  );
}

// --- 6. Depodaki veri kümesi temiz ---
{
  const players = JSON.parse(fs.readFileSync("data/players.json", "utf8"));
  const dirty = players.filter((player) =>
    hasMojibake(player.name) ||
    hasMojibake(player.fullName) ||
    String(player.name || "").includes("�"));

  assert.equal(
    dirty.length,
    0,
    `veri kümesinde bozuk adlı kayıt kalmamalı: ${dirty.map((p) => `${p.id}=${p.name}`).join(", ")}`
  );

  // Kimlik ve URL addan türetiliyor: bozuk ad temizlendiyse slug da temiz olmalı.
  const dirtySlugs = players.filter((player) => hasMojibake(player.id) || hasMojibake(player.slug));
  assert.equal(dirtySlugs.length, 0, "bozuk kodlamadan türemiş kimlik/slug kalmamalı");
}

// --- 7. Oyuncu adı BİRDEN ÇOK veri dosyasında yaşıyor ---
{
  // İlk onarımda yalnızca data/players.json temizlenmişti ve arşiv/kadro
  // sayfaları hâlâ "O. MimoviÄ" basıyordu: aynı ad sağlayıcı kadro anlık
  // görüntüsünde ve sezon arşivinde de duruyor, o sayfalar oradan okuyor.
  // Tek dosyayı denetleyen bir test bu tekrarı kaçırır.
  const SOURCES = ["data/players.json", "data/super-lig-squads.json", "data/season-archive.json"];

  for (const file of SOURCES) {
    if (!fs.existsSync(file)) continue;

    const raw = fs.readFileSync(file, "utf8");
    const dirty = [];

    // Dosya biçimleri farklı (dizi, kadro anlık görüntüsü, sezon arşivi);
    // ada nerede rastlanacağını varsaymak yerine tüm dizeler geziliyor.
    const visit = (value) => {
      if (typeof value === "string") {
        if (hasMojibake(value) || value.includes("�")) dirty.push(value);
        return;
      }
      if (Array.isArray(value)) return value.forEach(visit);
      if (value && typeof value === "object") return Object.values(value).forEach(visit);
    };
    visit(JSON.parse(raw));

    assert.equal(
      dirty.length,
      0,
      `${file} içinde bozuk kodlanmış metin kalmamalı: ${[...new Set(dirty)].slice(0, 5).join(", ")}`
    );
  }
}

console.log("Text encoding repair tests passed (sağlam ad korunur, bozuk ad onarılır, kayıplı bozulmada tahmin yok, yayın kapısı, veri kümesi temiz, tüm kaynak dosyalar temiz).");
