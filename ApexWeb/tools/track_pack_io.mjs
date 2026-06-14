// ApexWeb/tools/track_pack_io.mjs — pure filesystem helpers for the track pack. No HTTP.
// Used by tools/editor_server.mjs and unit-tested directly.
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TRANSLIT = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",
  н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",
  ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};

// track name -> filesystem-safe ASCII slug (Cyrillic transliterated). Empty -> "track".
export function slugify(name) {
  const s = String(name || "").toLowerCase().split("").map((c) => (c in TRANSLIT ? TRANSLIT[c] : c)).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "track";
}

// write one track record to <tracksDir>/<slug>.json (pretty). Same name -> same slug -> overwrite.
export function writeTrack(tracksDir, record) {
  if (!record || !Array.isArray(record.points) || record.points.length < 8) throw new Error("bad record: points");
  if (!existsSync(tracksDir)) mkdirSync(tracksDir, { recursive: true });
  const slug = slugify(record.name);
  const clean = {
    name: record.name || slug,
    points: record.points,
    objects: Array.isArray(record.objects) ? record.objects : [],
    pit: record.pit || null,
    pitLoss: (typeof record.pitLoss === "number") ? record.pitLoss : null,
    zones: Array.isArray(record.zones) ? record.zones : [],
    cornerOverrides: record.cornerOverrides || null,
  };
  writeFileSync(join(tracksDir, slug + ".json"), JSON.stringify(clean, null, 2));
  return { slug, file: slug + ".json" };
}

// (re)build <tracksDir>/index.json = [{slug,name}] from every *.json (except index.json), sorted by name.
export function buildIndex(tracksDir) {
  if (!existsSync(tracksDir)) return [];
  const index = [];
  for (const f of readdirSync(tracksDir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try {
      const rec = JSON.parse(readFileSync(join(tracksDir, f), "utf8"));
      index.push({ slug: f.slice(0, -5), name: rec.name || f.slice(0, -5) });
    } catch { /* skip a corrupt file */ }
  }
  index.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(join(tracksDir, "index.json"), JSON.stringify(index, null, 2));
  return index;
}
