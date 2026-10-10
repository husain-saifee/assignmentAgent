from app.agents.gemini_client import GeminiStructuredClient
from app.schemas import StructuredRubric

RUBRIC_SYSTEM_INSTRUCTION = (
    "You are an expert Computer Science & Engineering Curriculum Designer and Rubric Architect. "
    "Your task is to produce a rigorous, unambiguous StructuredRubric for evaluating student assignments.\n"
    "- Every criterion must have a clear criterion_id (e.g., C1, C2, C3), title, description, max_points, "
    "evaluation_focus ('code_logic', 'code_quality', 'theory_concept', or 'completeness'), and explicit "
    "scoring_bands ('Exemplary', 'Proficient', 'Developing', 'Unsatisfactory') with non-overlapping point ranges.\n"
    "- Ensure the sum of criterion max_points equals total_max_points."
)


async def parse_or_generate_rubric(
    client: GeminiStructuredClient,
    *,
    title: str,
    assignment_type: str,
    prompt_text: str,
    raw_rubric_text: str = "",
    reference_solution_text: str = "",
) -> StructuredRubric:
    cleaned_rubric = raw_rubric_text.strip()
    cleaned_ref = reference_solution_text.strip() or "[No reference solution provided]"

    if cleaned_rubric:
        mode_instructions = (
            "MODE: PARSE EXISTING RUBRIC\n"
            "Parse the instructor's raw rubric text faithfully into structured criteria and scoring bands "
            "('Exemplary', 'Proficient', 'Developing', 'Unsatisfactory'). Preserve all point allocations and "
            "criteria intent from the raw rubric.\n\n"
            f"INSTRUCTOR RAW RUBRIC:\n{cleaned_rubric}"
        )
    else:
        mode_instructions = (
            "MODE: AUTO-GENERATE STRUCTURED RUBRIC\n"
            "No raw rubric was provided. Auto-generate 3 to 5 clear, objective RubricCriterion items "
            "with explicit scoring bands ('Exemplary', 'Proficient', 'Developing', 'Unsatisfactory') "
            "tailored to the assignment modality, prompt requirements, and reference solution, "
            "totaling 100 points (unless the assignment prompt explicitly specifies a different total)."
        )

    prompt = (
        f"ASSIGNMENT TITLE: {title}\n"
        f"ASSIGNMENT MODALITY: {assignment_type}\n\n"
        f"ASSIGNMENT PROMPT:\n{prompt_text}\n\n"
        f"REFERENCE SOLUTION / BENCHMARK NOTES:\n{cleaned_ref}\n\n"
        f"{mode_instructions}"
    )

    return await client.generate_structured(
        system_instruction=RUBRIC_SYSTEM_INSTRUCTION,
        prompt=prompt,
        response_schema=StructuredRubric,
        temperature=0.1,
    )
