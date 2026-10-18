# AETHER STUDIO · Autonomous Assignment Evaluator Agent

<p align="center">
  <img src="app/static/logo.svg" alt="AETHER Studio Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>Autonomous 4-Agent Pipeline for Objective, Bias-Calibrated Academic Assignment Evaluation</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/FastAPI-0.115+-009688?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI" />
  <img src="https://img.shields.io/badge/Gemini_API-Structured_Outputs-4285F4?style=flat-square&logo=google&logoColor=white" alt="Gemini API" />
  <img src="https://img.shields.io/badge/Tests-103_Passing-brightgreen?style=flat-square" alt="Tests 103 Passing" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=flat-square" alt="MIT License" />
</p>

---

## 🎯 Overview

**AETHER Studio** is an autonomous multi-agent assignment evaluation platform engineered to eliminate grading fatigue and grading inconsistency. Powered by Google Gemini's structured schema outputs, AETHER deconstructs natural-language course rubrics, evaluates student submissions across both programming code and theoretical essays, audits grading decisions for leniency or harshness drift, and produces empathetic, actionable pedagogical feedback reports.

Whether grading complex distributed systems code, database query architectures, or essay-based theoretical proofs, AETHER delivers deterministic, rubric-anchored evaluations with line-level citations in seconds.

---

## ⚡ The 4-Agent Autonomous Pipeline

```
  ┌────────────────────────────────────────────────────────┐
  │                 Student Submission                     │
  │     Code (.py, .java, .cpp) | Theory (.pdf, .txt, .md) │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │         Stage 1: Rubric Deconstruction Agent           │
  │   Parses raw rubrics into weighted, discrete criteria   │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │      Stage 2: Chain-of-Thought Evaluator Agent         │
  │   Semantic dry-runs, logic tracing & code citations    │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │       Stage 3: Reflection & Bias Auditor Agent         │
  │  Audits leniency/harshness & applies score calibration │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │     Stage 4: Pedagogical Feedback Synthesizer          │
  │ Generates strengths, learning gaps & study roadmaps   │
  └───────────────────────────┬────────────────────────────┘
                              │
                              ▼
  ┌────────────────────────────────────────────────────────┐
  │            Calibrated Academic Report                  │
  │   Live Dashboard · Portable Markdown · Printable HTML  │
  └────────────────────────────────────────────────────────┘
```

1. **Rubric Deconstruction Agent**: Ingests unstructured or semi-structured rubrics and decomposes them into explicit, deterministic criteria with allocated point weights, performance anchors, and grading rules.
2. **Chain-of-Thought Evaluator Agent**: Traces code execution logic, validates theoretical reasoning against reference solutions, cites exact lines from student work, and logs intermediate deductions.
3. **Reflection & Bias Auditor Agent**: Operates as an independent meta-reviewer. Audits initial evaluations against rubric bounds to detect subjective harshness or leniency drift, computing mathematical score calibrations ($\Delta$).
4. **Pedagogical Feedback Synthesizer Agent**: Synthesizes scorecards, code observations, and rubric audits into constructive, growth-oriented student coaching reports.

---

## ✨ Key Features

- **Multi-Modality Ingestion**: Evaluate Python, Java, C++, JavaScript, TypeScript, raw Markdown/Text, and multi-page PDF submissions with native text extraction.
- **Zero-Build Tactile Studio UI**: Beautiful porcelain-and-graphite interface served natively via FastAPI—featuring hardware-accelerated spring animations, sliding active pill navigation, and real-time SSE progress indicators.
- **Real-Time Telemetry Streaming**: Watch all 4 agents think and collaborate live via Server-Sent Events (SSE) at `/api/evaluate/stream`.
- **Zero-Bias Score Calibration**: Every evaluation includes transparent before-and-after score adjustments with explicit auditor justifications.
- **One-Click Multi-Format Export**: Download complete student evaluations as portable GitHub-flavored Markdown (`.md`) or print-ready standalone HTML reports.
- **Local SQLite Persistence**: Lightweight, zero-configuration local database storing assignments, rubrics, and evaluation histories without cloud lock-in.
- **WCAG 2.2 AA & Motion Accessible**: Built with high-contrast color tokens, full keyboard navigability, and graceful fallbacks for `prefers-reduced-motion` and `prefers-reduced-transparency`.

---

## 🚀 Quick Start

### Prerequisites

- **Python 3.11+** installed
- **Google Gemini API Key** ([Get one here](https://aistudio.google.com/app/apikey))

### 1. Clone the Repository

```bash
git clone https://github.com/husain-saifee/assignmentAgent.git
cd assignmentAgent
```

### 2. Set Up Virtual Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate on Windows PowerShell:
.\.venv\Scripts\Activate.ps1

# Or activate on Linux / macOS:
source .venv/bin/activate

# Install dependencies
pip install -r <(uv pip compile pyproject.toml 2>/dev/null || pip install .)
# Or with uv:
uv sync
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
DATABASE_PATH=data/evaluations.db
```

*(Note: You can also leave `GEMINI_API_KEY` blank in `.env` and provide it directly in the web UI header popover).*

### 4. Run the Application

```bash
python -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --reload
```

Open your browser at **`http://127.0.0.1:8000`** to access AETHER Studio.

---

## 🧪 Running Tests

The test suite covers unit tests, schema contracts, agent reasoning pipelines, and end-to-end accessibility:

```bash
pytest -v
```

All 103 test cases run cleanly in seconds.

---

## 🔌 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the AETHER Studio single-page application |
| `GET` | `/api/health` | System health check and Gemini API key availability |
| `POST` | `/api/ingest-file` | Extracts and parses text from uploaded code, text, or PDF files |
| `GET` | `/api/assignments` | Lists configured assignments and sample benchmarks |
| `POST` | `/api/assignments` | Creates a new assignment with rubric parsing |
| `DELETE` | `/api/assignments/{id}` | Deletes an assignment and associated records |
| `POST` | `/api/assignments/seed` | Seeds built-in benchmark assignments (Code & Theory) |
| `POST` | `/api/evaluate/stream` | Initiates real-time 4-agent evaluation stream (SSE) |
| `GET` | `/api/evaluations` | Fetches historical evaluation runs |
| `GET` | `/api/evaluations/{id}` | Retrieves full evaluation payload with reasoning traces |
| `GET` | `/api/evaluations/{id}/export` | Exports report as Markdown (`?format=md`) or HTML (`?format=html`) |

---

## 📁 Project Structure

```
assignmentAgent/
├── app/
│   ├── agents.py          # Gemini structured output schemas & agent prompts
│   ├── config.py          # Pydantic Settings & environment configuration
│   ├── db.py              # SQLite repository & CRUD persistence
│   ├── exporter.py        # Markdown and standalone HTML report renderers
│   ├── ingestion.py       # Multi-format document parser (PDF, text, code)
│   ├── main.py            # FastAPI application factory, routes & SSE stream
│   ├── orchestrator.py    # 4-stage pipeline execution & progress broadcasting
│   ├── samples.py         # Default benchmark assignments & reference solutions
│   ├── schemas.py         # Pydantic data models for rubrics, traces & feedback
│   └── static/
│       ├── app.js         # Reactive SPA controller & SSE stream listener
│       ├── index.html     # Semantic studio interface with hero & stepper
│       ├── logo.svg       # Vector brand asset
│       └── studio.css     # Design tokens, spring physics & accessibility
├── tests/                 # Unit & integration test suites
├── tests_e2e/             # Motion, telemetry, accessibility & adversarial tests
├── pyproject.toml         # Python project configuration & dependencies
└── README.md              # Project documentation
```

---

## 🛡️ License

This project is licensed under the [MIT License](LICENSE).
