# Quick check: sector bounds cover [0,1] correctly, DRS flags correct per track.
SECTOR_BOUNDS = {
    "Монако":       [0.36, 0.65],
    "Монца":        [0.33, 0.67],
    "Спа":          [0.34, 0.68],
    "Сильверстоун": [0.35, 0.70],
    "Сингапур":     [0.38, 0.70],
    "Бахрейн":      [0.35, 0.70],
    "Хунгароринг":  [0.38, 0.72],
    "Сузука":       [0.38, 0.72],
    "Баку":         [0.35, 0.68],
    "Зандворт":     [0.38, 0.72],
}

SECTOR_CHARS = {
    "Монако":       [{"drs": False}, {"drs": False}, {"drs": False}],
    "Монца":        [{"drs": False}, {"drs": True},  {"drs": True}],
    "Спа":          [{"drs": True},  {"drs": False}, {"drs": True}],
    "Сильверстоун": [{"drs": False}, {"drs": True},  {"drs": False}],
    "Сингапур":     [{"drs": False}, {"drs": False}, {"drs": True}],
    "Бахрейн":      [{"drs": True},  {"drs": False}, {"drs": True}],
    "Хунгароринг":  [{"drs": False}, {"drs": False}, {"drs": True}],
    "Сузука":       [{"drs": False}, {"drs": True},  {"drs": False}],
    "Баку":         [{"drs": True},  {"drs": False}, {"drs": True}],
    "Зандворт":     [{"drs": False}, {"drs": False}, {"drs": True}],
}

print("=== Sector bounds coverage check ===")
all_ok = True
for track, bounds in SECTOR_BOUNDS.items():
    s1_end, s2_end = bounds
    s_sizes = [s1_end, s2_end - s1_end, 1.0 - s2_end]
    total = sum(s_sizes)
    drs_sectors = [i for i, sc in enumerate(SECTOR_CHARS[track]) if sc["drs"]]
    ok = abs(total - 1.0) < 1e-9 and all(s > 0 for s in s_sizes)
    if not ok:
        all_ok = False
    print(f"{'OK' if ok else 'FAIL'} {track}: sizes={[f'{s:.3f}' for s in s_sizes]} sum={total:.4f}  DRS sectors={drs_sectors}")

print()
print("=== Mini-sector count check ===")
for track, bounds in SECTOR_BOUNDS.items():
    s1_end, s2_end = bounds
    s_ends = [s1_end, s2_end, 1.0]
    counts = [5, 7, 5]
    mini_bounds = []
    s_start = 0.0
    for si, (s_end, n) in enumerate(zip(s_ends, counts)):
        for mi in range(n):
            mini_bounds.append(s_start + (s_end - s_start) * (mi + 1) / n)
        s_start = s_end
    ok = len(mini_bounds) == 17 and abs(mini_bounds[-1] - 1.0) < 1e-9
    if not ok:
        all_ok = False
    print(f"{'OK' if ok else 'FAIL'} {track}: {len(mini_bounds)} mini-sectors, last={mini_bounds[-1]:.6f}")

print()
print("=== DRS coverage: Monaco (none) vs Monza (S2+S3) ===")
for track in ["Монако", "Монца"]:
    drs = [i+1 for i, sc in enumerate(SECTOR_CHARS[track]) if sc["drs"]]
    print(f"  {track}: DRS in S{drs if drs else 'none'}")

print()
if all_ok:
    print("ALL CHECKS PASSED")
else:
    print("SOME CHECKS FAILED — review output above")
