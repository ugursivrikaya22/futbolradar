/**
 * DERLEME KAPISI: YAYIMLANAN ÇIKTIDA SIR OLMAMALI.
 *
 * Bu adım derleme zincirinin SONUNDA koşar — bütün sayfalar üretildikten,
 * public/ aynası kopyalandıktan ve son işlemler (yerleşim, tema, GA4)
 * uygulandıktan sonra. Daha erken koşsaydı, kendisinden sonra gelen bir adımın
 * sızdırdığı değeri göremezdi.
 *
 * NEDEN TESTE BIRAKILMIYOR. Testler dağıtım zincirinin parçası değil: Vercel
 * `npm run build` çalıştırır, `npm test` çalıştırmaz. Sızıntının olabileceği
 * tek ortam ise anahtarların TANIMLI olduğu derleme ortamıdır. Yani korumanın
 * yaşaması gereken yer tam olarak burasıdır; test aynı taramayı ayrıca
 * doğrular ama onun yerini tutamaz.
 *
 * BULURSA DURUR. Sızıntılı bir çıktıyı yayımlamaktansa derlemeyi düşürmek
 * doğrudur: sızmış bir servis anahtarı geri alınamaz, düşen bir derleme
 * alınabilir.
 */

import { scanPublishedOutput } from "./lib/publishedSecretScan.mjs";

const root = process.cwd();
const { files, problems } = scanPublishedOutput(root);

if (problems.length) {
  console.error(`Yayımlanan çıktıda sır bulundu (${problems.length} bulgu):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nDerleme durduruldu. Bu değerler tarayıcıya giden dosyalara yazılmamalı; " +
    "çalışma zamanı tanılaması /api/supabase-health ucunda yaşar."
  );
  process.exit(1);
}

console.log(`Sır taraması temiz: ${files} yayımlanan dosya tarandı.`);
