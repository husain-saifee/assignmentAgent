from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.genai import types

from app.agents.evaluator_agent import evaluate_submission
from app.agents.feedback_agent import synthesize_feedback
from app.agents.gemini_client import GeminiClientError, GeminiStructuredClient
from app.agents.reflection_agent import audit_and_calibrate
from app.agents.rubric_agent import parse_or_generate_rubric
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


def _sample_rubric() -> StructuredRubric:
    return SEED_ASSIGNMENTS[0]["structured_rubric"]


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
                rationale="Matches Proficient band (25-35) for dict + list with O(n) removal.",
            ),
            CriterionEvaluation(
                criterion_id="C2",
                criterion_title="Eviction & Recency Update Logic",
                max_points=35.0,
                chain_of_thought_trace="Traced put(1, 10) when at capacity: pops index 0 and updates order.",
                student_evidence_quotes=["oldest = self.order.pop(0)"],
                strengths_observed=["Maintains LRU order from index 0 to end"],
                flaws_or_gaps_observed=["Evicts even when updating existing key at full capacity"],
                initial_score=26.0,
                rationale="Refreshes recency on get and put, minor flaw on existing key at capacity.",
            ),
            CriterionEvaluation(
                criterion_id="C3",
                criterion_title="Edge Cases & Code Quality",
                max_points=25.0,
                chain_of_thought_trace="Traced put(existing_key, new_val) at capacity == len(self.store): wrongly evicts oldest.",
                student_evidence_quotes=["if len(self.store) >= self.capacity:"],
                strengths_observed=["Readable Python structure and type hints"],
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
            "Verified student code quotes exist in submission",
        ],
        criterion_audits=[
            CriterionAudit(
                criterion_id="C1",
                initial_score=28.0,
                calibrated_score=28.0,
                adjustment_delta=0.0,
                audit_verdict="verified",
                bias_or_error_detected="None",
                calibration_reasoning="28/40 accurately reflects Proficient band for dict + list.",
            ),
            CriterionAudit(
                criterion_id="C2",
                initial_score=26.0,
                calibrated_score=32.0,
                adjustment_delta=6.0,
                audit_verdict="adjusted_up",
                bias_or_error_detected="Double-penalized existing-key update bug already deducted in C3.",
                calibration_reasoning="Award Exemplary 32/35 for C2 since recency and LRU eviction order work.",
            ),
            CriterionAudit(
                criterion_id="C3",
                initial_score=18.0,
                calibrated_score=18.0,
                adjustment_delta=0.0,
                audit_verdict="verified",
                bias_or_error_detected="None",
                calibration_reasoning="18/25 matches Proficient band for existing-key edge case.",
            ),
        ],
    )


def _sample_feedback_output() -> FeedbackOutput:
    return FeedbackOutput(
        executive_summary="Solid LRU Cache structure that tracks recency, with two main areas to reach O(1) perfection.",
        key_strengths=[
            "Clean class interface with type annotations",
            "Correctly refreshes recency on both get() and put() operations",
        ],
        learning_gaps=[
            LearningGap(
                concept_or_skill="O(1) Recency Tracking via Doubly Linked List",
                observed_issue="Using list.remove(key) and list.pop(0) causes O(n) time complexity.",
                actionable_fix="Replace self.order list with a doubly linked list of nodes or collections.OrderedDict.",
                example_or_hint="node.prev.next = node.next; node.next.prev = node.prev",
            ),
            LearningGap(
                concept_or_skill="Updating Existing Keys at Full Capacity",
                observed_issue="put() checks len(self.store) >= self.capacity before checking if key already exists.",
                actionable_fix="Check `if key in self.store:` first and update in-place before capacity eviction.",
                example_or_hint="if key in self.store:\n    self.store[key] = value\n    ...",
            ),
        ],
        revision_roadmap=[
            "Handle existing keys at the top of put() before eviction check",
            "Refactor self.order list into doubly linked list nodes for O(1) removal",
        ],
        encouraging_closing="You have the core LRU mental model down—switching to linked nodes will make it O(1)!",
    )


@pytest.mark.asyncio
async def test_gemini_client_missing_api_key_raises_error() -> None:
    client = GeminiStructuredClient(api_key="   ", model="gemini-2.5-flash")
    with pytest.raises(
        GeminiClientError,
        match=r"GEMINI_API_KEY is missing\. Please configure it in \.env or enter it in the top navigation bar\.",
    ):
        await client.generate_structured(
            system_instruction="You are a test assistant.",
            prompt="Return a rubric.",
            response_schema=StructuredRubric,
        )


@pytest.mark.asyncio
async def test_gemini_client_generate_structured_with_pdf_and_retry() -> None:
    rubric = _sample_rubric()
    mock_response = MagicMock()
    mock_response.parsed = None
    mock_response.text = rubric.model_dump_json()

    mock_generate = AsyncMock(side_effect=[RuntimeError("Transient 503"), mock_response])
    mock_genai_client = MagicMock()
    mock_genai_client.aio.models.generate_content = mock_generate

    with (
        patch("app.agents.gemini_client.genai.Client", return_value=mock_genai_client) as mock_client_cls,
        patch("app.agents.gemini_client.asyncio.sleep", new_callable=AsyncMock) as mock_sleep,
    ):
        client = GeminiStructuredClient(api_key="test-key-123", model="gemini-3.8-flash")
        result = await client.generate_structured(
            system_instruction="System instruction text",
            prompt="Analyze this PDF",
            response_schema=StructuredRubric,
            pdf_bytes=b"%PDF-1.4 fake bytes",
            temperature=0.15,
        )

    assert isinstance(result, StructuredRubric)
    assert result.rubric_title == rubric.rubric_title
    assert mock_client_cls.call_count >= 1
    assert mock_generate.await_count == 2
    mock_sleep.assert_awaited_once()

    call_kwargs = mock_generate.call_args.kwargs
    assert call_kwargs["model"] == "gemini-3.8-flash"
    contents = call_kwargs["contents"]
    assert isinstance(contents, list)
    assert len(contents) == 2
    assert isinstance(contents[0], types.Part)
    assert contents[0].inline_data is not None
    assert contents[0].inline_data.mime_type == "application/pdf"
    assert contents[0].inline_data.data == b"%PDF-1.4 fake bytes"
    assert contents[1] == "Analyze this PDF"

    config = call_kwargs["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.system_instruction == "System instruction text"
    assert config.response_mime_type == "application/json"
    assert config.response_schema == StructuredRubric
    assert config.temperature == 0.15


@pytest.mark.asyncio
async def test_gemini_client_raises_after_two_failed_attempts() -> None:
    mock_generate = AsyncMock(side_effect=[RuntimeError("Attempt 1 failed"), RuntimeError("Attempt 2 failed")])
    mock_genai_client = MagicMock()
    mock_genai_client.aio.models.generate_content = mock_generate

    with (
        patch("app.agents.gemini_client.genai.Client", return_value=mock_genai_client),
        patch("app.agents.gemini_client.asyncio.sleep", new_callable=AsyncMock),
    ):
        client = GeminiStructuredClient(api_key="test-key-123")
        with pytest.raises(GeminiClientError, match="Attempt 2 failed"):
            await client.generate_structured(
                system_instruction="Sys",
                prompt="Prompt",
                response_schema=StructuredRubric,
            )
    assert mock_generate.await_count == 2


@pytest.mark.asyncio
async def test_rubric_agent_parses_existing_and_generates_when_empty() -> None:
    expected_rubric = _sample_rubric()
    client = GeminiStructuredClient(api_key="test-key")
    captured_calls: list[dict[str, Any]] = []

    async def fake_generate_structured(**kwargs: Any) -> StructuredRubric:
        captured_calls.append(kwargs)
        return expected_rubric

    client.generate_structured = fake_generate_structured  # type: ignore[method-assign]

    # Case 1: raw_rubric_text provided
    res_parsed = await parse_or_generate_rubric(
        client,
        title="CS301 LRU Cache",
        assignment_type="code",
        prompt_text="Implement LRUCache in O(1).",
        raw_rubric_text="C1: 40 pts O(1), C2: 35 pts Eviction, C3: 25 pts Edge cases",
        reference_solution_text="class LRUCache: ...",
    )
    assert res_parsed == expected_rubric
    assert len(captured_calls) == 1
    assert captured_calls[0]["response_schema"] is StructuredRubric
    assert "C1: 40 pts O(1)" in captured_calls[0]["prompt"]
    assert "parse" in captured_calls[0]["prompt"].lower()

    # Case 2: raw_rubric_text empty -> auto-generate 3-5 criteria with Exemplary/Proficient/Developing/Unsatisfactory
    res_generated = await parse_or_generate_rubric(
        client,
        title="CS301 LRU Cache",
        assignment_type="code",
        prompt_text="Implement LRUCache in O(1).",
        raw_rubric_text="   ",
        reference_solution_text="class LRUCache: ...",
    )
    assert res_generated == expected_rubric
    assert len(captured_calls) == 2
    gen_prompt = captured_calls[1]["prompt"]
    gen_sys = captured_calls[1]["system_instruction"]
    combined = f"{gen_sys}\n{gen_prompt}"
    assert "Exemplary" in combined
    assert "Proficient" in combined
    assert "Developing" in combined
    assert "Unsatisfactory" in combined
    assert "100" in combined


@pytest.mark.asyncio
async def test_evaluator_agent_builds_cot_trace_prompt_and_forwards_pdf_bytes() -> None:
    expected_eval = _sample_evaluator_output()
    client = GeminiStructuredClient(api_key="test-key")
    captured: dict[str, Any] = {}

    async def fake_generate_structured(**kwargs: Any) -> EvaluatorOutput:
        captured.update(kwargs)
        return expected_eval

    client.generate_structured = fake_generate_structured  # type: ignore[method-assign]

    result = await evaluate_submission(
        client,
        assignment_title="CS301: O(1) LRU Cache",
        assignment_type="code",
        prompt_text="Implement O(1) LRUCache.",
        reference_solution_text="class LRUCache: pass",
        rubric=_sample_rubric(),
        submission_text="class LRUCache:\n    pass",
        pdf_bytes=b"%PDF-sample",
    )
    assert result == expected_eval
    assert captured["response_schema"] is EvaluatorOutput
    assert captured["pdf_bytes"] == b"%PDF-sample"
    combined = f"{captured['system_instruction']}\n{captured['prompt']}".lower()
    assert "chain-of-thought" in combined or "mental" in combined or "dry-run" in combined
    assert "quote" in combined
    assert "class lrucache:" in combined


@pytest.mark.asyncio
async def test_reflection_agent_audits_bias_and_double_penalties() -> None:
    expected_reflection = _sample_reflection_output()
    client = GeminiStructuredClient(api_key="test-key")
    captured: dict[str, Any] = {}

    async def fake_generate_structured(**kwargs: Any) -> ReflectionOutput:
        captured.update(kwargs)
        return expected_reflection

    client.generate_structured = fake_generate_structured  # type: ignore[method-assign]

    result = await audit_and_calibrate(
        client,
        prompt_text="Implement O(1) LRUCache.",
        reference_solution_text="class LRUCache: pass",
        rubric=_sample_rubric(),
        initial_evaluation=_sample_evaluator_output(),
        submission_text="class LRUCache:\n    pass",
    )
    assert result == expected_reflection
    assert captured["response_schema"] is ReflectionOutput
    combined = f"{captured['system_instruction']}\n{captured['prompt']}".lower()
    assert "double-penal" in combined or "double penal" in combined
    assert "hallucinat" in combined
    assert "harshness" in combined or "leniency" in combined
    assert "adjusted_up" in combined and "adjusted_down" in combined and "verified" in combined


@pytest.mark.asyncio
async def test_feedback_agent_synthesizes_constructive_feedback() -> None:
    expected_feedback = _sample_feedback_output()
    client = GeminiStructuredClient(api_key="test-key")
    captured: dict[str, Any] = {}

    async def fake_generate_structured(**kwargs: Any) -> FeedbackOutput:
        captured.update(kwargs)
        return expected_feedback

    client.generate_structured = fake_generate_structured  # type: ignore[method-assign]

    result = await synthesize_feedback(
        client,
        assignment_title="CS301: O(1) LRU Cache",
        rubric=_sample_rubric(),
        initial_evaluation=_sample_evaluator_output(),
        reflection_audit=_sample_reflection_output(),
        submission_text="class LRUCache:\n    pass",
    )
    assert result == expected_feedback
    assert captured["response_schema"] is FeedbackOutput
    assert "CS301: O(1) LRU Cache" in captured["prompt"]
    assert "adjusted_up" in captured["prompt"]
