from typing import Literal

from pydantic import BaseModel, Field


class ScoringBand(BaseModel):
    band_label: str = Field(description="Band name such as Exemplary, Proficient, Developing, Unsatisfactory")
    points_range: str = Field(description="Point range string such as '9-10' or '0-2'")
    description: str = Field(description="Concrete requirements to achieve this scoring band")


class RubricCriterion(BaseModel):
    criterion_id: str = Field(description="Short identifier such as C1, C2, C3")
    title: str = Field(description="Criterion title")
    description: str = Field(description="Detailed description of what is evaluated")
    max_points: float = Field(description="Maximum points available for this criterion")
    evaluation_focus: Literal["code_logic", "code_quality", "theory_concept", "completeness"]
    scoring_bands: list[ScoringBand]


class StructuredRubric(BaseModel):
    rubric_title: str
    total_max_points: float
    criteria: list[RubricCriterion]


class CriterionEvaluation(BaseModel):
    criterion_id: str
    criterion_title: str
    max_points: float
    chain_of_thought_trace: str = Field(
        description="Step-by-step mental execution trace for code or conceptual verification for theory"
    )
    student_evidence_quotes: list[str] = Field(
        description="Direct quotes or code snippets from the student submission"
    )
    strengths_observed: list[str]
    flaws_or_gaps_observed: list[str]
    initial_score: float
    rationale: str


class EvaluatorOutput(BaseModel):
    submission_modality: Literal["code", "theory", "hybrid"]
    overall_comprehension_summary: str
    criterion_evaluations: list[CriterionEvaluation]


class CriterionAudit(BaseModel):
    criterion_id: str
    initial_score: float
    calibrated_score: float
    adjustment_delta: float
    audit_verdict: Literal["verified", "adjusted_up", "adjusted_down"]
    bias_or_error_detected: str
    calibration_reasoning: str


class ReflectionOutput(BaseModel):
    audit_status: Literal["verified", "calibrated"]
    overall_audit_summary: str
    bias_checks_performed: list[str]
    criterion_audits: list[CriterionAudit]


class LearningGap(BaseModel):
    concept_or_skill: str
    observed_issue: str
    actionable_fix: str
    example_or_hint: str


class FeedbackOutput(BaseModel):
    executive_summary: str
    key_strengths: list[str]
    learning_gaps: list[LearningGap]
    revision_roadmap: list[str]
    encouraging_closing: str


class AssignmentCreate(BaseModel):
    title: str
    assignment_type: Literal["code", "theory", "hybrid"] = "hybrid"
    prompt_text: str
    raw_rubric_text: str = ""
    reference_solution_text: str = ""
    parse_rubric_now: bool = False


class AssignmentRecord(BaseModel):
    id: str
    title: str
    assignment_type: Literal["code", "theory", "hybrid"]
    prompt_text: str
    raw_rubric_text: str
    reference_solution_text: str
    structured_rubric: StructuredRubric | None = None
    created_at: str


class EvaluationRecord(BaseModel):
    id: str
    assignment_id: str
    student_name: str
    student_id: str
    submission_filename: str
    submission_text: str
    status: Literal["running", "completed", "failed"]
    rubric_used: StructuredRubric | None = None
    initial_evaluation: EvaluatorOutput | None = None
    reflection_audit: ReflectionOutput | None = None
    feedback_report: FeedbackOutput | None = None
    total_initial_score: float = 0.0
    total_final_score: float = 0.0
    max_possible_score: float = 0.0
    letter_grade: str = "N/A"
    duration_ms: int = 0
    error_message: str = ""
    created_at: str


class EvaluateRequest(BaseModel):
    assignment_id: str
    student_name: str = "Anonymous Student"
    student_id: str = ""
    submission_filename: str = "submission.txt"
    submission_text: str
    force_reparse_rubric: bool = False
