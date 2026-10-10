# Assignment Evaluation Agent — Design Specification

**Date:** 2026-10-10  
**Status:** Draft (Pending User Review)  
**Path Classification:** Architectural (Greenfield Full-Stack Multi-Agent Web Application)

---

## 1. Overview & Objectives

Evaluating academic assignments at scale demands substantial educator effort and suffers from subjective grading drift. The **Assignment Evaluation Agent** is a single-server full-stack web application powered by a coordinated 4-agent workflow built on the **Google Gemini API (`google-genai` SDK)**.

The system evaluates both **programming/code assignments** and **theoretical/written assignments** submitted in text-based formats or PDF documents. Rather than executing untrusted student code in an OS sandbox, the evaluation pipeline uses **Chain-of-Thought (CoT) static & semantic trace verification** to dry-run code logic, inspect edge cases, and evaluate theoretical comprehension. An independent **Reflection & Bias Auditor Agent** cross-verifies initial evaluations against benchmark rubric criteria to eliminate harshness/leniency bias and hallucinated deductions before a **Feedback Synthesizer Agent** produces personalized, constructive learning-gap feedback.

---

## 2. Scope & Explicit Non-Goals

### In Scope
- **Full-Stack Single-Server Web Application**: Python FastAPI backend serving a responsive HTML + Tailwind CSS + Vanilla JS workspace with real-time Server-Sent Events (SSE) agent progress streaming.
- **Supported Input Modalities**:
  - Text and source code files: `.py`, `.js`, `.ts`, `.java`, `.cpp`, `.c`, `.cs`, `.go`, `.rs`, `.sql`, `.sh`, `.md`, `.txt`, `.json`, `.yaml`, `.csv`, `.html`, `.css`.
  - Jupyter Notebooks (`.ipynb`): Parsed into ordered Markdown and Code cells.
  - PDF Documents (`.pdf`): Extracted via `pdfplumber` (with `pypdf` fallback) and native Gemini multimodal PDF ingestion (`Part.from_bytes`) when PDFs contain scanned pages or low extractable text.
- **Flexible Rubric Ingestion**: Educators can paste/upload a rubric (text/Markdown/PDF) **or** let the Rubric Parser Agent auto-generate weighted criteria and scoring bands from the assignment prompt and optional reference solution.
- **4-Stage Coordinated Multi-Agent Pipeline**:
  1. **Rubric Parser Agent** (`rubric_agent.py`)
  2. **CoT Evaluator Agent** (`evaluator_agent.py`)
  3. **Reflection & Bias Auditor Agent** (`reflection_agent.py`) — 1 bounded verification/calibration pass
  4. **Feedback Synthesizer Agent** (`feedback_agent.py`)
- **SQLite Persistence**: Local SQLite database (`data/evaluations.db`) storing assignments, parsed rubrics, student submissions, full agent reasoning traces, calibrated scores, and synthesized feedback reports.
- **Report Export**: Downloadable Markdown (`.md`) and printable HTML/PDF student evaluation reports.
- **Pre-Seeded Sample Assignments**: Built-in one-click sample assignments (one Algorithms/Python code assignment and one Computer Science/AI theory assignment) with sample student submissions for immediate verification.

### Out of Scope (Non-Goals)
- **OS Subprocess / Container Code Execution**: Code correctness, time/space complexity, and edge-case handling are verified via Gemini Chain-of-Thought static analysis and mental execution tracing.
- **Quantitative Human-Alignment Benchmark Suite**: No statistical correlation/MAE dashboard; the application focuses strictly on evaluating student submissions.
- **Authentication / Multi-Role Login Wall**: Streamlined single-workspace evaluator with immediate access to assignment setup, submission grading, and evaluation history.

---

## 3. System Architecture & Module Boundaries

```
assignmentAgent/
├── pyproject.toml
├── .env.example
├── app/
│   ├── __init__.py
│   ├── config.py             # Environment settings, Gemini model & API key resolution
│   ├── schemas.py            # Pydantic v2 models for API & Gemini structured outputs
│   ├── db.py                 # SQLite database initialization & CRUD repository
│   ├── ingestion.py          # Text, code, .ipynb, and .pdf extraction + multimodal payload prep
│   ├── samples.py            # Pre-seeded sample assignments & student submissions
│   ├── orchestrator.py       # Async 4-agent pipeline coordinator & SSE event generator
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── gemini_client.py  # Wrapper around google-genai async structured generation + retry
│   │   ├── rubric_agent.py   # Agent 1: Rubric parsing & criterion generation
│   │   ├── evaluator_agent.py# Agent 2: CoT static/semantic evaluation per criterion
│   │   ├── reflection_agent.py# Agent 3: Cross-verification, bias audit & score calibration
│   │   └── feedback_agent.py # Agent 4: Personalized learning-gap & study plan synthesis
│   ├── main.py               # FastAPI routes, SSE streaming endpoint, static file mount
│   └── static/
│       ├── index.html        # Single-page Evaluator Workspace UI (Tailwind CSS)
│       └── app.js            # Frontend state, SSE stream consumer, rubric & report renderer
└── tests/
    ├── test_ingestion.py     # Unit tests for text, code, .ipynb, and PDF parsing
    ├── test_orchestrator.py  # Pipeline, reflection calibration, and SSE event tests
    └── test_api.py           # FastAPI endpoint & SQLite persistence integration tests
```

### Module Responsibilities
- **`app/config.py`**: Loads `GEMINI_API_KEY` and `GEMINI_MODEL` (defaults to `gemini-2.5-flash`) from environment variables or `.env`, and allows per-request API key/model override from the UI header.
- **`app/ingestion.py`**: Validates uploaded filenames and extensions, extracts UTF-8 text from text/code files, formats `.ipynb` cells, extracts text/tables from `.pdf` via `pdfplumber`/`pypdf`, and returns an `IngestedDocument(text, filename, file_type, raw_pdf_bytes_if_sparse)`.
- **`app/agents/gemini_client.py`**: Provides a single async helper `generate_structured(prompt, response_schema, system_instruction, api_key, model, pdf_bytes=None)` using `google.genai.Client` (`client.aio.models.generate_content`) with `GenerateContentConfig(response_mime_type="application/json", response_schema=response_schema, temperature=0.1)` and 2-attempt exponential backoff on transient API errors.
- **`app/orchestrator.py`**: Coordinates the 4 agents sequentially, caches parsed rubrics on the assignment record, enforces score bounds ($0 \le \text{score} \le \text{max\_points}$), computes final totals and letter grades deterministically in Python, persists results to SQLite, and yields structured SSE events at each stage transition.

---

## 4. Data Contracts & Pydantic Schemas (`app/schemas.py`)

### 4.1 Agent 1 Output: `StructuredRubric`
```python
class ScoringBand(BaseModel):
    band_label: str          # e.g., "Exemplary", "Proficient", "Developing", "Unsatisfactory"
    points_range: str        # e.g., "9-10", "6-8", "3-5", "0-2"
    description: str

class RubricCriterion(BaseModel):
    criterion_id: str        # e.g., "C1", "C2"
    title: str
    description: str
    max_points: float
    evaluation_focus: Literal["code_logic", "code_quality", "theory_concept", "completeness"]
    scoring_bands: list[ScoringBand]

class StructuredRubric(BaseModel):
    rubric_title: str
    total_max_points: float
    criteria: list[RubricCriterion]
```

### 4.2 Agent 2 Output: `EvaluatorOutput`
```python
class CriterionEvaluation(BaseModel):
    criterion_id: str
    criterion_title: str
    max_points: float
    chain_of_thought_trace: str   # Step-by-step mental execution trace (for code) or conceptual verification (for theory)
    student_evidence_quotes: list[str]
    strengths_observed: list[str]
    flaws_or_gaps_observed: list[str]
    initial_score: float
    rationale: str

class EvaluatorOutput(BaseModel):
    submission_modality: Literal["code", "theory", "hybrid"]
    overall_comprehension_summary: str
    criterion_evaluations: list[CriterionEvaluation]
```

### 4.3 Agent 3 Output: `ReflectionOutput`
```python
class CriterionAudit(BaseModel):
    criterion_id: str
    initial_score: float
    calibrated_score: float
    adjustment_delta: float
    audit_verdict: Literal["verified", "adjusted_up", "adjusted_down"]
    bias_or_error_detected: str   # "None" if verified, else describes harshness, leniency, double-penalty, or rubric mismatch
    calibration_reasoning: str

class ReflectionOutput(BaseModel):
    audit_status: Literal["verified", "calibrated"]
    overall_audit_summary: str
    bias_checks_performed: list[str]
    criterion_audits: list[CriterionAudit]
```

### 4.4 Agent 4 Output: `FeedbackOutput`
```python
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
```

---

## 5. SQLite Database Schema (`app/db.py`)

Database file: `data/evaluations.db` (configurable via `DATABASE_PATH` for isolated tests).

```sql
CREATE TABLE IF NOT EXISTS assignments (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    assignment_type TEXT NOT NULL DEFAULT 'hybrid',
    prompt_text TEXT NOT NULL,
    raw_rubric_text TEXT DEFAULT '',
    reference_solution_text TEXT DEFAULT '',
    structured_rubric_json TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    assignment_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_id TEXT DEFAULT '',
    submission_filename TEXT DEFAULT 'pasted_submission.txt',
    submission_text TEXT NOT NULL,
    status TEXT NOT NULL,
    rubric_used_json TEXT,
    initial_evaluation_json TEXT,
    reflection_audit_json TEXT,
    feedback_report_json TEXT,
    total_initial_score REAL DEFAULT 0,
    total_final_score REAL DEFAULT 0,
    max_possible_score REAL DEFAULT 0,
    letter_grade TEXT DEFAULT 'N/A',
    duration_ms INTEGER DEFAULT 0,
    error_message TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
);
```

---

## 6. REST & SSE API Specification (`app/main.py`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the single-page Evaluator Workspace (`index.html`). |
| `GET` | `/api/health` | Returns server status, configured model, and whether a default `GEMINI_API_KEY` is present in env. |
| `POST` | `/api/ingest-file` | Multipart file upload (`.pdf`, `.py`, `.md`, `.ipynb`, etc.); returns extracted text and metadata for preview in assignment/submission forms. |
| `GET` | `/api/assignments` | Lists all saved assignments ordered by `created_at DESC`. |
| `POST` | `/api/assignments` | Creates a new assignment and optionally runs the Rubric Parser Agent immediately to cache `structured_rubric_json`. |
| `DELETE` | `/api/assignments/{id}` | Deletes an assignment and its associated evaluations. |
| `POST` | `/api/assignments/seed` | Seeds 2 sample assignments (1 Python code assignment + 1 CS/AI theory assignment) if not already present. |
| `POST` | `/api/evaluate/stream` | Runs the 4-stage multi-agent evaluation pipeline and streams Server-Sent Events (`agent_start`, `agent_complete`, `evaluation_complete`, `agent_error`). |
| `GET` | `/api/evaluations` | Lists past evaluations (optional `?assignment_id=` filter). |
| `GET` | `/api/evaluations/{id}` | Returns full evaluation record including all 4 agent JSON payloads. |
| `GET` | `/api/evaluations/{id}/export` | Returns a downloadable Markdown report (`?format=md`) or printable HTML report (`?format=html`). |

---

## 7. Web UI Design (`app/static/index.html` & `app/static/app.js`)

The interface is organized into a clean, academic-grade dark/light workspace:
1. **Top Navigation Bar**:
   - App title & status badge.
   - Gemini Model selector (`gemini-2.5-flash`, `gemini-2.5-pro`) and optional API Key input field (persisted in `sessionStorage` if not set in `.env`).
   - **"Load Sample Assignments"** quick-action button.
2. **Left Column (Assignments & Evaluation History)**:
   - List of saved assignments with modality badges (`Code`, `Theory`, `Hybrid`).
   - List of recent student evaluations with score pills (`92/100 • A`) and reflection indicator badges.
3. **Middle Column (Assignment Configuration & Submission Input)**:
   - **Assignment & Rubric Panel**: Create/edit assignment prompt, reference solution, and rubric (supports uploading a `.pdf` or text file to populate any field), plus an interactive view of the parsed `StructuredRubric` criteria and scoring bands.
   - **Student Submission Panel**: Enter student name/ID, upload `.pdf` / `.py` / `.js` / `.ipynb` / `.md` / `.txt` file or paste directly, and click **"Run 4-Agent Evaluation"**.
4. **Right Column (Live Multi-Agent Pipeline & Evaluation Report)**:
   - **4-Stage Live Progress Stepper**: Displays real-time status (`Waiting`, `Running...`, `Completed in 2.4s`) for:
     1. *Rubric Parser Agent*
     2. *CoT Semantic & Static Evaluator Agent*
     3. *Reflection & Bias Auditor Agent*
     4. *Feedback Synthesizer Agent*
   - **Score & Calibration Banner**: Shows Initial Score, Reflection Adjustment Delta ($\pm$ points), Final Calibrated Score, Percentage, and Letter Grade.
   - **4 Interactive Report Tabs**:
     - **Feedback & Learning Gaps**: Executive summary, strengths, structured learning-gap cards with actionable fixes/hints, and revision roadmap.
     - **Criterion Breakdown & CoT Trace**: Per-criterion cards showing initial vs. calibrated score, exact student quotes, and collapsible Chain-of-Thought static code trace / conceptual analysis.
     - **Reflection & Bias Audit**: Shows the Auditor Agent's cross-verification checks, bias flags, and calibration rationale for each criterion.
     - **Export**: One-click **Download Markdown Report (`.md`)** and **Print / Save PDF Report**.

---

## 8. Error Handling & Testing Strategy

### Error Handling
- **File Ingestion**: Rejects unsupported binary extensions (e.g., `.exe`, `.zip`, `.docx`) with `HTTP 400` and a clear list of supported text and `.pdf` formats. Enforces a 15 MB upload limit.
- **Score Clamping & Math Integrity**: In `orchestrator.py`, all LLM-assigned `initial_score` and `calibrated_score` values are clamped to $[0, \text{criterion.max\_points}]$, and total scores/percentages/letter grades are computed deterministically in Python rather than trusting LLM arithmetic.
- **Missing API Key**: If neither `.env` nor the request header provides a `GEMINI_API_KEY`, the server returns a clear `agent_error` SSE event prompting the user to enter their Gemini API key in the top bar or `.env`.

### Verification & Test Suite
1. **`tests/test_ingestion.py`**: Tests plain text/code (`.py`, `.md`), Jupyter Notebook (`.ipynb`), and dynamically generated `.pdf` extraction, plus rejection of unsupported extensions.
2. **`tests/test_orchestrator.py`**: Tests the 4-agent orchestrator using a mock Gemini structured generator, verifying rubric caching, score clamping, reflection calibration deltas, SQLite persistence, and SSE event order.
3. **`tests/test_api.py`**: End-to-end FastAPI `TestClient` tests verifying sample seeding, assignment CRUD, file ingestion, streaming evaluation, and Markdown/HTML report export.
