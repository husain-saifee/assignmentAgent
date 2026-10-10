from pathlib import Path

from app.config import Settings, get_settings
from app.db import Database
from app.samples import SEED_ASSIGNMENTS
from app.schemas import (
    AssignmentCreate,
    AssignmentRecord,
    CriterionAudit,
    CriterionEvaluation,
    EvaluateRequest,
    EvaluationRecord,
    EvaluatorOutput,
    FeedbackOutput,
    LearningGap,
    ReflectionOutput,
    RubricCriterion,
    ScoringBand,
    StructuredRubric,
)


def test_schemas_and_sqlite_crud(tmp_path: Path) -> None:
    db_file = tmp_path / "test_eval.db"
    db = Database(str(db_file))
    db.init_db()

    rubric = StructuredRubric(
        rubric_title="Binary Search Rubric",
        total_max_points=20.0,
        criteria=[
            RubricCriterion(
                criterion_id="C1",
                title="Algorithmic Correctness",
                description="Correct O(log n) binary search implementation",
                max_points=10.0,
                evaluation_focus="code_logic",
                scoring_bands=[
                    ScoringBand(band_label="Full", points_range="9-10", description="Handles all cases"),
                    ScoringBand(band_label="Partial", points_range="5-8", description="Off-by-one error"),
                ],
            ),
            RubricCriterion(
                criterion_id="C2",
                title="Complexity Analysis",
                description="Explains time and space complexity accurately",
                max_points=10.0,
                evaluation_focus="theory_concept",
                scoring_bands=[
                    ScoringBand(band_label="Full", points_range="9-10", description="Exact big-O derivation"),
                ],
            ),
        ],
    )

    assignment = db.create_assignment(
        title="HW1: Binary Search & Complexity",
        assignment_type="hybrid",
        prompt_text="Implement binary search and analyze complexity.",
        raw_rubric_text="10 pts code, 10 pts complexity.",
        reference_solution_text="def binary_search(arr, target): ...",
        structured_rubric=rubric,
    )
    assert isinstance(assignment, AssignmentRecord)
    assert assignment.id
    assert assignment.structured_rubric is not None
    assert assignment.structured_rubric.total_max_points == 20.0

    eval_rec = db.create_evaluation(
        assignment_id=assignment.id,
        student_name="Alice Vance",
        student_id="S101",
        submission_filename="solution.py",
        submission_text="def binary_search(a, x): return a.index(x)",
    )
    assert isinstance(eval_rec, EvaluationRecord)
    assert eval_rec.status == "running"

    initial_eval = EvaluatorOutput(
        submission_modality="hybrid",
        overall_comprehension_summary="Used linear index() instead of binary search.",
        criterion_evaluations=[
            CriterionEvaluation(
                criterion_id="C1",
                criterion_title="Algorithmic Correctness",
                max_points=10.0,
                chain_of_thought_trace="list.index() scans linearly O(n) and raises ValueError if missing.",
                student_evidence_quotes=["return a.index(x)"],
                strengths_observed=["Valid Python syntax"],
                flaws_or_gaps_observed=["O(n) linear scan instead of O(log n)"],
                initial_score=3.0,
                rationale="Does not implement binary search.",
            ),
            CriterionEvaluation(
                criterion_id="C2",
                criterion_title="Complexity Analysis",
                max_points=10.0,
                chain_of_thought_trace="No complexity explanation included.",
                student_evidence_quotes=[],
                strengths_observed=[],
                flaws_or_gaps_observed=["Missing complexity analysis"],
                initial_score=0.0,
                rationale="Omitted.",
            ),
        ],
    )

    reflection = ReflectionOutput(
        audit_status="calibrated",
        overall_audit_summary="Adjusted C1 slightly for partial functional output on present elements.",
        bias_checks_performed=["Checked harshness on C1", "Verified C2 omission"],
        criterion_audits=[
            CriterionAudit(
                criterion_id="C1",
                initial_score=3.0,
                calibrated_score=4.0,
                adjustment_delta=1.0,
                audit_verdict="adjusted_up",
                bias_or_error_detected="Slightly harsh deduction for working lookup",
                calibration_reasoning="Award 4/10 under developing band.",
            ),
            CriterionAudit(
                criterion_id="C2",
                initial_score=0.0,
                calibrated_score=0.0,
                adjustment_delta=0.0,
                audit_verdict="verified",
                bias_or_error_detected="None",
                calibration_reasoning="Confirmed missing.",
            ),
        ],
    )

    feedback = FeedbackOutput(
        executive_summary="Your submission uses Python's built-in linear scan rather than binary search.",
        key_strengths=["Concise function signature"],
        learning_gaps=[
            LearningGap(
                concept_or_skill="Divide and Conquer (Binary Search)",
                observed_issue="Used list.index(x) which runs in O(n) time.",
                actionable_fix="Maintain low and high pointers and halve the search space each iteration.",
                example_or_hint="mid = (low + high) // 2",
            )
        ],
        revision_roadmap=["Implement two-pointer loop", "Add Big-O time/space explanation"],
        encouraging_closing="Great start—refactoring to two pointers will get you to O(log n)!",
    )

    completed = db.complete_evaluation(
        evaluation_id=eval_rec.id,
        rubric_used=rubric,
        initial_evaluation=initial_eval,
        reflection_audit=reflection,
        feedback_report=feedback,
        total_initial_score=3.0,
        total_final_score=4.0,
        max_possible_score=20.0,
        letter_grade="F",
        duration_ms=1450,
    )
    assert completed.status == "completed"
    assert completed.total_final_score == 4.0
    assert completed.feedback_report is not None
    assert len(SEED_ASSIGNMENTS) >= 2


def test_assignment_and_evaluation_lifecycle_methods(tmp_path: Path) -> None:
    db_file = tmp_path / "lifecycle.db"
    db = Database(str(db_file))
    db.init_db()

    # Create assignment without initial structured rubric and with explicit id
    a1 = db.create_assignment(
        assignment_id="custom-assign-1",
        title="HW2: Dynamic Programming",
        assignment_type="code",
        prompt_text="Solve 0/1 Knapsack.",
    )
    assert a1.id == "custom-assign-1"
    assert a1.structured_rubric is None

    # List and get assignments
    assignments = db.list_assignments()
    assert len(assignments) == 1
    assert assignments[0].id == "custom-assign-1"
    assert db.get_assignment("custom-assign-1") is not None
    assert db.get_assignment("nonexistent") is None

    # Update assignment rubric
    new_rubric = StructuredRubric(
        rubric_title="Knapsack Rubric",
        total_max_points=10.0,
        criteria=[
            RubricCriterion(
                criterion_id="C1",
                title="DP State Transition",
                description="Correct recurrence relation",
                max_points=10.0,
                evaluation_focus="code_logic",
                scoring_bands=[
                    ScoringBand(band_label="Exemplary", points_range="9-10", description="Optimal O(nW)"),
                ],
            )
        ],
    )
    updated = db.update_assignment_rubric("custom-assign-1", new_rubric)
    assert updated is not None
    assert updated.structured_rubric is not None
    assert updated.structured_rubric.rubric_title == "Knapsack Rubric"
    assert db.update_assignment_rubric("nonexistent", new_rubric) is None

    # Create and fail evaluation
    ev = db.create_evaluation(
        assignment_id=a1.id,
        student_name="Bob Stone",
        submission_text="def knapsack(): pass",
    )
    failed = db.fail_evaluation(ev.id, "Missing API key", duration_ms=120)
    assert failed is not None
    assert failed.status == "failed"
    assert failed.error_message == "Missing API key"
    assert failed.duration_ms == 120
    assert db.fail_evaluation("nonexistent", "err") is None

    # Get and list evaluations
    fetched_ev = db.get_evaluation(ev.id)
    assert fetched_ev is not None
    assert fetched_ev.status == "failed"
    assert db.get_evaluation("nonexistent") is None

    evals_for_a1 = db.list_evaluations(assignment_id=a1.id)
    assert len(evals_for_a1) == 1
    all_evals = db.list_evaluations()
    assert len(all_evals) == 1

    # Delete assignment (and cascade delete evaluations)
    assert db.delete_assignment(a1.id) is True
    assert db.delete_assignment(a1.id) is False
    assert db.get_assignment(a1.id) is None
    assert db.list_evaluations(assignment_id=a1.id) == []


def test_settings_and_request_schemas_and_seeds() -> None:
    settings = get_settings()
    assert isinstance(settings, Settings)
    assert settings.gemini_model
    assert settings.database_path

    create_req = AssignmentCreate(
        title="Test Assignment",
        prompt_text="Explain CAP theorem.",
    )
    assert create_req.assignment_type == "hybrid"
    assert create_req.parse_rubric_now is False

    eval_req = EvaluateRequest(
        assignment_id="a1",
        submission_text="Answer text",
    )
    assert eval_req.student_name == "Anonymous Student"
    assert eval_req.submission_filename == "submission.txt"

    # Verify SEED_ASSIGNMENTS structure
    assert len(SEED_ASSIGNMENTS) >= 2
    modalities = {item["assignment_type"] for item in SEED_ASSIGNMENTS}
    assert "code" in modalities
    assert "theory" in modalities

    for seed in SEED_ASSIGNMENTS:
        assert isinstance(seed["id"], str) and seed["id"]
        assert isinstance(seed["title"], str) and seed["title"]
        assert seed["assignment_type"] in ("code", "theory", "hybrid")
        assert isinstance(seed["prompt_text"], str) and seed["prompt_text"]
        assert isinstance(seed["raw_rubric_text"], str) and seed["raw_rubric_text"]
        assert isinstance(seed["reference_solution_text"], str) and seed["reference_solution_text"]
        assert isinstance(seed["structured_rubric"], StructuredRubric)
        sample_sub = seed["sample_submission"]
        assert isinstance(sample_sub, dict)
        assert sample_sub["student_name"]
        assert sample_sub["student_id"]
        assert sample_sub["submission_filename"]
        assert sample_sub["submission_text"]
