from app.agents.gemini_client import GeminiStructuredClient
from app.schemas import EvaluatorOutput, ReflectionOutput, StructuredRubric

REFLECTION_SYSTEM_INSTRUCTION = (
    "You are an independent Reflection & Bias Auditor Agent responsible for second-pass grading quality control.\n"
    "Your mandate is to audit the Evaluator Agent's initial evaluation against the benchmark StructuredRubric "
    "scoring bands and the actual student submission.\n"
    "Explicitly check every criterion for:\n"
    "(a) Harshness or leniency drift relative to the rubric's scoring band descriptions and point ranges.\n"
    "(b) Double-penalizing the same root bug or conceptual omission across multiple criteria.\n"
    "(c) Hallucinated flaws or claims that are contradicted by the actual student submission text.\n"
    "(d) Misalignment between the written rationale and the numeric score / scoring band.\n\n"
    "For each criterion, output a CriterionAudit with:\n"
    "- audit_verdict: 'verified' (if initial_score is fair), 'adjusted_up' (if too harsh or double-penalized), "
    "or 'adjusted_down' (if overly lenient).\n"
    "- calibrated_score: bounded within [0, max_points], and adjustment_delta = calibrated_score - initial_score.\n"
    "- Set overall audit_status to 'calibrated' if any criterion score changed, or 'verified' if all remained unchanged."
)


async def audit_and_calibrate(
    client: GeminiStructuredClient,
    *,
    prompt_text: str,
    reference_solution_text: str = "",
    rubric: StructuredRubric,
    initial_evaluation: EvaluatorOutput,
    submission_text: str,
) -> ReflectionOutput:
    cleaned_ref = reference_solution_text.strip() or "[No reference solution provided]"

    prompt = (
        f"ASSIGNMENT PROMPT:\n{prompt_text}\n\n"
        f"REFERENCE SOLUTION:\n{cleaned_ref}\n\n"
        f"STRUCTURED RUBRIC (JSON):\n{rubric.model_dump_json(indent=2)}\n\n"
        f"STUDENT SUBMISSION:\n{submission_text}\n\n"
        f"INITIAL EVALUATOR OUTPUT (JSON):\n{initial_evaluation.model_dump_json(indent=2)}\n\n"
        "Audit each CriterionEvaluation for harshness/leniency drift, double-penalizing the same root bug, "
        "hallucinated flaws, and band misalignment. Produce the calibrated ReflectionOutput."
    )

    return await client.generate_structured(
        system_instruction=REFLECTION_SYSTEM_INSTRUCTION,
        prompt=prompt,
        response_schema=ReflectionOutput,
        temperature=0.1,
    )
