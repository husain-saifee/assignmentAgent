import io
import json
from pathlib import Path
from typing import Any, Literal

import pdfplumber
import pypdf
from pydantic import BaseModel

ALLOWED_TEXT_EXTENSIONS: set[str] = {
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".cs",
    ".go",
    ".rs",
    ".sql",
    ".sh",
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".csv",
    ".html",
    ".css",
}

CODE_EXTENSIONS: set[str] = {
    ".py",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".java",
    ".cpp",
    ".c",
    ".h",
    ".cs",
    ".go",
    ".rs",
    ".sql",
    ".sh",
}

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024


class IngestionError(ValueError):
    """Raised when an uploaded file fails validation or cannot be parsed."""


class IngestedDocument(BaseModel):
    filename: str
    file_type: Literal["text", "code", "notebook", "pdf"]
    extracted_text: str
    page_count: int = 1
    raw_pdf_bytes: bytes | None = None


def _coerce_notebook_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "".join(str(item) for item in value)
    return ""


def _extract_notebook_outputs(outputs: Any) -> str:
    if not isinstance(outputs, list):
        return ""
    collected: list[str] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue
        text_val = _coerce_notebook_text(output.get("text", "")).strip()
        if text_val:
            collected.append(text_val)
        data = output.get("data")
        if isinstance(data, dict):
            plain_val = _coerce_notebook_text(data.get("text/plain", "")).strip()
            if plain_val and plain_val not in collected:
                collected.append(plain_val)
        if output.get("output_type") == "error":
            ename = str(output.get("ename", "")).strip()
            evalue = str(output.get("evalue", "")).strip()
            err_str = f"{ename}: {evalue}".strip(": ")
            if err_str:
                collected.append(err_str)
    return "\n".join(collected)


def _ingest_notebook(filename: str, content: bytes) -> IngestedDocument:
    try:
        raw_json = content.decode("utf-8")
        notebook = json.loads(raw_json)
    except Exception as exc:
        raise IngestionError(f"Corrupt or invalid Jupyter notebook: {exc}") from exc

    if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
        raise IngestionError("Invalid Jupyter notebook structure: missing 'cells' list.")

    sections: list[str] = []
    for idx, cell in enumerate(notebook["cells"], start=1):
        if not isinstance(cell, dict):
            continue
        cell_type = str(cell.get("cell_type", "code")).lower()
        source = _coerce_notebook_text(cell.get("source", "")).strip()
        outputs_text = _extract_notebook_outputs(cell.get("outputs", []))

        if cell_type == "markdown":
            header = f"[Markdown Cell {idx}]"
        elif cell_type == "code":
            header = f"[Code Cell {idx}]"
        else:
            header = f"[Cell {idx}]"

        body_parts = [part for part in (source, outputs_text) if part]
        if body_parts:
            sections.append(f"{header}\n" + "\n[Output]\n".join(body_parts))

    extracted_text = "\n\n".join(sections).strip()
    if not extracted_text:
        raise IngestionError("Jupyter notebook contains no readable cell content.")

    return IngestedDocument(
        filename=filename,
        file_type="notebook",
        extracted_text=extracted_text,
        page_count=1,
        raw_pdf_bytes=None,
    )


def _extract_pdf_pages_with_pdfplumber(content: bytes) -> list[str]:
    per_page: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            page_text = (page.extract_text() or "").strip()
            table_blocks: list[str] = []
            for table in page.extract_tables() or []:
                rows: list[str] = []
                for row in table or []:
                    if not row:
                        continue
                    cleaned_cells = [str(cell).strip() if cell is not None else "" for cell in row]
                    if any(cleaned_cells):
                        rows.append(" | ".join(cleaned_cells))
                if rows:
                    table_blocks.append("\n".join(rows))
            combined_parts = [part for part in [page_text, *table_blocks] if part]
            per_page.append("\n".join(combined_parts).strip())
    return per_page


def _extract_pdf_pages_with_pypdf(content: bytes) -> list[str]:
    reader = pypdf.PdfReader(io.BytesIO(content))
    return [(page.extract_text() or "").strip() for page in reader.pages]


def _ingest_pdf(filename: str, content: bytes) -> IngestedDocument:
    per_page_texts: list[str] | None = None
    plumber_err: Exception | None = None

    try:
        per_page_texts = _extract_pdf_pages_with_pdfplumber(content)
    except Exception as exc:  # noqa: BLE001
        plumber_err = exc

    if per_page_texts is None or sum(len("".join(t.split())) for t in per_page_texts) == 0:
        try:
            fallback_pages = _extract_pdf_pages_with_pypdf(content)
            if per_page_texts is None or sum(len("".join(t.split())) for t in fallback_pages) > 0:
                per_page_texts = fallback_pages
        except Exception as exc:
            if per_page_texts is None:
                raise IngestionError(f"Corrupt or unreadable PDF file: {plumber_err or exc}") from exc

    if not per_page_texts:
        raise IngestionError("PDF file contains no pages.")

    page_count = len(per_page_texts)
    page_sections = [
        f"[Page {idx}]\n{text}" for idx, text in enumerate(per_page_texts, start=1) if text.strip()
    ]
    extracted_text = "\n\n".join(page_sections).strip()
    non_ws_chars = sum(len("".join(t.split())) for t in per_page_texts)

    if non_ws_chars < 30 * max(1, page_count):
        raw_pdf_bytes: bytes | None = content
        if not extracted_text:
            extracted_text = "[PDF document attached for multimodal visual inspection]"
    else:
        raw_pdf_bytes = None

    return IngestedDocument(
        filename=filename,
        file_type="pdf",
        extracted_text=extracted_text,
        page_count=page_count,
        raw_pdf_bytes=raw_pdf_bytes,
    )


def ingest_file_bytes(filename: str, content: bytes) -> IngestedDocument:
    ext = Path(filename).suffix.lower()
    allowed_extensions = ALLOWED_TEXT_EXTENSIONS | {".ipynb", ".pdf"}
    if ext not in allowed_extensions:
        raise IngestionError(f"Unsupported file extension: {ext}")

    if not content or len(content) == 0:
        raise IngestionError("File content is empty.")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise IngestionError(f"File exceeds maximum allowed size of {MAX_FILE_SIZE_BYTES} bytes.")

    if ext == ".ipynb":
        return _ingest_notebook(filename, content)

    if ext == ".pdf":
        return _ingest_pdf(filename, content)

    if b"\x00" in content:
        raise IngestionError("Binary file detected (contains null bytes).")

    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        decoded = content.decode("latin-1")

    cleaned = decoded.replace("\x00", "")
    if not cleaned.strip():
        raise IngestionError("File contains only whitespace.")

    file_type: Literal["text", "code"] = "code" if ext in CODE_EXTENSIONS else "text"
    return IngestedDocument(
        filename=filename,
        file_type=file_type,
        extracted_text=cleaned,
        page_count=1,
        raw_pdf_bytes=None,
    )
