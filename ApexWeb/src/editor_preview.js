// ApexWeb/src/editor_preview.js — pure (THREE-free) math for the editor's 3D preview + svg reference.
// Kept free of any THREE/race3d import so it can be unit-tested under `node --test`.

// advance one car's progress by dt seconds at 1/lapSeconds laps/s; wrap lapFrac past 1 -> lap++.
export function advanceFrac(lap, lapFrac, dt, lapSeconds) {
  let f = lapFrac + dt / lapSeconds, l = lap;
  while (f >= 1) { f -= 1; l += 1; }
  return { lap: l, lapFrac: f };
}

// n synthetic preview cars spread evenly round the lap, coloured by colors[i % colors.length].
export function buildPreviewCars(n, colors) {
  const cars = [];
  for (let i = 0; i < n; i++) {
    cars.push({ idx: i, color: colors[i % colors.length], lap: 0, lapFrac: i / n, retired: false, inPit: false, player: false });
  }
  return cars;
}

// map a flat [x0,y0,...] normalized outline to canvas px: fit into w×h with `pad` margin, uniform
// scale, centered. Returns [] for a missing / too-short (< 3 points) outline.
export function fitOutline(flat, w, h, pad) {
  if (!Array.isArray(flat) || flat.length < 6) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    if (flat[i] < minX) minX = flat[i];
    if (flat[i] > maxX) maxX = flat[i];
    if (flat[i + 1] < minY) minY = flat[i + 1];
    if (flat[i + 1] > maxY) maxY = flat[i + 1];
  }
  const spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const s = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const ox = (w - spanX * s) / 2, oy = (h - spanY * s) / 2;
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([ox + (flat[i] - minX) * s, oy + (flat[i + 1] - minY) * s]);
  return out;
}
