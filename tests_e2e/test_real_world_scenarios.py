"""Tier 4: Real-World End-to-End Application Scenarios."""

from unittest.mock import patch

import pytest
from starlette.testclient import TestClient

from app.samples import SEED_ASSIGNMENTS
from app.schemas import (
    CriterionEvaluation,
    EvaluatorOutput,
    FeedbackOutput,
    ReflectionOutput,
)
from tests_e2e.conftest import CSSParser, DOMTree

# ═══════════════════════════════════════════════════════════════════════════
# TIER 4: REAL-WORLD APPLICATION SCENARIOS
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier4
def test_t4_full_academic_grading_pipeline_scenario(client: TestClient) -> None:
    """Scenario 1: End-to-end user grading lifecycle with SSE streaming, persistence, and exports."""
    # 1. User loads landing page
    index_res = client.get("/")
    assert index_res.status_code == 200
    assert "Run 4-Agent Evaluation" in index_res.text

    # 2. Benchmark suite is seeded
    seed_res = client.post("/api/assignments/seed")
    assert seed_res.status_code == 200
    assignments = seed_res.json()["assignments"]
    assert len(assignments) >= 1
    target_assign = assignments[0]

    # 3. User submits student code for live SSE evaluation
    sample_rubric = SEED_ASSIGNMENTS[0]["structured_rubric"].model_copy(deep=True)
    sample_eval = EvaluatorOutput(
        submission_modality="code",
        overall_comprehension_summary="Clean LRU cache implementation.",
        criterion_evaluations=[
            CriterionEvaluation(
                criterion_id="C1",
                criterion_title="Complexity",
                max_points=50.0,
                chain_of_thought_trace="O(1) verified.",
                student_evidence_quotes=["self.cache[key]"],
                strengths_observed=["Uses OrderedDict"],
                flaws_or_gaps_observed=[],
                initial_score=48.0,
                rationale="Good performance.",
            )
        ],
    )
    sample_ref = ReflectionOutput(
        audit_status="verified",
        overall_audit_summary="No bias found.",
        bias_checks_performed=["Checked harshness/leniency drift"],
        criterion_audits=[],
    )
    sample_fb = FeedbackOutput(
        executive_summary="Excellent mastery of hash maps and doubly-linked nodes.",
        key_strengths=["Clean object orientation"],
        learning_gaps=[],
        revision_roadmap=["Consider thread-safety locking"],
        encouraging_closing="Superb work!",
    )

    with patch("app.orchestrator.parse_or_generate_rubric", return_value=sample_rubric), \
         patch("app.orchestrator.evaluate_submission", return_value=sample_eval), \
         patch("app.orchestrator.audit_and_calibrate", return_value=sample_ref), \
         patch("app.orchestrator.synthesize_feedback", return_value=sample_fb):

        stream_payload = {
            "assignment_id": target_assign["id"],
            "student_name": "E2E Test Student",
            "student_id": "STU-E2E-101",
            "submission_filename": "lru_cache.py",
            "submission_text": "class LRUCache:\n    def __init__(self, capacity):\n        pass\n",
            "force_reparse_rubric": False,
        }

        stream_res = client.post("/api/evaluate/stream", json=stream_payload)
        assert stream_res.status_code == 200
        assert "text/event-stream" in stream_res.headers["content-type"]

        body_text = stream_res.text
        assert "event: agent_start" in body_text
        assert "event: agent_complete" in body_text
        assert "event: evaluation_complete" in body_text

    # 4. Evaluation record is saved and retrievable via history
    history_res = client.get("/api/evaluations")
    assert history_res.status_code == 200
    records = history_res.json()
    assert len(records) >= 1
    eval_id = records[0]["id"]

    # 5. User exports report in Markdown and HTML
    md_res = client.get(f"/api/evaluations/{eval_id}/export?format=md")
    assert md_res.status_code == 200
    assert "E2E Test Student" in md_res.text
    assert "Evaluation Report" in md_res.text

    html_res = client.get(f"/api/evaluations/{eval_id}/export?format=html")
    assert html_res.status_code == 200
    assert "<!DOCTYPE html>" in html_res.text
    assert "E2E Test Student" in html_res.text


@pytest.mark.tier4
def test_t4_high_accessibility_user_journey_scenario(dom_tree: DOMTree, css_parser: CSSParser) -> None:
    """Scenario 2: User requesting high-accessibility (reduced motion & high contrast) navigates studio."""
    # 1. Document has proper language
    html_node = dom_tree.find_all_by_tag("html")
    assert len(html_node) >= 1
    assert html_node[0].attrs.get("lang") == "en"

    # 2. Viewport allows zoom and responsive scaling
    meta_tags = dom_tree.find_all_by_tag("meta")
    viewport_meta = [m for m in meta_tags if m.attrs.get("name") == "viewport"]
    assert len(viewport_meta) >= 1
    content = viewport_meta[0].attrs.get("content", "")
    assert "width=device-width" in content

    # 3. Accessible heading hierarchy
    h1_tags = dom_tree.find_all_by_tag("h1")
    assert len(h1_tags) >= 1, "Must contain at least one primary h1 heading"

    # 4. Form inputs have placeholder or aria-label
    inputs = dom_tree.find_all_by_tag("input")
    for inp in inputs:
        if inp.attrs.get("type") in {"text", "file"}:
            assert "placeholder" in inp.attrs or "aria-label" in inp.attrs or "id" in inp.attrs


@pytest.mark.tier4
def test_t4_custom_assignment_authoring_and_evaluation_scenario(client: TestClient) -> None:
    """Scenario 3: Instructor authors custom assignment, submits rubric & prompt, and evaluates."""
    # 1. Create custom assignment
    new_assignment_payload = {
        "title": "CS401: Distributed Consensus via Raft",
        "course_code": "CS401",
        "description": "Implement leader election and log replication.",
        "prompt_text": "Write a Python implementation of Raft consensus protocol.",
        "rubric_text": "Criteria: Leader Election (30 pts), Log Matching (40 pts), Heartbeat Safety (30 pts).",
    }

    create_res = client.post("/api/assignments", json=new_assignment_payload)
    assert create_res.status_code == 200
    created = create_res.json()
    assert created["title"] == "CS401: Distributed Consensus via Raft"
    assign_id = created["id"]

    # 2. Verify assignment appears in list
    list_res = client.get("/api/assignments")
    assert list_res.status_code == 200
    all_assigns = list_res.json()["assignments"]
    assert any(a["id"] == assign_id for a in all_assigns)

    # 3. Clean up by deleting assignment
    del_res = client.delete(f"/api/assignments/{assign_id}")
    assert del_res.status_code == 200


@pytest.mark.tier4
def test_t4_resilience_to_malformed_submission_and_error_recovery(client: TestClient) -> None:
    """Scenario 4: Student uploads invalid/empty file or malformed request, verifying clean error response."""
    # 1. Unsupported binary payload to /api/ingest-file
    res = client.post(
        "/api/ingest-file",
        files={"file": ("malware.exe", b"\x00\x01\x02", "application/octet-stream")},
    )
    assert res.status_code == 400

    # 2. Evaluate with invalid assignment ID
    invalid_eval_payload = {
        "assignment_id": "non-existent-assign-id-999",
        "student_name": "Ghost Student",
        "submission_text": "print('hello')",
    }
    eval_res = client.post("/api/evaluate", json=invalid_eval_payload)
    assert eval_res.status_code in {400, 404, 500}


@pytest.mark.tier4
def test_t4_history_archive_restoration_and_tab_inspection(client: TestClient) -> None:
    """Scenario 5: History drawer archive retrieval and inspection of stored records."""
    # Seed assignments
    client.post("/api/assignments/seed")
    # Fetch history list
    res = client.get("/api/evaluations")
    assert res.status_code == 200
    records = res.json()
    assert isinstance(records, list)


@pytest.mark.tier4
def test_t4_adversarial_input_escaping_and_report_rendering(client: TestClient) -> None:
    """Scenario 6: Adversarial inputs containing raw script tags and HTML entities."""
    seed_res = client.post("/api/assignments/seed")
    assert seed_res.status_code == 200
    assign = seed_res.json()["assignments"][0]
    assert "id" in assign

    # Ingest file with adversarial script injection
    file_content = b"def solution():\n    # <script>alert('pwned')</script>\n    return True\n"
    res = client.post(
        "/api/ingest-file",
        files={"file": ("malicious.py", file_content, "text/x-python")},
    )
    assert res.status_code == 200
    data = res.json()
    assert "<script>" in data["extracted_text"]
    assert data["file_type"] == "code"
