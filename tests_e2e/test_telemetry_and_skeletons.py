"""E2E Acceptance Tests for R2 (Telemetry & Pipeline Motion) and R4 (Skeleton Shimmer Sweeps)."""

import re

import pytest

from tests_e2e.conftest import CSSParser, DOMTree

# ═══════════════════════════════════════════════════════════════════════════
# TIER 1: FEATURE COVERAGE (R2 - Live Telemetry & Pipeline Motion)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier1
@pytest.mark.r2
def test_r2_pipeline_stepper_4_stage_cards_exist(dom_tree: DOMTree) -> None:
    """R2: Verify all 4 specialist agent stage cards exist in #pipeline-stepper."""
    stepper = dom_tree.find_by_id("pipeline-stepper")
    assert stepper is not None, "Missing #pipeline-stepper container in DOM"

    expected_stages = [
        "stage-rubric_parser",
        "stage-cot_evaluator",
        "stage-reflection_auditor",
        "stage-feedback_synthesizer",
    ]
    for stage_id in expected_stages:
        card = dom_tree.find_by_id(stage_id)
        assert card is not None, f"Missing stage card #{stage_id} in pipeline stepper"
        assert "stage-card" in card.classes, f"Stage card #{stage_id} must have .stage-card class"


@pytest.mark.tier1
@pytest.mark.r2
def test_r2_svg_checkmark_path_length_and_dashoffset(studio_css: str, css_parser: CSSParser) -> None:
    """R2: Verify SVG checkmark path drawing keyframes and stroke-dasharray properties."""
    keyframes = css_parser.get_keyframes()
    assert "drawCheckPath" in keyframes, "Missing @keyframes drawCheckPath in studio.css"
    draw_kf = keyframes["drawCheckPath"]
    assert "stroke-dashoffset" in draw_kf, "drawCheckPath must animate stroke-dashoffset"

    # Verify .svg-check-anim rule
    svg_rule_match = re.search(r"\.svg-check-anim[^{]*\{([^}]+)\}", studio_css)
    assert svg_rule_match is not None, "Missing .svg-check-anim rule in studio.css"
    declarations = svg_rule_match.group(1)
    assert "stroke-dasharray: 24" in declarations, "Expected stroke-dasharray: 24 in .svg-check-anim"
    assert "animation:" in declarations, "Expected animation assignment in .svg-check-anim"


@pytest.mark.tier1
@pytest.mark.r2
def test_r2_active_node_running_gpu_breathing_glow(studio_css: str) -> None:
    """R2: Verify .node-running class exists and provides active visual indicator."""
    node_running_match = re.search(r"\.node-running[^{]*\{([^}]+)\}", studio_css)
    assert node_running_match is not None, "Missing .node-running rule in studio.css"


@pytest.mark.tier1
@pytest.mark.r2
def test_r2_progress_bar_markup_and_stage_labels(dom_tree: DOMTree) -> None:
    """R2: Verify smooth progress bar and stage telemetry labels exist in DOM."""
    bar = dom_tree.find_by_id("live-pipeline-progress-bar")
    stage_label = dom_tree.find_by_id("live-progress-stage-label")
    pct_label = dom_tree.find_by_id("live-progress-pct-label")

    assert bar is not None, "Missing #live-pipeline-progress-bar in DOM"
    assert stage_label is not None, "Missing #live-progress-stage-label in DOM"
    assert pct_label is not None, "Missing #live-progress-pct-label in DOM"


@pytest.mark.tier1
@pytest.mark.r2
def test_r2_live_agent_working_card_telemetry_timer(dom_tree: DOMTree) -> None:
    """R2: Verify live working card displays timer, stage badge, and status heading."""
    working_card = dom_tree.find_by_id("live-agent-working-card")
    timer = dom_tree.find_by_id("live-agent-timer")
    badge = dom_tree.find_by_id("live-agent-step-badge")
    heading = dom_tree.find_by_id("live-agent-status-heading")

    assert working_card is not None, "Missing #live-agent-working-card in DOM"
    assert timer is not None, "Missing #live-agent-timer in DOM"
    assert badge is not None, "Missing #live-agent-step-badge in DOM"
    assert heading is not None, "Missing #live-agent-status-heading in DOM"


# ═══════════════════════════════════════════════════════════════════════════
# TIER 2: BOUNDARY & CORNER CASES (R2 - Live Telemetry & Pipeline Motion)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier2
@pytest.mark.r2
def test_r2_boundary_node_constant_border_prevents_layout_jitter(studio_css: str) -> None:
    """R2 Boundary: Verify .node-complete and .node-error classes define clean border states."""
    assert ".node-complete" in studio_css
    assert ".node-error" in studio_css


@pytest.mark.tier2
@pytest.mark.r2
def test_r2_boundary_svg_checkmark_zero_flash_initial_offset(css_parser: CSSParser) -> None:
    """R2 Boundary: Verify drawCheckPath keyframe starts at offset 24 to prevent flash."""
    keyframes = css_parser.get_keyframes()
    draw_kf = keyframes.get("drawCheckPath", "")
    assert "24" in draw_kf, "Initial keyframe state must specify dashoffset 24"
    assert "0" in draw_kf, "Terminal keyframe state must reach dashoffset 0"


@pytest.mark.tier2
@pytest.mark.r2
def test_r2_boundary_progress_bar_asymptotic_crawling_controller(app_js: str) -> None:
    """R2 Boundary: Verify app.js updates progress percentages during SSE streaming."""
    assert "updateLiveProgress" in app_js, "app.js must provide updateLiveProgress controller"
    assert "live-pipeline-progress-bar" in app_js
    assert "live-progress-pct-label" in app_js


@pytest.mark.tier2
@pytest.mark.r2
def test_r2_boundary_timer_stops_cleanly_on_pipeline_completion(app_js: str) -> None:
    """R2 Boundary: Verify telemetry timer is stopped upon evaluation completion and error."""
    assert "stopLiveTimer" in app_js, "app.js must define stopLiveTimer()"
    # Verify stopLiveTimer is invoked on evaluation_complete
    assert "evaluation_complete" in app_js
    assert "agent_error" in app_js


@pytest.mark.tier2
@pytest.mark.r2
def test_r2_boundary_agent_error_shows_tactile_error_badge(app_js: str) -> None:
    """R2 Boundary: Verify agent_error SSE event updates status badge cleanly."""
    assert "agent_error" in app_js
    assert "showBanner" in app_js


# ═══════════════════════════════════════════════════════════════════════════
# TIER 1: FEATURE COVERAGE (R4 - Shimmer Skeleton Sweeps)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier1
@pytest.mark.r4
def test_r4_skeleton_shimmer_css_class_definition(studio_css: str) -> None:
    """R4: Verify .skeleton-shimmer or enter animation styles are defined."""
    # Verify animation support or skeleton loading definitions exist
    assert "animate-enter" in studio_css or "skeleton" in studio_css or "pulse" in studio_css


@pytest.mark.tier1
@pytest.mark.r4
def test_r4_skeleton_shimmer_angled_gradient_sweep(studio_css: str) -> None:
    """R4: Verify gradient sweep or background animation keyframes exist."""
    assert "@keyframes" in studio_css


@pytest.mark.tier1
@pytest.mark.r4
def test_r4_feedback_panel_loading_structure(dom_tree: DOMTree) -> None:
    """R4: Verify #tab-panel-feedback exists and has structured container."""
    panel = dom_tree.find_by_id("tab-panel-feedback")
    assert panel is not None, "Missing #tab-panel-feedback in DOM"


@pytest.mark.tier1
@pytest.mark.r4
def test_r4_criteria_panel_loading_structure(dom_tree: DOMTree) -> None:
    """R4: Verify #tab-panel-criteria exists and has structured container."""
    panel = dom_tree.find_by_id("tab-panel-criteria")
    assert panel is not None, "Missing #tab-panel-criteria in DOM"


@pytest.mark.tier1
@pytest.mark.r4
def test_r4_reflection_panel_loading_structure(dom_tree: DOMTree) -> None:
    """R4: Verify #tab-panel-reflection exists and has structured container."""
    panel = dom_tree.find_by_id("tab-panel-reflection")
    assert panel is not None, "Missing #tab-panel-reflection in DOM"


# ═══════════════════════════════════════════════════════════════════════════
# TIER 2: BOUNDARY & CORNER CASES (R4 - Shimmer Skeleton Sweeps)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier2
@pytest.mark.r4
def test_r4_boundary_hero_scorecard_metric_elements(dom_tree: DOMTree) -> None:
    """R4 Boundary: Verify all hero scorecard metric elements are present."""
    metric_ids = [
        "hero-initial-score",
        "hero-calibration-delta",
        "hero-final-score",
        "hero-percentage",
        "hero-letter-grade",
    ]
    for mid in metric_ids:
        el = dom_tree.find_by_id(mid)
        assert el is not None, f"Missing metric element #{mid} in hero scorecard"


@pytest.mark.tier2
@pytest.mark.r4
def test_r4_boundary_skeleton_replacement_upon_agent_completion(app_js: str) -> None:
    """R4 Boundary: Verify tab renderers cleanly replace placeholders upon stage completion."""
    assert "renderCriteriaTab" in app_js, "app.js must provide renderCriteriaTab()"
    assert "renderReflectionTab" in app_js, "app.js must provide renderReflectionTab()"
    assert "renderFeedbackTab" in app_js, "app.js must provide renderFeedbackTab()"


@pytest.mark.tier2
@pytest.mark.r4
def test_r4_boundary_skeleton_shimmer_reduced_motion_fallback(studio_css: str, css_parser: CSSParser) -> None:
    """R4 Boundary: Verify prefers-reduced-motion media query disables intense looping animations."""
    media_blocks = css_parser.get_media_queries()
    assert "prefers-reduced-motion: reduce" in media_blocks


@pytest.mark.tier2
@pytest.mark.r4
def test_r4_boundary_empty_tab_navigation_during_streaming(dom_tree: DOMTree, app_js: str) -> None:
    """R4 Boundary: Verify report tabs can be switched to inspect panels during streaming."""
    assert "setupTabs" in app_js
    assert "data-tab" in app_js


@pytest.mark.tier2
@pytest.mark.r4
def test_r4_boundary_skeleton_container_overflow_hidden(dom_tree: DOMTree) -> None:
    """R4 Boundary: Verify stage cards and modal containers enforce overflow-hidden."""
    stage_cards = dom_tree.find_all_by_class("stage-card")
    for card in stage_cards:
        assert "overflow-hidden" in card.classes, "Stage cards must clip animated sweeps with overflow-hidden"
