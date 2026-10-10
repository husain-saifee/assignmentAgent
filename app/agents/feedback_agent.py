from app.agents.gemini_client import GeminiStructuredClient
from app.schemas import (
    EvaluatorOutput,
    FeedbackOutput,
    ReflectionOutput,
    StructuredRubric,
)

FEEDBACK_SYSTEM_INSTRUCTION = (
    "You are a Pedagogical Feedback Synthesizer Agent and supportive university mentor.\n"
    "Transform the technical evaluation trace and calibrated reflection audit into clear, personalized, "
    "constructive student-facing feedback:\n"
    "- Summarize overall achievement candidly and encouragingly in executive_summary.\n"
    "- Highlight concrete key_strengths demonstrated in the student's work.\n"
    "- Turn verified deductions into structured learning_gaps with concept_or_skill, observed_issue, "
    "actionable_fix, and a targeted example_or_hint (without giving away a full copy-paste solution).\n"
    "- Provide a prioritized, step-by-step revision_roadmap and an encouraging_closing."
)


async def synthesize_feedback(
    client: GeminiStructuredClient,
    *,
    assignment_title: str,
    rubric: StructuredRubric,
    initial_evaluation: EvaluatorOutput,
    reflection_audit: ReflectionOutput,
    submission_text: str,
) -> FeedbackOutput:
    prompt = (
        f"ASSIGNMENT TITLE: {assignment_title}\n\n"
        f"STRUCTURED RUBRIC (JSON):\n{rubric.model_dump_json(indent=2)}\n\n"
        f"INITIAL EVALUATION (JSON):\n{initial_evaluation.model_dump_json(indent=2)}\n\n"
        f"CALIBRATED REFLECTION AUDIT (JSON):\n{reflection_audit.model_dump_json(indent=2)}\n\n"
        f"STUDENT SUBMISSION:\n{submission_text}\n\n"
        "Synthesize actionable, student-facing FeedbackOutput aligned with the calibrated scores and identified learning gaps."
    )

    return await client.generate_structured(
        system_instruction=FEEDBACK_SYSTEM_INSTRUCTION,
        prompt=prompt,
        response_schema=FeedbackOutput,
        temperature=0.2,
    )
