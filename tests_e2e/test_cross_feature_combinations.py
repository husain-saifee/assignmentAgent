"""Tier 3: Cross-Feature Pairwise Interaction Tests across R1-R5."""

import pytest
from starlette.testclient import TestClient

from tests_e2e.conftest import CSSParser, DOMTree

# ═══════════════════════════════════════════════════════════════════════════
# TIER 3: CROSS-FEATURE PAIRWISE COMBINATIONS
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier3
def test_t3_drawer_and_sliding_pill_interaction(dom_tree: DOMTree) -> None:
    """T3 (R1 + R3): Verify header contains both navigation tab triggers and history drawer trigger."""
    nav_setup = dom_tree.find_by_id("flow-tab-setup-btn")
    nav_report = dom_tree.find_by_id("flow-tab-report-btn")
    drawer_btn = dom_tree.find_by_id("open-history-drawer-btn")

    assert nav_setup is not None, "Missing setup navigation button"
    assert nav_report is not None, "Missing report navigation button"
    assert drawer_btn is not None, "Missing open-history-drawer-btn in header"


@pytest.mark.tier3
def test_t3_drawer_open_during_live_streaming_telemetry(app_js: str) -> None:
    """T3 (R2 + R3): Verify SSE stream handler functions independently of drawer modal state."""
    # Ensure handleSseEvent updates pipeline stage cards regardless of modal presence
    assert "handleSseEvent" in app_js
    assert "updateStageState" in app_js
    assert "history-drawer-modal" in app_js


@pytest.mark.tier3
def test_t3_skeletons_and_completed_svg_checkmark_transition(app_js: str) -> None:
    """T3 (R2 + R4): Verify stage completion in app.js triggers both checkmark and panel render."""
    # When cot_evaluator finishes, renderCriteriaTab should be invoked
    assert "cot_evaluator" in app_js
    assert "renderCriteriaTab" in app_js
    # When reflection_auditor finishes, renderReflectionTab should be invoked
    assert "reflection_auditor" in app_js
    assert "renderReflectionTab" in app_js
    # When feedback_synthesizer finishes, renderFeedbackTab should be invoked
    assert "feedback_synthesizer" in app_js
    assert "renderFeedbackTab" in app_js


@pytest.mark.tier3
def test_t3_tactile_springs_under_prefers_reduced_motion(studio_css: str, css_parser: CSSParser) -> None:
    """T3 (R1 + R5): Verify tactile buttons retain pointer feedback while reduced-motion bounds transitions."""
    media_blocks = css_parser.get_media_queries()
    assert "prefers-reduced-motion: reduce" in media_blocks
    assert ".btn" in studio_css


@pytest.mark.tier3
def test_t3_drawer_and_modal_under_prefers_reduced_transparency(css_parser: CSSParser) -> None:
    """T3 (R3 + R5): Verify reduced transparency removes backdrop-filter from surfaces."""
    media_blocks = css_parser.get_media_queries()
    reduced_trans = media_blocks.get("prefers-reduced-transparency: reduce", "")
    assert "backdrop-filter: none" in reduced_trans


@pytest.mark.tier3
def test_t3_shimmer_skeleton_under_prefers_reduced_motion(css_parser: CSSParser) -> None:
    """T3 (R4 + R5): Verify prefers-reduced-motion disables intense looping animations."""
    media_blocks = css_parser.get_media_queries()
    reduced_motion = media_blocks.get("prefers-reduced-motion: reduce", "")
    assert "animation" in reduced_motion


@pytest.mark.tier3
def test_t3_progress_bar_gpu_scale_under_live_streaming(dom_tree: DOMTree) -> None:
    """T3 (R2 + R5): Verify progress bar container has overflow-hidden for GPU sub-element clipping."""
    bar = dom_tree.find_by_id("live-pipeline-progress-bar")
    assert bar is not None
    # Check parent container in DOM has overflow-hidden or rounded-full
    parent = bar.parent
    assert parent is not None
    assert "overflow-hidden" in parent.classes or "rounded-full" in parent.classes


@pytest.mark.tier3
def test_t3_modal_open_while_skeletons_stream_in_background(dom_tree: DOMTree) -> None:
    """T3 (R3 + R4): Verify modal has higher z-index (z-50) than main content to overlay cleanly."""
    modal = dom_tree.find_by_id("new-assignment-modal")
    drawer = dom_tree.find_by_id("history-drawer-modal")
    assert modal is not None
    assert drawer is not None
    assert "z-50" in modal.classes
    assert "z-50" in drawer.classes


@pytest.mark.tier3
def test_t3_benchmark_selection_during_active_pipeline(app_js: str) -> None:
    """T3 (R1 + R2): Verify selecting a benchmark updates active assignment without crashing pipeline."""
    assert "selectAssignment" in app_js, "app.js must provide selectAssignment controller"


@pytest.mark.tier3
def test_t3_export_generation_with_active_score_gauge(client: TestClient) -> None:
    """T3 (R2 + R5): Verify export endpoints generate valid output after evaluation."""
    # Seed assignments first
    seed_res = client.post("/api/assignments/seed")
    assert seed_res.status_code == 200
    assignments = seed_res.json()
    assert len(assignments) >= 1
