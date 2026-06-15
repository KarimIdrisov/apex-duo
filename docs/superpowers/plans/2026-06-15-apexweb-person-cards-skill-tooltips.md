# Person Cards + Skill Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the paddock driver cards (compact action + car-as-backdrop) and add a hover skill tooltip for pilots and staff across the paddock, as pure UI.

**Architecture:** All logic lives in `src/ui/teamviz.js` — pure string builders (`driverSkillTip`/`staffSkillTip`), data-attr helpers (`personTipAttrs`/`staffTipAttrs`), a redesigned `driverCard`, and one DOM piece (`attachPersonTips`, a body-level singleton + delegated hover). `src/ui/season.js` stamps `data-*` on the five person-bearing areas and calls `attachPersonTips(root)`. Driver skills are computed in the UI from `driverAttrs(abbrev, overall)` — no snapshot/sim/data changes.

**Tech Stack:** Vanilla JS ES modules, `node --test` (node:test + node:assert/strict). No build, no icon font (use a Unicode `★`, never Tabler `<i class="ti">` — the game page loads no icon font).

---

**CRITICAL — parallel-WIP discipline:** The owner is actively committing **D4 market** work and editing `src/ui/season.js`, `src/market.js`, `src/development.js`, `src/market.test.js`. For EVERY commit, `git add` ONLY the exact pathspecs named. NEVER `git add -A`/`.`/`-u`, `git commit -a`, or `git stash`. Do NOT push. `data.js`/`sim.js` are READ-ONLY. Commit trailer: a second `-m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"`.

**CRITICAL — test runner:** `node --test` (full suite) takes ~12 min (`sim.test.js` runs hundreds of races) and HANGS if run concurrently with another suite. Per task, verify with `node --check <file>` and the **fast non-sim suite**:
`node --test --test-force-exit $(ls tests/*.test.js | grep -v -E 'sim\.test|sim_edited_track\.test')`
Run the full suite at most ONCE, at the very end, alone.

## File Structure

- `src/ui/teamviz.js` — MODIFY. Add tooltip builders + helpers (Task 1), redesign `driverCard` (Task 2), add `attachPersonTips` (Task 3).
- `tests/teamviz.test.js` — MODIFY. Add tests for the builders/helpers (Task 1), the card stamp (Task 2), the attach no-throw (Task 3).
- `src/ui/season.js` — MODIFY (surgical, owner D4 WIP; **controller applies directly**). Compact button + tip-attrs on 5 areas + `attachPersonTips(root)` (Task 4).
- `README.md` — MODIFY. Document the tooltips (Task 5).

---

### Task 1: teamviz.js — skill-tooltip builders + tip-attr helpers (TDD)

**Files:** Modify `src/ui/teamviz.js`; Modify `tests/teamviz.test.js`.

- [ ] **Step 1: Append the failing tests to `tests/teamviz.test.js`**

```js
import { ATTR_RU, STAFF_TIP, personTipAttrs, staffTipAttrs, driverSkillTip, staffSkillTip } from "../src/ui/teamviz.js";
import { ATTR_KEYS } from "../src/team.js";

test("ATTR_RU: a Russian label for every one of the 13 attribute keys", () => {
  assert.equal(ATTR_KEYS.length, 13);
  for (const k of ATTR_KEYS) assert.equal(typeof ATTR_RU[k], "string", `missing label for ${k}`);
});

test("personTipAttrs / staffTipAttrs: emit the expected data-attributes", () => {
  const d = personTipAttrs({ abbrev: "VER", overall: 0.944, team: "Red Bull", name: "Ферстаппен", age: 28 });
  assert.match(d, /data-driver="VER"/); assert.match(d, /data-ovr="0\.944"/);
  assert.match(d, /data-team="Red Bull"/); assert.match(d, /data-name="Ферстаппен"/); assert.match(d, /data-age="28"/);
  const s = staffTipAttrs({ role: "strategist", val: 0.82, team: "Mercedes" });
  assert.match(s, /data-staff="strategist"/); assert.match(s, /data-val="0\.82"/); assert.match(s, /data-team="Mercedes"/);
});

test("driverSkillTip: header (name + OVR) + all 13 labels + bars", () => {
  const h = driverSkillTip("VER", 0.944, "Red Bull", "Ферстаппен", 28);
  assert.match(h, /Ферстаппен/); assert.match(h, /OVR/); assert.match(h, />94</, "OVR rounded to 94");
  for (const k of ATTR_KEYS) assert.ok(h.includes(ATTR_RU[k]), `tip missing ${ATTR_RU[k]}`);
  assert.match(h, /width:\d+%/, "has at least one bar fill");
  assert.match(h, /★/, "marks top skills with a star");
});

test("staffSkillTip: role label + rating + effect line", () => {
  const h = staffSkillTip("strategist", 0.82, "Mercedes");
  assert.match(h, /Стратег/); assert.match(h, />82</); assert.ok(h.includes(STAFF_TIP.strategist));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/teamviz.test.js`
Expected: FAIL — the new symbols are not exported yet.

- [ ] **Step 3: Add the imports + builders to `src/ui/teamviz.js`**

At the top, the existing import is `import { TEAMS, TEAM_LOGO } from "../data.js";`. Add after it:
```js
import { driverAttrs, ATTR_KEYS } from "../team.js";
import { ROLE_LABEL } from "../staff.js";
```
At the END of the file, append:
```js
// RU labels for the 13 driver attributes (keys = ATTR_KEYS from team.js)
export const ATTR_RU = { pace: "Темп", quali: "Квала", tyre: "Резина", overtaking: "Обгон",
  defending: "Защита", consistency: "Стабильн.", composure: "Хладнокр.", aggression: "Агрессия",
  discipline: "Дисципл.", wet: "Дождь", starts: "Старт", race_iq: "Гонч. IQ", smoothness: "Плавность" };

// what each staff role affects (one line each)
export const STAFF_TIP = {
  designer: "Разработка машины: скорость R&D и прирост деталей.",
  strategist: "Питы, реакция на сейфти-кар и дождь, выбор стратегии гонки.",
  pitCrew: "Скорость пит-стопа — меньше потерь времени в боксах." };

// data-attr strings spliced into a hover target (values are quote-free: team names + Cyrillic names)
export function personTipAttrs({ abbrev, overall, team, name, age }) {
  return `data-driver="${abbrev}" data-ovr="${overall}" data-team="${team}" data-name="${name}" data-age="${age}"`;
}
export function staffTipAttrs({ role, val, team }) {
  return `data-staff="${role}" data-val="${val}" data-team="${team}"`;
}

// pilot tooltip: header (avatar + name + age + OVR) + 13 team-coloured mini-bars, top-3 starred.
export function driverSkillTip(abbrev, overall, team, name, age) {
  const col = teamColor(team);
  const a = driverAttrs(abbrev, Number(overall));
  const vals = ATTR_KEYS.map(k => Math.round((a[k] || 0) * 100));
  const order = vals.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0] || x[1] - y[1]);
  const topIdx = new Set(order.slice(0, 3).map(x => x[1]));
  const bars = ATTR_KEYS.map((k, i) => {
    const v = vals[i], t = topIdx.has(i);
    return `<div style="display:flex;align-items:center;gap:6px">`
      + `<span style="font-size:11px;color:${t ? "#ECEDEE" : "#A1A1AA"};width:74px;flex:0 0 auto">${ATTR_RU[k]}${t ? ` <span style="color:${col}">★</span>` : ""}</span>`
      + `<span style="flex:1;height:5px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden"><span style="display:block;height:5px;width:${v}%;background:${col};opacity:${t ? 1 : 0.78}"></span></span>`
      + `<span style="font-size:11px;font-weight:600;width:18px;text-align:right;color:#ECEDEE">${v}</span></div>`;
  }).join("");
  return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:9px">`
    + driverAvatar(abbrev, team, 40)
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${name}</div>`
    +   `<div style="font-size:11px;color:#A1A1AA">${team} · ${age} лет</div></div>`
    + `<div style="text-align:right"><div style="font-size:10px;color:#A1A1AA">OVR</div>`
    +   `<div style="font-weight:800;font-size:20px;color:${col}">${Math.round(Number(overall) * 100)}</div></div></div>`
    + `<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">${bars}</div>`;
}

// staff tooltip: role + rating + bar + effect line. Letter-block avatar (no icon font in the game).
export function staffSkillTip(role, val, team) {
  const col = teamColor(team), ink = teamInk(col), v = Math.round(Number(val) * 100);
  const label = ROLE_LABEL[role] || role;
  return `<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">`
    + `<div style="width:38px;height:38px;border-radius:9px;background:${col};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:${ink}">${label[0]}</div>`
    + `<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px">${label}</div>`
    +   `<div style="font-size:11px;color:#A1A1AA">персонал · ${team}</div></div>`
    + `<div style="font-weight:800;font-size:20px;color:${col}">${v}</div></div>`
    + `<div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;margin-bottom:8px"><div style="height:6px;width:${v}%;background:${col};border-radius:3px"></div></div>`
    + `<div style="font-size:11px;color:#A1A1AA;line-height:1.55">${STAFF_TIP[role] || ""}</div>`;
}
```

- [ ] **Step 4: Run to verify it passes + syntax-check**

Run: `node --test tests/teamviz.test.js` → Expected: all green (8 prior + 4 new).
Run: `node --check src/ui/teamviz.js` → Expected: no output.

- [ ] **Step 5: Commit (explicit pathspecs)**

```bash
git add src/ui/teamviz.js tests/teamviz.test.js
git commit -m "feat(apexweb): teamviz skill-tooltip builders (pilot 13 attrs + staff) + tip-attr helpers" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: teamviz.js — redesign `driverCard` (compact + car backdrop + stamp tip-attrs)

**Files:** Modify `src/ui/teamviz.js` (the `driverCard` function); Modify `tests/teamviz.test.js`.

- [ ] **Step 1: Add the failing test (append to `tests/teamviz.test.js`)**

```js
test("driverCard: stamps data-driver when overall is provided; omits it otherwise", () => {
  const withTip = driverCard({ team: "McLaren", abbrev: "NOR", name: "Норрис", overall: 0.95, age: 25 }, { car: true, sub: "x" });
  assert.match(withTip, /data-driver="NOR"/, "card is a hover target when overall is given");
  assert.match(withTip, /data-ovr="0\.95"/);
  const noTip = driverCard({ team: "McLaren", abbrev: "NOR", name: "Норрис" }, { sub: "x" });
  assert.doesNotMatch(noTip, /data-driver=/, "no tip-attrs without overall");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/teamviz.test.js`
Expected: FAIL — current `driverCard` never emits `data-driver`.

- [ ] **Step 3: Replace the `driverCard` function in `src/ui/teamviz.js`**

Find the current `export function driverCard(d, opts = {}) { … }` (ends just before the Task-1 appended block) and replace the WHOLE function with:
```js
// A team-coloured driver card: avatar + name + team chip + sub-line, optional car render + action.
// d = { team, abbrev, name, overall?, age? }. When overall is given, the card is a skill-tooltip trigger.
// opts = { car?:bool, sub?:html, action?:html }.
export function driverCard(d, opts = {}) {
  const col = teamColor(d.team), ink = teamInk(col);
  const tip = (d.overall != null)
    ? " " + personTipAttrs({ abbrev: d.abbrev, overall: d.overall, team: d.team, name: d.name, age: d.age })
    : "";
  const car = opts.car
    ? `<img src="${carImgSrc(d.team)}" alt="" onerror="this.style.display='none'" style="position:absolute;right:-6px;bottom:-22px;height:120px;object-fit:contain;opacity:.10;pointer-events:none">`
    : "";
  const sub = opts.sub ? `<div class="label" style="margin-top:3px">${opts.sub}</div>` : "";
  const act = opts.action ? `<div style="flex:0 0 auto">${opts.action}</div>` : "";
  return `<div${tip} style="position:relative;overflow:hidden;background:var(--content2);border:1px solid var(--border);border-left:4px solid ${col};border-radius:var(--r-md);padding:11px 12px;min-height:64px">`
    + `<div style="position:relative;display:flex;align-items:center;gap:10px">`
    +   driverAvatar(d.abbrev, d.team, 46)
    +   `<div style="min-width:0;flex:1">`
    +     `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><b>${d.name}</b>`
    +       `<span style="font-size:10px;font-weight:600;color:${ink};background:${col};border-radius:4px;padding:1px 6px">${d.team}</span></div>`
    +     sub
    +   `</div>`
    +   act
    + `</div>` + car + `</div>`;
}
```
(`personTipAttrs` is defined later in the file but hoisting makes function declarations available — fine. The car render is now a faint backdrop; the action sits inline at the row's right, not full-width.)

- [ ] **Step 4: Run to verify it passes (incl. the prior driverCard test) + syntax**

Run: `node --test tests/teamviz.test.js` → Expected: all green (the earlier `driverCard` test — name/photo/car/sub — still passes; the new stamp test passes).
Run: `node --check src/ui/teamviz.js` → Expected: no output.

- [ ] **Step 5: Commit (explicit pathspecs)**

```bash
git add src/ui/teamviz.js tests/teamviz.test.js
git commit -m "feat(apexweb): teamviz driverCard redesign — compact action, car backdrop, tooltip trigger" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: teamviz.js — `attachPersonTips` (DOM singleton + delegated hover)

**Files:** Modify `src/ui/teamviz.js` (append `attachPersonTips`); Modify `tests/teamviz.test.js`.

- [ ] **Step 1: Add the failing test (append to `tests/teamviz.test.js`)**

```js
import { attachPersonTips } from "../src/ui/teamviz.js";

test("attachPersonTips: a no-op (no throw) when there is no DOM", () => {
  assert.equal(typeof attachPersonTips, "function");
  assert.doesNotThrow(() => attachPersonTips(null));
  assert.doesNotThrow(() => attachPersonTips({}));  // no document in node → early return
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/teamviz.test.js`
Expected: FAIL — `attachPersonTips` not exported.

- [ ] **Step 3: Append `attachPersonTips` to `src/ui/teamviz.js`**

```js
// Hover skill tooltips: one body-level singleton + a delegated listener on `root`. Targets carry
// data-driver/-ovr/-team/-name/-age (pilots) or data-staff/-val/-team (staff). Desktop hover; the tip
// is pointer-events:none so it never blocks buttons under it. Idempotent — safe to call every render.
let _personTipEl = null;
export function attachPersonTips(root) {
  if (typeof document === "undefined" || !root || !root.addEventListener) return;
  if (!_personTipEl) {
    _personTipEl = document.createElement("div");
    _personTipEl.id = "apex-person-tip";
    _personTipEl.style.cssText = "position:fixed;z-index:9999;pointer-events:none;min-width:240px;max-width:320px;"
      + "background:#18181b;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;display:none;"
      + "box-shadow:0 10px 30px rgba(0,0,0,.55);color:#ECEDEE;font-family:inherit";
    document.body.appendChild(_personTipEl);
  }
  const tip = _personTipEl;
  const place = (el) => {
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - tw - 8);
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = Math.max(8, r.top - th - 8);
    tip.style.left = left + "px"; tip.style.top = top + "px";
  };
  const show = (el) => {
    const ds = el.dataset;
    const html = ds.driver ? driverSkillTip(ds.driver, ds.ovr, ds.team, ds.name, ds.age)
      : ds.staff ? staffSkillTip(ds.staff, ds.val, ds.team) : "";
    if (!html) return;
    tip.innerHTML = html; tip.style.display = "block"; place(el);
  };
  const hide = () => { tip.style.display = "none"; };
  if (root._apexTipOver) { root.removeEventListener("mouseover", root._apexTipOver); root.removeEventListener("mouseout", root._apexTipOut); }
  root._apexTipOver = (e) => { const t = e.target.closest && e.target.closest("[data-driver],[data-staff]"); if (t) show(t); };
  root._apexTipOut = (e) => { const t = e.target.closest && e.target.closest("[data-driver],[data-staff]"); if (t && (!e.relatedTarget || !t.contains(e.relatedTarget))) hide(); };
  root.addEventListener("mouseover", root._apexTipOver);
  root.addEventListener("mouseout", root._apexTipOut);
}
```

- [ ] **Step 4: Run to verify it passes + syntax + module load**

Run: `node --test tests/teamviz.test.js` → Expected: all green.
Run: `node --check src/ui/teamviz.js && node -e "import('./src/ui/teamviz.js').then(()=>console.log('LOAD-OK'))"` → Expected: no `--check` output; `LOAD-OK`.

- [ ] **Step 5: Commit (explicit pathspecs)**

```bash
git add src/ui/teamviz.js tests/teamviz.test.js
git commit -m "feat(apexweb): teamviz attachPersonTips — hover skill tooltip (singleton + delegation)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: season.js — paddock wiring (controller applies directly; owner D4 WIP)

**Files:** Modify `src/ui/season.js` (5 row/card areas + import + `attachPersonTips(root)` call).

**Scene:** `season.js` is the owner's actively-edited D4 paddock screen. Re-read the current file before editing (line numbers drift). Change ONLY the markup below; keep every panel-builder and click handler. `git add` only `src/ui/season.js`.

- [ ] **Step 1: Extend the teamviz import**

Current: `import { teamColor, driverAvatar, driverCard } from "./teamviz.js";`
Change to:
```js
import { teamColor, driverAvatar, driverCard, personTipAttrs, staffTipAttrs, attachPersonTips } from "./teamviz.js";
```

- [ ] **Step 2: Пилоты — pass overall/age into driverCard + compact button**

Find the `driverCards` builder (currently passes `{ team, abbrev, name }` and an action `<button class="ready resign" …>`). Replace it with:
```js
  const driverCards = mine.map(([ab, d]) => driverCard(
    { team: myTeamName, abbrev: ab, name: DRIVER_NAME[ab] || ab, overall: d.overall, age: d.age },
    { car: true,
      sub: `${d.age} лет · ovr ${d.overall.toFixed(3)} · мораль ${Math.round(d.morale * 100)}% · ${d.contractSeasons} сез. · ${m$(d.salary)}/гонка`,
      action: `<button class="resign" data-ab="${ab}" style="background:transparent;border:1px solid var(--border);color:var(--ink);border-radius:8px;padding:5px 11px;font-size:12px;font-weight:600">Продлить</button>` }
  )).join("");
```
(Button drops `.ready` → no `width:100%`; keeps `class="resign"` + `data-ab` for the handler. The card now triggers the skill tooltip.)

- [ ] **Step 3: Зачёт — make the driver-standings name cell a tooltip target**

Find the `drvTbl` builder (currently `driverAvatar(r.abbrev, r.team, 22) + <b>${r.abbrev}</b>`). Replace its first cell content with a wrapped span that resolves overall/age from `c.drivers`:
```js
  const drvTbl = drv.map(r => { const dd = (c.drivers && c.drivers[r.abbrev]) || {};
    const tip = dd.overall != null ? personTipAttrs({ abbrev: r.abbrev, overall: dd.overall, team: r.team, name: DRIVER_NAME[r.abbrev] || r.abbrev, age: dd.age }) : "";
    return row([r.pos,
      `<span ${tip} style="cursor:default">${driverAvatar(r.abbrev, r.team, 22)} <b style="vertical-align:middle">${r.abbrev}</b></span>`, r.team, r.pts]);
  }).join("");
```

- [ ] **Step 4: Команда — make each staff role row a tooltip target**

In the `staffPanel`, the `STAFF_ROLES.map(rk => row([ROLE_LABEL[rk], …]))` first cell is `ROLE_LABEL[rk]`. Replace that first cell with a wrapped span:
```js
    ${STAFF_ROLES.map(rk => row([`<span ${staffTipAttrs({ role: rk, val: st[rk], team: myTeamName })} style="cursor:default">${ROLE_LABEL[rk]}</span>`, `${Math.round(st[rk] * 100)}`,
      `<button class="ready stf" data-kind="staff" data-key="${rk}" ${c.money < STAFF_UPGRADE_COST || st[rk] >= 0.99 ? "disabled" : ""} style="padding:3px 8px;font-size:12px">+ (${m$(STAFF_UPGRADE_COST)})</button>`])).join("")}
```
(Facilities rows are unchanged — they are buildings, not people.)

- [ ] **Step 5: Трансферы — wrap the available-driver name cell**

In `transferPanel`, the first cell is `<b>${d.abbrev}</b> ${DRIVER_NAME[d.abbrev] || ""}${freeAgent(d) ? …}`. Wrap it:
```js
    ${avail.map(d => row([`<span ${personTipAttrs({ abbrev: d.abbrev, overall: d.overall, team: DRIVER_INFO[d.abbrev] ? DRIVER_INFO[d.abbrev].team : "", name: DRIVER_NAME[d.abbrev] || d.abbrev, age: d.age })} style="cursor:default"><b>${d.abbrev}</b> ${DRIVER_NAME[d.abbrev] || ""}</span>${freeAgent(d) ? ` <span class="label">СА</span>` : ""}`, `ovr ${d.overall.toFixed(3)}`, `${d.age} л.`, m$(signCost(d)),
      mineAbbrevs.map(ab => `<button class="ready sign" data-in="${d.abbrev}" data-out="${ab}" ${c.money < signCost(d) ? "disabled" : ""} style="padding:3px 6px;font-size:11px;margin-left:4px">↔${ab}</button>`).join("")])).join("")}
```
Add `DRIVER_INFO` to the data import at the top of `season.js`: change `import { TEAM_LOGO, TEAMS } from "../data.js";` to `import { TEAM_LOGO, TEAMS, DRIVER_INFO } from "../data.js";`.

- [ ] **Step 6: Академия — wrap the junior name cells (both `acadRows` and `scoutRows`)**

For both `acadRows` and `scoutRows`, the first cell is `<b>${j.abbrev}</b> ${j.name}`. Wrap each with the junior's own overall/age/name (juniors are not in `c.drivers`):
```js
  const jtip = j => personTipAttrs({ abbrev: j.abbrev, overall: j.overall, team: myTeamName, name: j.name, age: j.age });
  const acadRows = acad.map(j => row([`<span ${jtip(j)} style="cursor:default"><b>${j.abbrev}</b> ${j.name}</span>`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    j.overall >= SUPERLICENSE
      ? mineAbbrevs.map(ab => `<button class="ready promote" data-j="${j.abbrev}" data-out="${ab}" style="padding:3px 6px;font-size:11px;margin-left:4px">▲${ab}</button>`).join("")
      : `<span class="label">нужен ovr ${SUPERLICENSE}</span>`])).join("");
  const scoutRows = scout.map(j => row([`<span ${jtip(j)} style="cursor:default"><b>${j.abbrev}</b> ${j.name}</span>`, `${j.age} л.`, `ovr ${j.overall.toFixed(3)}`, `пот. ${j.potential.toFixed(2)}`,
    `<button class="ready scout" data-j="${j.abbrev}" ${c.money < SCOUT_FEE ? "disabled" : ""} style="padding:3px 8px;font-size:11px">Подписать (${m$(SCOUT_FEE)})</button>`])).join("");
```
(Define `jtip` once just before `acadRows`. The juniors use the player's team colour `myTeamName` since they belong to your academy.)

- [ ] **Step 7: Call `attachPersonTips(root)` after the paddock is rendered**

Find the line that sets the paddock HTML — `root.innerHTML = tabBar + ... + footer ...;` followed by the `.pad-tab` click wiring. Immediately AFTER `root.innerHTML = …;` (and after the existing `root.querySelectorAll(".pad-tab")…` wiring is fine too), add:
```js
  attachPersonTips(root);
```

- [ ] **Step 8: Verify (controller runs these)**

```bash
node --check src/ui/season.js
node -e "import('./src/ui/season.js').then(()=>console.log('LOAD-OK')).catch(e=>{console.error(e.message);process.exit(1)})"
node --test --test-force-exit $(ls tests/*.test.js | grep -v -E 'sim\.test|sim_edited_track\.test')
```
Expected: no `--check` output; `LOAD-OK`; the non-sim suite reports `# fail 0`.

- [ ] **Step 9: Commit (explicit pathspec — season.js only)**

```bash
git add src/ui/season.js
git commit -m "feat(apexweb): paddock — compact driver-card action + skill tooltips on pilots & staff" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: README + final verification

**Files:** Modify `README.md`.

- [ ] **Step 1: Document the tooltips in the structure line**

In `README.md`, find the `src/ui/teamviz.js` structure line (added in the team-visuals pass). Append to it: `; тултип навыков при наведении (пилот: 13 атрибутов из driverAttrs; персонал: рейтинг роли + эффект) — attachPersonTips`.

- [ ] **Step 2: Run the full suite once, alone, for the count**

Run (NOTHING else running): `node --test --test-force-exit 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# fail 0`. Note the `# tests N` total.

- [ ] **Step 3: Update the test count**

In `README.md`, set the `node --test` count number (the `(NNN: …)` after «модульные тесты чистого ядра») to the total from Step 2.

- [ ] **Step 4: Commit (explicit pathspec — README only)**

```bash
git add README.md
git commit -m "docs(apexweb): README — skill tooltips + test count" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final scope check**

Run: `git log --oneline -6 --stat`
Expected: the feature commits touch only `src/ui/teamviz.js`, `tests/teamviz.test.js`, `src/ui/season.js`, `README.md`. No `main.js`/`data.js`/`sim.js`/`market.js`/Godot/`experiments/`. Do NOT push.

---

## Self-Review

**1. Spec coverage:**
- Card redesign (compact button + car backdrop) → Task 2 (`driverCard`) + Task 4 Step 2 (compact button). ✓
- Tooltip builders (driver 13 attrs top-3 starred; staff role+rating+effect) → Task 1. ✓
- `personTipAttrs`/`staffTipAttrs` + `ATTR_RU`/`STAFF_TIP` → Task 1. ✓
- `attachPersonTips` singleton + delegation + position-flip + idempotent + pointer-events:none → Task 3. ✓
- Wiring across Пилоты/Зачёт/Команда/Трансферы/Академия + `attachPersonTips(root)` → Task 4. ✓
- Overall resolved from `careerView.drivers` for standings → Task 4 Step 3. ✓
- Pure UI; only teamviz.js + season.js + teamviz.test.js (+ README); sim/data untouched → all tasks. ✓
- No `style.css` change; no icon font (★ + letter-block) → Tasks 1, 3. ✓

**2. Placeholder scan:** Every code step has full before/after. No TBD/"handle edge cases"/"similar to". The `attachPersonTips` node-test is a real no-throw assertion (DOM behaviour is F5-gated, stated). ✓

**3. Type consistency:** `personTipAttrs({abbrev,overall,team,name,age})` and `staffTipAttrs({role,val,team})` take the same object shapes at every call site (Tasks 1–4). `driverSkillTip(abbrev,overall,team,name,age)` / `staffSkillTip(role,val,team)` positional args match `attachPersonTips`'s `dataset` reads (`ds.driver,ds.ovr,ds.team,ds.name,ds.age` / `ds.staff,ds.val,ds.team`). `driverCard` `d` grows to `{team,abbrev,name,overall?,age?}` — Task 4 Step 2 passes exactly that. `ATTR_RU` keyed by `ATTR_KEYS`. ✓
