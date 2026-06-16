// ApexWeb/src/backers.js — team funding archetypes (works / independent), mirroring the real 2026
// grid. Pure data + helpers, no I/O. Drives career income (annual grant), the cost-cap (PU dev is
// off-cap for works PU-makers, Phase B), and the acquisition/event system (Phase C). Values are in
// $k/season, GAME-SCALED to Apex's economy (not real $M) — tune here, not in logic.
//
//   type        : "works" (concern/big-owner funded) | "independent" (lives off prize + sponsors)
//   puMaker     : true = builds its own engine (own PU R&D, off cost-cap) | false = customer engine
//   supplier    : engine supplier label (display + Phase B supply economy); null if puMaker
//   grant       : $k/season funding floor from the parent/owner (amortised per race as income)
//   boardProfile: "oem" (demanding, pull-out risk) | "owner" (ambitious billionaire/investor) | "patient"

export const BACKERS = {
  "Mercedes":     { type: "works",       puMaker: true,  supplier: null,       grant: 10000, boardProfile: "oem" },
  "Ferrari":      { type: "works",       puMaker: true,  supplier: null,       grant: 11000, boardProfile: "oem" },
  "Red Bull":     { type: "works",       puMaker: true,  supplier: null,       grant: 10000, boardProfile: "oem" },
  "Sauber":       { type: "works",       puMaker: true,  supplier: null,       grant: 7000,  boardProfile: "oem" },   // Audi works (2026)
  "Aston Martin": { type: "works",       puMaker: false, supplier: "Honda",    grant: 6000,  boardProfile: "oem" },   // Honda works + Stroll
  "McLaren":      { type: "independent", puMaker: false, supplier: "Mercedes", grant: 6000,  boardProfile: "owner" }, // independent but investor-rich
  "RB":           { type: "works",       puMaker: false, supplier: "Red Bull", grant: 4500,  boardProfile: "owner" }, // Red Bull-owned junior
  "Cadillac":     { type: "independent", puMaker: false, supplier: "Ferrari",  grant: 5000,  boardProfile: "owner" }, // GM-backed new entry
  "Alpine":       { type: "independent", puMaker: false, supplier: "Mercedes", grant: 4000,  boardProfile: "owner" }, // Renault-owned, Mercedes customer (2026)
  "Williams":     { type: "independent", puMaker: false, supplier: "Mercedes", grant: 1500,  boardProfile: "owner" },
  "Haas":         { type: "independent", puMaker: false, supplier: "Ferrari",  grant: 1500,  boardProfile: "owner" },
};

const DEFAULT_BACKER = { type: "independent", puMaker: false, supplier: "Ferrari", grant: 1500, boardProfile: "owner" };

// the (default, season-start) backer for a team by name — a fresh copy (career mutates its own).
export function backerFor(teamName) {
  const b = BACKERS[teamName] || DEFAULT_BACKER;
  return { ...b };
}

export function backerLabel(b) { return b && b.type === "works" ? "Заводская" : "Независимая"; }
