// ApexWeb/src/track_pack.js — load the committed track pack (ApexWeb/tracks/) and hydrate it into
// localStorage so the existing localStorage-based paths (track_store.effectiveTrack, main.js
// quick-race) see pack tracks unchanged. DOM-free: browser fetch + an injected saveTrack. A missing
// or corrupt pack degrades to [] (never throws into the editor).

// fetch the manifest, then each track record. Returns [{slug, name, record}].
export async function loadPack(base = "tracks") {
  let index;
  try {
    const r = await fetch(base + "/index.json");
    if (!r.ok) return [];
    index = await r.json();
  } catch { return []; }
  if (!Array.isArray(index)) return [];
  const out = [];
  for (const ent of index) {
    if (!ent || typeof ent.slug !== "string") continue;
    try {
      const r = await fetch(base + "/" + ent.slug + ".json");
      if (!r.ok) continue;
      const rec = await r.json();
      if (rec && Array.isArray(rec.points) && rec.points.length >= 8) {
        out.push({ slug: ent.slug, name: rec.name || ent.name || ent.slug, record: rec });
      }
    } catch { /* skip a bad file */ }
  }
  return out;
}

// load the pack and write each record into localStorage via the injected saveTrack(name, record).
// Returns the track names (for the editor dropdown).
export async function hydratePack(saveTrack, base = "tracks") {
  const pack = await loadPack(base);
  for (const t of pack) saveTrack(t.name, t.record);
  return pack.map((t) => t.name);
}
