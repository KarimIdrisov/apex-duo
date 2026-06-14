// ApexWeb/src/career_store.js — persistence for the career/season state (localStorage) + JSON
// export/import. Wrapped so private-mode / quota / corrupt data degrades to "no save".
import { migrate } from "./career.js";
const KEY = "apexweb_career";
const ls = () => (typeof localStorage !== "undefined" ? localStorage : null);

export function saveCareer(career) {
  const s = ls(); if (!s || !career) return false;
  try { s.setItem(KEY, JSON.stringify(career)); return true; } catch { return false; }
}
export function loadCareer() {
  const s = ls(); if (!s) return null;
  try { const c = JSON.parse(s.getItem(KEY) || "null"); return (c && typeof c.v === "number") ? migrate(c) : null; } catch { return null; }
}
export function hasCareer() { return !!loadCareer(); }
export function clearCareer() { const s = ls(); if (s) { try { s.removeItem(KEY); } catch {} } }
export function exportCareer(career) { return JSON.stringify(career); }
export function importCareer(json) {
  try { const c = JSON.parse(json); return (c && typeof c.v === "number") ? migrate(c) : null; } catch { return null; }
}
