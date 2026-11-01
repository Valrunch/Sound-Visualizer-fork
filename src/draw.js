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

const LINE_HIT_MIN_PX = 8;

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

function segmentControls(y, i, h) {
  const prevY = y(i - 1), curY = y(i), nextY = y(i + 1), follY = y(i + 2);
  return [
    Math.max(0, Math.min(h, curY + (nextY - prevY) / 6)),
    Math.max(0, Math.min(h, nextY - (follY - curY) / 6)),
  ];
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
      const nextY = y(i + 1);
      const [c1Y, c2Y] = segmentControls(y, i, h);
      const curX = i * xStep, nextX = (i + 1) * xStep;
      cr.curveTo(
        curX + (nextX - curX) / 3, c1Y,
        curX + 2 * (nextX - curX) / 3, c2Y,
        nextX, nextY
      );
    }
  }
  if (closeToBaseline)
    cr.lineTo(w, h);
}

const isRotated = o => o.orientation === 'left' || o.orientation === 'right';

function plotArea(width, height, n, o) {
  const pad = o.glow ? o.lineWidth * 2 : 0;
  const w = Math.max(1, (isRotated(o) ? height : width) - 2 * pad);
  const h = Math.max(1, (isRotated(o) ? width : height) - pad);
  const lineW = o.style === 'bars' ? Math.min(o.lineWidth, w / n) : o.lineWidth;
  return {pad, w, h, lineW};
}

export function hitBoxes(width, height, bars, o, visit) {
  const n = bars.length;
  if (n === 0 || width <= 0 || height <= 0)
    return;

  const {pad, w, h, lineW} = plotArea(width, height, n, o);
  const emit = (x1, y1, x2, y2) => {
    x1 += pad;
    x2 += pad;
    y1 += pad;
    y2 += pad;
    let bx1, by1, bx2, by2;
    switch (o.orientation) {
      case 'top':
        [bx1, by1, bx2, by2] = [x1, height - y2, x2, height - y1];
        break;
      case 'left':
        [bx1, by1, bx2, by2] = [width - y2, x1, width - y1, x2];
        break;
      case 'right':
        [bx1, by1, bx2, by2] = [y1, x1, y2, x2];
        break;
      default:
        [bx1, by1, bx2, by2] = [x1, y1, x2, y2];
        break;
    }
    bx1 = Math.max(0, bx1);
    by1 = Math.max(0, by1);
    bx2 = Math.min(width, bx2);
    by2 = Math.min(height, by2);
    if (bx1 < bx2 && by1 < by2)
      visit(bx1, by1, bx2, by2);
  };
  const y = i => h * (1 - level(bars, i));

  if (o.style === 'bars') {
    const step = w / n;
    for (let i = 0; i < n; i++)
      emit(i * step, y(i) - lineW / 2, (i + 1) * step, h + lineW / 2);
  } else if (n === 1) {
    emit(0, y(0) - lineW / 2, w, o.style === 'area' ? h : y(0) + lineW / 2);
  } else {
    const xStep = w / (n - 1);
    const thickness = Math.max(lineW, LINE_HIT_MIN_PX);
    for (let i = 0; i < n - 1; i++) {
      const [c1Y, c2Y] = segmentControls(y, i, h);
      const top = Math.min(y(i), y(i + 1), c1Y, c2Y);
      if (o.style === 'area') {
        emit(i * xStep, top, (i + 1) * xStep, h);
      } else {
        const bottom = Math.max(y(i), y(i + 1), c1Y, c2Y);
        emit(i * xStep - lineW / 2, top - thickness / 2, (i + 1) * xStep + lineW / 2, bottom + thickness / 2);
      }
    }
  }
}

export function drawVisualizer(cr, width, height, bars, o) {
  const n = bars.length;
  cr.save();
  try {
    switch (o.orientation) {
      case 'top':
        cr.translate(0, height);
        cr.scale(1, -1);
        break;
      case 'left':
        cr.translate(width, 0);
        cr.rotate(Math.PI / 2);
        break;
      case 'right':
        cr.rotate(-Math.PI / 2);
        cr.scale(-1, 1);
        break;
      default:
        break;
    }
    if (n === 0 || width <= 0 || height <= 0)
      return;

    const {pad, w, h, lineW} = plotArea(width, height, n, o);
    cr.translate(pad, pad);

    const area = o.style === 'area';
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
