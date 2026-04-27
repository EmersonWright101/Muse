/**
 * round-windows-icon.cjs
 *
 * Adds rounded corners to Windows icon files ONLY.
 * macOS icon.icns is intentionally left untouched.
 *
 * Modifies:
 *   src-tauri/icons/32x32.png
 *   src-tauri/icons/128x128.png
 *   src-tauri/icons/128x128@2x.png
 *   src-tauri/icons/icon.ico
 *
 * Does NOT touch:
 *   src-tauri/icons/icon.icns  ← macOS, untouched
 *   src-tauri/icons/icon.png   ← source, untouched
 */

'use strict';

const sharp = require('../node_modules/sharp');
const fs = require('fs');
const path = require('path');

const ICON_DIR = path.resolve(__dirname, '../src-tauri/icons');
const SOURCE   = path.join(ICON_DIR, 'icon.png');

// Rounded corner radius as a fraction of the icon size.
// 0.22 ≈ Windows 11 "squircle" style; adjust to taste (0.15 = subtle, 0.30 = very round)
const RADIUS_RATIO = 0.22;

/** Returns a Buffer of the source icon resized to `size` with rounded corners. */
async function makeRounded(size) {
  const r = Math.round(size * RADIUS_RATIO);
  const mask = Buffer.from(
    `<svg><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`
  );
  return sharp(SOURCE)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/**
 * Builds an ICO file containing multiple PNG images.
 * Modern Windows (Vista+) natively supports PNG-in-ICO.
 */
function buildIco(entries) {
  // entries = [{ size, buf }, ...]
  const count      = entries.length;
  const headerSize = 6 + count * 16;

  // Calculate image offsets
  let offset = headerSize;
  for (const e of entries) {
    e.offset = offset;
    offset  += e.buf.length;
  }

  // ICONDIR
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (ICO)
  header.writeUInt16LE(count, 4);

  // ICONDIRENTRY × count
  const dirs = entries.map(({ size, buf, offset: off }) => {
    const d = Buffer.alloc(16);
    d.writeUInt8(size === 256 ? 0 : size, 0); // width  (0 means 256)
    d.writeUInt8(size === 256 ? 0 : size, 1); // height
    d.writeUInt8(0,  2); // colorCount
    d.writeUInt8(0,  3); // reserved
    d.writeUInt16LE(1,  4); // planes
    d.writeUInt16LE(32, 6); // bitCount (32-bit RGBA)
    d.writeUInt32LE(buf.length, 8);  // bytesInRes
    d.writeUInt32LE(off,        12); // imageOffset
    return d;
  });

  return Buffer.concat([header, ...dirs, ...entries.map(e => e.buf)]);
}

async function main() {
  // --- Backup originals ---
  const backupDir = path.join(ICON_DIR, '_backup_before_round');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
    for (const f of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.ico']) {
      const src = path.join(ICON_DIR, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(backupDir, f));
      }
    }
    console.log('Backup saved to src-tauri/icons/_backup_before_round/');
  }

  // --- Generate rounded PNGs ---
  const pngJobs = [
    { size: 32,  file: '32x32.png' },
    { size: 128, file: '128x128.png' },
    { size: 256, file: '128x128@2x.png' },
  ];

  for (const { size, file } of pngJobs) {
    const buf = await makeRounded(size);
    fs.writeFileSync(path.join(ICON_DIR, file), buf);
    console.log(`✓ ${file} (${size}×${size})`);
  }

  // --- Generate icon.ico (16, 32, 48, 256) ---
  const icoSizes  = [16, 32, 48, 256];
  const icoEntries = await Promise.all(
    icoSizes.map(async size => ({ size, buf: await makeRounded(size) }))
  );
  const icoData = buildIco(icoEntries);
  fs.writeFileSync(path.join(ICON_DIR, 'icon.ico'), icoData);
  console.log('✓ icon.ico (16, 32, 48, 256)');

  console.log('\nDone. icon.icns (macOS) was NOT modified.');
}

main().catch(err => { console.error(err); process.exit(1); });
