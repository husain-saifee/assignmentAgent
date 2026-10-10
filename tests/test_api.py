import base64
import io
import json
import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from app.agents.gemini_client import GeminiStructuredClient
from app.db import Database
from app.exporter import render_html_report, render_markdown_report
from app.main import create_app
from app.samples import SEED_ASSIGNMENTS
from app.schemas import (
    CriterionAudit,
    CriterionEvaluation,
    EvaluatorOutput,
    FeedbackOutput,
    LearningGap,
    ReflectionOutput,
    StructuredRubric,
)


def _make_sample_rubric() -> StructuredRubric:
    return SEED_ASSIGNMENTS[0]["structured_rubric"].model_copy(deep=True)


def _make_sample_evaluator_output() -> EvaluatorOutput:
    return EvaluatorOutput(
        submission_modality="code",
        overall_comprehension_summary="Student uses dict + list resulting in O(n) recency updates.",
        criterion_evaluations=[
            CriterionEvaluation(
                criterion_id="C1",
                criterion_title="Data Structure & O(1) Time Complexity",
                max_points=40.0,
                chain_of_thought_trace="Traced get(1): self.order.remove(key) scans list in O(n) <script>alert(1)</script>.",
                student_evidence_quotes=["self.order.remove(key)"],
                strengths_observed=["Uses dictionary for key-value lookup"],
                flaws_or_gaps_observed=["List removal is O(n) instead of O(1)"],
                initial_score=28.0,
                rationale="Matches Proficient band (25-35).",
            ),
            CriterionEvaluation(
                criterion_id="C2",
                criterion_title="Eviction & Recency Update Logic",
                max_points=35.0,
                chain_of_thought_trace="Traced put(1, 10) at capacity: pops index 0 and updates order.",
                student_evidence_quotes=["oldest = self.order.pop(0)"],
                strengths_observed=["Maintains LRU order"],
                flaws_or_gaps_observed=["Evicts when updating existing key at full capacity"],
                initial_score=26.0,
                rationale="Refreshes recency on get and put.",
            ),
            CriterionEvaluation(
                criterion_id="C3",
                criterion_title="Edge Cases & Code Quality",
                max_points=25.0,
                chain_of_thought_trace="Traced put(existing_key, new_val) at capacity.",
                student_evidence_quotes=["if len(self.store) >= self.capacity:"],
                strengths_observed=["Readable Python structure"],
                flaws_or_gaps_observed=["Bug when updating existing key at full capacity"],
                initial_score=18.0,
                rationale="Matches Proficient band (14-21).",
            ),
        ],
    )


def _make_sample_reflection_output() -> ReflectionOutput:
    return ReflectionOutput(
        audit_status="calibrated",
        overall_audit_summary="Detected double-penalty for existing-key capacity bug across C2 and C3; adjusted C2 up.",
        bias_checks_performed=[
            "Checked harshness/leniency drift against scoring bands",
            "Checked double-penalizing same root bug across C2 and C3",
        ],
        criterion_audits=[
            CriterionAudit(
                criterion_id="C1",
                initial_score=28.0,
                calibrated_score=28.0,
                adjustment_delta=0.0,
                audit_verdict="verified",
                bias_or_error_detected="None",
                calibration_reasoning="28/40 accurately reflects Proficient band.",
            ),
            CriterionAudit(
                criterion_id="C2",
                initial_score=26.0,
                calibrated_score=32.0,
                adjustment_delta=6.0,
                audit_verdict="adjusted_up",
                bias_or_error_detected="Double-penalized existing-key update bug already deducted in C3.",
                calibration_reasoning="Award Exemplary 32/35 for C2.",
            ),
            CriterionAudit(
                criterion_id="C3",
                initial_score=18.0,
                calibrated_score=18.0,
                adjustment_delta=0.0,
                audit_verdict="verified",
                bias_or_error_detected="None",
                calibration_reasoning="18/25 matches Proficient band.",
            ),
        ],
    )


def _make_sample_feedback_output() -> FeedbackOutput:
    return FeedbackOutput(
        executive_summary="Solid LRU Cache structure that tracks recency, with two main areas to reach O(1).",
        key_strengths=["Clean class interface", "Refreshes recency on get() and put()"],
        learning_gaps=[
            LearningGap(
                concept_or_skill="O(1) Recency Tracking via Doubly Linked List",
                observed_issue="Using list.remove(key) and list.pop(0) causes O(n) time complexity.",
                actionable_fix="Replace self.order list with a doubly linked list or OrderedDict.",
                example_or_hint="node.prev.next = node.next; node.next.prev = node.prev",
            )
        ],
        revision_roadmap=[
            "Handle existing keys at the top of put() before eviction check",
            "Refactor self.order list into doubly linked list nodes for O(1) removal",
        ],
        encouraging_closing="You have the core LRU mental model down!",
    )


def _build_fake_client_factory(captured_calls: list[dict[str, Any]] | None = None):
    def _factory(api_key: str, model: str) -> GeminiStructuredClient:
        client = GeminiStructuredClient(api_key=api_key or "test-key", model=model or "gemini-2.5-flash")

        async def _fake_generate_structured(**kwargs: Any) -> Any:
            if captured_calls is not None:
                captured_calls.append(
                    {
                        "api_key": api_key,
                        "model": model,
                        "schema": kwargs["response_schema"],
                        "pdf_bytes": kwargs.get("pdf_bytes"),
                    }
                )
            schema = kwargs["response_schema"]
            if schema is StructuredRubric:
                return _make_sample_rubric()
            if schema is EvaluatorOutput:
                return _make_sample_evaluator_output()
            if schema is ReflectionOutput:
                return _make_sample_reflection_output()
            if schema is FeedbackOutput:
                return _make_sample_feedback_output()
            raise AssertionError(f"Unexpected schema: {schema}")

        client.generate_structured = _fake_generate_structured  # type: ignore[method-assign]
        return client

    return _factory


def test_db_connect_context_manager_closes_connection_and_releases_file(tmp_path: Path) -> None:
    db_file = tmp_path / "conn_close.db"
    db = Database(str(db_file))
    db.init_db()

    with db._connect() as conn:
        conn.execute(
            "INSERT INTO assignments (id, title, assignment_type, prompt_text, created_at) VALUES (?, ?, ?, ?, ?)",
            ("a1", "Title", "code", "Prompt", "2026-10-10T00:00:00Z"),
        )

    # Connection must be closed after exiting the context manager
    with pytest.raises(sqlite3.ProgrammingError):
        conn.execute("SELECT 1")

    # Verify rollback on exception and connection still closed
    with pytest.raises(RuntimeError, match="boom"), db._connect() as conn2:
        conn2.execute(
            "INSERT INTO assignments (id, title, assignment_type, prompt_text, created_at) VALUES (?, ?, ?, ?, ?)",
            ("a2", "Title2", "code", "Prompt2", "2026-10-10T00:00:00Z"),
        )
        raise RuntimeError("boom")

    assert db.get_assignment("a1") is not None
    assert db.get_assignment("a2") is None

    # On Windows, unlinking the SQLite file immediately succeeds only if all handles are closed
    db_file.unlink()
    assert not db_file.exists()


def test_exporter_renders_markdown_and_html_reports(tmp_path: Path) -> None:
    db = Database(str(tmp_path / "export.db"))
    db.init_db()

    seed = SEED_ASSIGNMENTS[0]
    assignment = db.create_assignment(
        assignment_id=seed["id"],
        title=seed["title"],
        assignment_type=seed["assignment_type"],
        prompt_text=seed["prompt_text"],
        raw_rubric_text=seed["raw_rubric_text"],
        reference_solution_text=seed["reference_solution_text"],
        structured_rubric=seed["structured_rubric"],
    )
    ev = db.create_evaluation(
        assignment_id=assignment.id,
        student_name="Jordan Patel",
        student_id="STU-4082",
        submission_filename="lru_cache.py",
        submission_text=seed["sample_submission"]["submission_text"],
    )
    completed = db.complete_evaluation(
        evaluation_id=ev.id,
        rubric_used=_make_sample_rubric(),
        initial_evaluation=_make_sample_evaluator_output(),
        reflection_audit=_make_sample_reflection_output(),
        feedback_report=_make_sample_feedback_output(),
        total_initial_score=72.0,
        total_final_score=78.0,
        max_possible_score=100.0,
        letter_grade="C+",
        duration_ms=2340,
    )

    md_report = render_markdown_report(assignment, completed)
    assert "CS301: O(1) LRU Cache Implementation" in md_report
    assert "Jordan Patel" in md_report
    assert "STU-4082" in md_report
    assert "72.0" in md_report
    assert "78.0" in md_report
    assert "C+" in md_report
    assert "O(1) Recency Tracking via Doubly Linked List" in md_report
    assert "Double-penalized existing-key update bug" in md_report

    html_report = render_html_report(assignment, completed)
    assert "<!DOCTYPE html>" in html_report
    assert "CS301: O(1) LRU Cache Implementation" in html_report
    assert "Jordan Patel" in html_report
    assert "C+" in html_report
    assert "@media print" in html_report
    # Verify XSS / HTML escaping on CoT trace
    assert "<script>alert(1)</script>" not in html_report
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html_report


def test_health_index_and_static_ui_assets(tmp_path: Path) -> None:
    app = create_app(
        db_path=str(tmp_path / "ui.db"),
        client_factory=_build_fake_client_factory(),
    )
    client = TestClient(app)

    health_res = client.get("/api/health")
    assert health_res.status_code == 200
    health_data = health_res.json()
    assert health_data["status"] == "ok"
    assert "default_model" in health_data
    assert isinstance(health_data["has_env_api_key"], bool)

    index_res = client.get("/")
    assert index_res.status_code == 200
    assert "text/html" in index_res.headers["content-type"]
    html = index_res.text
    for model_name in (
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-3.8-flash",
        "gemini-3.1-pro-preview",
    ):
        assert model_name in html
    assert "Run 4-Agent Evaluation" in html

    js_res = client.get("/static/app.js")
    assert js_res.status_code == 200
    assert "/api/evaluate/stream" in js_res.text
    assert "/api/assignments/seed" in js_res.text


def test_assignments_seed_create_list_and_delete(tmp_path: Path) -> None:
    captured: list[dict[str, Any]] = []
    app = create_app(
        db_path=str(tmp_path / "assignments.db"),
        client_factory=_build_fake_client_factory(captured),
    )
    client = TestClient(app)

    # Seed idempotently
    seed_res1 = client.post("/api/assignments/seed")
    assert seed_res1.status_code == 200
    seed_payload = seed_res1.json()
    assert len(seed_payload["assignments"]) >= 2
    assert "seed-python-lru-cache" in seed_payload["sample_submissions"]
    assert "seed-theory-distributed-attention" in seed_payload["sample_submissions"]

    seed_res2 = client.post("/api/assignments/seed")
    assert seed_res2.status_code == 200
    assert len(seed_res2.json()["assignments"]) == len(seed_payload["assignments"])

    # List assignments
    list_res = client.get("/api/assignments")
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert len(list_data["assignments"]) >= 2
    assert "seed-python-lru-cache" in list_data["sample_submissions"]

    # Create assignment with parse_rubric_now=True
    create_res = client.post(
        "/api/assignments",
        json={
            "title": "HW3: Graph Shortest Paths",
            "assignment_type": "code",
            "prompt_text": "Implement Dijkstra's algorithm with a priority queue.",
            "raw_rubric_text": "50 pts correctness, 50 pts complexity",
            "reference_solution_text": "import heapq",
            "parse_rubric_now": True,
        },
        headers={"X-Gemini-Api-Key": "custom-key", "X-Gemini-Model": "gemini-2.5-pro"},
    )
    assert create_res.status_code == 200
    created_assignment = create_res.json()
    assert created_assignment["title"] == "HW3: Graph Shortest Paths"
    assert created_assignment["structured_rubric"] is not None
    assert any(c["schema"] is StructuredRubric for c in captured)

    # Delete assignment
    del_res = client.delete(f"/api/assignments/{created_assignment['id']}")
    assert del_res.status_code == 200
    del_missing = client.delete(f"/api/assignments/{created_assignment['id']}")
    assert del_missing.status_code == 404


def test_ingest_file_endpoint_success_and_validation_error(tmp_path: Path) -> None:
    app = create_app(
        db_path=str(tmp_path / "ingest.db"),
        client_factory=_build_fake_client_factory(),
    )
    client = TestClient(app)

    ok_res = client.post(
        "/api/ingest-file",
        files={"file": ("solution.py", b"def solve(x):\n    return x * 2\n", "text/x-python")},
    )
    assert ok_res.status_code == 200
    ok_data = ok_res.json()
    assert ok_data["filename"] == "solution.py"
    assert ok_data["file_type"] == "code"
    assert "def solve(x):" in ok_data["extracted_text"]
    assert ok_data["page_count"] == 1
    assert ok_data["has_raw_pdf"] is False

    bad_res = client.post(
        "/api/ingest-file",
        files={"file": ("malware.exe", b"\x00\x01\x02", "application/octet-stream")},
    )
    assert bad_res.status_code == 400


def test_evaluate_stream_and_sync_and_history_and_exports(tmp_path: Path) -> None:
    captured: list[dict[str, Any]] = []
    app = create_app(
        db_path=str(tmp_path / "eval.db"),
        client_factory=_build_fake_client_factory(captured),
    )
    client = TestClient(app)
    client.post("/api/assignments/seed")

    seed = SEED_ASSIGNMENTS[0]
    req_body = {
        "assignment_id": seed["id"],
        "student_name": seed["sample_submission"]["student_name"],
        "student_id": seed["sample_submission"]["student_id"],
        "submission_filename": seed["sample_submission"]["submission_filename"],
        "submission_text": seed["sample_submission"]["submission_text"],
        "force_reparse_rubric": False,
    }

    # Test SSE streaming endpoint
    with client.stream(
        "POST",
        "/api/evaluate/stream",
        json=req_body,
        headers={"X-Gemini-Api-Key": "header-key", "X-Gemini-Model": "gemini-3.8-flash"},
    ) as stream_res:
        assert stream_res.status_code == 200
        assert "text/event-stream" in stream_res.headers["content-type"]
        raw_stream = "".join(stream_res.iter_text())

    assert "event: agent_start" in raw_stream
    assert "event: agent_complete" in raw_stream
    assert "event: evaluation_complete" in raw_stream

    # Parse final evaluation_complete payload from SSE stream
    blocks = [b.strip() for b in raw_stream.split("\n\n") if b.strip()]
    last_block = blocks[-1]
    lines = last_block.splitlines()
    assert lines[0] == "event: evaluation_complete"
    final_record = json.loads(lines[1].removeprefix("data: "))
    assert final_record["status"] == "completed"
    assert final_record["total_initial_score"] == 72.0
    assert final_record["total_final_score"] == 78.0
    assert final_record["letter_grade"] == "C+"
    eval_id = final_record["id"]

    # Verify headers were passed to client_factory
    assert captured[-1]["api_key"] == "header-key"
    assert captured[-1]["model"] == "gemini-3.8-flash"

    # Test non-streaming POST /api/evaluate convenience endpoint
    sync_res = client.post("/api/evaluate", json=req_body)
    assert sync_res.status_code == 200
    sync_record = sync_res.json()
    assert sync_record["status"] == "completed"
    assert sync_record["total_final_score"] == 78.0

    # Test listing and fetching evaluations
    list_res = client.get("/api/evaluations", params={"assignment_id": seed["id"]})
    assert list_res.status_code == 200
    evals_list = list_res.json()
    assert len(evals_list) == 2

    single_res = client.get(f"/api/evaluations/{eval_id}")
    assert single_res.status_code == 200
    assert single_res.json()["id"] == eval_id

    missing_res = client.get("/api/evaluations/does-not-exist")
    assert missing_res.status_code == 404

    # Test Markdown and HTML report exports
    md_res = client.get(f"/api/evaluations/{eval_id}/export", params={"format": "md"})
    assert md_res.status_code == 200
    assert "text/markdown" in md_res.headers["content-type"]
    assert "attachment" in md_res.headers.get("content-disposition", "")
    assert "Jordan Patel" in md_res.text

    html_res = client.get(f"/api/evaluations/{eval_id}/export", params={"format": "html"})
    assert html_res.status_code == 200
    assert "text/html" in html_res.headers["content-type"]
    assert "<!DOCTYPE html>" in html_res.text
    assert "Jordan Patel" in html_res.text


def test_sparse_pdf_ingestion_and_multimodal_pdf_bytes_forwarding(tmp_path: Path) -> None:
    captured: list[dict[str, Any]] = []
    app = create_app(
        db_path=str(tmp_path / "pdf.db"),
        client_factory=_build_fake_client_factory(captured),
    )
    client = TestClient(app)
    client.post("/api/assignments/seed")

    # Generate a sparse PDF (<30 non-whitespace chars) to trigger raw_pdf_bytes retention
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, "Scan")
    c.showPage()
    c.save()
    sparse_pdf_bytes = buf.getvalue()

    ingest_res = client.post(
        "/api/ingest-file",
        files={"file": ("scanned_hw.pdf", sparse_pdf_bytes, "application/pdf")},
    )
    assert ingest_res.status_code == 200
    ingest_data = ingest_res.json()
    assert ingest_data["has_raw_pdf"] is True
    assert ingest_data.get("pdf_base64") is not None

    eval_res = client.post(
        "/api/evaluate",
        json={
            "assignment_id": SEED_ASSIGNMENTS[0]["id"],
            "student_name": "Scan Student",
            "student_id": "STU-SCAN",
            "submission_filename": "scanned_hw.pdf",
            "submission_text": ingest_data["extracted_text"],
            "pdf_base64": ingest_data["pdf_base64"],
        },
    )
    assert eval_res.status_code == 200

    evaluator_calls = [call for call in captured if call["schema"] is EvaluatorOutput]
    assert len(evaluator_calls) == 1
    assert evaluator_calls[0]["pdf_bytes"] == sparse_pdf_bytes
    assert base64.b64decode(ingest_data["pdf_base64"]) == sparse_pdf_bytes

    # Also verify cached filename fallback when pdf_base64 is omitted on /api/evaluate/stream
    captured.clear()
    with client.stream(
        "POST",
        "/api/evaluate/stream",
        json={
            "assignment_id": SEED_ASSIGNMENTS[0]["id"],
            "student_name": "Scan Student 2",
            "submission_filename": "scanned_hw.pdf",
            "submission_text": ingest_data["extracted_text"],
        },
    ) as stream_res:
        assert stream_res.status_code == 200
        _ = "".join(stream_res.iter_text())

    stream_eval_calls = [call for call in captured if call["schema"] is EvaluatorOutput]
    assert len(stream_eval_calls) == 1
    assert stream_eval_calls[0]["pdf_bytes"] == sparse_pdf_bytes


def test_evaluate_and_export_error_handling(tmp_path: Path) -> None:
    app = create_app(
        db_path=str(tmp_path / "errors.db"),
        client_factory=_build_fake_client_factory(),
    )
    client = TestClient(app)

    # Evaluate against missing assignment -> HTTP 400
    missing_assign_res = client.post(
        "/api/evaluate",
        json={
            "assignment_id": "nonexistent-assignment",
            "submission_text": "print(1)",
        },
    )
    assert missing_assign_res.status_code == 400

    # Invalid base64 PDF payload -> HTTP 400
    bad_b64_res = client.post(
        "/api/evaluate",
        json={
            "assignment_id": "nonexistent-assignment",
            "submission_text": "print(1)",
            "pdf_base64": "%%%not-valid-base64%%%",
        },
    )
    assert bad_b64_res.status_code == 400

    # Export nonexistent evaluation -> HTTP 404
    assert client.get("/api/evaluations/missing-id/export").status_code == 404

    # Seed and run one evaluation, then request unsupported export format -> HTTP 400
    client.post("/api/assignments/seed")
    ok_eval = client.post(
        "/api/evaluate",
        json={
            "assignment_id": SEED_ASSIGNMENTS[0]["id"],
            "submission_text": "class LRUCache: pass",
        },
    ).json()
    bad_fmt = client.get(
        f"/api/evaluations/{ok_eval['id']}/export",
        params={"format": "docx"},
    )
    assert bad_fmt.status_code == 400

