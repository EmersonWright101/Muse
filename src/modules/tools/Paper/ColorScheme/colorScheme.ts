export type SchemeType = 'monochromatic' | 'complementary' | 'analogous' | 'triadic' | 'tetradic';

export interface ColorSwatch {
  hex: string;
  rgbStr: string;
  hslStr: string;
  textOnColor: 'white' | 'black';
}

// ─── Color Math ──────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

// WCAG relative luminance
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function textOnBg(hex: string): 'white' | 'black' {
  const rgb = hexToRgb(hex);
  if (!rgb) return 'black';
  const lum = luminance(...rgb);
  return 1.05 / (lum + 0.05) > (lum + 0.05) / 0.05 ? 'white' : 'black';
}

function swatch(h: number, s: number, l: number): ColorSwatch {
  s = Math.max(0, Math.min(100, s));
  l = Math.max(8, Math.min(94, l));
  const rgb = hslToRgb(h, s, l);
  const hex = rgbToHex(...rgb);
  return {
    hex,
    rgbStr: `rgb(${rgb.join(', ')})`,
    hslStr: `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`,
    textOnColor: textOnBg(hex),
  };
}

// ─── Scheme Generators ────────────────────────────────────────────────────────

function monochromatic(h: number, s: number, l: number): ColorSwatch[] {
  const base = Math.max(25, Math.min(l, 65));
  const sat  = Math.max(35, Math.min(s, 80));
  return [
    swatch(h, sat + 10, base - 28),
    swatch(h, sat + 5,  base - 14),
    swatch(h, sat,      base),
    swatch(h, sat - 12, base + 16),
    swatch(h, sat - 20, base + 28),
    swatch(h, sat - 28, base + 40),
  ];
}

function complementary(h: number, s: number, l: number): ColorSwatch[] {
  const comp = (h + 180) % 360;
  const sat  = Math.max(40, Math.min(s, 72));
  const base = Math.max(32, Math.min(l, 60));
  return [
    swatch(h,    sat + 5,  base - 12),
    swatch(h,    sat,      base),
    swatch(h,    sat - 18, base + 24),
    swatch(comp, sat + 5,  base - 12),
    swatch(comp, sat,      base),
    swatch(comp, sat - 18, base + 24),
  ];
}

function analogous(h: number, s: number, l: number): ColorSwatch[] {
  const sat  = Math.max(40, Math.min(s, 72));
  const base = Math.max(35, Math.min(l, 62));
  return [
    swatch((h - 40 + 360) % 360, sat - 5, base),
    swatch((h - 20 + 360) % 360, sat,     base),
    swatch(h,                    sat,     base),
    swatch((h + 20) % 360,       sat,     base),
    swatch((h + 40) % 360,       sat - 5, base),
  ];
}

function triadic(h: number, s: number, l: number): ColorSwatch[] {
  const sat  = Math.max(40, Math.min(s, 72));
  const base = Math.max(35, Math.min(l, 58));
  return [
    swatch(h,                   sat,      base),
    swatch(h,                   sat - 16, base + 22),
    swatch((h + 120) % 360,     sat,      base),
    swatch((h + 120) % 360,     sat - 16, base + 22),
    swatch((h + 240) % 360,     sat,      base),
    swatch((h + 240) % 360,     sat - 16, base + 22),
  ];
}

function tetradic(h: number, s: number, l: number): ColorSwatch[] {
  const sat  = Math.max(40, Math.min(s, 72));
  const base = Math.max(35, Math.min(l, 58));
  return [
    swatch(h,                sat, base),
    swatch((h + 90)  % 360,  sat, base),
    swatch((h + 180) % 360,  sat, base),
    swatch((h + 270) % 360,  sat, base),
  ];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateScheme(hex: string, type: SchemeType): ColorSwatch[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return [];
  const [h, s, l] = rgbToHsl(...rgb);
  switch (type) {
    case 'monochromatic':  return monochromatic(h, s, l);
    case 'complementary':  return complementary(h, s, l);
    case 'analogous':      return analogous(h, s, l);
    case 'triadic':        return triadic(h, s, l);
    case 'tetradic':       return tetradic(h, s, l);
  }
}

export function isValidHex(hex: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(hex.trim());
}

export function normalizeHex(hex: string): string {
  const clean = hex.trim().replace('#', '');
  return '#' + clean.toLowerCase();
}
