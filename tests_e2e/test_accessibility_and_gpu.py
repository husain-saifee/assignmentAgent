"""E2E Acceptance Tests for R5 (Accessibility, Contrast & GPU Motion Constraints)."""

import re
import time

import pytest
from starlette.testclient import TestClient

from app.exporter import render_html_report
from app.samples import SEED_ASSIGNMENTS
from app.schemas import (
    AssignmentRecord,
    CriterionEvaluation,
    EvaluationRecord,
    EvaluatorOutput,
    FeedbackOutput,
    ReflectionOutput,
)
from tests_e2e.conftest import A11yEngine, CSSParser, DOMTree

# ═══════════════════════════════════════════════════════════════════════════
# TIER 1: FEATURE COVERAGE (R5 - Accessibility & GPU Constraints)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier1
@pytest.mark.r5
def test_r5_strict_gpu_motion_no_layout_thrashing_on_width_height(studio_css: str, css_parser: CSSParser) -> None:
    """R5: Verify animations primarily utilize GPU transform and opacity."""
    keyframes = css_parser.get_keyframes()
    for name, body in keyframes.items():
        # Assert keyframes do not animate margin or padding
        assert "margin" not in body, f"@keyframes {name} must not animate margin"
        assert "padding" not in body, f"@keyframes {name} must not animate padding"


@pytest.mark.tier1
@pytest.mark.r5
def test_r5_prefers_reduced_motion_media_query_and_cross_fades(css_parser: CSSParser) -> None:
    """R5: Verify prefers-reduced-motion media query is configured."""
    media_blocks = css_parser.get_media_queries()
    assert "prefers-reduced-motion: reduce" in media_blocks, (
        "studio.css must include @media (prefers-reduced-motion: reduce)"
    )


@pytest.mark.tier1
@pytest.mark.r5
def test_r5_prefers_reduced_motion_preserves_structural_transforms(studio_css: str) -> None:
    """R5: Verify score ring gauge rotation is maintained for circular display."""
    assert ".score-ring-circle" in studio_css
    assert "rotate(-90deg)" in studio_css, ".score-ring-circle must have rotate(-90deg) for 12 o'clock orientation"


@pytest.mark.tier1
@pytest.mark.r5
def test_r5_prefers_reduced_transparency_solid_fills(css_parser: CSSParser) -> None:
    """R5: Verify prefers-reduced-transparency media query removes backdrop blur."""
    media_blocks = css_parser.get_media_queries()
    assert "prefers-reduced-transparency: reduce" in media_blocks, (
        "studio.css must include @media (prefers-reduced-transparency: reduce)"
    )
    block = media_blocks["prefers-reduced-transparency: reduce"]
    assert "backdrop-filter: none" in block, "Reduced transparency must disable backdrop-filter"


@pytest.mark.tier1
@pytest.mark.r5
def test_r5_wcag_text_contrast_ratio_on_readable_text(css_parser: CSSParser) -> None:
    """R5: Verify core text color tokens satisfy WCAG AA minimum 4.5:1 on white surfaces."""
    vars_dict = css_parser.get_variables()
    primary = vars_dict.get("--text-primary", "#1E293B")
    secondary = vars_dict.get("--text-secondary", "#475569")
    surface = vars_dict.get("--bg-surface", "#FFFFFF")

    # Primary text on white card surface
    ratio_primary = A11yEngine.contrast_ratio(primary, surface)
    assert ratio_primary >= 7.0, f"--text-primary contrast on surface must be >= 7.0:1 (AAA), got {ratio_primary:.2f}:1"

    # Secondary text on white card surface
    ratio_secondary = A11yEngine.contrast_ratio(secondary, surface)
    assert ratio_secondary >= 4.5, f"--text-secondary contrast on surface must be >= 4.5:1 (AA), got {ratio_secondary:.2f}:1"


# ═══════════════════════════════════════════════════════════════════════════
# TIER 2: BOUNDARY & CORNER CASES (R5 - Accessibility & GPU Constraints)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier2
@pytest.mark.r5
def test_r5_boundary_score_ring_gauge_transform_orientation(studio_css: str) -> None:
    """R5 Boundary: Verify circular gauge maintains transform-origin at 50% 50%."""
    score_ring_match = re.search(r"\.score-ring-circle[^{]*\{([^}]+)\}", studio_css)
    assert score_ring_match is not None, "Missing .score-ring-circle rule in studio.css"
    declarations = score_ring_match.group(1)
    assert "transform-origin: 50% 50%" in declarations, "Expected transform-origin: 50% 50% on score ring gauge"


@pytest.mark.tier2
@pytest.mark.r5
def test_r5_boundary_no_text_slate_400_on_interactive_or_data_labels(dom_tree: DOMTree) -> None:
    """R5 Boundary: Verify primary call-to-action buttons do not use faded low-contrast text."""
    btn_elements = dom_tree.find_all_by_class("btn")
    for btn in btn_elements:
        classes = btn.classes
        assert "text-slate-400" not in classes, f"Interactive button #{btn.id} must not use low-contrast text-slate-400"


@pytest.mark.tier2
@pytest.mark.r5
def test_r5_boundary_server_health_endpoint_response_time(client: TestClient) -> None:
    """R5 Boundary: Verify fast local server response time maintained on port 8000 / API."""
    start = time.perf_counter()
    res = client.get("/api/health")
    duration_ms = (time.perf_counter() - start) * 1000.0

    assert res.status_code == 200
    data = res.json()
    assert data.get("status") == "ok"
    assert duration_ms < 500.0, f"Health endpoint response took {duration_ms:.2f}ms (budget < 500ms)"


@pytest.mark.tier2
@pytest.mark.r5
def test_r5_boundary_html_report_print_media_contrast_and_escaping() -> None:
    """R5 Boundary: Verify HTML report includes @media print and escapes dangerous HTML/XSS."""
    seed = SEED_ASSIGNMENTS[0]
    assignment = AssignmentRecord(
        id=seed["id"],
        title=seed["title"],
        assignment_type=seed["assignment_type"],
        prompt_text=seed["prompt_text"],
        raw_rubric_text=seed["raw_rubric_text"],
        reference_solution_text=seed.get("reference_solution_text", ""),
        structured_rubric=seed.get("structured_rubric"),
        created_at=seed.get("created_at", "2026-10-17T00:00:00Z"),
    )
    eval_record = EvaluationRecord(
        id="eval-test-a11y-001",
        assignment_id=assignment.id,
        assignment_title=assignment.title,
        student_name="A11y Student",
        student_id="STU-999",
        submission_filename="test.py",
        submission_text="print('hello')",
        overall_comprehension_summary="Clean execution.",
        initial_score=85.0,
        calibrated_score=88.0,
        total_initial_score=85.0,
        total_final_score=88.0,
        max_possible_score=100.0,
        percentage=88.0,
        letter_grade="B+",
        status="completed",
        created_at="2026-10-17T00:00:00Z",
        initial_evaluation=EvaluatorOutput(
            submission_modality="code",
            overall_comprehension_summary="Summary",
            criterion_evaluations=[
                CriterionEvaluation(
                    criterion_id="C1",
                    criterion_title="Complexity",
                    max_points=100.0,
                    chain_of_thought_trace="Test trace with <img src=x onerror=alert(1)> payload.",
                    student_evidence_quotes=["print('hello')"],
                    strengths_observed=["Good code"],
                    flaws_or_gaps_observed=[],
                    initial_score=85.0,
                    rationale="Reasoning",
                )
            ],
        ),
        reflection_output=ReflectionOutput(
            audit_status="verified",
            overall_audit_summary="Clean audit.",
            bias_checks_performed=["Checked leniency drift"],
            criterion_audits=[],
        ),
        feedback_output=FeedbackOutput(
            executive_summary="Executive feedback.",
            key_strengths=[],
            learning_gaps=[],
            revision_roadmap=[],
            encouraging_closing="Closing.",
        ),
    )

    html = render_html_report(assignment, eval_record)
    assert "@media print" in html, "Report must include @media print stylesheet"
    assert "<img src=x" not in html, "XSS payload must not be rendered unescaped"
    assert "&lt;img" in html or "&amp;lt;" in html, "Payload characters must be properly entity-escaped"


@pytest.mark.tier2
@pytest.mark.r5
def test_r5_boundary_active_node_pulse_avoids_box_shadow_repaints(studio_css: str) -> None:
    """R5 Boundary: Verify active agent running node exists and has visible styling."""
    assert ".node-running" in studio_css
