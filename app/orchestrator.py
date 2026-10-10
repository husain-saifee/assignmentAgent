import time
from collections.abc import AsyncIterator
from typing import Any

from app.agents import (
    GeminiStructuredClient,
    audit_and_calibrate,
    evaluate_submission,
    parse_or_generate_rubric,
    synthesize_feedback,
)
from app.db import Database
from app.schemas import (
    EvaluateRequest,
    EvaluatorOutput,
    ReflectionOutput,
    StructuredRubric,
)


def compute_letter_grade(score: float, max_score: float) -> str:
    if max_score <= 0:
        return "N/A"
    pct = (score / max_score) * 100.0
    if pct >= 93.0:
        return "A"
    if pct >= 90.0:
        return "A-"
    if pct >= 87.0:
        return "B+"
    if pct >= 83.0:
        return "B"
    if pct >= 80.0:
        return "B-"
    if pct >= 77.0:
        return "C+"
    if pct >= 73.0:
        return "C"
    if pct >= 70.0:
        return "C-"
    if pct >= 60.0:
        return "D"
    return "F"


def clamp_and_reconcile_scores(
    rubric: StructuredRubric,
    initial_eval: EvaluatorOutput,
    reflection: ReflectionOutput,
) -> tuple[float, float, float]:
    max_by_id: dict[str, float] = {
        c.criterion_id.strip(): max(0.0, float(c.max_points)) for c in rubric.criteria
    }
    max_by_id_lower: dict[str, float] = {
        k.lower(): v for k, v in max_by_id.items()
    }

    def _resolve_max_points(cid: str, idx: int, fallback: float) -> float:
        key = cid.strip()
        if key in max_by_id:
            return max_by_id[key]
        if key.lower() in max_by_id_lower:
            return max_by_id_lower[key.lower()]
        if idx < len(rubric.criteria):
            return max(0.0, float(rubric.criteria[idx].max_points))
        return max(0.0, float(fallback))

    clamped_initial_by_id: dict[str, float] = {}
    clamped_initial_by_id_lower: dict[str, float] = {}
    clamped_initial_by_idx: list[float] = []

    for idx, ce in enumerate(initial_eval.criterion_evaluations):
        max_pts = _resolve_max_points(ce.criterion_id, idx, ce.max_points)
        ce.max_points = max_pts
        clamped_score = round(min(max(float(ce.initial_score), 0.0), max_pts), 2)
        ce.initial_score = clamped_score
        key = ce.criterion_id.strip()
        clamped_initial_by_id[key] = clamped_score
        clamped_initial_by_id_lower[key.lower()] = clamped_score
        clamped_initial_by_idx.append(clamped_score)

    any_adjusted = False
    for idx, ca in enumerate(reflection.criterion_audits):
        max_pts = _resolve_max_points(ca.criterion_id, idx, max_by_id.get(ca.criterion_id, 100.0))
        key = ca.criterion_id.strip()
        if key in clamped_initial_by_id:
            init_score = clamped_initial_by_id[key]
        elif key.lower() in clamped_initial_by_id_lower:
            init_score = clamped_initial_by_id_lower[key.lower()]
        elif idx < len(clamped_initial_by_idx):
            init_score = clamped_initial_by_idx[idx]
        else:
            init_score = round(min(max(float(ca.initial_score), 0.0), max_pts), 2)

        ca.initial_score = init_score
        ca.calibrated_score = round(min(max(float(ca.calibrated_score), 0.0), max_pts), 2)
        ca.adjustment_delta = round(ca.calibrated_score - ca.initial_score, 2)

        if ca.adjustment_delta > 0.01:
            ca.audit_verdict = "adjusted_up"
            any_adjusted = True
        elif ca.adjustment_delta < -0.01:
            ca.audit_verdict = "adjusted_down"
            any_adjusted = True
        else:
            ca.audit_verdict = "verified"

    reflection.audit_status = "calibrated" if any_adjusted else "verified"

    total_initial_score = round(sum(ce.initial_score for ce in initial_eval.criterion_evaluations), 2)
    if reflection.criterion_audits:
        total_final_score = round(sum(ca.calibrated_score for ca in reflection.criterion_audits), 2)
    else:
        total_final_score = total_initial_score

    if rubric.criteria:
        max_possible_score = round(sum(max(0.0, float(c.max_points)) for c in rubric.criteria), 2)
        rubric.total_max_points = max_possible_score
    else:
        max_possible_score = round(max(0.0, float(rubric.total_max_points)), 2)

    return total_initial_score, total_final_score, max_possible_score


async def run_evaluation_pipeline(
    db: Database,
    client: GeminiStructuredClient,
    request: EvaluateRequest,
    pdf_bytes: bytes | None = None,
) -> AsyncIterator[dict[str, Any]]:
    assignment = db.get_assignment(request.assignment_id)
    if assignment is None:
        yield {"event": "agent_error", "data": {"message": "Assignment not found"}}
        return

    eval_rec = db.create_evaluation(
        assignment_id=request.assignment_id,
        student_name=request.student_name,
        student_id=request.student_id,
        submission_filename=request.submission_filename,
        submission_text=request.submission_text,
    )

    pipeline_start = time.perf_counter()

    try:
        # Stage 1: Rubric Parser Agent
        yield {
            "event": "agent_start",
            "data": {"agent": "rubric_parser", "label": "Rubric Parser Agent"},
        }
        stage_t0 = time.perf_counter()
        if assignment.structured_rubric is not None and not request.force_reparse_rubric:
            rubric = assignment.structured_rubric
            cached = True
        else:
            rubric = await parse_or_generate_rubric(
                client,
                title=assignment.title,
                assignment_type=assignment.assignment_type,
                prompt_text=assignment.prompt_text,
                raw_rubric_text=assignment.raw_rubric_text,
                reference_solution_text=assignment.reference_solution_text,
            )
            db.update_assignment_rubric(assignment.id, rubric)
            cached = False
        stage1_ms = int((time.perf_counter() - stage_t0) * 1000)
        yield {
            "event": "agent_complete",
            "data": {
                "agent": "rubric_parser",
                "cached": cached,
                "duration_ms": stage1_ms,
                "output": rubric.model_dump(),
            },
        }

        # Stage 2: Chain-of-Thought Evaluator Agent
        yield {
            "event": "agent_start",
            "data": {"agent": "cot_evaluator", "label": "Chain-of-Thought Evaluator Agent"},
        }
        stage_t0 = time.perf_counter()
        initial_eval = await evaluate_submission(
            client,
            assignment_title=assignment.title,
            assignment_type=assignment.assignment_type,
            prompt_text=assignment.prompt_text,
            reference_solution_text=assignment.reference_solution_text,
            rubric=rubric,
            submission_text=request.submission_text,
            pdf_bytes=pdf_bytes,
        )
        stage2_ms = int((time.perf_counter() - stage_t0) * 1000)
        yield {
            "event": "agent_complete",
            "data": {
                "agent": "cot_evaluator",
                "duration_ms": stage2_ms,
                "output": initial_eval.model_dump(),
            },
        }

        # Stage 3: Reflection & Bias Auditor Agent
        yield {
            "event": "agent_start",
            "data": {"agent": "reflection_auditor", "label": "Reflection & Bias Auditor Agent"},
        }
        stage_t0 = time.perf_counter()
        reflection = await audit_and_calibrate(
            client,
            prompt_text=assignment.prompt_text,
            reference_solution_text=assignment.reference_solution_text,
            rubric=rubric,
            initial_evaluation=initial_eval,
            submission_text=request.submission_text,
        )
        total_initial_score, total_final_score, max_possible_score = clamp_and_reconcile_scores(
            rubric, initial_eval, reflection
        )
        stage3_ms = int((time.perf_counter() - stage_t0) * 1000)
        yield {
            "event": "agent_complete",
            "data": {
                "agent": "reflection_auditor",
                "duration_ms": stage3_ms,
                "output": reflection.model_dump(),
                "total_initial_score": total_initial_score,
                "total_final_score": total_final_score,
                "max_possible_score": max_possible_score,
            },
        }

        # Stage 4: Pedagogical Feedback Synthesizer Agent
        yield {
            "event": "agent_start",
            "data": {
                "agent": "feedback_synthesizer",
                "label": "Pedagogical Feedback Synthesizer Agent",
            },
        }
        stage_t0 = time.perf_counter()
        feedback = await synthesize_feedback(
            client,
            assignment_title=assignment.title,
            rubric=rubric,
            initial_evaluation=initial_eval,
            reflection_audit=reflection,
            submission_text=request.submission_text,
        )
        stage4_ms = int((time.perf_counter() - stage_t0) * 1000)
        yield {
            "event": "agent_complete",
            "data": {
                "agent": "feedback_synthesizer",
                "duration_ms": stage4_ms,
                "output": feedback.model_dump(),
            },
        }

        total_duration_ms = int((time.perf_counter() - pipeline_start) * 1000)
        letter_grade = compute_letter_grade(total_final_score, max_possible_score)
        completed_record = db.complete_evaluation(
            evaluation_id=eval_rec.id,
            rubric_used=rubric,
            initial_evaluation=initial_eval,
            reflection_audit=reflection,
            feedback_report=feedback,
            total_initial_score=total_initial_score,
            total_final_score=total_final_score,
            max_possible_score=max_possible_score,
            letter_grade=letter_grade,
            duration_ms=total_duration_ms,
        )
        yield {
            "event": "evaluation_complete",
            "data": completed_record.model_dump(),
        }
    except Exception as exc:  # noqa: BLE001
        duration_ms = int((time.perf_counter() - pipeline_start) * 1000)
        db.fail_evaluation(eval_rec.id, str(exc), duration_ms)
        yield {
            "event": "agent_error",
            "data": {
                "evaluation_id": eval_rec.id,
                "message": str(exc),
            },
        }
