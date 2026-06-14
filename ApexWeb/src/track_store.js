// ApexWeb/src/track_store.js — persistence for editor-edited tracks (localStorage) + the resolver
// the game uses to prefer edited points/objects over the built-in preset. All localStorage access
// is wrapped so private-mode / quota / corrupt data degrades cleanly to "no edits".
const KEY = "apexweb_tracks";
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null);

export function loadAll() {
  const s = ls(); if (!s) return {};
  try { return JSON.parse(s.getItem(KEY) || "{}") || {}; } catch { return {}; }
}
export function saveTrack(name, data) {
  const s = ls(); if (!s) return;
  const all = loadAll(); all[name] = { points: data.points, objects: data.objects || [] };
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* quota/full -> ignore */ }
}
export function clearTrack(name) {
  const s = ls(); if (!s) return;
  const all = loadAll(); delete all[name];
  try { s.setItem(KEY, JSON.stringify(all)); } catch {}
}
// edited {points,objects} if a usable edit is saved for `name`, else the preset points + no objects.
export function effectiveTrack(name, presetPoints) {
  const e = loadAll()[name];
  return (e && Array.isArray(e.points) && e.points.length >= 8)
    ? { points: e.points, objects: Array.isArray(e.objects) ? e.objects : [] }
    : { points: presetPoints, objects: [] };
}
