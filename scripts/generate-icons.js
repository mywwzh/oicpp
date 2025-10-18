const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const icojs = require('icojs');

(async function main() {
  const root = process.cwd();
  const icoPath = path.join(root, 'oicpp.ico');
  if (!fs.existsSync(icoPath)) {
    console.log('[icons] oicpp.ico not found, skip');
    process.exit(0);
  }
  const outDir = path.join(root, 'build', 'icons');
  const pngDir = path.join(outDir, 'png');
  fs.mkdirSync(pngDir, { recursive: true });

  const buf = fs.readFileSync(icoPath);
  const images = await icojs.parse(buf, 'image/png');
  let largest = images.sort((a,b)=> (b.width*b.height)-(a.width*a.height))[0];
  let basePng = largest && largest.buffer ? Buffer.from(largest.buffer) : null;
  if (!basePng) {
    const pngFromIco = await sharp(buf).png().toBuffer();
    basePng = pngFromIco;
  }

  const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  for (const s of sizes) {
    const pngOut = path.join(pngDir, `${s}x${s}.png`);
    const out = await sharp(basePng).resize(s, s, { fit: 'cover' }).png().toBuffer();
    fs.writeFileSync(pngOut, out);
  }

})();
