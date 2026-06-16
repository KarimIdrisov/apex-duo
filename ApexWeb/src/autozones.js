// ApexWeb/src/autozones.js — pure heuristic that suggests overtake zones from a track's 18 corner
// classes. NO imports: the caller (editor) computes the classes (it already does for the overlay) and
// passes them in. Returns the same {sectors, ease, type} shape the editor paints + the sim reads.
const RANK = { straight: 3, high: 2, med: 1, low: 0 };

// classes: array of "straight"|"high"|"med"|"low" (length N, =18 in the editor). Returns
// [{sectors:[asc], ease, type:"brake"|"slip"}]. Deterministic; [] when no zones are found.
export function suggestZonesFromClasses(classes, opts = {}) {
  const { maxBrakes = 3, brakeEase = 0.5, slipEase = 0.45, brakeLen = 3, slipLen = 3 } = opts;
  const N = Array.isArray(classes) ? classes.length : 0;
  if (N < 2) return [];
  const wrap = (i) => ((i % N) + N) % N;
  const r = (i) => { const v = RANK[classes[wrap(i)]]; return v === undefined ? 3 : v; };
  const fast = (i) => r(i) >= 2, slow = (i) => r(i) <= 1;

  // braking points: a slow corner right after a fast sector; score by the approach (fast-run) length.
  const pts = [];
  for (let i = 0; i < N; i++) {
    if (slow(i) && fast(i - 1)) {
      let len = 0, j = i - 1;
      while (len < N && fast(j)) { len++; j--; }
      pts.push({ entry: i, approach: len });
    }
  }
  pts.sort((a, b) => b.approach - a.approach || a.entry - b.entry);

  const covered = new Set(), zones = [];
  for (const p of pts) {
    if (zones.length >= maxBrakes) break;
    if (covered.has(p.entry)) continue;
    const secs = [p.entry];
    let j = p.entry - 1;
    while (secs.length < brakeLen && fast(j)) { secs.push(wrap(j)); j--; }
    if (secs.some((s) => covered.has(s))) continue;   // would overlap an earlier brake zone
    secs.forEach((s) => covered.add(s));
    zones.push({ sectors: secs.slice().sort((a, b) => a - b), ease: brakeEase, type: "brake" });
  }

  // slip: longest wrap-aware run of consecutive "straight" sectors, minus covered, capped to slipLen.
  const run = longestStraightRun(classes, N);
  if (run.length >= 2) {
    const free = run.filter((s) => !covered.has(s)).slice(0, slipLen);
    if (free.length >= 2) zones.push({ sectors: free.slice().sort((a, b) => a - b), ease: slipEase, type: "slip" });
  }
  return zones;
}

// longest run of consecutive "straight" sectors round the loop, as indices in track order from the
// run's start. [] if there is no straight sector; the whole loop if every sector is straight.
function longestStraightRun(classes, N) {
  const isS = (i) => classes[((i % N) + N) % N] === "straight";
  let any = false; for (let i = 0; i < N; i++) if (isS(i)) { any = true; break; }
  if (!any) return [];
  let start = 0; while (start < N && isS(start)) start++;
  if (start === N) return Array.from({ length: N }, (_, i) => i);   // all straight
  let best = [], cur = [];
  for (let k = 0; k < N; k++) {
    const i = (start + k) % N;
    if (isS(i)) { cur.push(i); if (cur.length > best.length) best = cur.slice(); }
    else cur = [];
  }
  return best;
}
