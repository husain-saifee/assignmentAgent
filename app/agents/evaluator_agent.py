from app.agents.gemini_client import GeminiStructuredClient
from app.schemas import EvaluatorOutput, StructuredRubric

EVALUATOR_SYSTEM_INSTRUCTION = (
    "You are an expert Academic Evaluator Agent performing rigorous Chain-of-Thought static and semantic "
    "trace verification on student submissions.\n"
    "Follow these mandatory evaluation rules for every rubric criterion:\n"
    "1. For code criteria ('code_logic', 'code_quality'):\n"
    "   - Mentally trace and dry-run the student's code step-by-step on normal, boundary, and edge-case inputs "
    "(e.g., empty inputs, capacity=1, duplicate updates at full capacity) without executing untrusted OS code.\n"
    "   - Inspect data structures and algorithmic time/space complexity carefully.\n"
    "   - Quote exact lines of student code in student_evidence_quotes to substantiate findings.\n"
    "2. For theory criteria ('theory_concept', 'completeness'):\n"
    "   - Verify mathematical formulations, conceptual accuracy, completeness, depth of reasoning, and technical "
    "terminology against the assignment prompt and reference solution.\n"
    "   - Quote exact phrases or equations from the student submission in student_evidence_quotes.\n"
    "3. Score strictly within [0, max_points] aligned with the criterion's scoring bands."
)


async def evaluate_submission(
    client: GeminiStructuredClient,
    *,
    assignment_title: str,
    assignment_type: str,
    prompt_text: str,
    reference_solution_text: str = "",
    rubric: StructuredRubric,
    submission_text: str,
    pdf_bytes: bytes | None = None,
) -> EvaluatorOutput:
    cleaned_ref = reference_solution_text.strip() or "[No reference solution provided]"

    prompt = (
        f"ASSIGNMENT TITLE: {assignment_title}\n"
        f"ASSIGNMENT MODALITY: {assignment_type}\n\n"
        f"ASSIGNMENT PROMPT:\n{prompt_text}\n\n"
        f"REFERENCE SOLUTION:\n{cleaned_ref}\n\n"
        f"STRUCTURED RUBRIC (JSON):\n{rubric.model_dump_json(indent=2)}\n\n"
        f"STUDENT SUBMISSION:\n{submission_text}\n\n"
        "Perform a criterion-by-criterion Chain-of-Thought trace (mental dry-run for code; conceptual "
        "verification for theory), quote exact student lines/text as evidence, and assign initial scores."
    )

    return await client.generate_structured(
        system_instruction=EVALUATOR_SYSTEM_INSTRUCTION,
        prompt=prompt,
        response_schema=EvaluatorOutput,
        pdf_bytes=pdf_bytes,
        temperature=0.1,
    )
