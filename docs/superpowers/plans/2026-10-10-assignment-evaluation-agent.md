# Assignment Evaluation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-server full-stack Assignment Evaluation Agent web application that evaluates code and theory assignments in text/code, `.ipynb`, and `.pdf` formats using a 4-stage Google Gemini multi-agent workflow (Rubric Parser, CoT Evaluator, Reflection & Bias Auditor, and Feedback Synthesizer).

**Architecture:** A Python FastAPI single-server application backed by SQLite (`sqlite3`) and the official `google-genai` SDK using Pydantic v2 `response_schema` structured outputs. A sequential 4-agent async orchestrator streams real-time Server-Sent Events (SSE) to a responsive HTML + Tailwind CSS + Vanilla JS workspace, clamping and calibrating scores deterministically in Python.

**Tech Stack:** Python 3.13, `uv`, FastAPI, Uvicorn, `google-genai`, Pydantic v2, `pdfplumber`, `pypdf`, `reportlab` (for test PDF generation), `python-multipart`, `pytest`, `httpx`, SQLite3, Tailwind CSS + Vanilla JS.

**Spec:** `docs/superpowers/specs/2026-10-10-assignment-evaluation-agent-design.md`

## Global Constraints

- **Python & Tooling**: Python $\ge 3.11$ (3.13 installed); manage dependencies and test execution exclusively with `uv add` and `uv run`.
- **LLM Provider**: Strictly Google Gemini API via the official `google-genai` SDK (`client.aio.models.generate_content` with `response_mime_type="application/json"` and Pydantic `response_schema`). Default model: `gemini-2.5-flash`.
- **Supported Formats**: Text/code files (`.py`, `.js`, `.ts`, `.java`, `.cpp`, `.c`, `.cs`, `.go`, `.rs`, `.sql`, `.sh`, `.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.html`, `.css`), Jupyter Notebooks (`.ipynb`), and PDF documents (`.pdf`). Max file size: 15 MB.
- **No OS Subprocess Sandbox**: Code and theory assignments are verified via Chain-of-Thought static/semantic analysis and mental execution tracing; never execute student code in an OS subprocess.
- **No Login Wall & No Benchmark Dashboard**: Single-workspace evaluator with SQLite persistence (`data/evaluations.db`) and Markdown/HTML report export.

---

### Task 1: Project Scaffolding, Schemas, SQLite Repository & Sample Seeds

**Files:**
- Create: `pyproject.toml` (via `uv init` + `uv add`)
- Create: `.env.example`
- Create: `app/__init__.py`
- Create: `app/config.py`
- Create: `app/schemas.py`
- Create: `app/db.py`
- Create: `app/samples.py`
- Test: `tests/test_db_and_schemas.py`

**Interfaces:**
- Consumes: Standard library `sqlite3`, `os`, `uuid`, `datetime`, `pydantic`.
- Produces:
  - `app.config.Settings` (`get_settings() -> Settings`)
  - `app.schemas`: `ScoringBand`, `RubricCriterion`, `StructuredRubric`, `CriterionEvaluation`, `EvaluatorOutput`, `CriterionAudit`, `ReflectionOutput`, `LearningGap`, `FeedbackOutput`, `AssignmentCreate`, `AssignmentRecord`, `EvaluationRecord`, `EvaluateRequest`
  - `app.db.Database`: `init_db(db_path)`, `create_assignment(...)`, `list_assignments(...)`, `get_assignment(...)`, `update_assignment_rubric(...)`, `delete_assignment(...)`, `create_evaluation(...)`, `complete_evaluation(...)`, `fail_evaluation(...)`, `get_evaluation(...)`, `list_evaluations(...)`
  - `app.samples.SEED_ASSIGNMENTS`: list of pre-built code and theory sample assignments + sample student submissions.

- [ ] **Step 1: Initialize `uv` project and install dependencies**

Run:
```powershell
uv init --bare --name assignment-evaluation-agent
uv add fastapi uvicorn python-multipart pydantic python-dotenv google-genai pdfplumber pypdf
uv add --group dev pytest pytest-asyncio httpx reportlab ruff
```

- [ ] **Step 2: Write the failing test `tests/test_db_and_schemas.py`**

```python
from pathlib import Path
from app.schemas import (
    ScoringBand,
    RubricCriterion,
    StructuredRubric,
    CriterionEvaluation,
    EvaluatorOutput,
    CriterionAudit,
    ReflectionOutput,
    LearningGap,
    FeedbackOutput,
)
from app.db import Database
from app.samples import SEED_ASSIGNMENTS


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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `uv run pytest tests/test_db_and_schemas.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 4: Implement `app/config.py`, `app/schemas.py`, `app/db.py`, `app/samples.py`, and `.env.example`**

Create `app/config.py`:
```python
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    gemini_api_key: str
    gemini_model: str
    database_path: str


def get_settings() -> Settings:
    return Settings(
        gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip(),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        database_path=os.getenv("DATABASE_PATH", "data/evaluations.db").strip(),
    )
```

Create `app/schemas.py`:
```python
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
```

Create `app/db.py` implementing SQLite persistence and `app/samples.py` providing realistic pre-seeded assignments (1 Python LRU Cache / Dynamic Programming code assignment and 1 Distributed Systems & Transformer Attention theory assignment, each with a sample student submission).

- [ ] **Step 5: Run test to verify it passes and commit**

Run: `uv run pytest tests/test_db_and_schemas.py -v`
Expected: PASS

```powershell
git add pyproject.toml uv.lock .env.example app/ tests/test_db_and_schemas.py
git commit -m "feat: add schemas, SQLite repository, and sample assignments"
```

---

### Task 2: Multi-Format Document Ingestion (Text, Code, `.ipynb`, and `.pdf`)

**Files:**
- Create: `app/ingestion.py`
- Test: `tests/test_ingestion.py`

**Interfaces:**
- Consumes: `pdfplumber`, `pypdf`, `json`, `pathlib.Path`, `io.BytesIO`.
- Produces:
  - `app.ingestion.IngestedDocument`: dataclass/BaseModel with `filename: str`, `file_type: Literal["text", "code", "notebook", "pdf"]`, `extracted_text: str`, `page_count: int`, `raw_pdf_bytes: bytes | None`
  - `app.ingestion.ingest_file_bytes(filename: str, content: bytes) -> IngestedDocument`
  - `app.ingestion.IngestionError` (ValueError subclass raised on unsupported format, empty content, or >15 MB payload)

- [ ] **Step 1: Write the failing test `tests/test_ingestion.py`**

```python
import io
import json
import pytest
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from app.ingestion import ingest_file_bytes, IngestionError


def _make_sample_pdf(text: str) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    c.drawString(72, 720, text)
    c.showPage()
    c.save()
    return buf.getvalue()


def test_ingest_python_code_file() -> None:
    code = b"def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)\n"
    doc = ingest_file_bytes("solution.py", code)
    assert doc.file_type == "code"
    assert "def fib(n):" in doc.extracted_text
    assert doc.raw_pdf_bytes is None


def test_ingest_jupyter_notebook() -> None:
    nb = {
        "cells": [
            {"cell_type": "markdown", "source": ["# Problem 1\n", "Explanation of BFS."]},
            {"cell_type": "code", "source": ["from collections import deque\n", "q = deque()"]},
        ]
    }
    doc = ingest_file_bytes("hw1.ipynb", json.dumps(nb).encode("utf-8"))
    assert doc.file_type == "notebook"
    assert "[Markdown Cell 1]" in doc.extracted_text
    assert "[Code Cell 2]" in doc.extracted_text
    assert "deque()" in doc.extracted_text


def test_ingest_pdf_document() -> None:
    pdf_bytes = _make_sample_pdf("Student Answer: CAP Theorem states Consistency, Availability, Partition Tolerance.")
    doc = ingest_file_bytes("essay.pdf", pdf_bytes)
    assert doc.file_type == "pdf"
    assert doc.page_count == 1
    assert "CAP Theorem" in doc.extracted_text


def test_reject_unsupported_binary_extension() -> None:
    with pytest.raises(IngestionError, match="Unsupported file extension"):
        ingest_file_bytes("archive.exe", b"\x00\x01\x02")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_ingestion.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ingestion'`

- [ ] **Step 3: Implement `app/ingestion.py`**

Implement `ingest_file_bytes` supporting all allowed text/code extensions, `.ipynb` JSON cell formatting, and `.pdf` extraction using `pdfplumber` with `pypdf.PdfReader` fallback (and retaining `raw_pdf_bytes` when extracted text is fewer than 30 characters per page so Gemini multimodal PDF ingestion can read scanned/diagram pages).

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `uv run pytest tests/test_ingestion.py -v`
Expected: PASS

```powershell
git add app/ingestion.py tests/test_ingestion.py
git commit -m "feat: add multi-format document ingestion for text, code, ipynb, and pdf"
```

---

### Task 3: Gemini Structured Client & 4 Specialized Evaluation Agents

**Files:**
- Create: `app/agents/__init__.py`
- Create: `app/agents/gemini_client.py`
- Create: `app/agents/rubric_agent.py`
- Create: `app/agents/evaluator_agent.py`
- Create: `app/agents/reflection_agent.py`
- Create: `app/agents/feedback_agent.py`
- Test: `tests/test_agents.py`

**Interfaces:**
- Consumes: `google.genai`, `app.schemas.*`
- Produces:
  - `app.agents.gemini_client.GeminiStructuredClient`:
    `async def generate_structured(self, *, system_instruction: str, prompt: str, response_schema: type[T], pdf_bytes: bytes | None = None) -> T`
  - `app.agents.rubric_agent.parse_or_generate_rubric(client, *, title, assignment_type, prompt_text, raw_rubric_text, reference_solution_text) -> StructuredRubric`
  - `app.agents.evaluator_agent.evaluate_submission(client, *, assignment_title, assignment_type, prompt_text, reference_solution_text, rubric: StructuredRubric, submission_text: str, pdf_bytes: bytes | None = None) -> EvaluatorOutput`
  - `app.agents.reflection_agent.audit_and_calibrate(client, *, prompt_text, reference_solution_text, rubric: StructuredRubric, initial_evaluation: EvaluatorOutput, submission_text: str) -> ReflectionOutput`
  - `app.agents.feedback_agent.synthesize_feedback(client, *, assignment_title, rubric: StructuredRubric, initial_evaluation: EvaluatorOutput, reflection_audit: ReflectionOutput, submission_text: str) -> FeedbackOutput`

- [ ] **Step 1: Write the failing test `tests/test_agents.py`**

Write unit tests using a fake `GeminiStructuredClient` that captures prompts and system instructions for each of the 4 agents and verifies:
1. `parse_or_generate_rubric` includes both raw rubric text and auto-generation instructions when `raw_rubric_text` is empty.
2. `evaluate_submission` prompts for static mental execution tracing on code criteria and conceptual verification on theory criteria, passing `pdf_bytes` when present.
3. `audit_and_calibrate` cross-verifies `EvaluatorOutput` against `StructuredRubric` for harshness/leniency bias and double-penalties.
4. `synthesize_feedback` produces `FeedbackOutput` aligned with the calibrated scores.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agents.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.agents'`

- [ ] **Step 3: Implement `app/agents/gemini_client.py` and the 4 agent modules**

Implement `GeminiStructuredClient` using `google.genai.Client(api_key=...)` and `await client.aio.models.generate_content(...)` with `types.GenerateContentConfig(system_instruction=system_instruction, response_mime_type="application/json", response_schema=response_schema, temperature=0.1)`, attaching `types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")` when `pdf_bytes` is provided.

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `uv run pytest tests/test_agents.py -v`
Expected: PASS

```powershell
git add app/agents/ tests/test_agents.py
git commit -m "feat: implement Gemini structured client and 4 specialized evaluation agents"
```

---

### Task 4: Async Multi-Agent Orchestrator & Score Calibration Math

**Files:**
- Create: `app/orchestrator.py`
- Test: `tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `app.db.Database`, `app.agents.*`, `app.schemas.*`
- Produces:
  - `app.orchestrator.compute_letter_grade(score: float, max_score: float) -> str`
  - `app.orchestrator.clamp_and_reconcile_scores(rubric: StructuredRubric, initial_eval: EvaluatorOutput, reflection: ReflectionOutput) -> tuple[float, float, float]`
  - `app.orchestrator.run_evaluation_pipeline(db: Database, client: GeminiStructuredClient, request: EvaluateRequest, pdf_bytes: bytes | None = None) -> AsyncIterator[dict[str, Any]]` (yields SSE-ready event dicts: `agent_start`, `agent_complete`, `evaluation_complete`, `agent_error`)

- [ ] **Step 1: Write the failing test `tests/test_orchestrator.py`**

Test that `run_evaluation_pipeline`:
1. Reuses cached `structured_rubric` on the assignment if present, or invokes `rubric_agent` and saves it to SQLite if missing.
2. Clamps out-of-range scores to `[0, criterion.max_points]` and reconciles `adjustment_delta = calibrated_score - initial_score`.
3. Emits SSE events in exact order (`rubric_parser` -> `cot_evaluator` -> `reflection_auditor` -> `feedback_synthesizer` -> `evaluation_complete`) and persists the completed `EvaluationRecord` in SQLite.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_orchestrator.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.orchestrator'`

- [ ] **Step 3: Implement `app/orchestrator.py`**

Implement deterministic score clamping, letter-grade calculation (`A`, `A-`, `B+`, `B`, `B-`, `C+`, `C`, `D`, `F`), rubric caching, and the async generator `run_evaluation_pipeline`.

- [ ] **Step 4: Run test to verify it passes and commit**

Run: `uv run pytest tests/test_orchestrator.py -v`
Expected: PASS

```powershell
git add app/orchestrator.py tests/test_orchestrator.py
git commit -m "feat: add 4-agent async orchestrator with score clamping and SSE streaming"
```

---

### Task 5: FastAPI Backend, Report Exporter & Single-Server Evaluator Web UI

**Files:**
- Create: `app/exporter.py`
- Create: `app/main.py`
- Create: `app/static/index.html`
- Create: `app/static/app.js`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `app.db`, `app.ingestion`, `app.orchestrator`, `app.samples`, `app.config`
- Produces:
  - `app.exporter.render_markdown_report(assignment: AssignmentRecord, evaluation: EvaluationRecord) -> str`
  - `app.exporter.render_html_report(assignment: AssignmentRecord, evaluation: EvaluationRecord) -> str`
  - `app.main.app`: FastAPI instance serving `/`, `/api/health`, `/api/ingest-file`, `/api/assignments`, `/api/assignments/seed`, `/api/evaluate/stream`, `/api/evaluations`, `/api/evaluations/{id}`, and `/api/evaluations/{id}/export`.

- [ ] **Step 1: Write the failing integration test `tests/test_api.py`**

Test using `fastapi.testclient.TestClient`:
1. `GET /` serves the HTML workspace UI.
2. `POST /api/assignments/seed` seeds the sample code and theory assignments.
3. `POST /api/ingest-file` extracts text from uploaded `.py`, `.ipynb`, and `.pdf` files.
4. `POST /api/evaluate/stream` (with dependency-overridden `GeminiStructuredClient`) streams SSE events through all 4 agents and persists the evaluation.
5. `GET /api/evaluations/{id}/export?format=md` and `?format=html` return complete formatted evaluation reports.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_api.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement `app/exporter.py`, `app/main.py`, `app/static/index.html`, and `app/static/app.js`**

Build:
- `app/exporter.py`: Clean Markdown and printable academic HTML report generators.
- `app/main.py`: FastAPI routes + SSE streaming endpoint (`StreamingResponse(..., media_type="text/event-stream")`) + static files.
- `app/static/index.html` & `app/static/app.js`: Responsive 3-column academic evaluation studio with live 4-agent stepper, drag-and-drop file ingestion (`.pdf`, `.py`, `.ipynb`, `.md`, `.txt`, etc.), rubric preview cards, Chain-of-Thought trace viewer, Reflection & Bias Audit comparison table, and 1-click Markdown/PDF report export.

- [ ] **Step 4: Run full test suite and linter to verify everything passes**

Run:
```powershell
uv run pytest -v
uv run ruff check .
```
Expected: All tests PASS, zero lint errors.

- [ ] **Step 5: Commit**

```powershell
git add app/exporter.py app/main.py app/static/ tests/test_api.py
git commit -m "feat: add FastAPI backend, SSE evaluation stream, report exporter, and web UI"
```
