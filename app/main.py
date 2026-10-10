import base64
import json
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, Header, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.agents import (
    GeminiClientError,
    GeminiStructuredClient,
    parse_or_generate_rubric,
)
from app.config import get_settings
from app.db import Database
from app.exporter import render_html_report, render_markdown_report
from app.ingestion import IngestionError, ingest_file_bytes
from app.orchestrator import run_evaluation_pipeline
from app.samples import SEED_ASSIGNMENTS
from app.schemas import AssignmentCreate, EvaluateRequest

STATIC_DIR = Path(__file__).resolve().parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)


def _seed_sample_map() -> dict[str, dict[str, Any]]:
    return {
        str(seed["id"]): dict(seed["sample_submission"])
        for seed in SEED_ASSIGNMENTS
        if "id" in seed and "sample_submission" in seed
    }


def create_app(
    db_path: str | None = None,
    client_factory: Callable[[str, str], GeminiStructuredClient] | None = None,
) -> FastAPI:
    settings = get_settings()
    effective_db_path = db_path or settings.database_path
    db = Database(effective_db_path)
    db.init_db()

    raw_pdf_cache: dict[str, bytes] = {}
    seed_samples = _seed_sample_map()

    def _build_client(
        header_api_key: str | None = None,
        header_model: str | None = None,
    ) -> tuple[GeminiStructuredClient, str]:
        api_key = (header_api_key or "").strip() or settings.gemini_api_key
        model = (header_model or "").strip() or settings.gemini_model
        if client_factory is not None:
            return client_factory(api_key, model), api_key
        return GeminiStructuredClient(api_key=api_key, model=model), api_key

    def _resolve_pdf_bytes(payload: EvaluateRequest) -> bytes | None:
        if payload.pdf_base64:
            try:
                return base64.b64decode(payload.pdf_base64)
            except Exception as exc:
                raise HTTPException(
                    status_code=400, detail=f"Invalid pdf_base64 payload: {exc}"
                ) from exc
        return raw_pdf_cache.get(payload.submission_filename)

    def _format_assignments_response() -> dict[str, Any]:
        records = db.list_assignments()
        matched_samples = {
            rec.id: seed_samples[rec.id]
            for rec in records
            if rec.id in seed_samples
        }
        return {
            "assignments": [rec.model_dump() for rec in records],
            "sample_submissions": matched_samples,
        }

    fastapi_app = FastAPI(
        title="Autonomous Academic Evaluation & Feedback Agent",
        version="0.1.0",
    )
    fastapi_app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @fastapi_app.get("/")
    async def serve_index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @fastapi_app.get("/api/health")
    async def health_check() -> dict[str, Any]:
        return {
            "status": "ok",
            "default_model": settings.gemini_model,
            "has_env_api_key": bool(settings.gemini_api_key),
        }

    @fastapi_app.post("/api/ingest-file")
    async def ingest_uploaded_file(
        file: Annotated[UploadFile, File(...)],
    ) -> dict[str, Any]:
        filename = file.filename or "uploaded_submission.txt"
        content = await file.read()
        try:
            doc = ingest_file_bytes(filename, content)
        except IngestionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        if doc.raw_pdf_bytes is not None:
            raw_pdf_cache[doc.filename] = doc.raw_pdf_bytes
            pdf_b64: str | None = base64.b64encode(doc.raw_pdf_bytes).decode("ascii")
        else:
            raw_pdf_cache.pop(doc.filename, None)
            pdf_b64 = None

        return {
            "filename": doc.filename,
            "file_type": doc.file_type,
            "extracted_text": doc.extracted_text,
            "page_count": doc.page_count,
            "has_raw_pdf": doc.raw_pdf_bytes is not None,
            "pdf_base64": pdf_b64,
        }

    @fastapi_app.get("/api/assignments")
    async def list_assignments() -> dict[str, Any]:
        return _format_assignments_response()

    @fastapi_app.post("/api/assignments")
    async def create_assignment(
        payload: AssignmentCreate,
        x_gemini_api_key: str | None = Header(default=None),
        x_gemini_model: str | None = Header(default=None),
    ) -> dict[str, Any]:
        structured_rubric = None
        if payload.parse_rubric_now:
            client, effective_key = _build_client(x_gemini_api_key, x_gemini_model)
            if effective_key or client_factory is not None:
                try:
                    structured_rubric = await parse_or_generate_rubric(
                        client,
                        title=payload.title,
                        assignment_type=payload.assignment_type,
                        prompt_text=payload.prompt_text,
                        raw_rubric_text=payload.raw_rubric_text,
                        reference_solution_text=payload.reference_solution_text,
                    )
                except GeminiClientError as exc:
                    raise HTTPException(status_code=400, detail=str(exc)) from exc

        record = db.create_assignment(
            title=payload.title,
            assignment_type=payload.assignment_type,
            prompt_text=payload.prompt_text,
            raw_rubric_text=payload.raw_rubric_text,
            reference_solution_text=payload.reference_solution_text,
            structured_rubric=structured_rubric,
        )
        return record.model_dump()

    @fastapi_app.post("/api/assignments/{assignment_id}/parse-rubric")
    async def parse_assignment_rubric(
        assignment_id: str,
        x_gemini_api_key: str | None = Header(default=None),
        x_gemini_model: str | None = Header(default=None),
    ) -> dict[str, Any]:
        assignment = db.get_assignment(assignment_id)
        if assignment is None:
            raise HTTPException(status_code=404, detail="Assignment not found")
        client, _ = _build_client(x_gemini_api_key, x_gemini_model)
        try:
            rubric = await parse_or_generate_rubric(
                client,
                title=assignment.title,
                assignment_type=assignment.assignment_type,
                prompt_text=assignment.prompt_text,
                raw_rubric_text=assignment.raw_rubric_text,
                reference_solution_text=assignment.reference_solution_text,
            )
        except GeminiClientError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        updated = db.update_assignment_rubric(assignment_id, rubric)
        assert updated is not None
        return updated.model_dump()

    @fastapi_app.delete("/api/assignments/{assignment_id}")
    async def delete_assignment(assignment_id: str) -> dict[str, Any]:
        deleted = db.delete_assignment(assignment_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return {"status": "deleted", "id": assignment_id}

    @fastapi_app.post("/api/assignments/seed")
    async def seed_assignments() -> dict[str, Any]:
        for seed in SEED_ASSIGNMENTS:
            db.create_assignment(
                assignment_id=seed["id"],
                title=seed["title"],
                assignment_type=seed["assignment_type"],
                prompt_text=seed["prompt_text"],
                raw_rubric_text=seed["raw_rubric_text"],
                reference_solution_text=seed["reference_solution_text"],
                structured_rubric=seed["structured_rubric"],
            )
        return _format_assignments_response()

    @fastapi_app.post("/api/evaluate/stream")
    async def evaluate_stream(
        payload: EvaluateRequest,
        x_gemini_api_key: str | None = Header(default=None),
        x_gemini_model: str | None = Header(default=None),
    ) -> StreamingResponse:
        pdf_bytes = _resolve_pdf_bytes(payload)
        client, _ = _build_client(x_gemini_api_key, x_gemini_model)

        async def _sse_generator() -> AsyncIterator[str]:
            async for evt in run_evaluation_pipeline(
                db, client, payload, pdf_bytes=pdf_bytes
            ):
                yield f"event: {evt['event']}\ndata: {json.dumps(evt['data'])}\n\n"

        return StreamingResponse(
            _sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @fastapi_app.post("/api/evaluate")
    async def evaluate_sync(
        payload: EvaluateRequest,
        x_gemini_api_key: str | None = Header(default=None),
        x_gemini_model: str | None = Header(default=None),
    ) -> dict[str, Any]:
        pdf_bytes = _resolve_pdf_bytes(payload)
        client, _ = _build_client(x_gemini_api_key, x_gemini_model)

        completed_data: dict[str, Any] | None = None
        error_data: dict[str, Any] | None = None

        async for evt in run_evaluation_pipeline(
            db, client, payload, pdf_bytes=pdf_bytes
        ):
            if evt["event"] == "evaluation_complete":
                completed_data = evt["data"]
            elif evt["event"] == "agent_error":
                error_data = evt["data"]

        if error_data is not None:
            raise HTTPException(
                status_code=400,
                detail=error_data.get("message", "Evaluation pipeline failed"),
            )
        if completed_data is None:
            raise HTTPException(
                status_code=500,
                detail="Evaluation pipeline ended without producing a final record",
            )
        return completed_data

    @fastapi_app.get("/api/evaluations")
    async def list_evaluations(
        assignment_id: str | None = Query(default=None),
    ) -> list[dict[str, Any]]:
        records = db.list_evaluations(assignment_id=assignment_id)
        return [rec.model_dump() for rec in records]

    @fastapi_app.get("/api/evaluations/{evaluation_id}")
    async def get_evaluation(evaluation_id: str) -> dict[str, Any]:
        record = db.get_evaluation(evaluation_id)
        if record is None:
            raise HTTPException(status_code=404, detail="Evaluation not found")
        return record.model_dump()

    @fastapi_app.get("/api/evaluations/{evaluation_id}/export")
    async def export_evaluation(
        evaluation_id: str,
        format: str = Query(default="md"),
    ) -> Response:
        evaluation = db.get_evaluation(evaluation_id)
        if evaluation is None:
            raise HTTPException(status_code=404, detail="Evaluation not found")
        assignment = db.get_assignment(evaluation.assignment_id)

        fmt = format.strip().lower()
        if fmt == "md":
            md_text = render_markdown_report(assignment, evaluation)
            filename = f"evaluation-{evaluation.id[:8]}.md"
            return Response(
                content=md_text,
                media_type="text/markdown; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )
        if fmt == "html":
            html_text = render_html_report(assignment, evaluation)
            return Response(
                content=html_text,
                media_type="text/html; charset=utf-8",
            )
        raise HTTPException(
            status_code=400,
            detail="Unsupported export format. Allowed values: 'md', 'html'.",
        )

    return fastapi_app


app = create_app()
