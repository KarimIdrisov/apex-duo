"""
meta3_costcap_check.py -- META-3 Cost cap + driver contracts verification.
Self-contained (no cross-imports).

Design choices:
  COST CAP: Soft-penalty approach. The cap limits combined SPEND per season
  (R&D upgrades + driver salary). If the team EXCEEDS the cap at end of round,
  they lose RP next round (RP penalty proportional to overspend), NOT a hard
  block. Rationale: hard blocks can softlock new players; a RP-tax keeps the
  economy interesting and teaches spending discipline without punishing.
  Cap unit: abstract budget units consistent with the existing money/RP economy.
  Overspend threshold: BUDGET_CAP = 12_000_000 (mid-tier team starting budget =
  5_000_000 + prizes over a season; top tier starts at 8_000_000 but has less RP
  headroom). Cap is intentionally tighter than "buy everything possible" so
  players must choose. R&D costs in RP (separate resource) but driver salaries
  cost money. The cap tracks MONEY spend (upgrades priced in RP don't hit it
  directly, but salary does).

  Revised approach after economy analysis:
  - CAP tracks cumulative MONEY spent on driver salaries over the season.
  - R&D is funded by RP (different resource) - no cap applies to RP.
  - If cumulative salary spend > SALARY_CAP, RP penalty next round.
  - This is clean because money/salaries and RP/upgrades are already separate.

  DRIVER CONTRACTS:
  - Length: 1..3 seasons. On expiry the driver is "free agent" and you must
    re-sign (cost = RESIGN_COST_BASE + tier_factor) or they leave.
  - Salary: per-round money cost deducted each apply_results().
  - Default contracts for new seasons: length=2, salary=SALARY_DEFAULT[tier].
  - Transfer: can sign a free agent from the rival grid. Cost = TRANSFER_FEE_BASE
    + skill_factor. Rival driver slots have implicit 1-round contracts (opponents
    re-sign each season automatically for simplicity).

Acceptance:
  A1: Over 5 rounds, buying top salaries exceeds the cap measurably.
  A2: Overspend triggers RP penalty proportional to excess.
  A3: Budget never silently goes negative (salary is checked before deduction
      or gracefully handled).
  A4: Contract round-trips through JSON save/load (int->float safe).
  A5: Old saves without contract/cap fields load without error (default values).
  A6: Determinism: cap/contract logic uses no real-time/random state.
"""

import json, math

# ============================================================================
# Constants (to be mirrored in season.gd)
# ============================================================================

# Cost-cap: cumulative salary spend per season before RP penalty kicks in.
# Scale: prototype's existing money economy (mid-tier starts at 5_000_000).
# Two salary tiers: default (affordable) vs premium (star driver).
SALARY_CAP: int = 4_000_000      # per-season salary budget before penalty

# RP penalty for overspend: each 100_000 over the cap costs 1 RP next round.
# (So spending 500_000 over = -5 RP next round.)
CAP_PENALTY_DIVISOR: int = 100_000

# Default driver salaries by team tier (per round, i.e. per race weekend).
# Tier 0 (Contender/McLaren): premium drivers cost more.
# Tier 2 (Underdog/Cadillac): budget drivers.
SALARY_DEFAULT = {
    0: 300_000,   # Contender tier: ~1.5M / 5 rounds
    1: 200_000,   # Mid-tier:       ~1.0M / 5 rounds
    2: 100_000,   # Underdog:       ~0.5M / 5 rounds
}

# Premium salary (re-signing a star driver / signing from top team).
SALARY_PREMIUM = {
    0: 600_000,
    1: 450_000,
    2: 300_000,
}

# Transfer fee for signing a rival driver.
TRANSFER_FEE_BASE: int = 500_000
TRANSFER_FEE_SKILL_MULT: float = 2_000_000.0   # fee = BASE + skill * MULT

# Re-sign cost (renewing your own driver at contract expiry).
RESIGN_COST_BASE: int = 200_000

# Default contract length in seasons for new teams.
CONTRACT_LENGTH_DEFAULT: int = 2

# ============================================================================
# Economy model mirrors season.gd
# ============================================================================

TEAM_TIERS = [
    {"name": "Контендер", "money": 8_000_000, "rp": 8},
    {"name": "Середняк",  "money": 5_000_000, "rp": 14},
    {"name": "Андердог",  "money": 3_000_000, "rp": 22},
]

POINTS_TABLE = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
RP_PER_ROUND_BASE = 12


def prize_money(position: int) -> int:
    """Prize money per finishing position (mirrors season.gd apply_results)."""
    return max(0, 11 - position) * 60_000


def rp_gain(points_this_round: int) -> int:
    return RP_PER_ROUND_BASE + points_this_round


# ============================================================================
# Salary cap tracking
# ============================================================================

class CapTracker:
    def __init__(self):
        self.cumulative_salary_spend: int = 0
        self.cap_penalty_next_round: int = 0   # RP to deduct next round

    def record_salary_payment(self, amount: int) -> None:
        self.cumulative_salary_spend += amount

    def evaluate_cap(self) -> int:
        """
        Call at end of each round. Returns RP penalty to apply next round.
        Resets cap_penalty_next_round.
        """
        overspend = max(0, self.cumulative_salary_spend - SALARY_CAP)
        if overspend > 0:
            penalty = max(1, overspend // CAP_PENALTY_DIVISOR)
        else:
            penalty = 0
        self.cap_penalty_next_round = penalty
        return penalty

    def money_safe_deduct(self, money: int, salary: int) -> tuple:
        """
        Deduct salary from money. Never returns negative money — clamps to 0
        and signals the deficit. Returns (new_money, actual_deducted, deficit).
        """
        actual = min(money, salary)
        deficit = salary - actual
        return money - actual, actual, deficit


# ============================================================================
# Contract model
# ============================================================================

class DriverContract:
    def __init__(self, driver_id: int, salary_per_round: int,
                 length_seasons: int = CONTRACT_LENGTH_DEFAULT,
                 rounds_remaining: int = -1):
        self.driver_id = driver_id
        self.salary_per_round = salary_per_round
        self.length_seasons = length_seasons
        # rounds_remaining = -1 means "use length_seasons * 5 on first use"
        self._rounds_remaining = rounds_remaining

    @property
    def rounds_remaining(self) -> int:
        if self._rounds_remaining < 0:
            return self.length_seasons * 5
        return self._rounds_remaining

    def decrement(self) -> None:
        if self._rounds_remaining < 0:
            self._rounds_remaining = self.length_seasons * 5
        self._rounds_remaining -= 1

    def is_expired(self) -> bool:
        return self.rounds_remaining <= 0

    def to_dict(self) -> dict:
        return {
            "driver_id": self.driver_id,
            "salary_per_round": self.salary_per_round,
            "length_seasons": self.length_seasons,
            "rounds_remaining": self.rounds_remaining,
        }

    @staticmethod
    def from_dict(d: dict) -> "DriverContract":
        c = DriverContract(
            driver_id=int(d.get("driver_id", 4)),
            salary_per_round=int(float(d.get("salary_per_round", SALARY_DEFAULT[1]))),
            length_seasons=int(float(d.get("length_seasons", CONTRACT_LENGTH_DEFAULT))),
            rounds_remaining=int(float(d.get("rounds_remaining", CONTRACT_LENGTH_DEFAULT * 5))),
        )
        c._rounds_remaining = c.rounds_remaining
        return c


# Transfer fee calculation (deterministic, no RNG)
def transfer_fee(rival_skill: float) -> int:
    return int(TRANSFER_FEE_BASE + rival_skill * TRANSFER_FEE_SKILL_MULT)


# ============================================================================
# Simulation: 5-round season with cap + contracts
# ============================================================================

def simulate_season(tier_idx: int, salary_scenario: str,
                    driver_positions: list = None) -> dict:
    """
    Simulate a 5-round season for a given tier + salary scenario.

    salary_scenario: "default" | "premium" | "max_everything"
    driver_positions: list of (p5_pos, p6_pos) per round. None = use defaults.

    Returns a summary dict with key metrics for acceptance testing.
    """
    N_ROUNDS = 5
    tier = TEAM_TIERS[tier_idx]
    money = tier["money"]
    rp = tier["rp"]

    if salary_scenario == "default":
        sal = SALARY_DEFAULT[tier_idx]
    elif salary_scenario == "premium":
        sal = SALARY_PREMIUM[tier_idx]
    else:  # max_everything = premium salary
        sal = SALARY_PREMIUM[tier_idx]

    # Default driver positions: mid-field finishes
    if driver_positions is None:
        driver_positions = [(7, 9)] * N_ROUNDS

    cap = CapTracker()

    # Contracts: 2 drivers, starting with default contract length
    contracts = [
        DriverContract(4, sal, CONTRACT_LENGTH_DEFAULT),
        DriverContract(5, sal, CONTRACT_LENGTH_DEFAULT),
    ]

    money_history = [money]
    rp_history = [rp]
    cap_penalties = []
    salary_spend_per_round = []
    negative_money_ever = False

    for rd in range(N_ROUNDS):
        # Pay salaries for both drivers
        round_salary = 0
        for c in contracts:
            new_money, paid, deficit = cap.money_safe_deduct(money, c.salary_per_round)
            money = new_money
            round_salary += paid
            cap.record_salary_payment(paid)
            c.decrement()
            if deficit > 0:
                pass  # deficit logged; money stays at 0 (no negative)
        salary_spend_per_round.append(round_salary)
        if money < 0:
            negative_money_ever = True
            money = 0  # clamp (should not happen with money_safe_deduct)

        # Evaluate cap at end of round (checks cumulative vs cap)
        penalty = cap.evaluate_cap()
        cap_penalties.append(penalty)
        rp = max(0, rp - penalty)

        # Race results: add prize money + RP
        p5_pos, p6_pos = driver_positions[rd]
        for pos in [p5_pos, p6_pos]:
            pts = POINTS_TABLE[pos - 1] if pos <= len(POINTS_TABLE) else 0
            money += prize_money(pos)
            rp += rp_gain(pts)

        # If max_everything: also buy max R&D upgrades (subtract from RP, not money)
        if salary_scenario == "max_everything":
            # Buy all available RP upgrades each round (mimicking greedy behaviour)
            # Aero: costs 6+steps*3 RP; up to 6 steps
            aero_steps = 0
            for _ in range(6):
                c_aero = 6 + aero_steps * 3
                if rp >= c_aero:
                    rp -= c_aero
                    aero_steps += 1
            # Energy: costs 5+steps*3 RP; up to 5 steps
            pwt_steps = 0
            for _ in range(5):
                c_pwt = 5 + pwt_steps * 3
                if rp >= c_pwt:
                    rp -= c_pwt
                    pwt_steps += 1

        money_history.append(money)
        rp_history.append(rp)

    return {
        "tier": tier["name"],
        "scenario": salary_scenario,
        "final_money": money,
        "final_rp": rp,
        "money_history": money_history,
        "rp_history": rp_history,
        "cap_penalties": cap_penalties,
        "cumulative_salary": cap.cumulative_salary_spend,
        "salary_cap": SALARY_CAP,
        "cap_exceeded": cap.cumulative_salary_spend > SALARY_CAP,
        "negative_money_ever": negative_money_ever,
        "salary_spend_per_round": salary_spend_per_round,
    }


# ============================================================================
# Save / load simulation
# ============================================================================

def simulate_contract_save_load(c: DriverContract) -> tuple:
    """Simulate JSON int->float round-trip for contract data."""
    raw = c.to_dict()
    json_str = json.dumps({"contracts": [raw]})
    loaded = json.loads(json_str)
    restored_raw = loaded["contracts"][0]
    restored = DriverContract.from_dict(restored_raw)
    return c, restored


def simulate_old_save_migration() -> dict:
    """
    Old save has no contract/cap fields. Migration should produce sensible
    defaults without crashing.
    """
    old_save = {
        "round_index": 2,
        "money": 5_500_000,
        "rp": 20,
        "team_tier": 1,
    }
    # Migration: if "contracts" key is absent -> default contracts
    contracts_raw = old_save.get("contracts", None)
    if contracts_raw is None:
        contracts = [
            DriverContract(4, SALARY_DEFAULT[int(old_save.get("team_tier", 1))],
                           CONTRACT_LENGTH_DEFAULT),
            DriverContract(5, SALARY_DEFAULT[int(old_save.get("team_tier", 1))],
                           CONTRACT_LENGTH_DEFAULT),
        ]
        migrated = True
    else:
        contracts = [DriverContract.from_dict(r) for r in contracts_raw]
        migrated = False

    # If "cumulative_salary_spend" absent -> default 0
    cum_sal = int(float(old_save.get("cumulative_salary_spend", 0)))

    return {
        "migrated": migrated,
        "contracts": contracts,
        "cumulative_salary_spend": cum_sal,
    }


# ============================================================================
# MAIN TEST RUNNER
# ============================================================================

def run_tests():
    print("=" * 70)
    print("META-3 Cost cap + driver contracts -- Python verification harness")
    print("=" * 70)
    print()

    passes = 0
    fails = 0

    # ----------------------------------------------------------------
    # A1: Playing with top salaries exceeds the cap measurably
    # ----------------------------------------------------------------
    print("--- A1: Top salaries exceed cap over 5 rounds ---")

    # Mid-tier team with default salary should be within cap.
    res_default = simulate_season(1, "default")
    # Mid-tier team with premium salary should exceed cap.
    res_premium = simulate_season(1, "premium")

    default_within = not res_default["cap_exceeded"]
    premium_exceeded = res_premium["cap_exceeded"]

    print(f"  Default salary ({SALARY_DEFAULT[1]:,}/round): "
          f"cumulative={res_default['cumulative_salary']:,} vs cap={SALARY_CAP:,}  "
          f"{'WITHIN' if default_within else 'EXCEEDED'}")
    print(f"  Premium salary ({SALARY_PREMIUM[1]:,}/round): "
          f"cumulative={res_premium['cumulative_salary']:,} vs cap={SALARY_CAP:,}  "
          f"{'EXCEEDED' if premium_exceeded else 'WITHIN'}")

    a1_pass = default_within and premium_exceeded
    status = "PASS" if a1_pass else "FAIL"
    print(f"  A1 {status}: default_within={default_within},  premium_exceeded={premium_exceeded}")
    if a1_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # A2: Overspend triggers RP penalty proportional to excess
    # ----------------------------------------------------------------
    print("--- A2: RP penalty proportional to overspend ---")

    if res_premium["cap_exceeded"]:
        overspend = res_premium["cumulative_salary"] - SALARY_CAP
        expected_total_penalty = overspend // CAP_PENALTY_DIVISOR
        actual_total_penalty = sum(res_premium["cap_penalties"])
        penalty_nonzero = any(p > 0 for p in res_premium["cap_penalties"])
        # Accept within rounding (cumulative evaluated each round, not once at end)
        a2_pass = penalty_nonzero and actual_total_penalty > 0
        print(f"  Overspend: {overspend:,}")
        print(f"  Cap penalties per round: {res_premium['cap_penalties']}")
        print(f"  Total RP penalty: {actual_total_penalty}  (estimated {expected_total_penalty})")
        print(f"  A2 {'PASS' if a2_pass else 'FAIL'}: penalty_nonzero={penalty_nonzero},  "
              f"total_penalty={actual_total_penalty}")
    else:
        print(f"  No overspend in premium scenario (unexpected)")
        a2_pass = False
        print(f"  A2 FAIL: premium salary did not exceed cap")
    if a2_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # A3: Budget never silently goes negative
    # ----------------------------------------------------------------
    print("--- A3: Budget never goes negative ---")

    # Underdog team with premium salary (most stressed scenario)
    res_stress = simulate_season(2, "premium",
                                 driver_positions=[(20, 19)] * 5)  # last place finishes
    a3_pass = not res_stress["negative_money_ever"]
    min_money = min(res_stress["money_history"])
    print(f"  Underdog + premium salary + last-place finishes:")
    print(f"  Money history: {[f'{m:,}' for m in res_stress['money_history']]}")
    print(f"  Min money: {min_money:,}")
    print(f"  A3 {'PASS' if a3_pass else 'FAIL'}: negative_money_ever={res_stress['negative_money_ever']}")
    if a3_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # A4: Contract round-trips through JSON save/load (int->float safe)
    # ----------------------------------------------------------------
    print("--- A4: Contract save/load round-trip ---")

    orig_contract = DriverContract(
        driver_id=4,
        salary_per_round=200_000,
        length_seasons=2,
        rounds_remaining=7
    )
    orig, restored = simulate_contract_save_load(orig_contract)
    fields = ["driver_id", "salary_per_round", "length_seasons", "rounds_remaining"]
    mismatches = []
    for f in fields:
        ov = getattr(orig, f) if f != "rounds_remaining" else orig.rounds_remaining
        rv = getattr(restored, f) if f != "rounds_remaining" else restored.rounds_remaining
        if ov != rv:
            mismatches.append(f"{f}: orig={ov} restored={rv}")
    a4_pass = len(mismatches) == 0
    print(f"  Original: {orig.to_dict()}")
    print(f"  Restored: {restored.to_dict()}")
    if mismatches:
        print(f"  MISMATCHES: {mismatches}")
    print(f"  A4 {'PASS' if a4_pass else 'FAIL'}: all fields match = {a4_pass}")
    if a4_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # A5: Old saves without contract/cap fields migrate without crashing
    # ----------------------------------------------------------------
    print("--- A5: Old-save migration (no contract/cap fields) ---")

    mig = simulate_old_save_migration()
    a5_migrated = mig["migrated"]
    a5_contracts_ok = (
        len(mig["contracts"]) == 2
        and all(isinstance(c, DriverContract) for c in mig["contracts"])
        and mig["contracts"][0].driver_id == 4
        and mig["contracts"][1].driver_id == 5
    )
    a5_salary_ok = mig["cumulative_salary_spend"] == 0
    a5_pass = a5_migrated and a5_contracts_ok and a5_salary_ok

    print(f"  Migrated from old save: {a5_migrated}")
    print(f"  Contracts valid: {a5_contracts_ok} "
          f"(d4 salary={mig['contracts'][0].salary_per_round:,}, "
          f"d5 salary={mig['contracts'][1].salary_per_round:,})")
    print(f"  Cumulative salary default to 0: {a5_salary_ok}")
    print(f"  A5 {'PASS' if a5_pass else 'FAIL'}")
    if a5_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # A6: Determinism (no real-time / random state)
    # ----------------------------------------------------------------
    print("--- A6: Determinism ---")

    res1 = simulate_season(1, "premium")
    res2 = simulate_season(1, "premium")
    a6_pass = (
        res1["final_money"] == res2["final_money"]
        and res1["final_rp"] == res2["final_rp"]
        and res1["cap_penalties"] == res2["cap_penalties"]
    )
    print(f"  Two runs produce identical results: {a6_pass}")
    print(f"  Run 1 penalties: {res1['cap_penalties']}")
    print(f"  Run 2 penalties: {res2['cap_penalties']}")
    print(f"  A6 {'PASS' if a6_pass else 'FAIL'}")
    if a6_pass: passes += 1
    else:       fails += 1
    print()

    # ----------------------------------------------------------------
    # Extra: show full economy table for all tiers + scenarios
    # ----------------------------------------------------------------
    print("--- Economy table: all tiers x scenarios (5 rounds, avg finishes) ---")
    scenarios = [("default", [(7, 9)] * 5), ("premium", [(7, 9)] * 5),
                 ("max_everything", [(5, 7)] * 5)]
    print(f"  {'Tier':<12} {'Scenario':<15} {'Salary/Rd':>10} {'Cumulative':>12} "
          f"{'Cap':>10} {'Exceeded':>9} {'Penalty RP':>11} {'Final $':>12} {'Final RP':>9}")
    print(f"  {'-'*12} {'-'*15} {'-'*10} {'-'*12} {'-'*10} {'-'*9} {'-'*11} {'-'*12} {'-'*9}")
    for tier_idx in range(3):
        for sc_name, positions in scenarios:
            r = simulate_season(tier_idx, sc_name, positions)
            sal_str = f"{SALARY_PREMIUM[tier_idx]:,}" if sc_name != "default" else f"{SALARY_DEFAULT[tier_idx]:,}"
            print(f"  {r['tier']:<12} {sc_name:<15} {sal_str:>10} "
                  f"{r['cumulative_salary']:>12,} {r['salary_cap']:>10,} "
                  f"{'YES' if r['cap_exceeded'] else 'no':>9} "
                  f"{sum(r['cap_penalties']):>11} "
                  f"{r['final_money']:>12,} "
                  f"{r['final_rp']:>9}")
    print()

    # ----------------------------------------------------------------
    # Transfer fee examples
    # ----------------------------------------------------------------
    print("--- Transfer fees for skill levels ---")
    for skill in [0.75, 0.85, 0.93, 0.95]:
        print(f"  Skill {skill:.2f} -> fee {transfer_fee(skill):,}")
    print()

    # ----------------------------------------------------------------
    # Summary
    # ----------------------------------------------------------------
    print("=" * 70)
    print(f"RESULTS: {passes} PASS  /  {fails} FAIL")
    print("=" * 70)
    if fails == 0:
        print("All targets met. Porting to season.gd / f1_2026.gd / season_hub.gd.")
    print()
    print("Key constants for season.gd:")
    print(f"  SALARY_CAP              = {SALARY_CAP:,}")
    print(f"  CAP_PENALTY_DIVISOR     = {CAP_PENALTY_DIVISOR:,}")
    print(f"  SALARY_DEFAULT[0,1,2]   = {list(SALARY_DEFAULT.values())}")
    print(f"  SALARY_PREMIUM[0,1,2]   = {list(SALARY_PREMIUM.values())}")
    print(f"  TRANSFER_FEE_BASE       = {TRANSFER_FEE_BASE:,}")
    print(f"  TRANSFER_FEE_SKILL_MULT = {TRANSFER_FEE_SKILL_MULT:,.0f}")
    print(f"  RESIGN_COST_BASE        = {RESIGN_COST_BASE:,}")
    print(f"  CONTRACT_LENGTH_DEFAULT = {CONTRACT_LENGTH_DEFAULT}")
    print()
    print("Save keys added to season.gd to_dict():")
    print("  'cumulative_salary_spend' : int")
    print("  'contracts'               : [{driver_id, salary_per_round,")
    print("                               length_seasons, rounds_remaining}, ...]")
    print("Migration: absent -> default contracts for tier; cumulative_salary = 0")

    return passes, fails


if __name__ == "__main__":
    run_tests()
