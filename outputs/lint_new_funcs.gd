extends Control

# Standalone lint check for new functions added to main.gd (HUD energy spec).
# gdparse / gdlint this file; it contains all new/changed logic.

const DEPLOY_BUDGET_BASE := 8.5

var track_char_label: RichTextLabel
var _track_char_set := false
var panels: Array = []
var snapshot: Dictionary = {}
var game_mode := ""


# --- new helper: build BBCode string for track character strip ---
func _track_char_bbcode(energy_limit: float, aero_zones: int) -> String:
	var tier_word: String
	var tier_col: String
	if energy_limit < 0.70:
		tier_word = "НИЗКИЙ"
		tier_col = "#e23b3b"
	elif energy_limit < 0.90:
		tier_word = "СРЕДНИЙ"
		tier_col = "#f2c14e"
	else:
		tier_word = "ВЫСОКИЙ"
		tier_col = "#5dd17a"
	var zones_str: String = "нет" if aero_zones == 0 else str(aero_zones)
	return "Энерголимит: [color=%s]%s[/color] · Прямые зоны: %s" % [tier_col, tier_word, zones_str]


# --- new helper: set track character label ---
func _set_track_char_label(energy_limit: float, aero_zones: int) -> void:
	if track_char_label != null:
		track_char_label.text = _track_char_bbcode(energy_limit, aero_zones)


# --- deploy_bar update logic (extracted from _update_panels) ---
func _update_deploy_bar(p: Dictionary, e: Dictionary) -> void:
	if p.has("deploy_bar"):
		var db: ProgressBar = p["deploy_bar"]
		var dmax: float = float(e.get("deploy_budget_max", DEPLOY_BUDGET_BASE))
		var dval: float = float(e.get("deploy_budget", dmax))
		if dmax > 0.0:
			db.max_value = dmax
			db.value = dval
			var dfrac: float = dval / dmax
			if dfrac >= 0.60:
				db.modulate = Color("#5dd17a")
			elif dfrac >= 0.20:
				db.modulate = Color("#f2c14e")
			else:
				db.modulate = Color("#e23b3b")


# --- client track-char strip one-shot (extracted from _update_hud) ---
func _maybe_set_client_track_char() -> void:
	if game_mode == "client" and not _track_char_set and snapshot.has("energy_limit"):
		var el: float = float(snapshot.get("energy_limit", 0.80))
		var az: int = int(snapshot.get("aero_zones", 2))
		_set_track_char_label(el, az)
		_track_char_set = true
