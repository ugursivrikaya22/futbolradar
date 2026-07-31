/**
 * DOSYA ADINI SÖYLEYEN JSON OKUYUCU.
 *
 * SORUN. Betiklerin çoğu JSON'u şöyle okuyordu:
 *
 *     JSON.parse(fs.readFileSync(filePath, "utf8"))
 *
 * Dosya bozuksa `JSON.parse` yalnızca "Expected ',' or '}' after property
 * value in JSON at position 9" diyor. HANGİ DOSYA olduğunu söylemiyor. CI
 * günlüğünde geriye kalan tek ipucu yığın izi oluyor ve hatayı okuyan kişi
 * betiği açıp hangi yolun okunduğunu elle bulmak zorunda kalıyor.
 *
 * Gerçek bir olayda tam olarak bu yaşandı: `data/match-analyses.json`
 * yarım kalmış bir düzenlemeyle bozuldu, "Refresh official lineups" adımı
 * çöktü ve hata mesajı dosyayı hiç anmadı.
 *
 * ÇÖZÜM. Bu okuyucu hatayı yakalar, DOSYA YOLUNU ve bozuk bölgeyi
 * gösteren bir bağlam satırını mesaja ekler, sonra yeniden fırlatır.
 *
 * SESSİZCE YUTMAZ. Bozuk bir dosyayı `[]` sayıp devam etmek daha da kötü
 * olurdu: betik "başarılı" görünür, hiçbir şey yapmaz ve veri sessizce
 * kaybolur. Eksik dosya (ENOENT) ayrı bir durumdur — `fallback` verilmişse
 * o döner, çünkü "dosya henüz üretilmemiş" beklenen bir hâldir.
 */
import fs from "node:fs";

/** Hatanın geçtiği yerin çevresinden okunabilir bir kesit. */
function contextAround(text, position, radius = 40) {
  if (!Number.isFinite(position)) return "";

  const start = Math.max(0, position - radius);
  const end = Math.min(text.length, position + radius);
  const before = text.slice(start, position).replace(/\n/g, "\\n");
  const after = text.slice(position, end).replace(/\n/g, "\\n");

  return `${before}  ►◄  ${after}`;
}

/** V8 mesajından "at position N" değerini çıkarır. */
function positionFrom(error) {
  const match = String((error && error.message) || "").match(/position (\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * JSON dosyasını okur; ayrıştırma hatasında dosya adını söyler.
 *
 * @param {string} filePath Okunacak dosya.
 * @param {*} [fallback] Dosya YOKSA dönecek değer. Verilmezse hata fırlar.
 *   Bozuk dosyada ASLA kullanılmaz — bozukluk sessizce geçilmez.
 * @returns {*} Ayrıştırılmış içerik.
 */
export function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`JSON dosyası bulunamadı: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");

  try {
    return JSON.parse(raw);
  } catch (error) {
    const position = positionFrom(error);
    const context = contextAround(raw, position);

    const detail = [
      `Bozuk JSON: ${filePath}`,
      `  Ayrıştırıcı: ${error.message}`,
      position === null ? "" : `  Bağlam (► hatanın yeri ◄): ${context}`,
      `  Dosyayı düzeltin ya da geçerli bir sürümden geri alın:`,
      `    git checkout HEAD -- ${filePath}`
    ].filter(Boolean).join("\n");

    const wrapped = new SyntaxError(detail);
    wrapped.cause = error;
    wrapped.filePath = filePath;
    throw wrapped;
  }
}

/**
 * Aynı okuyucunun "çökmeyen" biçimi: bozuk dosyada uyarı basar ve
 * `fallback` döner. Yalnızca bozuk verinin koşuyu durdurmaması GEREKEN
 * yerlerde kullanılmalı — ve orada bile uyarı görünür kalır.
 */
export function readJsonFileSafe(filePath, fallback, scope) {
  try {
    return readJsonFile(filePath, fallback);
  } catch (error) {
    console.warn(`[${scope || "readJson"}] ${error.message}`);
    return fallback;
  }
}

export default readJsonFile;
