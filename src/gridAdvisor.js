// Grid advisor: pure functions, no DOM. Units are whatever the user picked (in / cm / mm).
// Every grid is described as line positions in crop space: 0..1 across, 0..1 up from the bottom-left.

export const UNITS = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4 }; // → inches
const CM_PER = { in: 2.54, cm: 1, mm: 0.1 };

const NICE = {
  in: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12],
  cm: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20],
  mm: [10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 200],
};

// ideal = cells along the LONG side of the drawing; lo/hi = comfortable range.
export const SUBJECTS = {
  figure: { label: 'Figure', ideal: 8, lo: 6, hi: 12, note: 'about a head per cell down a standing figure' },
  portrait: { label: 'Portrait', ideal: 7, lo: 5, hi: 10, note: 'a few cells across the face keeps features locatable' },
  landscape: { label: 'Landscape', ideal: 9, lo: 6, hi: 14, note: 'enough cells to place horizon and big shapes' },
  still: { label: 'Still life', ideal: 6, lo: 4, hi: 9, note: 'few, large cells — objects are simple shapes' },
  architecture: { label: 'Architecture', ideal: 10, lo: 7, hi: 16, note: 'finer cells help you hold straight edges and angles' },
  other: { label: 'Other', ideal: 8, lo: 5, hi: 12, note: 'a middle-of-the-road density' },
};

export function fmt(n) {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function distToInt(x) {
  return Math.abs(x - Math.round(x));
}

function niceness(c, unit) {
  if (unit === 'in') {
    if (distToInt(c * 4) < 1e-6) return 0;
    if (distToInt(c * 8) < 1e-6) return 0.1;
  } else if (unit === 'cm') {
    if (distToInt(c * 2) < 1e-6) return 0;
    if (distToInt(c * 10) < 1e-6) return 0.1;
  } else if (distToInt(c / 5) < 1e-6) return 0;
  return 0.35;
}

function penalty(c, dw, dh, unit, ideal, subj, minShort = 1.5) {
  const cols = dw / c;
  const rows = dh / c;
  const L = Math.max(cols, rows);
  const S = Math.min(cols, rows);
  if (S < minShort) return Infinity;
  let p = 0;
  p += 3.5 * (distToInt(cols) + distToInt(rows));
  const lr = Math.log(L / ideal);
  p += 1.6 * lr * lr;
  if (L < subj.lo * Math.min(1, ideal / subj.ideal)) p += 0.5;
  if (L > subj.hi * Math.max(1, ideal / subj.ideal)) p += 0.5;
  p += niceness(c, unit);
  const cm = c * CM_PER[unit];
  if (cm < 1.5) p += 0.35 * (1.5 / cm - 1);
  if (cm > 8) p += 0.15 * (cm / 8 - 1);
  const total = Math.ceil(cols) * Math.ceil(rows);
  if (total > 100) p += 0.3 * (total / 100);
  return p;
}

function candidates(dw, dh, unit) {
  const set = new Map();
  const add = (c) => {
    if (!(c > 0)) return;
    set.set(Math.round(c * 1000) / 1000, c);
  };
  NICE[unit].forEach(add);
  // cells that divide the long side evenly (e.g. 14 in / 7 = 2 in)
  const long = Math.max(dw, dh);
  for (let n = 2; n <= 20; n++) {
    const c = long / n;
    if (distToInt(c * (unit === 'in' ? 8 : unit === 'cm' ? 10 : 1)) < 1e-6) add(c);
  }
  return [...set.values()];
}

export function squareLines(cell, dw, dh) {
  const v = [];
  const h = [];
  for (let k = 1; k * cell < dw - 1e-6; k++) v.push((k * cell) / dw);
  for (let k = 1; k * cell < dh - 1e-6; k++) h.push((k * cell) / dh);
  // rows are measured from the TOP of the drawing (that's how you measure paper), but stored bottom-up
  return { v: weigh(v), h: weigh(h.map((p) => 1 - p).sort((a, b) => a - b), true) };
}

function weigh(arr, flip) {
  // every 4th line a touch heavier once there are plenty of cells
  const n = arr.length;
  return arr.map((p, i) => {
    const idx = flip ? n - i : i + 1;
    return { p, w: n >= 7 && idx % 4 === 0 ? 2 : 1 };
  });
}

// ---- composition guides -----------------------------------------------------------------------
function armatureSegs(w, h) {
  // diagonals + "reciprocals": perpendiculars dropped from the other corners onto each diagonal
  const segs = [];
  const corners = [[0, 0], [w, 0], [w, h], [0, h]];
  const diags = [[corners[0], corners[2]], [corners[1], corners[3]]];
  const toUv = (pt) => [pt[0] / w, pt[1] / h];
  diags.forEach(([a, b], i) => {
    segs.push([...toUv(a), ...toUv(b)]);
    const others = i === 0 ? [corners[1], corners[3]] : [corners[0], corners[2]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    others.forEach((o) => {
      const t = ((o[0] - a[0]) * dx + (o[1] - a[1]) * dy) / len2;
      const f = [a[0] + t * dx, a[1] + t * dy];
      segs.push([...toUv(o), ...toUv(f)]);
    });
  });
  return segs;
}

const mk = (arr) => arr.map((p) => ({ p, w: 1 }));

export function guideSpec(id, dw, dh) {
  switch (id) {
    case 'thirds':
      return { v: [{ p: 1 / 3, w: 1 }, { p: 2 / 3, w: 1 }], h: [{ p: 1 / 3, w: 1 }, { p: 2 / 3, w: 1 }], segs: [] };
    case 'phi':
      return { v: mk([0.382, 0.618]), h: mk([0.382, 0.618]), segs: [] };
    case 'heads': {
      const h = [];
      for (let k = 1; k < 8; k++) h.push({ p: k / 8, w: k === 4 ? 2 : 1 });
      return { v: [{ p: 0.5, w: 1 }], h, segs: [] };
    }
    case 'armature':
      return { v: [], h: [], segs: armatureSegs(dw, dh) };
    case 'center':
      return { v: [{ p: 0.5, w: 1 }], h: [{ p: 0.5, w: 1 }], segs: [[0, 0, 1, 1], [0, 1, 1, 0]] };
    default:
      return { v: [], h: [], segs: [] };
  }
}

export const GUIDES = {
  thirds: { label: 'Thirds', blurb: 'Put the focal point or horizon on a line or crossing.' },
  phi: { label: 'Golden ratio', blurb: 'Subtler than thirds — lines sit a bit closer to center.' },
  heads: { label: 'Eight heads', blurb: 'Standing figure ≈ 8 heads tall. Fit head-to-feet to the crop; the heavy line is the hips.' },
  armature: { label: 'Armature', blurb: 'Diagonals + reciprocals. Strong shapes land where lines cross.' },
  center: { label: 'Center + diagonals', blurb: 'Quick placement and perspective checks.' },
};

const GUIDE_ORDER = {
  figure: ['heads', 'armature', 'center', 'thirds', 'phi'],
  portrait: ['thirds', 'phi', 'center', 'armature', 'heads'],
  landscape: ['thirds', 'phi', 'armature', 'center', 'heads'],
  still: ['thirds', 'armature', 'phi', 'center', 'heads'],
  architecture: ['center', 'thirds', 'armature', 'phi', 'heads'],
  other: ['thirds', 'phi', 'armature', 'center', 'heads'],
};

// ---- main entry --------------------------------------------------------------------------------
export function advise({ dw, dh, unit, subject }) {
  const subj = SUBJECTS[subject] || SUBJECTS.other;
  const cands = candidates(dw, dh, unit);
  const pick = (ideal, exclude = new Set(), minShort = 1.5, minCell = 0) => {
    let best = null;
    for (const c of cands) {
      const key = Math.round(c * 1000);
      if (exclude.has(key) || c < minCell) continue;
      const p = penalty(c, dw, dh, unit, ideal, subj, minShort);
      if (!best || p < best.p) best = { c, p };
    }
    return best;
  };
  const used = new Set();
  const main = pick(subj.ideal);
  if (main) used.add(Math.round(main.c * 1000));
  const loose = pick(subj.ideal * 0.6, used);
  if (loose) used.add(Math.round(loose.c * 1000));
  const fine = pick(subj.ideal * 1.6, used);
  const loosest = pick(subj.ideal * 0.3, used, 1.0, loose ? loose.c * 1.4 : 0);

  const describe = (r, role) => {
    if (!r) return null;
    const c = r.c;
    const cols = dw / c;
    const rows = dh / c;
    const exactX = distToInt(cols) < 0.02;
    const exactY = distToInt(rows) < 0.02;
    const nx = Math.ceil(cols - 0.02);
    const ny = Math.ceil(rows - 0.02);
    const why = [];
    if (exactX && exactY) why.push(`Divides your ${fmt(dw)} × ${fmt(dh)} ${unit} drawing area exactly — no partial cells.`);
    else {
      const bits = [];
      if (!exactX) bits.push(`last column is ${fmt(dw - (nx - 1) * c)} ${unit} wide`);
      if (!exactY) bits.push(`last row is ${fmt(dh - (ny - 1) * c)} ${unit} tall`);
      why.push(`Not a perfect fit — the ${bits.join(' and the ')}. Measure from the top-left corner.`);
    }
    const L = Math.max(cols, rows);
    if (role === 'best') why.push(`${Math.round(L * 10) / 10} cells along the long side — ${subj.note}.`);
    if (role === 'loose') why.push('Fewer cells: good for gesture, block-in and big shapes.');
    if (role === 'loosest') why.push('Very few cells: just placement and the biggest shapes — ideal for a loose start.');
    if (role === 'fine') why.push('More cells: good for tight rendering and small details.');
    const cm = c * CM_PER[unit];
    if (cm < 1.5) why.push('Cells are small — fiddly to draw on paper.');
    return {
      id: `sq-${Math.round(c * 1000)}`,
      role,
      cell: c,
      cols: nx,
      rows: ny,
      exact: exactX && exactY,
      title: `${fmt(c)} ${unit} squares`,
      grid: `${nx} × ${ny} cells`,
      mark: `Mark your paper every ${fmt(c)} ${unit}.`,
      why,
      lines: squareLines(c, dw, dh),
    };
  };

  const order = GUIDE_ORDER[subject] || GUIDE_ORDER.other;
  const guides = order.map((id, i) => ({ id, ...GUIDES[id], recommended: i === 0, lines: guideSpec(id, dw, dh) }));

  return {
    best: describe(main, 'best'),
    loosest: describe(loosest, 'loosest'),
    loose: describe(loose, 'loose'),
    fine: describe(fine, 'fine'),
    guides,
    subjectLabel: subj.label,
  };
}

// Step the transfer grid one notch looser (dir > 0, bigger cells) or finer (dir < 0).
export function stepCell(cell, dir, dw, dh, unit) {
  const cands = candidates(dw, dh, unit).filter((c) => Math.min(dw, dh) / c >= 1.2).sort((x, y) => x - y);
  if (dir > 0) return cands.find((c) => c > cell * 1.02) ?? cell;
  return [...cands].reverse().find((c) => c < cell / 1.02) ?? cell;
}
