extends "res://race_sim.gd"
# Test-only subclass: forces every AI car into one ERS mode so the per-mode SoC
# balance can be measured in isolation (the step-order gotcha means d.ers_mode
# must be set inside _ai_energy, not between steps). Player cars unaffected.

var forced_mode: String = "balanced"


func _ai_energy(d, ahead_gap: float, behind_gap: float) -> void:
	if d.is_player:
		super._ai_energy(d, ahead_gap, behind_gap)
		return
	d.pace_mode = "balanced"
	d.ers_mode = forced_mode
	d.overtake = false
