export const ANALYSIS_BANDS = 512;
export const NYQUIST_HZ = 24000;
export const MIN_HZ = 30;
export const MAX_HZ = 16000;
export const DB_FLOOR = -80;
const TILT_DB_PER_OCTAVE = 3;
const FALL_MIN = 0.3;
const FALL_MAX = 30;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const gainDb = sensitivity => (clamp(sensitivity, 0, 100) - 50) * 0.6;

export const intervalNs = fps => Math.round(1e9 / clamp(fps, 5, 120));

export const distinctBands = (totalBars, mirror) =>
  Math.max(1, mirror ? Math.ceil(totalBars / 2) : Math.floor(totalBars));
export const drawnBars = (distinct, mirror) => (mirror ? distinct * 2 : distinct);

export function buildBandMap(distinct, scale) {
  const binHz = NYQUIST_HZ / ANALYSIS_BANDS;
  const lo = new Float64Array(distinct);
  const hi = new Float64Array(distinct);
  const tilt = new Float64Array(distinct);
  for (let d = 0; d < distinct; d++) {
    let f0, f1;
    if (scale === 'log') {
      f0 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, d / distinct);
      f1 = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, (d + 1) / distinct);
      tilt[d] = TILT_DB_PER_OCTAVE * Math.log2(Math.sqrt(f0 * f1) / 1000);
    } else {
      f0 = (d / distinct) * MAX_HZ;
      f1 = ((d + 1) / distinct) * MAX_HZ;
    }
    lo[d] = f0 / binHz;
    hi[d] = f1 / binHz;
  }
  const maxBin = Math.min(ANALYSIS_BANDS - 1, Math.ceil(hi[distinct - 1]));
  return {distinct, scale, lo, hi, tilt, maxBin};
}

export function mapSpectrum(db, map, out) {
  const {lo, hi, maxBin} = map;
  for (let d = 0; d < map.distinct; d++) {
    const a = lo[d], b = hi[d];
    if (b - a < 1) {
      const c = (a + b) / 2 - 0.5;
      const i0 = clamp(Math.floor(c), 0, maxBin);
      const i1 = Math.min(i0 + 1, maxBin);
      const t = clamp(c - i0, 0, 1);
      out[d] = db[i0] * (1 - t) + db[i1] * t;
    } else {
      let m = -Infinity;
      const end = Math.min(Math.ceil(b), maxBin + 1);
      for (let i = Math.floor(a); i < end; i++)
        if (db[i] > m) m = db[i];
      out[d] = Number.isFinite(m) ? m : DB_FLOOR;
    }
  }
  return out;
}

export function toTargets(raw, map, gain, targets) {
  for (let d = 0; d < map.distinct; d++)
    targets[d] = clamp((raw[d] + map.tilt[d] + gain - DB_FLOOR) / -DB_FLOOR, 0, 1);
  return targets;
}

export function isAudible(raw, count, thresholdDb) {
  const required = Math.min(count, Math.max(2, Math.ceil(count * 0.05)));
  let active = 0;
  for (let d = 0; d < count; d++)
    if (raw[d] > thresholdDb) active++;
  return count > 0 && active >= required;
}

export class LevelSmoother {
  constructor(count) {
    this.levels = new Float64Array(count);
  }

  reset() {
    this.levels.fill(0);
  }

  update(targets, dt, smoothing, decay) {
    const s = clamp(smoothing, 0, 100) / 100 * 0.9;
    const k = Math.pow(s, dt * 30);
    const fall = FALL_MIN * Math.pow(FALL_MAX / FALL_MIN, clamp(decay, 0, 100) / 100) * dt;
    const lv = this.levels;
    for (let i = 0; i < lv.length; i++) {
      const t = targets[i];
      const v = lv[i];
      lv[i] = t >= v ? t + (v - t) * k : Math.max(t, v - fall);
    }
    return lv;
  }
}

export function mirrorLevels(levels, out) {
  const n = levels.length;
  for (let i = 0; i < n; i++) {
    out[i] = levels[n - 1 - i];
    out[n + i] = levels[i];
  }
  return out;
}

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function ensureVisible(rgb) {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  if (max >= 140) return rgb.map(Math.round);
  const f = max === 0 ? 0 : 140 / max;
  return max === 0 ? [140, 140, 140] : rgb.map(c => Math.round(Math.min(255, c * f)));
}

export function dominantColors(pixels, width, height, rowstride, channels) {
  const BUCKETS = 12;
  const acc = Array.from({length: BUCKETS}, () => ({w: 0, r: 0, g: 0, b: 0}));
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * rowstride + x * channels;
      if (channels === 4 && pixels[o + 3] < 128) continue;
      const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
      sumR += r; sumG += g; sumB += b; count++;
      const [h, s, v] = rgbToHsv(r / 255, g / 255, b / 255);
      const w = s * s * (0.2 + 0.8 * v);
      const bk = acc[Math.floor(h / (360 / BUCKETS)) % BUCKETS];
      bk.w += w; bk.r += r * w; bk.g += g * w; bk.b += b * w;
    }
  }
  if (count === 0) return null;
  const order = acc.map((a, i) => ({a, i})).filter(e => e.a.w > 0).sort((p, q) => q.a.w - p.a.w);
  const total = order.reduce((t, e) => t + e.a.w, 0);
  const avg = e => [e.a.r / e.a.w, e.a.g / e.a.w, e.a.b / e.a.w];
  if (order.length === 0 || total < 0.5) {
    const m = [sumR / count, sumG / count, sumB / count];
    return {c1: ensureVisible(m), c2: ensureVisible(m.map(c => Math.min(255, c * 1.4 + 30)))};
  }
  const first = order[0];
  const c1 = avg(first);
  const far = order.find(e => {
    const dist = Math.min(Math.abs(e.i - first.i), BUCKETS - Math.abs(e.i - first.i));
    return e !== first && dist >= 2 && e.a.w >= first.a.w * 0.15;
  });
  const c2 = far ? avg(far) : c1.map(c => Math.min(255, c * 0.6 + 255 * 0.4));
  return {c1: ensureVisible(c1), c2: ensureVisible(c2)};
}
