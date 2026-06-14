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
  const all = loadAll();
  all[name] = {
    points: data.points,
    objects: data.objects || [],
    pit: data.pit || null,
    pitLoss: (typeof data.pitLoss === "number") ? data.pitLoss : null,
    zones: Array.isArray(data.zones) ? data.zones : [],
    cornerOverrides: data.cornerOverrides || null,
  };
  try { s.setItem(KEY, JSON.stringify(all)); } catch { /* quota/full -> ignore */ }
}
export function clearTrack(name) {
  const s = ls(); if (!s) return;
  const all = loadAll(); delete all[name];
  try { s.setItem(KEY, JSON.stringify(all)); } catch {}
}
// edited {points,objects,pit,pitLoss,zones,cornerOverrides} if a usable edit is saved, else the
// preset points with all gameplay fields defaulted.
export function effectiveTrack(name, presetPoints) {
  const e = loadAll()[name];
  if (e && Array.isArray(e.points) && e.points.length >= 8) return {
    points: e.points,
    objects: Array.isArray(e.objects) ? e.objects : [],
    pit: e.pit || null,
    pitLoss: (typeof e.pitLoss === "number") ? e.pitLoss : null,
    zones: Array.isArray(e.zones) ? e.zones : [],
    cornerOverrides: e.cornerOverrides || null,
  };
  return { points: presetPoints, objects: [], pit: null, pitLoss: null, zones: [], cornerOverrides: null };
}
