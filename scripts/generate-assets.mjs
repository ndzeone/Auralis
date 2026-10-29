import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'apps/launcher/build');
await mkdir(out, { recursive: true });
const logo = await readFile(path.join(root, 'branding/logo.svg'));
const png = (size) => sharp(logo).resize(size, size).png().toBuffer();
await writeFile(path.join(out, 'icon.png'), await png(512));
const sizes = [16, 32, 48, 64, 128, 256];
const images = await Promise.all(sizes.map(png));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
images.forEach((buffer, index) => {
  const pos = 6 + index * 16;
  header[pos] = sizes[index] === 256 ? 0 : sizes[index];
  header[pos + 1] = header[pos];
  header.writeUInt16LE(1, pos + 4);
  header.writeUInt16LE(32, pos + 6);
  header.writeUInt32LE(buffer.length, pos + 8);
  header.writeUInt32LE(offset, pos + 12);
  offset += buffer.length;
});
await writeFile(path.join(out, 'icon.ico'), Buffer.concat([header, ...images]));
const chunks = await Promise.all(
  [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(async ([type, size]) => {
    const body = await png(size);
    const h = Buffer.alloc(8);
    h.write(type, 0, 4, 'ascii');
    h.writeUInt32BE(body.length + 8, 4);
    return Buffer.concat([h, body]);
  }),
);
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile(path.join(out, 'icon.icns'), Buffer.concat([icnsHeader, ...chunks]));
await sharp(path.join(root, 'branding/dmg-background.svg')).png().toFile(path.join(out, 'dmg-background.png'));
await mkdir(path.join(root, 'apps/web/public'), { recursive: true });
await writeFile(path.join(root, 'apps/web/public/favicon.svg'), logo);
console.log('Generated PNG, multi-resolution ICO, ICNS, DMG background and web favicon.');
