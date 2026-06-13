import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const svgPath = path.join(publicDir, 'ar4-test.svg');

const BACKGROUND = '#000000';
const PADDING_RATIO = 0.15;

async function generateIcon(size) {
  const padding = Math.round(size * PADDING_RATIO);
  const inner = size - padding * 2;

  const svg = await readFile(svgPath);

  // High density so the vector logo stays crisp when scaled to `inner`.
  const logo = await sharp(svg, { density: 512 })
    .resize(inner, inner, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const outPath = path.join(publicDir, `icon-${size}.png`);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BACKGROUND,
    },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toFile(outPath);

  console.log(`✓ ${outPath} (${size}x${size}, padding ${padding}px)`);
}

await generateIcon(192);
await generateIcon(512);
console.log('Done.');
