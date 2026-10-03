import {
  WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, Mesh, ShaderMaterial, Texture, Color,
  LinearMipmapLinearFilter, LinearFilter, DoubleSide, Vector4,
} from 'three';
import { advise, SUBJECTS, GUIDES, guideSpec, squareLines, fmt, UNITS } from './gridAdvisor.js';
import { VERT, FRAG } from './shader.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const coarse = matchMedia('(pointer:coarse)').matches;

// ======================================================================= state
const PRESETS = [
  ['Custom', null],
  ['Letter · 8.5 × 11 in', [8.5, 11, 'in']],
  ['Tabloid · 11 × 17 in', [11, 17, 'in']],
  ['8 × 10 in', [8, 10, 'in']],
  ['9 × 12 in', [9, 12, 'in']],
  ['11 × 14 in', [11, 14, 'in']],
  ['12 × 12 in', [12, 12, 'in']],
  ['12 × 16 in', [12, 16, 'in']],
  ['12 × 18 in', [12, 18, 'in']],
  ['16 × 20 in', [16, 20, 'in']],
  ['18 × 24 in', [18, 24, 'in']],
  ['24 × 36 in', [24, 36, 'in']],
  ['A5 · 148 × 210 mm', [148, 210, 'mm']],
  ['A4 · 210 × 297 mm', [210, 297, 'mm']],
  ['A3 · 297 × 420 mm', [297, 420, 'mm']],
  ['A2 · 420 × 594 mm', [420, 594, 'mm']],
];
const TIMES = [[0, 'No timer'], [15, '15 s'], [30, '30 s'], [45, '45 s'], [60, '1 min'], [120, '2 min'], [300, '5 min'],
  [600, '10 min'], [1200, '20 min'], [1800, '30 min'], [3600, '60 min']];
const LOOK0 = { mirror: false, gray: false, values: false, levels: 4, bias: 0, blur: 0, contrast: 1, bright: 0 };

const S = {
  paper: { w: 8, h: 10 }, unit: 'in', margin: 0, orient: 'auto', preset: 3,
  subject: 'figure', follow: true, gridSel: { type: 'square', cell: 1 }, guide: 'none', labels: false, gridOp: 0.8,
  dur: 120, shuffle: false, burn: false,
};
const look = { ...LOOK0 };
try { Object.assign(S, JSON.parse(localStorage.getItem('refsession.v1') || '{}')); } catch (e) { /* ignore */ }

const Q = { items: [], i: 0 };
let cur = null; // {item, tex, w, h, ow, oh, crop:{cx,cy,z}}
let A = { dw: 8, dh: 10, ratio: 0.8, orient: 'portrait' };
let adv = null;
let LA = { v: [], h: [] };
let LB = { v: [], h: [], segs: [] };
let editing = false;
let userView = false;
const V = { x: 0, y: 0, s: 1 };
const T = { left: 0, running: true };

// ======================================================================= three
const canvas = $('gl');
const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power', alpha: false });
renderer.setClearColor(new Color(0x2e2e2e));
const scene = new Scene();
const cam = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
const uniforms = {
  uMap: { value: null }, uCrop: { value: new Vector4() }, uOutside: { value: 1 }, uEdit: { value: 0 },
  uGray: { value: 0 }, uLevels: { value: 0 }, uBias: { value: 0 }, uBlur: { value: 0 }, uContrast: { value: 1 }, uBright: { value: 0 },
  uLineW: { value: 1.2 }, uOpA: { value: 0.8 }, uOpB: { value: 0.8 },
  uColA: { value: [1, 1, 1] }, uColB: { value: [1, 0.706, 0.329] },
  uAnv: { value: 0 }, uAnh: { value: 0 }, uBnv: { value: 0 }, uBnh: { value: 0 }, uBns: { value: 0 },
  uAv: { value: new Float32Array(48) }, uAh: { value: new Float32Array(48) },
  uBv: { value: new Float32Array(16) }, uBh: { value: new Float32Array(16) },
  uBs: { value: Array.from({ length: 8 }, () => new Vector4()) },
};
const mat = new ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, side: DoubleSide, depthTest: false });
const mesh = new Mesh(new PlaneGeometry(1, 1), mat);
mesh.visible = false;
scene.add(mesh);

let vw = 1, vh = 1;
function resize() {
  const r = $('stage').getBoundingClientRect();
  vw = Math.max(1, r.width); vh = Math.max(1, r.height);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(vw, vh, false);
  uniforms.uLineW.value = 1.25 * Math.min(devicePixelRatio || 1, 2);
  if (!userView) fitView();
  invalidate();
}
new ResizeObserver(resize).observe($('stage'));

let dirty = false;
function invalidate() { if (!dirty) { dirty = true; requestAnimationFrame(render); } }
const mirrored = () => look.mirror && !editing;
const m = () => (mirrored() ? -1 : 1);

function render() {
  dirty = false;
  const hw = vw / (2 * V.s), hh = vh / (2 * V.s);
  cam.left = V.x - m() * hw; cam.right = V.x + m() * hw;
  cam.top = V.y + hh; cam.bottom = V.y - hh;
  cam.updateProjectionMatrix();
  if (cur) {
    const R = cropRect();
    uniforms.uCrop.value.set(R.minX, R.minY, R.maxX, R.maxY);
    uniforms.uOutside.value = editing ? 0.7 : 1;
    uniforms.uEdit.value = editing ? 1 : 0;
    uniforms.uGray.value = look.gray || look.values ? 1 : 0;
    uniforms.uLevels.value = look.values ? look.levels : 0;
    uniforms.uBias.value = look.bias; uniforms.uBlur.value = look.blur;
    uniforms.uContrast.value = look.contrast; uniforms.uBright.value = look.bright;
    uniforms.uOpA.value = S.gridOp; uniforms.uOpB.value = S.gridOp;
  }
  renderer.render(scene, cam);
  drawOverlay();
}

const worldToScreen = (wx, wy) => [(wx - V.x) * V.s * m() + vw / 2, vh / 2 - (wy - V.y) * V.s];
const screenToWorld = (px, py) => [V.x + (px - vw / 2) / (V.s * m()), V.y - (py - vh / 2) / V.s];

function fitView() {
  if (!cur) return;
  const R = cropRect();
  const rw = editing ? cur.w : R.maxX - R.minX;
  const rh = editing ? cur.h : R.maxY - R.minY;
  V.s = Math.min(vw / rw, vh / rh) * (editing ? 0.92 : 0.94);
  V.x = editing ? 0 : (R.minX + R.maxX) / 2;
  V.y = editing ? 0 : (R.minY + R.maxY) / 2;
  userView = false;
}
function zoomAt(px, py, ns) {
  const [wx, wy] = screenToWorld(px, py);
  const base = cur ? Math.min(vw / (cur.w), vh / (cur.h)) : 1;
  V.s = clamp(ns, base * 0.15, base * 60);
  V.x = wx - (px - vw / 2) / (V.s * m());
  V.y = wy + (py - vh / 2) / V.s;
  userView = true;
  invalidate();
}

// ======================================================================= canvas / crop math
function convertUnit(from, to, v) { return v * UNITS[from] / UNITS[to]; }

function area() {
  let w = S.paper.w - 2 * S.margin;
  let h = S.paper.h - 2 * S.margin;
  w = Math.max(w, 0.1); h = Math.max(h, 0.1);
  let o = S.orient;
  if (o === 'auto') o = cur ? (cur.w >= cur.h ? 'landscape' : 'portrait') : (w >= h ? 'landscape' : 'portrait');
  const long = Math.max(w, h), short = Math.min(w, h);
  if (o === 'landscape') { w = long; h = short; } else { w = short; h = long; }
  return { dw: w, dh: h, ratio: w / h, orient: Math.abs(w - h) < 1e-9 ? 'square' : o };
}

function maxCrop() {
  const W = cur.w, H = cur.h;
  return W / H > A.ratio ? { mw: H * A.ratio, mh: H } : { mw: W, mh: W / A.ratio };
}
function cropRect() {
  const W = cur.w, H = cur.h;
  const { mw, mh } = maxCrop();
  const z = cur.crop.z;
  const cw = mw / z, ch = mh / z;
  const cx = clamp(cur.crop.cx * W, cw / 2, W - cw / 2);
  const cy = clamp(cur.crop.cy * H, ch / 2, H - ch / 2);
  return { cw, ch, cx, cy, mw, mh, minX: cx - cw / 2 - W / 2, maxX: cx + cw / 2 - W / 2, minY: H / 2 - (cy + ch / 2), maxY: H / 2 - (cy - ch / 2) };
}
function setCropCenterWorld(wx, wy) {
  const R = cropRect();
  const cx = clamp(wx + cur.w / 2, R.cw / 2, cur.w - R.cw / 2);
  const cy = clamp(cur.h / 2 - wy, R.ch / 2, cur.h - R.ch / 2);
  cur.crop.cx = cx / cur.w; cur.crop.cy = cy / cur.h;
}
function setZoom(z) {
  const R = cropRect();
  cur.crop.cx = R.cx / cur.w; cur.crop.cy = R.cy / cur.h;
  cur.crop.z = clamp(z, 1, 8);
  const R2 = cropRect();
  cur.crop.cx = R2.cx / cur.w; cur.crop.cy = R2.cy / cur.h;
}

// ======================================================================= persistence
let saveT = 0;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      localStorage.setItem('refsession.v1', JSON.stringify({
        paper: S.paper, unit: S.unit, margin: S.margin, orient: S.orient, preset: S.preset, subject: S.subject, follow: S.follow,
        gridSel: S.gridSel, guide: S.guide, labels: S.labels, gridOp: S.gridOp, dur: S.dur, shuffle: S.shuffle, burn: S.burn,
      }));
    } catch (e) { /* storage blocked */ }
  }, 250);
}
let cropStore = {};
try { cropStore = JSON.parse(localStorage.getItem('refsession.crops') || '{}'); } catch (e) { /* ignore */ }
let cropSaveT = 0;
function saveCrop() {
  if (!cur) return;
  cropStore[cur.item.key] = [cur.crop.cx, cur.crop.cy, cur.crop.z];
  clearTimeout(cropSaveT);
  cropSaveT = setTimeout(() => {
    const keys = Object.keys(cropStore);
    if (keys.length > 600) keys.slice(0, keys.length - 600).forEach((k) => delete cropStore[k]);
    try { localStorage.setItem('refsession.crops', JSON.stringify(cropStore)); } catch (e) { /* ignore */ }
  }, 300);
}

// ======================================================================= grid lines → uniforms
function pack(list, arr) {
  arr.fill(0);
  const n = Math.min(list.length, arr.length);
  for (let i = 0; i < n; i++) arr[i] = list[i].p + (list[i].w - 1) * 10;
  return n;
}
function buildLines() {
  LA = S.gridSel.type === 'square' ? squareLines(S.gridSel.cell, A.dw, A.dh) : { v: [], h: [] };
  LB = S.guide !== 'none' ? guideSpec(S.guide, A.dw, A.dh) : { v: [], h: [], segs: [] };
  uniforms.uAnv.value = pack(LA.v, uniforms.uAv.value);
  uniforms.uAnh.value = pack(LA.h, uniforms.uAh.value);
  uniforms.uBnv.value = pack(LB.v, uniforms.uBv.value);
  uniforms.uBnh.value = pack(LB.h, uniforms.uBh.value);
  const ns = Math.min(LB.segs.length, 8);
  for (let i = 0; i < 8; i++) {
    if (i < ns) uniforms.uBs.value[i].set(...LB.segs[i]); else uniforms.uBs.value[i].set(0, 0, 0, 0);
  }
  uniforms.uBns.value = ns;
}

// ======================================================================= overlay (labels, handles)
const overlay = $('overlay');
const handles = [0, 1, 2, 3].map(() => {
  const d = document.createElement('div'); d.className = 'handle'; d.style.display = 'none'; overlay.appendChild(d); return d;
});
const lblLayer = document.createElement('div');
overlay.appendChild(lblLayer);
const COLS = (n) => { let s = ''; n++; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function drawOverlay() {
  if (!cur) { handles.forEach((h) => (h.style.display = 'none')); lblLayer.innerHTML = ''; return; }
  const R = cropRect();
  const corners = [[R.minX, R.maxY], [R.maxX, R.maxY], [R.maxX, R.minY], [R.minX, R.minY]];
  handles.forEach((h, i) => {
    if (!editing) { h.style.display = 'none'; return; }
    const [sx, sy] = worldToScreen(...corners[i]);
    h.style.display = 'block'; h.style.left = sx + 'px'; h.style.top = sy + 'px';
  });
  let html = '';
  if (S.labels && S.gridSel.type === 'square' && !editing) {
    const c = S.gridSel.cell;
    const nx = Math.ceil(A.dw / c - 0.02), ny = Math.ceil(A.dh / c - 0.02);
    const cwW = R.maxX - R.minX, chW = R.maxY - R.minY;
    const [tlx, tly] = worldToScreen(mirrored() ? R.maxX : R.minX, R.maxY);
    const [brx] = worldToScreen(mirrored() ? R.minX : R.maxX, R.minY);
    const sw = Math.abs(brx - tlx);
    const pxPerCellX = (c / A.dw) * sw;
    const step = pxPerCellX < 22 ? 2 : 1;
    for (let j = 0; j < nx; j += step) {
      const frac = Math.min(((j + 0.5) * c) / A.dw, (j * c + A.dw) / 2 / A.dw);
      const sx = tlx + frac * sw;
      html += `<div class="lbl" style="left:${sx}px;top:${tly + 13}px">${COLS(j)}</div>`;
    }
    const sh = (R.maxY - R.minY) * V.s;
    const pxPerCellY = (c / A.dh) * sh;
    const stepY = pxPerCellY < 22 ? 2 : 1;
    for (let k = 0; k < ny; k += stepY) {
      const frac = Math.min(((k + 0.5) * c) / A.dh, (k * c + A.dh) / 2 / A.dh);
      const sy = tly + frac * sh;
      html += `<div class="lbl" style="left:${tlx + 14}px;top:${sy}px">${k + 1}</div>`;
    }
    void cwW; void chW;
  }
  lblLayer.innerHTML = html;
}

// ======================================================================= files
const IMG_RE = /\.(jpe?g|png|webp|gif|avif|heic|heif|bmp|tiff?)$/i;
const isImage = (f) => (f.type && f.type.startsWith('image/')) || IMG_RE.test(f.name);

async function readEntry(entry, out) {
  if (entry.isFile) {
    await new Promise((res) => entry.file((f) => { f._rel = entry.fullPath; out.push(f); res(); }, res));
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
      if (!batch.length) break;
      for (const e of batch) await readEntry(e, out);
    }
  }
}
async function filesFromDrop(dt) {
  const out = [];
  const items = dt.items ? [...dt.items] : [];
  const entries = items.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (entries.some(Boolean)) { for (const e of entries) if (e) await readEntry(e, out); return out; }
  return [...dt.files];
}
const natural = (a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true, sensitivity: 'base' });

function addFiles(files) {
  const had = Q.items.length;
  const known = new Set(Q.items.map((i) => i.key));
  const fresh = [];
  for (const f of files) {
    if (!isImage(f)) continue;
    const key = `${f.name}|${f.size}|${f.lastModified}`;
    if (known.has(key)) continue;
    known.add(key);
    fresh.push({ file: f, name: f.name, key, sortKey: f._rel || f.webkitRelativePath || f.name });
  }
  if (!fresh.length) { toast('No new images found'); return; }
  if (S.shuffle) { Q.items.push(...fresh); shuffleRest(had); } else { Q.items.push(...fresh); Q.items.sort(natural); }
  toast(`${fresh.length} photo${fresh.length > 1 ? 's' : ''} added`);
  $('drop').classList.add('hidden');
  if (!had) { Q.i = 0; show(0); } else { Q.i = Q.items.findIndex((i) => i === cur?.item); updateCount(); }
  if (!had && matchMedia('(max-width:820px)').matches) setPanel(false);
}
function shuffleRest(from) {
  const a = Q.items;
  for (let i = a.length - 1; i > from; i--) { const j = from + Math.floor(Math.random() * (i - from + 1)); [a[i], a[j]] = [a[j], a[i]]; }
}
function applyShuffle() {
  const keep = cur ? cur.item : null;
  if (S.shuffle) {
    const rest = Q.items.filter((i) => i !== keep);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    Q.items = keep ? [keep, ...rest] : rest;
    Q.i = 0;
  } else {
    Q.items.sort(natural);
    Q.i = keep ? Q.items.indexOf(keep) : 0;
  }
  updateCount();
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file); } catch (e) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      return await createImageBitmap(img);
    } finally { URL.revokeObjectURL(url); }
  }
}

let loadToken = 0;
async function show(i) {
  const n = Q.items.length;
  if (!n) return;
  Q.i = ((i % n) + n) % n;
  const token = ++loadToken;
  const item = Q.items[Q.i];
  let bmp;
  try { bmp = await loadBitmap(item.file); } catch (e) { toast(`Can't open ${item.name}`); if (n > 1) { Q.items.splice(Q.i, 1); show(Q.i); } return; }
  if (token !== loadToken) { bmp.close && bmp.close(); return; }
  const ow = bmp.width, oh = bmp.height;
  const cap = coarse ? 6144 : Math.min(8192, renderer.capabilities.maxTextureSize);
  let src = bmp, w = ow, h = oh;
  if (Math.max(ow, oh) > cap) {
    const k = cap / Math.max(ow, oh);
    w = Math.round(ow * k); h = Math.round(oh * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    src = c;
  }
  const tex = new Texture(src);
  tex.flipY = false; tex.generateMipmaps = true; tex.minFilter = LinearMipmapLinearFilter; tex.magFilter = LinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  if (cur) { cur.tex.dispose(); }
  const saved = cropStore[item.key];
  cur = { item, tex, w, h, ow, oh, crop: saved ? { cx: saved[0], cy: saved[1], z: saved[2] } : { cx: 0.5, cy: 0.5, z: 1 } };
  uniforms.uMap.value = tex;
  mesh.scale.set(w, h, 1);
  mesh.visible = true;
  T.left = S.dur;
  refresh({ fit: true });
  updateCount();
  requestWake();
}
const next = (d = 1) => show(Q.i + d);

// ======================================================================= refresh / UI render
function refresh({ fit = false, grid = true } = {}) {
  A = area();
  if (grid) {
    adv = advise({ dw: A.dw, dh: A.dh, unit: S.unit, subject: S.subject });
    if (S.follow && adv.best) S.gridSel = { type: 'square', cell: adv.best.cell };
    buildLines();
    renderGridUI();
  }
  renderCanvasInfo();
  renderCropInfo();
  if (fit) fitView();
  invalidate();
  save();
}

function ratioStr(r) {
  for (let d = 1; d <= 12; d++) { const n = Math.round(r * d); if (n && Math.abs(n / d - r) / r < 0.012) return `${n}:${d}`; }
  return `${r.toFixed(2)}:1`;
}
function renderCanvasInfo() {
  const sq = A.orient === 'square' ? 'square' : A.orient;
  $('areaInfo').innerHTML = `Drawing area <b>${fmt(A.dw)} × ${fmt(A.dh)} ${S.unit}</b> · ${sq} · ratio ${ratioStr(A.ratio)}`
    + (S.orient === 'auto' && cur ? '<br><span class="x">Direction follows each photo.</span>' : '');
  $('marginU').textContent = S.unit; $('cellU').textContent = S.unit;
}
function renderCropInfo() {
  const el = $('cropInfo');
  const hud = [];
  if (!cur) { el.textContent = 'Drop a photo to begin.'; $('hud').innerHTML = ''; return; }
  const R = cropRect();
  const px = Math.round((R.cw / cur.w) * cur.ow), py = Math.round((R.ch / cur.h) * cur.oh);
  const inches = A.dw * UNITS[S.unit];
  const ppi = px / inches;
  let q = '<span class="ok">sharp at this size</span>';
  if (ppi < 70) q = '<span class="bad">very soft at this size — fine for a ref on screen only</span>';
  else if (ppi < 140) q = '<span class="warn">okay on screen, soft if you print it</span>';
  else if (ppi < 220) q = '<span class="ok">good for print</span>';
  const used = Math.round(((R.cw * R.ch) / (cur.w * cur.h)) * 100);
  el.innerHTML = `<b>${px} × ${py} px</b> · ${Math.round(ppi)} ppi at ${fmt(A.dw)} × ${fmt(A.dh)} ${S.unit}<br>${q}<br>Using ${used}% of the photo (${cur.ow} × ${cur.oh}).`;
  $('cropZoom').value = cur.crop.z;
  hud.push(cur.item.name);
  if (S.gridSel.type === 'square') hud.push(`${fmt(S.gridSel.cell)} ${S.unit} grid`);
  if (S.guide !== 'none') hud.push(GUIDES[S.guide].label);
  $('hud').innerHTML = hud.map((t) => `<span>${t.replace(/</g, '&lt;')}</span>`).join('');
}

function miniSvg(lines, ratio, colA, big) {
  const W = 100, H = big ? 56 : 34;
  let rw = W - 8, rh = rw / ratio;
  if (rh > H - 6) { rh = H - 6; rw = rh * ratio; }
  const x0 = (W - rw) / 2, y0 = (H - rh) / 2;
  let s = `<svg viewBox="0 0 ${W} ${H}"><rect x="${x0}" y="${y0}" width="${rw}" height="${rh}" fill="rgba(255,255,255,.07)" stroke="rgba(255,255,255,.35)" stroke-width="1"/>`;
  const sw = (w) => (w > 1 ? 1.5 : 0.8);
  (lines.v || []).forEach((l) => { const x = x0 + l.p * rw; s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + rh}" stroke="${colA}" stroke-width="${sw(l.w)}"/>`; });
  (lines.h || []).forEach((l) => { const y = y0 + (1 - l.p) * rh; s += `<line x1="${x0}" y1="${y}" x2="${x0 + rw}" y2="${y}" stroke="${colA}" stroke-width="${sw(l.w)}"/>`; });
  (lines.segs || []).forEach((g) => { s += `<line x1="${x0 + g[0] * rw}" y1="${y0 + (1 - g[1]) * rh}" x2="${x0 + g[2] * rw}" y2="${y0 + (1 - g[3]) * rh}" stroke="${colA}" stroke-width=".8"/>`; });
  return s + '</svg>';
}

function renderGridUI() {
  // subject chips
  $('subjects').innerHTML = Object.entries(SUBJECTS).map(([k, v]) => `<button class="chip ${S.subject === k ? 'on' : ''}" data-k="${k}">${v.label}</button>`).join('');
  // transfer cards
  const order = [adv.loose, adv.best, adv.fine].filter(Boolean);
  const labels = { loose: 'Looser', best: 'Best fit', fine: 'Finer' };
  $('cards').innerHTML = order.map((c) => {
    const on = S.gridSel.type === 'square' && Math.abs(S.gridSel.cell - c.cell) < 1e-6;
    return `<div class="card ${on ? 'on' : ''}" data-cell="${c.cell}" data-role="${c.role}">${c.role === 'best' ? '<span class="badge">RECOMMENDED</span>' : ''}`
      + miniSvg(c.lines, A.ratio, '#fff', true) + `<div class="t">${fmt(c.cell)} ${S.unit}</div><div class="g">${c.cols} × ${c.rows} · ${labels[c.role]}</div></div>`;
  }).join('');
  // advice text
  const sel = order.find((c) => S.gridSel.type === 'square' && Math.abs(S.gridSel.cell - c.cell) < 1e-6);
  let html;
  if (S.gridSel.type !== 'square') html = '<span class="x">No transfer grid.</span>';
  else if (sel) html = `<div class="mark">${sel.mark} <span class="x">(${sel.grid})</span></div><ul>${sel.why.map((w) => `<li>${w}</li>`).join('')}</ul>`;
  else {
    const c = S.gridSel.cell;
    html = `<div class="mark">Mark your paper every ${fmt(c)} ${S.unit}. <span class="x">(${Math.ceil(A.dw / c - 0.02)} × ${Math.ceil(A.dh / c - 0.02)} cells)</span></div>`
      + `<ul><li>Custom cell size — compare against the cards above.</li></ul>`;
  }
  $('advice').innerHTML = html;
  // guides
  $('guides').innerHTML = adv.guides.map((g) => `<div class="card ${S.guide === g.id ? 'on' : ''}" data-g="${g.id}">${g.recommended ? '<span class="badge">★</span>' : ''}${miniSvg(g.lines, A.ratio, '#ffb454', false)}<div class="t">${g.label}</div></div>`).join('');
  $('guideInfo').textContent = S.guide !== 'none' ? GUIDES[S.guide].blurb : `★ suggested for ${adv.subjectLabel.toLowerCase()}. Tap a guide to show it; tap again to hide.`;
  $('follow').checked = S.follow;
  $('labels').checked = S.labels;
}

function syncCanvasInputs() {
  const sel = $('preset');
  sel.value = String(S.preset);
  $('pw').value = fmt(S.paper.w); $('ph').value = fmt(S.paper.h);
  $('margin').value = fmt(S.margin);
  document.querySelectorAll('#unitSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.unit));
  document.querySelectorAll('#orientSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.orient));
  $('gridOp').value = S.gridOp; $('burnGrid').checked = S.burn;
  $('timerSel').value = String(S.dur);
  $('shuffle').classList.toggle('on', S.shuffle);
}

// ======================================================================= UI wiring
$('preset').innerHTML = PRESETS.map((p, i) => `<option value="${i}">${p[0]}</option>`).join('');
$('timerSel').innerHTML = TIMES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

$('preset').onchange = (e) => {
  const i = +e.target.value; S.preset = i;
  const p = PRESETS[i][1];
  if (p) {
    const oldU = S.unit;
    S.paper = { w: p[0], h: p[1] }; S.unit = p[2];
    S.margin = Math.round(convertUnit(oldU, S.unit, S.margin) * 100) / 100;
  }
  syncCanvasInputs(); refresh({ fit: !editing });
};
function paperEdited() { S.preset = 0; S.paper.w = Math.max(0.1, +$('pw').value || 1); S.paper.h = Math.max(0.1, +$('ph').value || 1); S.margin = Math.max(0, +$('margin').value || 0); syncCanvasInputs(); refresh({ fit: !editing }); }
['pw', 'ph', 'margin'].forEach((id) => ($(id).onchange = paperEdited));
document.querySelectorAll('#unitSeg button').forEach((b) => (b.onclick = () => {
  const to = b.dataset.v; if (to === S.unit) return;
  const r = (v) => Math.round(convertUnit(S.unit, to, v) * 100) / 100;
  S.paper = { w: r(S.paper.w), h: r(S.paper.h) }; S.margin = r(S.margin); S.unit = to; S.preset = 0;
  syncCanvasInputs(); refresh();
}));
document.querySelectorAll('#orientSeg button').forEach((b) => (b.onclick = () => { S.orient = b.dataset.v; syncCanvasInputs(); refresh({ fit: !editing }); }));

$('subjects').onclick = (e) => { const k = e.target.dataset.k; if (!k) return; S.subject = k; refresh(); };
$('cards').onclick = (e) => {
  const c = e.target.closest('.card'); if (!c) return;
  S.gridSel = { type: 'square', cell: +c.dataset.cell }; S.follow = c.dataset.role === 'best'; refresh();
};
$('guides').onclick = (e) => { const c = e.target.closest('.card'); if (!c) return; S.guide = S.guide === c.dataset.g ? 'none' : c.dataset.g; refresh(); };
$('customApply').onclick = () => { const v = +$('customCell').value; if (v > 0) { S.gridSel = { type: 'square', cell: v }; S.follow = false; refresh(); } };
$('gridNone').onclick = () => { S.gridSel = { type: 'none' }; S.follow = false; refresh(); };
$('follow').onchange = (e) => { S.follow = e.target.checked; refresh(); };
$('labels').onchange = (e) => { S.labels = e.target.checked; save(); invalidate(); };
$('gridOp').oninput = (e) => { S.gridOp = +e.target.value; save(); invalidate(); };
$('burnGrid').onchange = (e) => { S.burn = e.target.checked; save(); };

// look
const lookBtns = { tMirror: 'mirror', tGray: 'gray', tValues: 'values' };
function syncLook() {
  Object.entries(lookBtns).forEach(([id, k]) => $(id).classList.toggle('on', look[k]));
  $('levelsV').textContent = look.levels;
  invalidate();
}
Object.entries(lookBtns).forEach(([id, k]) => ($(id).onclick = () => toggleLook(k)));
function toggleLook(k) { look[k] = !look[k]; if (k === 'mirror' && editing && look.mirror) toast('Mirror applies when you leave crop mode'); syncLook(); }
[['levels', 'levels', 1], ['bias', 'bias', 1], ['blur', 'blur', 1], ['contrast', 'contrast', 1], ['bright', 'bright', 1]].forEach(([id, k]) => {
  $(id).oninput = (e) => { look[k] = +e.target.value; if ((k === 'levels' || k === 'bias') && !look.values) { look.values = true; } syncLook(); };
});
$('lookReset').onclick = () => {
  Object.assign(look, LOOK0);
  ['levels', 'bias', 'blur', 'contrast', 'bright'].forEach((id) => ($(id).value = look[id])); syncLook();
};

// crop
function setEditing(on) {
  editing = on; $('cropEdit').classList.toggle('on', on);
  fitView(); refresh({ grid: false }); invalidate();
}
$('cropEdit').onclick = () => cur && setEditing(!editing);
$('cropMax').onclick = () => { if (!cur) return; cur.crop.z = 1; setZoom(1); saveCrop(); refresh({ grid: false, fit: !editing }); };
$('cropReset').onclick = () => { if (!cur) return; cur.crop = { cx: 0.5, cy: 0.5, z: 1 }; saveCrop(); refresh({ grid: false, fit: !editing }); };
$('cropZoom').oninput = (e) => {
  if (!cur) return; setZoom(+e.target.value); saveCrop();
  if (!editing) fitView(); renderCropInfo(); invalidate();
};

// transport
$('prev').onclick = () => next(-1);
$('next').onclick = () => next(1);
$('play').onclick = () => { T.running = !T.running; $('play').textContent = T.running ? '❚❚' : '▶'; };
$('timerSel').onchange = (e) => { S.dur = +e.target.value; T.left = S.dur; save(); };
$('shuffle').onclick = () => { S.shuffle = !S.shuffle; applyShuffle(); syncCanvasInputs(); save(); toast(S.shuffle ? 'Shuffled' : 'In order'); };
$('hideUi').onclick = () => toggleUi();
$('showUi').onclick = () => toggleUi();
function toggleUi() {
  document.body.classList.toggle('hide-ui');
  if (document.body.classList.contains('hide-ui')) {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
    toast('Tap the ⤡ button (top right) to bring the controls back');
  } else if (document.fullscreenElement) document.exitFullscreen?.();
  setTimeout(resize, 50);
}
function updateCount() { $('count').textContent = Q.items.length ? `${Q.i + 1} / ${Q.items.length}` : '0 / 0'; }

// panel
function setPanel(open) { document.body.classList.toggle('panel-closed', !open); setTimeout(resize, 220); }
$('panelToggle').onclick = () => setPanel(true);
$('panelClose').onclick = () => setPanel(false);

// pick
$('pickFiles').onclick = () => $('fileIn').click();
$('addMore').onclick = () => $('fileIn').click();
$('pickFolder').onclick = () => $('folderIn').click();
$('fileIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
$('folderIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
const stage = $('stage');
['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); $('drop').classList.remove('over'); }));
stage.addEventListener('drop', async (e) => { addFiles(await filesFromDrop(e.dataTransfer)); });

// ======================================================================= toast
let toastT = 0;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ======================================================================= pointer input
const ptrs = new Map();
let gesture = null; // {kind, ...}
let penActive = false;

function hitTest(px, py, type) {
  const R = cropRect();
  const corners = [[R.minX, R.maxY], [R.maxX, R.maxY], [R.maxX, R.minY], [R.minX, R.minY]];
  const rad = type === 'touch' ? 30 : type === 'pen' ? 22 : 14;
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = worldToScreen(...corners[i]);
    if (Math.hypot(sx - px, sy - py) <= rad) return { kind: 'resize', corner: i };
  }
  const [wx, wy] = screenToWorld(px, py);
  if (wx >= R.minX && wx <= R.maxX && wy >= R.minY && wy <= R.maxY) return { kind: 'move' };
  return { kind: 'pan' };
}
const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
const CORNER_SIGN = [[-1, 1], [1, 1], [1, -1], [-1, -1]];

canvas.addEventListener('pointerdown', (e) => {
  if (!cur) return;
  if (e.pointerType === 'pen') penActive = true;
  else if (e.pointerType === 'touch' && penActive) return; // palm rejection
  canvas.setPointerCapture(e.pointerId);
  const [px, py] = local(e);
  ptrs.set(e.pointerId, { x: px, y: py, type: e.pointerType });
  if (ptrs.size === 2) {
    const [a, b] = [...ptrs.values()];
    gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: V.s };
    return;
  }
  const h = editing ? hitTest(px, py, e.pointerType) : { kind: 'pan' };
  if (h.kind === 'move') { const R = cropRect(); gesture = { kind: 'move', c0: [(R.minX + R.maxX) / 2, (R.minY + R.maxY) / 2], p0: screenToWorld(px, py) }; }
  else if (h.kind === 'resize') gesture = { kind: 'resize', corner: h.corner };
  else gesture = { kind: 'pan', x0: px, y0: py, vx: V.x, vy: V.y };
});

canvas.addEventListener('pointermove', (e) => {
  if (!cur) return;
  const [px, py] = local(e);
  const p = ptrs.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse' && editing) {
      const h = hitTest(px, py, 'mouse');
      canvas.style.cursor = h.kind === 'resize' ? (h.corner % 2 ? 'nesw-resize' : 'nwse-resize') : h.kind === 'move' ? 'move' : 'grab';
    } else canvas.style.cursor = 'grab';
    return;
  }
  p.x = px; p.y = py;
  if (!gesture) return;
  if (gesture.kind === 'pinch' && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.s0 * (d / gesture.d0));
  } else if (gesture.kind === 'pan') {
    V.x = gesture.vx - (px - gesture.x0) / (V.s * m());
    V.y = gesture.vy + (py - gesture.y0) / V.s;
    userView = true; invalidate();
  } else if (gesture.kind === 'move') {
    const [wx, wy] = screenToWorld(px, py);
    setCropCenterWorld(gesture.c0[0] + wx - gesture.p0[0], gesture.c0[1] + wy - gesture.p0[1]);
    saveCrop(); renderCropInfo(); invalidate();
  } else if (gesture.kind === 'resize') {
    const [wx, wy] = screenToWorld(px, py);
    resizeFrom(gesture.corner, wx, wy);
    saveCrop(); renderCropInfo(); invalidate();
  }
});
function resizeFrom(ci, wx, wy) {
  const R = cropRect();
  const corners = [[R.minX, R.maxY], [R.maxX, R.maxY], [R.maxX, R.minY], [R.minX, R.minY]];
  const [ax, ay] = corners[(ci + 2) % 4];
  const [sx, sy] = CORNER_SIGN[ci];
  let w = Math.max((wx - ax) * sx, ((wy - ay) * sy) * A.ratio);
  const roomX = sx > 0 ? cur.w / 2 - ax : ax + cur.w / 2;
  const roomY = sy > 0 ? cur.h / 2 - ay : ay + cur.h / 2;
  w = clamp(w, R.mw / 8, Math.min(R.mw, roomX, roomY * A.ratio));
  const h = w / A.ratio;
  cur.crop.z = R.mw / w;
  const cwx = ax + sx * w / 2, cwy = ay + sy * h / 2;
  cur.crop.cx = (cwx + cur.w / 2) / cur.w; cur.crop.cy = (cur.h / 2 - cwy) / cur.h;
}
function endPointer(e) {
  ptrs.delete(e.pointerId);
  if (e.pointerType === 'pen') setTimeout(() => (penActive = false), 400);
  if (ptrs.size < 2 && gesture && gesture.kind === 'pinch') gesture = null;
  if (!ptrs.size) gesture = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [px, py] = local(e);
  zoomAt(px, py, V.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)));
}, { passive: false });
let lastTap = 0;
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  const now = performance.now();
  if (now - lastTap < 320) { fitView(); invalidate(); }
  lastTap = now;
});
canvas.addEventListener('dblclick', () => { fitView(); invalidate(); });
// two-finger tap in hidden-UI mode brings controls back
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 3 || (e.touches.length === 2 && document.body.classList.contains('hide-ui') && !penActive)) {
    if (e.touches.length === 3) toggleUi();
  }
}, { passive: true });
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ======================================================================= keys
addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=number],select') || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright') next(1);
  else if (k === 'arrowleft') next(-1);
  else if (k === ' ') { e.preventDefault(); $('play').click(); }
  else if (k === 'c') cur && setEditing(!editing);
  else if (k === 'escape' && editing) setEditing(false);
  else if (k === 'f') toggleLook('mirror');
  else if (k === 'g') toggleLook('gray');
  else if (k === 'v') toggleLook('values');
  else if (k === 'b') { look.blur = look.blur > 0 ? 0 : 0.5; $('blur').value = look.blur; syncLook(); }
  else if (k === 'r') { fitView(); invalidate(); }
  else if (k === 'h') toggleUi();
  else return;
});

// ======================================================================= timer / chime / wake
let audio = null;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 660; g.gain.value = 0.0001;
    o.connect(g); g.connect(audio.destination);
    const t = audio.currentTime;
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.start(t); o.stop(t + 0.4);
  } catch (e) { /* no audio */ }
}
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now(), dt = (now - lastTick) / 1000; lastTick = now;
  const ring = $('ring'), clock = $('clock');
  if (!cur || !S.dur) { clock.textContent = '—'; ring.style.background = 'conic-gradient(var(--fill) 0deg, var(--fill) 0deg)'; return; }
  if (T.running && !editing && !document.hidden) {
    T.left -= dt;
    if (T.left <= 0) { chime(); T.left = S.dur; if (Q.items.length > 1) next(1); }
  }
  const l = Math.max(0, Math.ceil(T.left));
  clock.textContent = l >= 3600 ? `${Math.floor(l / 3600)}:${String(Math.floor(l / 60) % 60).padStart(2, '0')}:${String(l % 60).padStart(2, '0')}` : `${Math.floor(l / 60)}:${String(l % 60).padStart(2, '0')}`;
  ring.style.background = `conic-gradient(var(--tint) ${(T.left / S.dur) * 360}deg, var(--fill) 0deg)`;
}, 200);
let wake = null;
async function requestWake() {
  try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => (wake = null)); } } catch (e) { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && cur) requestWake(); });

// ======================================================================= export
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function withDpi(bytes, ppi) {
  const ppm = Math.round(ppi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(bytes.length + 21);
  out.set(bytes.subarray(0, 33), 0); out.set(chunk, 33); out.set(bytes.subarray(33), 54);
  return out;
}
$('exportBtn').onclick = async () => {
  if (!cur) return toast('Load a photo first');
  try {
    toast('Preparing crop…');
    const bmp = await loadBitmap(cur.item.file);
    const R = cropRect();
    const sx = Math.round(((R.cx - R.cw / 2) / cur.w) * bmp.width), sy = Math.round(((R.cy - R.ch / 2) / cur.h) * bmp.height);
    const sw = Math.round((R.cw / cur.w) * bmp.width), sh = Math.round((R.ch / cur.h) * bmp.height);
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    if (S.burn) drawBurn(ctx, sw, sh);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bytes = withDpi(new Uint8Array(await blob.arrayBuffer()), sw / (A.dw * UNITS[S.unit]));
    const base = cur.item.name.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    a.download = `${base}_${fmt(A.dw)}x${fmt(A.dh)}${S.unit}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`Saved ${sw} × ${sh} px · prints at ${fmt(A.dw)} × ${fmt(A.dh)} ${S.unit}`);
  } catch (e) { console.error(e); toast('Export failed'); }
};
function drawBurn(ctx, w, h) {
  const lw = Math.max(1.5, w / 900);
  const stroke = (fn, col) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = lw * 2.6; ctx.beginPath(); fn(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); fn(); ctx.stroke();
  };
  const V_ = (L, col) => stroke(() => L.v.forEach((l) => { ctx.moveTo(l.p * w, 0); ctx.lineTo(l.p * w, h); }), col);
  const H_ = (L, col) => stroke(() => L.h.forEach((l) => { ctx.moveTo(0, (1 - l.p) * h); ctx.lineTo(w, (1 - l.p) * h); }), col);
  V_(LA, '#fff'); H_(LA, '#fff'); V_(LB, '#ffb454'); H_(LB, '#ffb454');
  stroke(() => LB.segs.forEach((g) => { ctx.moveTo(g[0] * w, (1 - g[1]) * h); ctx.lineTo(g[2] * w, (1 - g[3]) * h); }), '#ffb454');
}

// ======================================================================= boot
if (!matchMedia('(max-width:820px)').matches) document.body.classList.remove('panel-closed');
else document.body.classList.add('panel-closed');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

syncCanvasInputs();
syncLook();
refresh();
resize();
window.refSession = { addFiles, render, invalidate, V, uniforms, renderer, mesh, get state() { return { S, A, cur, adv }; } };
