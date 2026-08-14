/**
 * PNG VE ICO KODLAYICI — BAĞIMLILIKSIZ.
 *
 * Bu depo bilerek sıfır bağımlılıkla duruyor (`package.json` içinde ne
 * `dependencies` ne `devDependencies` var) ve derleme Vercel'de `npm install`
 * çalıştırmıyor. Favicon üretmek için `sharp`/`jimp` eklemek, tek seferlik
 * bir görsel işi uğruna kalıcı bir kurulum adımı ve yüzlerce megabaytlık
 * ikili bağımlılık getirirdi.
 *
 * Oysa ihtiyacımız olan şey dar: elimizde ham RGBA piksel dizisi var ve onu
 * iki kaba koymak istiyoruz. İkisi de tamamen belgelenmiş, sabit biçimler:
 *
 *   • PNG — imza + IHDR + IDAT (zlib, Node'un kendi modülü) + IEND, her
 *     yığın kendi CRC32'siyle.
 *   • ICO — ICONDIR + her boyut için ICONDIRENTRY + BMP (DIB) gövdesi.
 *
 * ICO içinde PNG de gömülebiliyor ve modern tarayıcıların hepsi okuyor; yine
 * de 16/32/48 için BMP tercih edildi. Gerekçe: ICO'yu yalnızca tarayıcılar
 * okumuyor — arama motoru tarayıcıları, önizleme üreten sunucu tarafı
 * kütüphaneler ve eski araçlar da okuyor ve bunların bir kısmı ICO içinde
 * PNG beklemiyor. BMP her yerde çözülür, maliyeti yalnızca birkaç kilobayt.
 */
import zlib from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC32 tablosu — PNG her yığının sonuna bunu yazıyor. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

/**
 * RGBA piksel dizisinden PNG.
 *
 * Süzgeç baytı her satırda 0 ("None"). Daha akıllı süzgeçler dosyayı biraz
 * küçültürdü ama bu ikonlar zaten birkaç kilobayt; okunabilirlik daha değerli.
 */
export function encodePng(rgba, width, height) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`piksel sayısı uyuşmuyor: ${rgba.length} != ${width * height * 4}`);
  }

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer ? rgba.buffer : rgba, rgba.byteOffset || 0, rgba.length)
      .copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit derinliği
  ihdr[9] = 6;   // renk tipi: RGBA
  ihdr[10] = 0;  // sıkıştırma: deflate
  ihdr[11] = 0;  // süzgeç yöntemi
  ihdr[12] = 0;  // aralıksız

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/**
 * Tek bir ICO girdisinin BMP gövdesi.
 *
 * İki tuhaflığı var ve ikisi de biçimin kendisinden geliyor:
 *   • Yükseklik alanı GERÇEĞİN İKİ KATI yazılır — DIB, renk verisinden sonra
 *     bir de saydamlık maskesi taşıdığını böyle bildiriyor.
 *   • Satırlar ALTTAN ÜSTE dizilir.
 *
 * 32 bitlik alfa kanalı zaten saydamlığı taşıyor ama AND maskesi yine de
 * yazılır: yoksa maskeyi okuyan eski çözücüler ikonu tamamen opak sanar.
 */
function encodeIcoBmp(rgba, size) {
  const headerSize = 40;
  const rowSize = size * 4;
  const maskRowSize = Math.ceil(size / 32) * 4;
  const pixels = Buffer.alloc(rowSize * size);
  const mask = Buffer.alloc(maskRowSize * size);

  for (let y = 0; y < size; y += 1) {
    const sourceRow = size - 1 - y; // alttan üste
    for (let x = 0; x < size; x += 1) {
      const source = (sourceRow * size + x) * 4;
      const target = y * rowSize + x * 4;
      pixels[target] = rgba[source + 2];     // B
      pixels[target + 1] = rgba[source + 1]; // G
      pixels[target + 2] = rgba[source];     // R
      pixels[target + 3] = rgba[source + 3]; // A

      // Maske: 1 = saydam. Alfa 0 olan piksel işaretlenir.
      if (rgba[source + 3] === 0) {
        mask[y * maskRowSize + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }

  const header = Buffer.alloc(headerSize);
  header.writeUInt32LE(headerSize, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // renk + maske
  header.writeUInt16LE(1, 12);      // düzlem
  header.writeUInt16LE(32, 14);     // bit/piksel
  header.writeUInt32LE(0, 16);      // sıkıştırma yok
  header.writeUInt32LE(pixels.length + mask.length, 20);

  return Buffer.concat([header, pixels, mask]);
}

/**
 * Çok boyutlu ICO. `images`: `[{ size, rgba }]`.
 *
 * Boyutlar küçükten büyüğe yazılır; okuyucular genelde ilk uygun girdiyi
 * değil en yakın boyutu seçiyor ama sıralı liste eski araçlarda daha
 * öngörülebilir davranıyor.
 */
export function encodeIco(images) {
  const sorted = [...images].sort((left, right) => left.size - right.size);
  const bodies = sorted.map((image) => encodeIcoBmp(image.rgba, image.size));

  const directory = Buffer.alloc(6 + sorted.length * 16);
  directory.writeUInt16LE(0, 0); // ayrılmış
  directory.writeUInt16LE(1, 2); // tip: ikon
  directory.writeUInt16LE(sorted.length, 4);

  let offset = directory.length;
  sorted.forEach((image, index) => {
    const entry = 6 + index * 16;
    // 256 piksel alana 0 yazılır; bu ICO'da o boyut yok ama kural burada dursun.
    directory[entry] = image.size >= 256 ? 0 : image.size;
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palet yok
    directory[entry + 3] = 0; // ayrılmış
    directory.writeUInt16LE(1, entry + 4);   // düzlem
    directory.writeUInt16LE(32, entry + 6);  // bit/piksel
    directory.writeUInt32LE(bodies[index].length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += bodies[index].length;
  });

  return Buffer.concat([directory, ...bodies]);
}
