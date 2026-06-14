# 3D models from Sketchfab — licensing audit & drop-in pipeline

Status: **the 3D race view is procedural and ships with zero external models.** The
track is a ribbon extruded from our own `TRACK_PATH` geometry and cars are tinted
boxes (`src/ui/race3d.js`). Sketchfab models are **optional polish** — at most a
nicer car mesh — and must clear the checks below before being committed.

Context request: *"can we take the 3D track models from the PerilousPyramid
**F1 Tracks** Sketchfab collection for the game?"*

## TL;DR

- A Sketchfab **collection is not one license.** It aggregates models from
  different authors, each with its **own** license. "Take everything from here"
  is not a thing — every model is decided individually.
- The model license covers **geometry only**, never the **brand.** F1 circuit
  names, layouts, team liveries and the "Formula 1 / F1" marks are trademarks; a
  CC license on a mesh does not legalise them. (Same reason our 2D track outlines
  are the neutral CC-BY-4.0 `f1-circuits-svg` shapes, not official assets.)
- For our use, prefer **CC0** or **CC-BY**. Avoid **-NC** (kills any future
  commercial use), **-ND** (no modifications — we must scale/retopo/tint),
  **-SA** (copyleft would infect our source) and **All-Rights-Reserved /
  Sketchfab Standard / Editorial** (no redistribution in a product).
- **The track does not need a model.** A 23-circuit set of trademark-named F1
  track meshes is the highest legal risk and the lowest payoff (we already render
  every track). If we use anything, use a **generic F1-style car** mesh.

## Acceptable-license matrix

| License (Sketchfab label)        | Use in our game?            | Obligations |
|----------------------------------|-----------------------------|-------------|
| CC0 (Public Domain)              | ✅ yes                       | none (credit anyway, polite) |
| CC-BY (Attribution)              | ✅ yes (incl. commercial)    | **credit author + link + license** |
| CC-BY-SA                         | ⚠️ avoid                    | copyleft — would force our source under SA |
| CC-BY-ND                         | ❌ no                        | no modifications (we must scale/tint) |
| CC-BY-NC / -NC-SA / -NC-ND       | ❌ if ever commercial        | non-commercial only |
| Sketchfab Standard / Editorial   | ❌ no                        | no redistribution inside a product |
| All Rights Reserved              | ❌ no                        | — |

## Why I can't auto-fill the audit

Sketchfab is **outside this environment's network allowlist** — both the website
and `api.sketchfab.com` return `403 / host not in allowlist`, and downloading a
model needs a logged-in Sketchfab account. So I cannot enumerate the collection's
models or read their per-model licenses from here.

To complete the audit, do **one** of:
1. Add `sketchfab.com` and `api.sketchfab.com` to the environment's network
   egress settings, then ask me to fill the table; **or**
2. Open each model in the collection, copy the **License** field (shown on the
   right of every model page) plus author + downloadable flag into the table.

## Audit table — `PerilousPyramid / F1 Tracks` (fill in)

> Public API (once allowlisted):
> `GET https://api.sketchfab.com/v3/collections/fd60d88d08704a74b781f041b9bb23f7/models?count=100`
> → each entry has `name`, `user.username`, `license.label`, `isDownloadable`.

| Model name | Author | License | Downloadable | Verdict | Notes |
|------------|--------|---------|--------------|---------|-------|
| _e.g. Monaco Circuit_ | _author_ | _CC-BY?_ | _yes/no_ | _✅/❌_ | trademark name → rename if used |
| | | | | | |

Verdict rule: ✅ only if **license ∈ {CC0, CC-BY}** AND we strip/rename any F1
trademark (circuit name in our data, team logos baked into textures).

## Drop-in pipeline (already wired)

`race3d.js` will swap the box cars for a glTF model **if the file exists**, and
silently keep the boxes otherwise — so committing a cleared model is the only
step needed:

1. Export/convert the cleared model to **glTF binary** and save it as
   `ApexWeb/assets/models/f1car.glb`.
2. Add its attribution to `ApexWeb/assets/models/CREDITS.md` (required for CC-BY).
3. Reload the race → click **3D**. If the nose points the wrong way, flip
   `MODEL_YAW` in `race3d.js`; the mesh is auto-scaled so its longest horizontal
   span ≈ one car length (`CAR_L`).

Notes / things to verify in-browser (can't be tested headless here):
- We pin `three@0.160.0` for both the core and `GLTFLoader` so esm.sh serves a
  single three instance (a second copy would break rendering). If a model renders
  black/invisible, suspect a three-version mismatch first.
- Per-car team tint clones each material and overrides `.color`; a model with
  baked-in livery textures will tint oddly — fine for a prototype, revisit if kept.
- Keep `.glb` small (web load budget). A single shared car mesh is cloned per car.
