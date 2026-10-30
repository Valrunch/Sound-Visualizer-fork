import Cairo from 'gi://cairo';

const GLOW_LAYERS = [
  {widthFactor: 4, opacity: 0.08},
  {widthFactor: 2.5, opacity: 0.16},
  {widthFactor: 1.25, opacity: 0.3},
];

function setPaint(cr, c1, c2, h) {
  if (c2) {
    const gradient = new Cairo.LinearGradient(0, h, 0, 0);
    gradient.addColorStopRGBA(0, c1.red, c1.green, c1.blue, c1.alpha);
    gradient.addColorStopRGBA(1, c2.red, c2.green, c2.blue, c2.alpha);
    cr.setSource(gradient);
  } else {
    cr.setSourceRGBA(c1.red, c1.green, c1.blue, c1.alpha);
  }
}

const level = (bars, i) => {
  const v = bars[Math.max(0, Math.min(bars.length - 1, i))];
  return v > 0 ? (v < 1 ? v : 1) : 0;
};

function barsPath(cr, bars, w, h) {
  const n = bars.length;
  const step = w / n;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * step;
    cr.moveTo(x, h);
    cr.lineTo(x, h * (1 - level(bars, i)));
  }
}

function curvePath(cr, bars, w, h, closeToBaseline) {
  const n = bars.length;
  const y = i => h * (1 - level(bars, i));
  if (closeToBaseline)
    cr.moveTo(0, h);
  if (n === 1) {
    closeToBaseline ? cr.lineTo(w / 2, y(0)) : cr.moveTo(w / 2, y(0));
  } else {
    const xStep = w / (n - 1);
    closeToBaseline ? cr.lineTo(0, y(0)) : cr.moveTo(0, y(0));
    for (let i = 0; i < n - 1; i++) {
      const prevY = y(i - 1), curY = y(i), nextY = y(i + 1), follY = y(i + 2);
      const curX = i * xStep, nextX = (i + 1) * xStep;
      const c1Y = curY + (nextY - prevY) / 6;
      const c2Y = nextY - (follY - curY) / 6;
      cr.curveTo(
        curX + (nextX - curX) / 3, Math.max(0, Math.min(h, c1Y)),
        curX + 2 * (nextX - curX) / 3, Math.max(0, Math.min(h, c2Y)),
        nextX, nextY
      );
    }
  }
  if (closeToBaseline)
    cr.lineTo(w, h);
}

export function drawVisualizer(cr, width, height, bars, o) {
  const n = bars.length;
  cr.save();
  try {
    let w = width;
    let h = height;
    switch (o.orientation) {
      case 'top':
        cr.translate(0, height);
        cr.scale(1, -1);
        break;
      case 'left':
        cr.translate(width, 0);
        cr.rotate(Math.PI / 2);
        w = height;
        h = width;
        break;
      case 'right':
        cr.rotate(-Math.PI / 2);
        cr.scale(-1, 1);
        w = height;
        h = width;
        break;
      default:
        break;
    }
    if (n === 0 || w <= 0 || h <= 0)
      return;

    const pad = o.glow ? o.lineWidth * 2 : 0;
    cr.translate(pad, pad);
    w = Math.max(1, w - 2 * pad);
    h = Math.max(1, h - pad);

    const area = o.style === 'area';
    const lineW = o.style === 'bars' ? Math.min(o.lineWidth, w / n) : o.lineWidth;
    cr.setLineWidth(lineW);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);

    if (o.style === 'bars')
      barsPath(cr, bars, w, h);
    else
      curvePath(cr, bars, w, h, area);

    if (o.glow) {
      const path = cr.copyPath();
      for (const layer of GLOW_LAYERS) {
        cr.appendPath(path);
        cr.setLineWidth(lineW * layer.widthFactor);
        cr.setSourceRGBA(o.glow.red, o.glow.green, o.glow.blue, o.glow.alpha * layer.opacity);
        cr.stroke();
      }
      cr.appendPath(path);
    }

    cr.setLineWidth(lineW);
    setPaint(cr, o.color, o.color2, h);
    area ? cr.fill() : cr.stroke();
  } finally {
    cr.restore();
  }
}
