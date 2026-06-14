# ApexWeb Track Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edited tracks become committed `ApexWeb/tracks/*.json` files (a "track pack") that load as built-in tracks for everyone, written to disk on **Save** via a tiny localhost Node helper and pushed to git by an **Опубликовать** button.

**Architecture:** Repo files are the shared source of truth; `localStorage` is the local working cache. A no-deps Node server (`tools/editor_server.mjs`) serves `ApexWeb/` statically AND accepts `POST /api/save-track` (writes a file) + `POST /api/publish` (`git add ApexWeb/tracks` → commit → push). The editor hydrates the pack into `localStorage` on load (so the existing `effectiveTrack`/quick-race paths see pack tracks unchanged) and, on Save, writes both `localStorage` and the repo file. The deterministic sim (`sim.js`/`track.js`/`data.js`) is **untouched** — pack tracks race through the existing Шаг-2 `trackFromEdited` bridge.

**Tech Stack:** Vanilla ES modules, Node's built-in `node --test`, no npm dependencies (`http`, `fs`, `child_process`), browser `fetch`.

**Spec:** `docs/superpowers/specs/2026-06-14-apexweb-track-pack-design.md`

## Conventions (apply to every task)

- **Run all commands from the `ApexWeb/` directory** unless stated otherwise.
- **Commits use explicit pathspecs — never `git add -A`.** The owner keeps unrelated uncommitted WIP in the same tree.
- **End every commit message** with a blank line then `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Fast per-file test: `node --test tests/<file>.test.js`. Full suite (`node --test`) is slow (`sim.test.js` ≈ 10 min) — run it only in the final task.
- User-facing strings are **Russian**; code/comments English.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `tools/track_pack_io.mjs` | Create | Pure FS helpers: `slugify`, `writeTrack`, `buildIndex`. No HTTP. |
| `tools/editor_server.mjs` | Create | Localhost static server + `/api/save-track` + `/api/publish`. Thin glue over `track_pack_io`. |
| `src/track_pack.js` | Create | `loadPack()` / `hydratePack(saveTrack)` — fetch the committed pack, write it into `localStorage`. |
| `src/track_repo.js` | Create | `saveToRepo(record)` / `publish()` — POST to the helper; degrade to `{ok:false}` offline. |
| `src/ui/editor.js` | Modify | Hydrate pack → "Из репо" dropdown group; Save → localStorage + `saveToRepo`; Опубликовать button. |
| `editor.html` | Modify | Add the «📤 Опубликовать» button. |
| `tracks/index.json` | Create | Seed empty manifest `[]` so the folder exists in git and the first load is clean. |
| `README.md` | Modify | Editing via the Node helper; the Save→Опубликовать loop; structure list. |
| `tests/track_pack_io.test.js` | Create | Unit tests for the pure FS helpers. |
| `tests/track_pack.test.js` | Create | Unit tests for the client loader (fetch stubbed). |
| `tests/track_repo.test.js` | Create | Unit tests for the offline/ok degrade paths (fetch stubbed). |

**Untouched (do NOT edit):** `src/track_store.js`, `src/sim.js`, `src/track.js`, `src/track_build.js`, `src/data.js`, `src/main.js`, netcode. main.js already routes `localStorage["apexweb_race_track"]` → `startQuickRace` → `trackFromEdited`; a hydrated pack track races through it with no change.

---

### Task 1: `track_pack_io.mjs` — pure filesystem helpers

**Files:**
- Create: `ApexWeb/tools/track_pack_io.mjs`
- Test: `ApexWeb/tests/track_pack_io.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/track_pack_io.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, writeTrack, buildIndex } from "../tools/track_pack_io.mjs";

test("slugify: transliterates Cyrillic, sanitizes, falls back", () => {
  assert.equal(slugify("Моя Трасса"), "moya-trassa");
  assert.equal(slugify("Spa 24!"), "spa-24");
  assert.equal(slugify(""), "track");
  assert.equal(slugify("***"), "track");
});

test("writeTrack: writes <slug>.json with a clean record; same name overwrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    const { slug, file } = writeTrack(dir, {
      name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1],
      zones: [{ sectors: [0], ease: 0.5, type: "brake" }],
    });
    assert.equal(slug, "moya");
    assert.equal(file, "moya.json");
    const rec = JSON.parse(readFileSync(join(dir, "moya.json"), "utf8"));
    assert.equal(rec.name, "Моя");
    assert.deepEqual(rec.points, [0, 0, 1, 0, 1, 1, 0, 1]);
    assert.equal(rec.zones[0].type, "brake");
    assert.equal(rec.pit, null);                                  // defaulted
    writeTrack(dir, { name: "Моя", points: [9, 9, 9, 9, 9, 9, 9, 9] });   // same name -> overwrite
    const rec2 = JSON.parse(readFileSync(join(dir, "moya.json"), "utf8"));
    assert.deepEqual(rec2.points, [9, 9, 9, 9, 9, 9, 9, 9]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("writeTrack: rejects a record without enough points", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try { assert.throws(() => writeTrack(dir, { name: "x", points: [0, 0] })); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildIndex: lists every track file (not index.json), sorted by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  try {
    writeTrack(dir, { name: "Яна", points: [0, 0, 1, 0, 1, 1, 0, 1] });
    writeTrack(dir, { name: "Аня", points: [0, 0, 1, 0, 1, 1, 0, 1] });
    const index = buildIndex(dir);
    assert.deepEqual(index.map((e) => e.name), ["Аня", "Яна"]);
    const onDisk = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    assert.deepEqual(onDisk, index);
    assert.ok(!index.some((e) => e.slug === "index"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/track_pack_io.test.js`
Expected: FAIL — cannot find module `../tools/track_pack_io.mjs`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/tools/track_pack_io.mjs`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/track_pack_io.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add tools/track_pack_io.mjs tests/track_pack_io.test.js
git commit -m "feat(apexweb): track_pack_io — pure slugify/writeTrack/buildIndex for the track pack" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `editor_server.mjs` — localhost static + save + publish

**Files:**
- Create: `ApexWeb/tools/editor_server.mjs`

This is thin HTTP glue over the (already-tested) `track_pack_io`. No unit test — gated by `node --check` + an owner live smoke (final task / F5).

- [ ] **Step 1: Write the implementation**

Create `ApexWeb/tools/editor_server.mjs`:

```js
// ApexWeb/tools/editor_server.mjs — localhost dev server for the track editor: serves ApexWeb/ as
// static files AND accepts the editor's Save (writes a repo file) + Опубликовать (git push). Run this
// instead of `python -m http.server` while authoring tracks. No npm deps. Binds 127.0.0.1 only.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { writeTrack, buildIndex } from "./track_pack_io.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));   // ApexWeb/
const REPO = join(ROOT, "..");                                // repo root (for git)
const TRACKS = join(ROOT, "tracks");
const PORT = Number(process.env.PORT) || 8000;
const TYPES = {
  ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".json":"application/json",
  ".css":"text/css", ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon",
};

const readBody = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => res(b)); });
const sendJson = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

// git add ApexWeb/tracks (explicit pathspec — never -A) -> commit -> push. "nothing to commit" is a friendly no-op.
function gitPublish(done) {
  const run = (args) => new Promise((resolve, reject) =>
    execFile("git", args, { cwd: REPO }, (err, out, errout) => err ? reject(new Error(errout || err.message)) : resolve(out)));
  (async () => {
    try {
      await run(["add", "ApexWeb/tracks"]);
      try { await run(["commit", "-m", "chore(tracks): publish track pack"]); }
      catch (e) { if (/nothing to commit/i.test(e.message)) return done({ ok: true, message: "нечего публиковать (нет изменений)" }); throw e; }
      await run(["push"]);
      done({ ok: true, message: "опубликовано" });
    } catch (e) { done({ ok: false, message: String(e.message || e).split("\n")[0] }); }
  })();
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/save-track") {
      const { record } = JSON.parse(await readBody(req) || "{}");
      const { slug } = writeTrack(TRACKS, record);
      buildIndex(TRACKS);
      return sendJson(res, 200, { ok: true, slug });
    }
    if (req.method === "POST" && req.url === "/api/publish") {
      buildIndex(TRACKS);                                  // make sure the manifest reflects disk before committing
      return gitPublish((r) => sendJson(res, 200, r));
    }
    let url = (req.url || "/").split("?")[0];
    if (url === "/") url = "/index.html";
    const file = join(ROOT, normalize(decodeURIComponent(url)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }   // path-traversal guard
    const data = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (e) {
    if (e && e.code === "ENOENT") { res.writeHead(404); res.end("not found"); }
    else { sendJson(res, 500, { ok: false, message: String((e && e.message) || e) }); }
  }
});

server.listen(PORT, "127.0.0.1", () =>
  console.log(`editor server: http://127.0.0.1:${PORT}  (serving ApexWeb/, POST /api/save-track, POST /api/publish)`));
```

- [ ] **Step 2: Verify syntax**

Run: `node --check tools/editor_server.mjs`
Expected: no output, exit 0.

- [ ] **Step 3: Live smoke (manual — optional here, required at owner F5)**

In one terminal: `node tools/editor_server.mjs` → prints the listen line.
In another (PowerShell), confirm static serve + save endpoint:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/editor.html | Out-Null   # 200, no throw
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/api/save-track -ContentType application/json -Body '{"record":{"name":"Тест","points":[0,0,1,0,1,1,0,1]}}'
# -> @{ ok=True; slug=test }  and ApexWeb/tracks/test.json + index.json now exist
```

Stop the server (Ctrl+C). Delete the throwaway `tracks/test.json` if created (`git status` should then show only intended files).

- [ ] **Step 4: Commit**

```bash
git add tools/editor_server.mjs
git commit -m "feat(apexweb): editor_server — localhost static + /api/save-track + /api/publish (git add ApexWeb/tracks only)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `track_pack.js` — client loader + hydration

**Files:**
- Create: `ApexWeb/src/track_pack.js`
- Test: `ApexWeb/tests/track_pack.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/track_pack.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPack, hydratePack } from "../src/track_pack.js";

// stub global fetch: map url -> json value; any url not in the map answers 404.
function stubFetch(map) {
  globalThis.fetch = async (url) => (url in map)
    ? { ok: true, status: 200, json: async () => map[url] }
    : { ok: false, status: 404, json: async () => ({}) };
}

test("loadPack: reads the manifest then each track record", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "moya", name: "Моя" }],
    "tracks/moya.json": { name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1], zones: [] },
  });
  const pack = await loadPack();
  assert.equal(pack.length, 1);
  assert.equal(pack[0].name, "Моя");
  assert.deepEqual(pack[0].record.points, [0, 0, 1, 0, 1, 1, 0, 1]);
});

test("loadPack: missing manifest -> [] (no throw)", async () => {
  stubFetch({});
  assert.deepEqual(await loadPack(), []);
});

test("loadPack: skips a track with too few points", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "bad", name: "Bad" }, { slug: "ok", name: "Ok" }],
    "tracks/bad.json": { name: "Bad", points: [0, 0] },
    "tracks/ok.json": { name: "Ok", points: [0, 0, 1, 0, 1, 1, 0, 1] },
  });
  const pack = await loadPack();
  assert.deepEqual(pack.map((t) => t.name), ["Ok"]);
});

test("hydratePack: writes each record via the injected saveTrack, returns names", async () => {
  stubFetch({
    "tracks/index.json": [{ slug: "moya", name: "Моя" }],
    "tracks/moya.json": { name: "Моя", points: [0, 0, 1, 0, 1, 1, 0, 1] },
  });
  const calls = [];
  const names = await hydratePack((n, rec) => calls.push([n, rec]));
  assert.deepEqual(names, ["Моя"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "Моя");
  assert.deepEqual(calls[0][1].points, [0, 0, 1, 0, 1, 1, 0, 1]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/track_pack.test.js`
Expected: FAIL — cannot find module `../src/track_pack.js`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/src/track_pack.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/track_pack.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/track_pack.js tests/track_pack.test.js
git commit -m "feat(apexweb): track_pack client — loadPack + hydratePack (committed pack -> localStorage)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `track_repo.js` — save/publish HTTP client

**Files:**
- Create: `ApexWeb/src/track_repo.js`
- Test: `ApexWeb/tests/track_repo.test.js`

- [ ] **Step 1: Write the failing test**

Create `ApexWeb/tests/track_repo.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { saveToRepo, publish } from "../src/track_repo.js";

test("saveToRepo: no helper (fetch throws) -> {ok:false, offline:true}", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await saveToRepo({ name: "x", points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(r.ok, false);
  assert.equal(r.offline, true);
});

test("saveToRepo: helper ok -> {ok:true, slug}", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, slug: "x" }) });
  const r = await saveToRepo({ name: "x", points: [0, 0, 1, 0, 1, 1, 0, 1] });
  assert.equal(r.ok, true);
  assert.equal(r.slug, "x");
});

test("publish: no helper -> {ok:false}", async () => {
  globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
  const r = await publish();
  assert.equal(r.ok, false);
});

test("publish: helper result is passed through", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, message: "опубликовано" }) });
  const r = await publish();
  assert.equal(r.ok, true);
  assert.equal(r.message, "опубликовано");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/track_repo.test.js`
Expected: FAIL — cannot find module `../src/track_repo.js`.

- [ ] **Step 3: Write the implementation**

Create `ApexWeb/src/track_repo.js`:

```js
// ApexWeb/src/track_repo.js — thin HTTP client to the local editor helper (tools/editor_server.mjs).
// saveToRepo writes a repo file; publish git-pushes. Both degrade to {ok:false} when no helper is
// running (plain static hosting / GitHub Pages) so the editor never throws.
async function post(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error("http " + res.status);
  return res.json();
}

// POST the track record; returns {ok:true, slug} or {ok:false, offline:true} if no helper.
export async function saveToRepo(record) {
  try {
    const r = await post("/api/save-track", { record });
    return { ok: true, slug: r.slug };
  } catch {
    return { ok: false, offline: true };
  }
}

// ask the helper to git add ApexWeb/tracks -> commit -> push; returns {ok, message}.
export async function publish() {
  try {
    const r = await post("/api/publish", {});
    return { ok: r.ok !== false, message: r.message || "" };
  } catch {
    return { ok: false, message: "нет node-сервера (запусти tools/editor_server.mjs)" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/track_repo.test.js`
Expected: PASS — 4 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/track_repo.js tests/track_repo.test.js
git commit -m "feat(apexweb): track_repo client — saveToRepo + publish with offline degrade" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the editor — pack dropdown, Save→repo, Опубликовать button

**Files:**
- Modify: `ApexWeb/editor.html`
- Modify: `ApexWeb/src/ui/editor.js`

UI change — no unit test. Gate: `node --check src/ui/editor.js` + owner F5.

- [ ] **Step 1: Add the Опубликовать button to `editor.html`**

In `ApexWeb/editor.html`, find the save/reset row:

```html
  <div class="row"><button id="save">💾 Сохранить</button> <button id="reset">↺ Сброс</button></div>
```

Insert a new row immediately after it:

```html
  <div class="row"><button id="save">💾 Сохранить</button> <button id="reset">↺ Сброс</button></div>
  <div class="row"><button id="publish" style="width:100%;background:#2d5a7a;border-color:#3d7aa0">📤 Опубликовать на гит</button></div>
```

- [ ] **Step 2: Add imports to `src/ui/editor.js`**

Find (line 6):

```js
import { saveTrack, clearTrack, loadAll } from "../track_store.js";
```

Add two import lines immediately after it:

```js
import { saveTrack, clearTrack, loadAll } from "../track_store.js";
import { hydratePack } from "../track_pack.js";
import { saveToRepo, publish } from "../track_repo.js";
```

- [ ] **Step 3: Hydrate the pack into the dropdown**

Find the preset dropdown build (around line 232-234):

```js
const sel = document.getElementById("preset");
for (const n of [...TRACK_NAMES, EMPTY]) { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); }
sel.onchange = () => loadTrack(sel.value);
```

Add the hydration block immediately after `sel.onchange = ...`:

```js
const sel = document.getElementById("preset");
for (const n of [...TRACK_NAMES, EMPTY]) { const o = document.createElement("option"); o.value = o.textContent = n; sel.appendChild(o); }
sel.onchange = () => loadTrack(sel.value);
// pull the committed track pack (ApexWeb/tracks/) into localStorage + list it under "Из репо"
hydratePack(saveTrack).then((names) => {
  if (!names.length) return;
  const grp = document.createElement("optgroup"); grp.label = "Из репо";
  for (const n of names) { const o = document.createElement("option"); o.value = o.textContent = n; grp.appendChild(o); }
  sel.insertBefore(grp, sel.firstChild);   // pack tracks at the top of the list
});
```

- [ ] **Step 4: Save also writes the repo file**

Find the save handler (line 266):

```js
document.getElementById("save").onclick = () => { saveTrack(name, { points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides }); toast("Сохранено: " + name); };
```

Replace it with:

```js
document.getElementById("save").onclick = async () => {
  const rec = { name, points: toFlat(pts), objects, pit, pitLoss, zones, cornerOverrides };
  saveTrack(name, rec);                                   // local cache (and offline fallback)
  const r = await saveToRepo(rec);                        // repo file via the node helper
  toast(r.ok ? ("В репо: tracks/" + r.slug + ".json") : "Сохранено локально (нет node-сервера для записи в репо)");
};
```

- [ ] **Step 5: Wire the Опубликовать button**

Find the drive handler (line 268):

```js
document.getElementById("drive").onclick = toggleDrive;
```

Add the publish handler immediately after it:

```js
document.getElementById("drive").onclick = toggleDrive;
document.getElementById("publish").onclick = async () => {
  toast("Публикую…");
  const r = await publish();
  toast(r.ok ? "Опубликовано на гит" : ("Не вышло: " + r.message));
};
```

- [ ] **Step 6: Verify syntax**

Run: `node --check src/ui/editor.js`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add editor.html src/ui/editor.js
git commit -m "feat(apexweb): editor reads/saves the track pack + Опубликовать button" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Seed the pack folder, update README, full verification

**Files:**
- Create: `ApexWeb/tracks/index.json`
- Modify: `ApexWeb/README.md`

- [ ] **Step 1: Seed an empty manifest**

Create `ApexWeb/tracks/index.json` with exactly:

```json
[]
```

(So the `tracks/` folder exists in git and the first `loadPack` fetch succeeds instead of 404-ing.)

- [ ] **Step 2: Update the README run + editor sections**

In `ApexWeb/README.md`, under **## Запуск локально**, after the existing `python -m http.server` block, add:

```markdown
**Редактирование трасс с сохранением в репо:** запусти вместо python мини-сервер —
```
cd ApexWeb
node tools/editor_server.mjs
```
Он отдаёт ту же статику (`http://localhost:8000`) **плюс** принимает Сохранить (пишет файл
`tracks/<slug>.json`) и Опубликовать (`git add ApexWeb/tracks && commit && push`). Без него
редактор работает, но Сохранить пишет только в localStorage.
```

In the **## Редактор трассы** section, replace the line:

```markdown
Хранится в localStorage. *Пока редактор только авторит эти данные — сим начнёт их использовать
в расчётах отдельным шагом (Шаг 2).*
```

with:

```markdown
**Пак трасс (общий через гит):** запусти редактор через `node tools/editor_server.mjs` — тогда
**Сохранить** пишет трассу файлом в `ApexWeb/tracks/<slug>.json` (и в localStorage), а **📤
Опубликовать** делает `git add ApexWeb/tracks && commit && push`. После пуша трасса грузится у всех
из папки `tracks/` (в редакторе — группа «Из репо», гонять — через 🏁). Без node-сервера Сохранить
остаётся только в localStorage.
```

In the **## Структура** code block, add these lines next to the other `src/`/`tools/` entries:

```markdown
src/track_pack.js  загрузка закоммиченного пака трасс (tracks/) + гидратация в localStorage
src/track_repo.js  HTTP-клиент к tools/editor_server.mjs (Сохранить в файл / Опубликовать)
tracks/            пак трасс: <slug>.json + index.json (манифест), грузятся как встроенные
tools/editor_server.mjs  локальный сервер: статика + /api/save-track + /api/publish (git)
tools/track_pack_io.mjs  чистые FS-хелперы пака (slugify/writeTrack/buildIndex)
```

- [ ] **Step 3: Run the new tests + syntax checks**

Run:
```bash
node --test tests/track_pack_io.test.js tests/track_pack.test.js tests/track_repo.test.js
node --check tools/editor_server.mjs
node --check src/ui/editor.js
```
Expected: all tests PASS (12 total); both `node --check` exit 0 with no output.

- [ ] **Step 4: Run the full suite (regression gate)**

Run: `node --test`
Expected: the whole suite is green (existing ~188 + the 12 new). Untouched modules (`sim`, `track`, `track_build`, `track_store`) unchanged → no regression. (Allow ~10 min for `sim.test.js`.)

- [ ] **Step 5: Commit**

```bash
git add tracks/index.json README.md
git commit -m "feat(apexweb): seed tracks/ pack + README (node editor server, Save→repo→Опубликовать)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Owner F5 (manual — not automatable)

The browser + disk + git loop needs a real run:

1. `cd ApexWeb && node tools/editor_server.mjs`.
2. `http://localhost:8000/editor.html` → draw a track, paint a zone, set pit → **💾 Сохранить** → toast «В репо: tracks/…json»; confirm `ApexWeb/tracks/<slug>.json` appears and `git status` shows **only** `ApexWeb/tracks/` changed (no Godot WIP / `experiments/`).
3. **📤 Опубликовать** → toast «Опубликовано на гит»; `git log -1` shows the `chore(tracks)` commit; the push triggers the Pages deploy.
4. In a second browser profile (or after the deploy), open `editor.html` → the track is in **«Из репо»** → pick it → **🏁 Гонять** races it.

## Self-Review

**1. Spec coverage:**
- Storage format (`tracks/<slug>.json` + `index.json`) → Tasks 1, 6. ✓
- Node helper (static + save + publish, localhost, explicit pathspec) → Task 2. ✓
- `track_pack.js` load + hydrate → Task 3. ✓
- `track_repo.js` save + publish + offline degrade → Task 4. ✓
- Editor wiring (Из репо group, Save→repo, Опубликовать) → Task 5. ✓
- README + structure → Task 6. ✓
- Determinism untouched (no sim/track/data edits) → enforced by the "Untouched" list; full suite gate in Task 6 Step 4. ✓
- Error handling: corrupt pack → `loadPack` []; no helper → `saveToRepo`/`publish` offline; traversal guard; "nothing to commit" → friendly. ✓

**2. Placeholder scan:** No TBD/TODO/"handle errors" — every code/edit step shows full content. ✓

**3. Type consistency:** `slugify`/`writeTrack({slug,file})`/`buildIndex([{slug,name}])`, `loadPack([{slug,name,record}])`, `hydratePack(saveTrack)→names`, `saveToRepo→{ok,slug|offline}`, `publish→{ok,message}`, server `/api/save-track→{ok,slug}` and `/api/publish→{ok,message}` — names/shapes match across tasks and the client/server boundary. ✓
