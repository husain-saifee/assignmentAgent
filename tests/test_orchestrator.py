from pathlib import Path
from typing import Any

import pytest

from app.agents.gemini_client import GeminiClientError, GeminiStructuredClient
from app.db import Database
from app.orchestrator import (
    clamp_and_reconcile_scores,
    compute_letter_grade,
    run_evaluation_pipeline,
)
from app.samples import SEED_ASSIGNMENTS
from app.schemas import (
    CriterionAudit,
    CriterionEvaluation,
    EvaluateRequest,
    EvaluatorOutput,
    FeedbackOutput,
    LearningGap,
    ReflectionOutput,
    StructuredRubric,
)


def _sample_rubric() -> StructuredRubric:
    return SEED_ASSIGNMENTS[0]["structured_rubric"].model_copy(deep=True)


def _sample_evaluator_output() -> EvaluatorOutput:
    return EvaluatorOutput(
        submission_modality="code",
        overall_comprehension_summary="Student uses dict + list resulting in O(n) recency updates.",
        criterion_evaluations=[
            CriterionEvaluation(
                criterion_id="C1",
                criterion_title="Data Structure & O(1) Time Complexity",
                max_points=40.0,
                chain_of_thought_trace="Traced get(1): self.order.remove(key) scans list in O(n).",
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


def _sample_reflection_output() -> ReflectionOutput:
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


def _sample_feedback_output() -> FeedbackOutput:
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


def test_compute_letter_grade_thresholds_and_zero_max() -> None:
    assert compute_letter_grade(50.0, 0.0) == "N/A"
    assert compute_letter_grade(50.0, -10.0) == "N/A"
    assert compute_letter_grade(93.0, 100.0) == "A"
    assert compute_letter_grade(99.5, 100.0) == "A"
    assert compute_letter_grade(90.0, 100.0) == "A-"
    assert compute_letter_grade(87.0, 100.0) == "B+"
    assert compute_letter_grade(83.0, 100.0) == "B"
    assert compute_letter_grade(80.0, 100.0) == "B-"
    assert compute_letter_grade(77.0, 100.0) == "C+"
    assert compute_letter_grade(73.0, 100.0) == "C"
    assert compute_letter_grade(70.0, 100.0) == "C-"
    assert compute_letter_grade(60.0, 100.0) == "D"
    assert compute_letter_grade(59.9, 100.0) == "F"
    assert compute_letter_grade(0.0, 100.0) == "F"


def test_clamp_and_reconcile_scores_clamps_bounds_and_updates_verdicts() -> None:
    rubric = _sample_rubric()  # C1=40, C2=35, C3=25 -> total 100
    initial_eval = _sample_evaluator_output()
    reflection = _sample_reflection_output()

    # Set out-of-bounds scores and slightly mismatched criterion_id on index 2 to verify fallback
    initial_eval.criterion_evaluations[0].initial_score = 45.0  # above 40 -> clamp to 40.0
    initial_eval.criterion_evaluations[1].initial_score = -4.5  # below 0 -> clamp to 0.0
    initial_eval.criterion_evaluations[2].criterion_id = "C3-edge"
    initial_eval.criterion_evaluations[2].initial_score = 18.556  # round to 18.56

    reflection.criterion_audits[0].initial_score = 45.0
    reflection.criterion_audits[0].calibrated_score = 35.0  # 35.0 - 40.0 = -5.0 -> adjusted_down
    reflection.criterion_audits[0].audit_verdict = "verified"

    reflection.criterion_audits[1].initial_score = -4.5
    reflection.criterion_audits[1].calibrated_score = 50.0  # clamp to 35.0; 35.0 - 0.0 = +35.0 -> adjusted_up
    reflection.criterion_audits[1].audit_verdict = "verified"

    reflection.criterion_audits[2].criterion_id = "C3-edge"
    reflection.criterion_audits[2].initial_score = 10.0  # should sync to clamped initial 18.56
    reflection.criterion_audits[2].calibrated_score = 18.56  # delta = 0.0 -> verified
    reflection.criterion_audits[2].audit_verdict = "adjusted_up"

    reflection.audit_status = "verified"

    total_init, total_final, max_score = clamp_and_reconcile_scores(
        rubric, initial_eval, reflection
    )

    assert initial_eval.criterion_evaluations[0].initial_score == 40.0
    assert initial_eval.criterion_evaluations[1].initial_score == 0.0
    assert initial_eval.criterion_evaluations[2].initial_score == 18.56

    assert reflection.criterion_audits[0].initial_score == 40.0
    assert reflection.criterion_audits[0].calibrated_score == 35.0
    assert reflection.criterion_audits[0].adjustment_delta == -5.0
    assert reflection.criterion_audits[0].audit_verdict == "adjusted_down"

    assert reflection.criterion_audits[1].initial_score == 0.0
    assert reflection.criterion_audits[1].calibrated_score == 35.0
    assert reflection.criterion_audits[1].adjustment_delta == 35.0
    assert reflection.criterion_audits[1].audit_verdict == "adjusted_up"

    assert reflection.criterion_audits[2].initial_score == 18.56
    assert reflection.criterion_audits[2].calibrated_score == 18.56
    assert reflection.criterion_audits[2].adjustment_delta == 0.0
    assert reflection.criterion_audits[2].audit_verdict == "verified"

    assert reflection.audit_status == "calibrated"
    assert total_init == 58.56
    assert total_final == 88.56
    assert max_score == 100.0


def test_clamp_and_reconcile_scores_sets_verified_when_no_adjustments() -> None:
    rubric = _sample_rubric()
    initial_eval = _sample_evaluator_output()
    reflection = _sample_reflection_output()

    # Make all calibrated scores match initial scores
    for ce, ca in zip(initial_eval.criterion_evaluations, reflection.criterion_audits, strict=True):
        ca.calibrated_score = ce.initial_score

    total_init, total_final, max_score = clamp_and_reconcile_scores(
        rubric, initial_eval, reflection
    )
    assert reflection.audit_status == "verified"
    assert all(ca.audit_verdict == "verified" for ca in reflection.criterion_audits)
    assert total_init == 72.0
    assert total_final == 72.0
    assert max_score == 100.0


@pytest.mark.asyncio
async def test_run_evaluation_pipeline_missing_assignment_yields_error(tmp_path: Path) -> None:
    db = Database(str(tmp_path / "test.db"))
    db.init_db()
    client = GeminiStructuredClient(api_key="test-key")

    request = EvaluateRequest(
        assignment_id="non-existent-id",
        student_name="Alex",
        submission_text="print('hello')",
    )

    events = [ev async for ev in run_evaluation_pipeline(db, client, request)]
    assert len(events) == 1
    assert events[0]["event"] == "agent_error"
    assert events[0]["data"]["message"] == "Assignment not found"
    assert db.list_evaluations() == []


@pytest.mark.asyncio
async def test_run_evaluation_pipeline_cached_rubric_full_lifecycle(tmp_path: Path) -> None:
    db = Database(str(tmp_path / "test.db"))
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

    client = GeminiStructuredClient(api_key="test-key")
    schemas_called: list[Any] = []

    async def fake_generate_structured(**kwargs: Any) -> Any:
        schema = kwargs["response_schema"]
        schemas_called.append(schema)
        if schema is EvaluatorOutput:
            return _sample_evaluator_output()
        if schema is ReflectionOutput:
            return _sample_reflection_output()
        if schema is FeedbackOutput:
            return _sample_feedback_output()
        raise AssertionError(f"Unexpected schema: {schema}")

    client.generate_structured = fake_generate_structured  # type: ignore[method-assign]

    request = EvaluateRequest(
        assignment_id=assignment.id,
        student_name="Jordan Patel",
        student_id="STU-4082",
        submission_filename="lru_cache.py",
        submission_text=seed["sample_submission"]["submission_text"],
        force_reparse_rubric=False,
    )

    events = [
        ev
        async for ev in run_evaluation_pipeline(
            db, client, request, pdf_bytes=b"%PDF-1.4 mock"
        )
    ]

    assert schemas_called == [EvaluatorOutput, ReflectionOutput, FeedbackOutput]
    event_names = [e["event"] for e in events]
    assert event_names == [
        "agent_start",
        "agent_complete",
        "agent_start",
        "agent_complete",
        "agent_start",
        "agent_complete",
        "agent_start",
        "agent_complete",
        "evaluation_complete",
    ]

    # Verify Stage 1 cached rubric
    assert events[0]["data"]["agent"] == "rubric_parser"
    assert events[1]["data"]["agent"] == "rubric_parser"
    assert events[1]["data"]["cached"] is True

    # Verify Stage 3 reflection output has reconciled totals
    assert events[5]["data"]["agent"] == "reflection_auditor"
    assert events[5]["data"]["total_initial_score"] == 72.0
    assert events[5]["data"]["total_final_score"] == 78.0
    assert events[5]["data"]["max_possible_score"] == 100.0

    # Verify final evaluation_complete payload and DB state
    final_data = events[-1]["data"]
    assert final_data["status"] == "completed"
    assert final_data["total_initial_score"] == 72.0
    assert final_data["total_final_score"] == 78.0
    assert final_data["max_possible_score"] == 100.0
    assert final_data["letter_grade"] == "C+"

    persisted = db.get_evaluation(final_data["id"])
    assert persisted is not None
    assert persisted.status == "completed"
    assert persisted.letter_grade == "C+"
    assert persisted.total_final_score == 78.0


@pytest.mark.asyncio
async def test_run_evaluation_pipeline_parses_rubric_when_uncached_and_handles_failure(
    tmp_path: Path,
) -> None:
    db = Database(str(tmp_path / "test.db"))
    db.init_db()

    seed = SEED_ASSIGNMENTS[0]
    assignment = db.create_assignment(
        title=seed["title"],
        assignment_type=seed["assignment_type"],
        prompt_text=seed["prompt_text"],
        raw_rubric_text=seed["raw_rubric_text"],
        reference_solution_text=seed["reference_solution_text"],
        structured_rubric=None,
    )
    assert assignment.structured_rubric is None

    client = GeminiStructuredClient(api_key="test-key")

    async def fake_generate_failing_on_evaluator(**kwargs: Any) -> Any:
        schema = kwargs["response_schema"]
        if schema is StructuredRubric:
            return _sample_rubric()
        raise GeminiClientError("Simulated evaluator failure")

    client.generate_structured = fake_generate_failing_on_evaluator  # type: ignore[method-assign]

    request = EvaluateRequest(
        assignment_id=assignment.id,
        student_name="Jordan Patel",
        submission_text="class LRUCache: pass",
    )

    events = [ev async for ev in run_evaluation_pipeline(db, client, request)]

    # Should have parsed and cached the rubric on the assignment before failing in stage 2
    updated_assignment = db.get_assignment(assignment.id)
    assert updated_assignment is not None
    assert updated_assignment.structured_rubric is not None

    assert events[1]["event"] == "agent_complete"
    assert events[1]["data"]["agent"] == "rubric_parser"
    assert events[1]["data"]["cached"] is False

    assert events[-1]["event"] == "agent_error"
    assert "Simulated evaluator failure" in events[-1]["data"]["message"]
    eval_id = events[-1]["data"]["evaluation_id"]

    failed_rec = db.get_evaluation(eval_id)
    assert failed_rec is not None
    assert failed_rec.status == "failed"
    assert "Simulated evaluator failure" in failed_rec.error_message
