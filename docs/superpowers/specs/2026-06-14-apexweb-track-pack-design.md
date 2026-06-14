# ApexWeb Track Pack — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorm), pending spec review → plan
**Topic:** Edited tracks become committed repo files ("a track pack") that ship with the
game for everyone, with a one-press **Save → file on disk** flow via a tiny local Node helper
and a **Опубликовать** (publish) button that pushes them to git.

---

## Goal

Today the track editor saves edited tracks to **browser `localStorage`** (`track_store.js`).
That store is per-browser, per-machine: it never reaches git, is not shared, and does not appear
on the deployed GitHub Pages site. The owner wants: **draw a track → press Save → it lands in the
repo automatically → press Опубликовать → it is on git, live, for everyone.**

## Constraints (load-bearing)

1. **A static browser page cannot write files to disk / git.** Plain `python -m http.server`
   serves read-only. To make Save write a file we run a **tiny local Node helper** that serves the
   same static files *and* accepts a save POST. The deployed Pages site stays static and read-only
   (it only *loads* the committed pack — exactly right; visitors don't author).
2. **Determinism is sacred.** `sim.js` / `track.js` / `data.js` / netcode are **untouched**. Pack
   tracks race through the existing Шаг-2 `trackFromEdited` bridge (already determinism-proven and
   Barcelona-byte-identical). This feature is **render/data/tooling only** → it cannot change balance.
3. **Owner keeps parallel uncommitted WIP in the same tree.** The publish endpoint stages with an
   **explicit pathspec — `git add ApexWeb/tracks`** — never `git add -A`. The owner's Godot WIP and
   `experiments/` are never swept into a track-pack commit.
4. **No new infra beyond local Node.** No backend, no database, no GitHub API, no auth. The helper
   binds to **127.0.0.1 only**.

## Architecture — one data flow

> **Repo files = the shared source of truth. `localStorage` = the local working cache.**

- **Load:** opening the editor fetches the committed pack and **hydrates** it into `localStorage`
  (so every existing localStorage-based path — `effectiveTrack`, quick-race — just works unchanged).
- **Save:** writes to **both** — `localStorage` (current behaviour, offline fallback) **and** the
  on-disk file `ApexWeb/tracks/<slug>.json` (via the helper).
- **Publish:** the helper runs `git add ApexWeb/tracks && git commit && git push` → Pages redeploys
  → the track is in everyone's "Из репо" list and raceable.
- **Deployed site (no helper):** loading the pack works (static fetch); Save degrades to
  `localStorage` only, with a toast explaining how to write to the repo. Nothing breaks.

## Storage format

- `ApexWeb/tracks/<slug>.json` — one track per file. Body is exactly the record the editor already
  produces: `{ name, points, objects, pit, pitLoss, zones, cornerOverrides }` (with `name` added for
  display; `slug` is the filename).
- `ApexWeb/tracks/index.json` — manifest the game reads in one fetch (static hosts give no directory
  listing): `[{ slug, name }, ...]`, sorted by name. **Rebuilt by the helper on every save** (scan
  `*.json`), never hand-edited.

## Components (small, single-responsibility)

| File | Responsibility |
|---|---|
| `tools/track_pack_io.mjs` | **Pure** Node helpers: `slugify`, `writeTrack`, `buildIndex`. No HTTP — **unit-testable without a server**. |
| `tools/editor_server.mjs` | Localhost static server for `ApexWeb/` + `POST /api/save-track` + `POST /api/publish`. Thin; delegates writes to `track_pack_io`. Replaces `python` while editing. No npm deps (`http`, `fs`, `child_process`). |
| `src/track_pack.js` (client) | `loadPack()` — fetch manifest + records; `hydrate(saveTrack)` — write each pack record into `localStorage` via an injected `saveTrack`. Tolerates missing/corrupt → empty pack. |
| `src/track_repo.js` (client) | `saveToRepo(record)` and `publish()` — POST to the helper; on network error / 404 resolve to `{ ok:false, offline:true }` (never throws into the editor). |
| `src/ui/editor.js` (modify) | Pack tracks in the preset `<select>` under an optgroup **«Из репо»**; Save → `saveTrack` (localStorage) **+** `saveToRepo`; new **«📤 Опубликовать»** button → `publish`. |
| `editor.html` (modify) | Add the «Опубликовать» button. |
| `README.md` (modify) | Editing now via `node tools/editor_server.mjs`; the Save→file→publish loop; structure list. |

**Untouched:** `track_store.js` (the localStorage layer — the pack hydrates *through* its existing
`saveTrack`), `sim.js`, `track.js`, `track_build.js`, `data.js`, netcode.

## Interfaces

**`tools/track_pack_io.mjs` (pure)**
- `slugify(name) -> string` — transliterate Cyrillic→latin, lowercase, non-alphanumeric → `-`,
  collapse repeats, trim dashes; empty → `"track"`.
- `writeTrack(tracksDir, record) -> { slug, file }` — minimal validation (`points` is an array of
  ≥ 8 numbers), write `<slug>.json` as pretty JSON. Same name → same slug → **overwrite** (that is
  "update this track").
- `buildIndex(tracksDir) -> index` — read every `*.json` except `index.json`, collect `{slug,name}`,
  sort by name, write `index.json`, return it.

**`tools/editor_server.mjs`**
- `createServer({ root, repoRoot })` bound to `127.0.0.1` (port from `PORT`, default `8000`).
- Static GET with path-traversal guard and content-types for `.html/.js/.mjs/.json/.css/.svg`.
- `POST /api/save-track` `{record}` → `writeTrack` + `buildIndex` → `{ ok:true, slug }`.
- `POST /api/publish` → `git add ApexWeb/tracks` → `git commit -m "chore(tracks): publish track pack"`
  → `git push`; returns `{ ok, stdout, stderr }`. "nothing to commit" is reported as a friendly
  no-op, not an error. (Commits are the owner's track-data commits — no AI co-author footer.)

**`src/track_pack.js` (client)**
- `loadPack(base="tracks") -> Promise<Array<{slug,name,record}>>` — fetch `index.json`, then each
  `<slug>.json`; skip any that fail; `[]` if the manifest is missing.
- `hydrate(saveTrack, base?) -> Promise<string[]>` — `loadPack` then `saveTrack(name, record)` for
  each; return the names. `saveTrack` is injected for decoupling/testing.

**`src/track_repo.js` (client)**
- `saveToRepo(record) -> Promise<{ ok:true, slug } | { ok:false, offline:true }>`.
- `publish() -> Promise<{ ok, message }>`.

## UX

1. `node tools/editor_server.mjs` (one command instead of `python`).
2. Draw → **Сохранить** → toast «сохранено в репо: tracks/моя-трасса.json» (or, with no helper,
   «сохранено локально; запусти node-сервер, чтобы писать в репо»).
3. **📤 Опубликовать** → toast with the git result. Live for everyone; appears in **«Из репо»**.
4. Racing a pack track: pick it in the editor → **🏁 Гонять** (the existing Шаг-2 solo quick-race).

## Error handling

- **No helper running** (static / Pages): `saveToRepo`/`publish` resolve `offline` → Save still
  writes `localStorage`; toast explains. Loading the pack still works (static fetch).
- **Publish fails** (no network, auth, non-fast-forward): the button shows git `stderr`; nothing is
  half-written (commit is atomic; a failed push leaves a local commit the owner can retry).
- **Corrupt/missing pack**: `loadPack` skips bad files and returns what it can (degrade to empty),
  mirroring `loadAll`'s tolerance.
- **Path traversal / non-track POST**: server validates the body and rejects with 400.

## Testing

- `tools/track_pack_io.test.js` — `slugify` (Cyrillic, collisions, empties); `writeTrack` round-trip
  to a temp dir; `buildIndex` reflects the files on disk.
- `src/track_pack.test.js` — `loadPack` parses a manifest (with `fetch` stubbed); `hydrate` calls an
  injected `saveTrack` once per track with the right record; corrupt manifest → `[]`.
- Server endpoints are exercised by testing the pure `track_pack_io` they delegate to; the thin HTTP
  glue is verified by manual playtest.
- **Owner F5 playtest** (not automatable — real disk + git + browser): `node tools/editor_server.mjs`
  → draw → Save → confirm `ApexWeb/tracks/<slug>.json` appears → Опубликовать → confirm the commit +
  push (and that **only** `ApexWeb/tracks/` was staged) → on a second browser/profile load the pack
  and 🏁 race it.

## Scope / YAGNI

- **In:** repo-file pack + manifest, Node helper (static + save + publish), editor dropdown group +
  Save-to-repo + Опубликовать button, pack tracks raceable via the existing 🏁, README.
- **Out (deferred, unchanged by this):** a lobby / full-weekend / online **track picker** to race a
  pack track outside the editor's quick-race; auto-commit on every Save; any backend/GitHub-API path;
  deriving lap pace from geometry (separate Шаг-2+ item).

## Deploy note

`tracks/` lives under `ApexWeb/` → a publish push matches the Pages workflow path filter
(`ApexWeb/**`) and **redeploys the live site**. That is the intended "для всех".
