#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ApexWeb track-constant extractor (FastF1) — v2.

Pulls REAL F1 data and derives the constants src/data.js uses. Two modes:

  Single track (detailed JSON + diff vs current data.js):
    python tools/fastf1_extract.py --gp Spain --year 2024
    python tools/fastf1_extract.py --gp Spain --year 2024 --sc-years 2021 2022 2023 2024

  Multi-track (normalises power/aero character to a real 0..1 scale -> pw/df):
    python tools/fastf1_extract.py --tracks Monza Monaco Spain Silverstone Hungary --year 2024

OFFLINE calibration tool (TODO #3) — does NOT touch game code. Python computes
targets; you port numbers into src/data.js by hand.

v2 fixes over v1:
  * character (pw/df): physics-based. Curvature from X/Y telemetry -> lateral g
    (v^2 * kappa); aero-dependence = cornering load in the high-speed band, power
    = top speed. (v1 used full_throttle% which mislabelled Barcelona as POWER.)
  * compounds: a single global fit  sec ~ b0 + b_lap*lap + offset_c + deg_c*life
    separates fuel burn (b_lap) from compound pace (offset_c) and tyre deg (deg_c).
    (v1 compared per-stint medians, confounded by fuel/track-evolution.)
  * pw/df 0..1 scale now comes from MEASURED min/max across --tracks, not anchors.
"""

import argparse
import json
import os
import sys
import tempfile
import warnings

import numpy as np
import pandas as pd

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
warnings.filterwarnings("ignore")

import fastf1  # noqa: E402


# current hand-tuned values in src/data.js (only Barcelona exists there today)
CURRENT = {
    "lt": 80.0, "pw": 0.55, "df": 0.82, "ot": 0.30, "pit": 21.5, "sc": 0.25,
    "compound_pace": {"soft": -0.55, "medium": 0.0, "hard": 0.55},
}


# 2024 calendar (fastf1-resolvable GP names) for --calendar
CALENDAR_2024 = [
    "Bahrain", "Saudi Arabia", "Australia", "Japan", "China", "Miami",
    "Emilia Romagna", "Monaco", "Canada", "Spain", "Austria", "Britain",
    "Hungary", "Belgium", "Netherlands", "Italy", "Azerbaijan", "Singapore",
    "United States", "Mexico", "Brazil", "Las Vegas", "Qatar", "Abu Dhabi",
]


def setup_cache():
    cache = os.path.join(tempfile.gettempdir(), "apexweb_fastf1_cache")
    os.makedirs(cache, exist_ok=True)
    fastf1.Cache.enable_cache(cache)


def td_seconds(x):
    if x is None or pd.isna(x):
        return None
    return float(pd.to_timedelta(x).total_seconds())


def load(year, gp, session, **kw):
    s = fastf1.get_session(year, gp, session)
    s.load(**kw)
    return s


def _smooth(a, k=5):
    if len(a) < k:
        return a
    return np.convolve(a, np.ones(k) / k, mode="same")


# --- lap time -----------------------------------------------------------------
def extract_laptimes(race, quali):
    out = {}
    fl_q = quali.laps.pick_fastest()
    out["pole_time"] = td_seconds(fl_q["LapTime"]) if fl_q is not None else None
    laps = race.laps.pick_track_status("1")
    laps = laps[laps["PitInTime"].isna() & laps["PitOutTime"].isna()]
    t = laps["LapTime"].dropna().dt.total_seconds()
    t = t[t < t.quantile(0.95)]
    if len(t):
        out["race_fastest"] = round(float(t.min()), 3)
        out["race_median"] = round(float(t.median()), 3)
        out["race_p20"] = round(float(t.quantile(0.20)), 3)
    return out


# --- power vs aero track character (v2: physics from curvature) ----------------
def extract_character(quali):
    """Cornering load from the racing line. lateral_g = v^2 * kappa / g, where
    kappa (1/m) is path curvature from X/Y. Aero tracks carry high lateral_g in
    fast corners; power tracks live on top speed + long straights."""
    fl = quali.laps.pick_fastest()
    tel = fl.get_telemetry()
    d = tel["Distance"].to_numpy(float)   # metres (authoritative scale)
    x = tel["X"].to_numpy(float)          # fastf1 position, unknown unit -> calibrated below
    y = tel["Y"].to_numpy(float)
    v = tel["Speed"].to_numpy(float)      # km/h
    thr = tel["Throttle"].to_numpy(float)

    # resample onto a uniform 5 m grid so derivatives are stable
    keep = np.concatenate([[True], np.diff(d) > 0])  # strictly increasing distance
    d, x, y, v, thr = d[keep], x[keep], y[keep], v[keep], thr[keep]
    grid = np.arange(d.min(), d.max(), 5.0)
    xi, yi = _smooth(np.interp(grid, d, x)), _smooth(np.interp(grid, d, y))
    vi = np.interp(grid, d, v)
    thi = np.interp(grid, d, thr)

    # calibrate X/Y units: one 5 m grid step should be 5 m of path length. Scale
    # X/Y so the racing line's arc length matches Distance (metres) -> curvature in 1/m.
    raw_step = np.median(np.hypot(np.diff(xi), np.diff(yi)))
    scale = 5.0 / raw_step if raw_step > 0 else 1.0
    xi, yi = xi * scale, yi * scale

    dx, dy = np.gradient(xi, grid), np.gradient(yi, grid)
    ddx, ddy = np.gradient(dx, grid), np.gradient(dy, grid)
    denom = (dx * dx + dy * dy) ** 1.5 + 1e-9
    kappa = _smooth(np.abs(dx * ddy - dy * ddx) / denom, 5)
    vms = vi / 3.6
    # clip to a physical ceiling: real F1 never exceeds ~6.5 g, so anything above
    # is a curvature spike (2nd-derivative noise at clustered points), not signal.
    lat_g = np.clip(vms * vms * kappa / 9.81, 0.0, 6.5)

    seg = 5.0
    total = seg * len(grid)
    fast = vi >= 170          # high-speed band (aero corners live here)
    slow = vi < 120           # low-speed / mechanical grip
    # aero load: mean lateral_g sustained in the fast band
    aero_load = float(np.mean(lat_g[fast])) if fast.any() else 0.0
    hsc_pct = 100.0 * seg * np.sum(fast & (lat_g >= 2.0)) / total
    lsc_pct = 100.0 * seg * np.sum(slow) / total
    ft_pct = 100.0 * seg * np.sum(thi >= 99) / total

    return {
        "top_speed_kmh": round(float(np.nanmax(vi)), 1),
        "aero_load_g": round(aero_load, 2),       # df signal
        "hsc_pct": round(hsc_pct, 1),             # high-speed corner content (df)
        "lsc_pct": round(lsc_pct, 1),             # low-speed corner content (mech)
        "full_throttle_pct": round(ft_pct, 1),    # power signal (secondary)
        "max_lat_g": round(float(np.nanmax(lat_g)), 1),  # sanity (~4-6 g expected)
    }


# --- pit loss -----------------------------------------------------------------
def extract_pit_loss(race):
    """Time lost over an in+out lap pair vs that DRIVER's own green pace. Per-driver
    reference (not a field-wide quick lap) removes car-pace/fuel-phase bias; using
    the driver's median green lap absorbs most of the cold-tyre out-lap warmup."""
    laps = race.laps
    losses = []
    for drv in laps["Driver"].unique():
        dl = laps[laps["Driver"] == drv].sort_values("LapNumber")
        green = dl[dl["PitInTime"].isna() & dl["PitOutTime"].isna()]
        gt = green["LapTime"].dropna().dt.total_seconds()
        gt = gt[gt < gt.quantile(0.90)] if len(gt) else gt   # drop traffic
        if len(gt) < 5:
            continue
        ref = float(gt.median())
        for _, inlap in dl[dl["PitInTime"].notna()].iterrows():
            outlap = dl[dl["LapNumber"] == inlap["LapNumber"] + 1]
            it = td_seconds(inlap["LapTime"])
            ot = td_seconds(outlap["LapTime"].iloc[0]) if len(outlap) else None
            if it and ot:
                loss = (it - ref) + (ot - ref)
                if 10 < loss < 40:
                    losses.append(loss)
    if not losses:
        return None
    return {"pit_loss_s": round(float(np.median(losses)), 1), "n": len(losses)}


# --- overtaking index (on-track passes) ---------------------------------------
def extract_overtakes(race):
    """Count on-track position swaps lap-to-lap, excluding the start (laps 1-2)
    and any swap where either driver pitted on the current or previous lap (pit
    cycle, not a pass). Reported as passes per racing lap -> a track overtaking
    index (normalised to TRACK.ot across tracks in multi mode). Approximate:
    retirements and lapped-car shuffle add a little noise."""
    laps = race.laps[["Driver", "LapNumber", "Position", "PitInTime", "PitOutTime"]].copy()
    laps["Position"] = pd.to_numeric(laps["Position"], errors="coerce")
    laps["pit"] = laps["PitInTime"].notna() | laps["PitOutTime"].notna()
    pos = laps.pivot_table(index="LapNumber", columns="Driver", values="Position")
    pit = laps.pivot_table(index="LapNumber", columns="Driver", values="pit", aggfunc="any")
    lap_ids = sorted(pos.index)
    drivers = list(pos.columns)
    passes, counted = 0, 0
    for i in range(1, len(lap_ids)):
        lp, lc = lap_ids[i - 1], lap_ids[i]
        if lc <= 2:               # skip the start
            continue
        counted += 1
        for j in range(len(drivers)):
            for k in range(j + 1, len(drivers)):
                a, b = drivers[j], drivers[k]
                pa0, pb0 = pos.at[lp, a], pos.at[lp, b]
                pa1, pb1 = pos.at[lc, a], pos.at[lc, b]
                if pd.isna(pa0) or pd.isna(pb0) or pd.isna(pa1) or pd.isna(pb1):
                    continue
                if (pa0 - pb0) * (pa1 - pb1) < 0:   # order flipped this lap
                    if (pit.at[lc, a] or pit.at[lc, b]
                            or pit.at[lp, a] or pit.at[lp, b]):
                        continue                    # pit cycle, not a pass
                    passes += 1
    if counted == 0:
        return None
    return {"passes": passes, "racing_laps": counted,
            "passes_per_lap": round(passes / counted, 2)}


# --- compound pace + degradation (v2: global fuel-separated fit) ---------------
def extract_compounds(race):
    """One linear fit over ALL green race laps:
        sec = b0 + b_lap*lap + off_soft*[soft] + off_hard*[hard]
                 + deg_soft*life*[soft] + deg_med*life*[med] + deg_hard*life*[hard]
    Medium is the baseline. b_lap is the shared fuel-burn term (s/lap, negative);
    off_* are compound pace gaps at equal fuel; deg_* are per-compound wear (s/lap)."""
    laps = race.laps.pick_track_status("1")
    laps = laps[laps["PitInTime"].isna() & laps["PitOutTime"].isna()].copy()
    laps = laps[laps["LapTime"].notna()]
    laps["sec"] = laps["LapTime"].dt.total_seconds()
    laps["life"] = pd.to_numeric(laps["TyreLife"], errors="coerce")
    laps["lap"] = pd.to_numeric(laps["LapNumber"], errors="coerce")
    laps = laps.dropna(subset=["sec", "life", "lap", "Compound"])
    # drop traffic-spoiled laps (top 10% slowest)
    laps = laps[laps["sec"] < laps["sec"].quantile(0.90)]
    if len(laps) < 30:
        return {"error": "too few clean laps"}

    # GUARD against degenerate fits: a compound needs enough laps AND tyre-life
    # spread, else its slope/offset is unidentifiable (collinear with fuel/lap) and
    # the regression explodes (saw Bahrain cS +32, Britain -6 on single races).
    comp = laps["Compound"].str.upper()
    for c in ["SOFT", "MEDIUM", "HARD"]:
        cl = laps[comp == c]
        life_spread = (cl["life"].quantile(0.9) - cl["life"].quantile(0.1)) if len(cl) else 0
        if len(cl) < 15 or life_spread < 5:
            return {"error": "thin/degenerate compound data (wet/red-flag/short stint)",
                    "n": {c2.lower(): int((comp == c2).sum()) for c2 in ["SOFT", "MEDIUM", "HARD"]}}

    is_s = (comp == "SOFT").to_numpy(float)
    is_m = (comp == "MEDIUM").to_numpy(float)
    is_h = (comp == "HARD").to_numpy(float)
    life = laps["life"].to_numpy(float)
    lap = laps["lap"].to_numpy(float)
    y = laps["sec"].to_numpy(float)

    # design matrix (medium offset folded into intercept)
    X = np.column_stack([
        np.ones_like(y), lap, is_s, is_h,
        life * is_s, life * is_m, life * is_h,
    ])
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    b0, b_lap, off_s, off_h, deg_s, deg_m, deg_h = beta
    resid = y - X @ beta
    r2 = 1 - np.var(resid) / (np.var(y) + 1e-9)

    Lref = 3.0  # report pace at ~3 laps of tyre life (fresh-ish), equal fuel
    pace_soft = off_s + (deg_s - deg_m) * Lref
    pace_hard = off_h + (deg_h - deg_m) * Lref
    if abs(pace_soft) > 2.0 or abs(pace_hard) > 2.0 or r2 < 0.2:
        return {"error": "unstable fit", "r2": round(float(r2), 3),
                "raw": {"soft": round(float(pace_soft), 2), "hard": round(float(pace_hard), 2)}}

    def n(mask):
        return int(mask.sum())

    return {
        "fuel_burn_s_per_lap": round(float(b_lap), 3),
        "pace_delta_vs_medium": {
            "soft": round(float(pace_soft), 3),
            "medium": 0.0,
            "hard": round(float(pace_hard), 3),
        },
        "deg_s_per_lap": {
            "soft": round(float(deg_s), 3),
            "medium": round(float(deg_m), 3),
            "hard": round(float(deg_h), 3),
        },
        "r2": round(float(r2), 3),
        "n": {"soft": n(is_s > 0), "medium": n(is_m > 0), "hard": n(is_h > 0)},
    }


# --- compounds from LOW-FUEL laps (clean tyre pace, not race stints) -----------
# Race stints are confounded by fuel/track-evolution/traffic (the v2 calendar run
# gave soft median +0.32, wrong sign). The clean signal is each driver's BEST lap
# per compound in practice/quali: a low-fuel push lap. Comparing per-driver (same
# car, same low fuel) isolates pure tyre pace. Aggregate across drivers/GPs/years.
LF_SESSIONS = ["FP1", "FP2", "FP3", "Q"]


def driver_best_per_compound(session):
    """driver -> {compound: best low-fuel lap (s)} from accurate laps."""
    try:
        laps = session.laps.pick_accurate()
    except Exception:
        laps = session.laps
    out = {}
    for (drv, comp), g in laps.groupby(["Driver", "Compound"], observed=True):
        c = str(comp).upper()
        if c not in ("SOFT", "MEDIUM", "HARD"):
            continue
        t = g["LapTime"].dropna().dt.total_seconds()
        t = t[t > 0]
        if len(t):
            out.setdefault(drv, {})[c] = min(out.get(drv, {}).get(c, 1e9), float(t.min()))
    return out


def extract_global_compounds(years, gps):
    """Pure tyre pace deltas vs medium, aggregated over drivers/GPs/years."""
    deltas_s, deltas_h = [], []
    per_gp = []
    for y in years:
        for gp in gps:
            merged = {}
            for sess in LF_SESSIONS:
                try:
                    s = load(y, gp, sess, telemetry=False, weather=False, messages=False)
                except Exception:
                    continue
                best = driver_best_per_compound(s)
                for drv, cm in best.items():
                    for c, v in cm.items():
                        merged.setdefault(drv, {})[c] = min(merged.get(drv, {}).get(c, 1e9), v)
            gs, gh = [], []
            for drv, cm in merged.items():
                if "MEDIUM" in cm:
                    if "SOFT" in cm:
                        gs.append(cm["SOFT"] - cm["MEDIUM"])
                    if "HARD" in cm:
                        gh.append(cm["HARD"] - cm["MEDIUM"])
            if gs or gh:
                per_gp.append({"gp": gp, "year": y,
                               "soft": round(float(np.median(gs)), 3) if gs else None,
                               "hard": round(float(np.median(gh)), 3) if gh else None,
                               "n": len(merged)})
            deltas_s += gs
            deltas_h += gh
    # outlier trim (wet laps / errors slipping through pick_accurate)
    def trimmed_median(v, lim=2.5):
        v = [x for x in v if abs(x) < lim]
        return round(float(np.median(v)), 3) if v else None, len(v)
    soft, ns = trimmed_median(deltas_s)
    hard, nh = trimmed_median(deltas_h)
    return {"soft_vs_medium": soft, "medium": 0.0, "hard_vs_medium": hard,
            "n_soft": ns, "n_hard": nh, "per_gp": per_gp}


def run_compounds(years, gps, out_path=None):
    print(f"\n=== Global compound pace from low-fuel laps ({years}, {len(gps)} GPs) ===")
    for gp in gps:
        print(f"  ... {gp}", flush=True)
    res = extract_global_compounds(years, gps)
    print(json.dumps(res, indent=2, ensure_ascii=False))
    cur = CURRENT["compound_pace"]
    print(f"\n  current data.js: soft {cur['soft']}  medium 0  hard {cur['hard']}")
    print(f"  real (low-fuel): soft {res['soft_vs_medium']} (n={res['n_soft']})  "
          f"medium 0  hard {res['hard_vs_medium']} (n={res['n_hard']})")
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2, ensure_ascii=False)
        print(f"\nWrote {out_path}")


# --- safety car probability ---------------------------------------------------
def extract_sc(gp, years):
    seen, sc = 0, 0
    detail = []
    for yy in years:
        try:
            s = load(yy, gp, "R", telemetry=False, weather=False, messages=True)
            codes = "".join(str(c) for c in s.track_status["Status"].tolist())
            had = any(c in codes for c in "467")  # 4=SC, 6/7=VSC
            seen += 1
            sc += 1 if had else 0
            detail.append({"year": yy, "sc_or_vsc": had})
        except Exception as e:
            detail.append({"year": yy, "error": type(e).__name__})
    return {"prob": round(sc / seen, 2) if seen else None,
            "years_with_sc": sc, "years_seen": seen, "detail": detail}


# --- per-track raw bundle (shared by both modes) ------------------------------
def extract_track(year, gp, want_compounds=True):
    race = load(year, gp, "R", telemetry=True, weather=False, messages=False)
    quali = load(year, gp, "Q", telemetry=True, weather=False, messages=False)
    out = {"gp": gp, "year": year}
    for label, fn in [
        ("laptimes", lambda: extract_laptimes(race, quali)),
        ("character", lambda: extract_character(quali)),
        ("pit", lambda: extract_pit_loss(race)),
        ("overtakes", lambda: extract_overtakes(race)),
    ]:
        try:
            out[label] = fn()
        except Exception as e:
            out[label] = {"error": f"{type(e).__name__}: {e}"}
    if want_compounds:
        try:
            out["compounds"] = extract_compounds(race)
        except Exception as e:
            out["compounds"] = {"error": f"{type(e).__name__}: {e}"}
    return out


def minmax(vals):
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1.0
    return lambda v: (v - lo) / rng


# --- multi-track / multi-season: average raw signals, then normalise -> pw/df --
def _mean(vals):
    vals = [v for v in vals if v is not None]
    return float(np.mean(vals)) if vals else None


def run_multi(years, gps, out_path=None):
    """For each track, average raw signals over `years` (same ground-effect era),
    THEN min-max-normalise across tracks. Averaging first => a stable 0..1 scale
    that a one-off race can't swing."""
    raw = {}  # gp -> {tops:[], aeros:[], lts:[], pits:[], ppls:[], years:[]}
    for y in years:
        for gp in gps:
            print(f"  ... {y} {gp}", flush=True)
            try:
                r = extract_track(y, gp, want_compounds=False)
            except Exception as e:
                print(f"      FAILED {y} {gp}: {type(e).__name__}: {e}")
                continue
            ch = r.get("character")
            if not (isinstance(ch, dict) and "top_speed_kmh" in ch):
                continue
            d = raw.setdefault(gp, {"tops": [], "aeros": [], "lts": [], "pits": [],
                                    "ppls": [], "years": []})
            d["tops"].append(ch["top_speed_kmh"])
            d["aeros"].append(ch["aero_load_g"])
            lt = r.get("laptimes", {})
            d["lts"].append(lt.get("race_p20") or lt.get("race_median"))
            d["pits"].append((r.get("pit") or {}).get("pit_loss_s"))
            d["ppls"].append((r.get("overtakes") or {}).get("passes_per_lap"))
            d["years"].append(y)
    if len(raw) < 2:
        print("Need >=2 tracks with valid telemetry to normalise.")
        return

    agg = {gp: {"top": _mean(d["tops"]), "aero": _mean(d["aeros"]),
                "lt": _mean(d["lts"]), "pit": _mean(d["pits"]),
                "ppl": _mean(d["ppls"]), "n_years": len(d["years"])}
           for gp, d in raw.items()}
    np_ = minmax([a["top"] for a in agg.values()])
    na = minmax([a["aero"] for a in agg.values()])
    ppls = [a["ppl"] for a in agg.values() if a["ppl"] is not None]
    not_ = minmax(ppls) if len(ppls) >= 2 else (lambda v: None)

    print(f"\n=== Multi-season calibration {years} ({len(agg)} tracks) ===")
    print(f"{'Track':<14}{'yrs':>4}{'lt':>7}{'pit':>7}{'top':>6}{'aeroG':>7}"
          f"{'pw':>6}{'df':>6}{'pw-df':>7}{'ot':>6}")
    print("-" * 66)
    table = []
    for gp, a in sorted(agg.items(), key=lambda kv: (kv[1]["pw"] - kv[1]["df"]) if False else kv[0]):
        pw = round(np_(a["top"]), 2)
        df = round(na(a["aero"]), 2)
        otv = round(not_(a["ppl"]), 2) if a["ppl"] is not None and not_(a["ppl"]) is not None else None
        print(f"{gp:<14}{a['n_years']:>4}{(a['lt'] or 0):>7.1f}{(a['pit'] or 0):>7.1f}"
              f"{(a['top'] or 0):>6.0f}{(a['aero'] or 0):>7.2f}{pw:>6}{df:>6}"
              f"{pw - df:>+7.2f}{(otv if otv is not None else 0):>6.2f}")
        table.append({"gp": gp, "n_years": a["n_years"],
                      "lt": round(a["lt"], 2) if a["lt"] else None,
                      "pit": round(a["pit"], 1) if a["pit"] else None,
                      "pw": pw, "df": df, "ot": otv,
                      "passes_per_lap": round(a["ppl"], 2) if a["ppl"] else None})
    print("\npw=norm(top_speed) df=norm(aero_load_g) ot=norm(passes/lap). pw-df<0 => aero.")
    print("Barcelona cur data.js: pw 0.55 / df 0.82 (pw-df -0.27), ot 0.30.")
    payload = {"years": years, "tracks": table}
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        print(f"\nWrote {out_path}")
    else:
        print(json.dumps(table, indent=2, ensure_ascii=False))


# --- single-track mode --------------------------------------------------------
def run_single(year, gp, sc_years):
    print(f"\n=== FastF1 extract: {gp} GP {year} ===\n")
    rep = extract_track(year, gp, want_compounds=True)
    if sc_years:
        try:
            rep["sc"] = extract_sc(gp, sc_years)
        except Exception as e:
            rep["sc"] = {"error": f"{type(e).__name__}: {e}"}
    print(json.dumps(rep, indent=2, ensure_ascii=False))

    print("\n--- vs current src/data.js ---")
    lt = rep.get("laptimes", {})
    if isinstance(lt, dict):
        print(f"  lt        cur {CURRENT['lt']:>6} | real p20 {lt.get('race_p20')}"
              f"  median {lt.get('race_median')}  pole {lt.get('pole_time')}")
    ch = rep.get("character", {})
    if isinstance(ch, dict) and "aero_load_g" in ch:
        print(f"  character          | aero_load {ch['aero_load_g']}g  top {ch['top_speed_kmh']}km/h"
              f"  hsc {ch['hsc_pct']}%  lsc {ch['lsc_pct']}%  (max_lat {ch['max_lat_g']}g)")
        print(f"  pw-df     cur {CURRENT['pw'] - CURRENT['df']:+.2f} | needs --tracks to place on 0..1")
    pit = rep.get("pit")
    if isinstance(pit, dict) and "pit_loss_s" in pit:
        print(f"  pit       cur {CURRENT['pit']:>6} | real {pit['pit_loss_s']} (n={pit['n']})")
    cp = rep.get("compounds", {})
    if isinstance(cp, dict) and cp.get("pace_delta_vs_medium"):
        d = cp["pace_delta_vs_medium"]
        cur = CURRENT["compound_pace"]
        print(f"  compound  cur S{cur['soft']:+} M0 H{cur['hard']:+} | real "
              f"S{d['soft']:+} M0 H{d['hard']:+}  (fuel {cp['fuel_burn_s_per_lap']}s/lap, R2={cp['r2']}, "
              f"deg S{cp['deg_s_per_lap']['soft']}/M{cp['deg_s_per_lap']['medium']}/H{cp['deg_s_per_lap']['hard']})")
    ov = rep.get("overtakes")
    if isinstance(ov, dict) and ov.get("passes_per_lap") is not None:
        print(f"  overtakes cur {CURRENT['ot']:>6} | real {ov['passes_per_lap']} passes/lap "
              f"({ov['passes']} in {ov['racing_laps']} laps); norm needs --tracks")
    sc = rep.get("sc")
    if isinstance(sc, dict) and sc.get("prob") is not None:
        print(f"  sc        cur {CURRENT['sc']:>6} | real {sc['prob']} "
              f"({sc['years_with_sc']}/{sc['years_seen']} yrs)")


def main():
    ap = argparse.ArgumentParser(description="FastF1 -> ApexWeb track constants (v2)")
    ap.add_argument("--gp", default="Spain")
    ap.add_argument("--year", type=int, default=2024)
    ap.add_argument("--tracks", nargs="*", default=None,
                    help="multi-track mode: normalise pw/df/ot across these GPs")
    ap.add_argument("--calendar", action="store_true",
                    help="multi-track over the full 2024 calendar (24 GPs)")
    ap.add_argument("--years", type=int, nargs="*", default=None,
                    help="average multi-track metrics over these seasons (e.g. 2022 2023 2024)")
    ap.add_argument("--compounds", action="store_true",
                    help="global tyre-pace deltas from low-fuel laps (uses --years + a dry-GP set)")
    ap.add_argument("--out", default=None, help="write result JSON here")
    ap.add_argument("--sc-years", type=int, nargs="*", default=[])
    args = ap.parse_args()

    setup_cache()
    years = args.years or [args.year]

    if args.compounds:
        # dry weekends with reliable practice running (avoid wet/sprint-only)
        dry_gps = ["Bahrain", "Spain", "Hungary", "Japan", "Austria", "Abu Dhabi"]
        run_compounds(years, dry_gps, out_path=args.out)
        return

    tracks = CALENDAR_2024 if args.calendar else args.tracks
    if tracks:
        run_multi(years, tracks, out_path=args.out)
    else:
        run_single(args.year, args.gp, args.sc_years)


if __name__ == "__main__":
    main()
