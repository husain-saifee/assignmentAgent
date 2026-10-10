import io
import json

import pytest
from reportlab.pdfgen import canvas

from app.ingestion import (
    ALLOWED_TEXT_EXTENSIONS,
    CODE_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    IngestedDocument,
    IngestionError,
    ingest_file_bytes,
)


def _make_pdf_bytes(pages_text: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    for page_text in pages_text:
        if page_text:
            text_obj = c.beginText(72, 720)
            for line in page_text.splitlines():
                text_obj.textLine(line)
            c.drawText(text_obj)
        else:
            # Draw only a vector shape to simulate a scanned/diagram-only page
            c.rect(100, 500, 200, 150, stroke=1, fill=0)
        c.showPage()
    c.save()
    return buf.getvalue()


def test_ingest_python_code_file() -> None:
    code_bytes = (
        b"class LRUCache:\n"
        b"    def __init__(self, capacity: int) -> None:\n"
        b"        self.capacity = capacity\n"
    )
    doc = ingest_file_bytes("lru_cache.py", code_bytes)
    assert isinstance(doc, IngestedDocument)
    assert doc.filename == "lru_cache.py"
    assert doc.file_type == "code"
    assert doc.page_count == 1
    assert doc.raw_pdf_bytes is None
    assert "class LRUCache:" in doc.extracted_text
    assert ".py" in CODE_EXTENSIONS
    assert CODE_EXTENSIONS.issubset(ALLOWED_TEXT_EXTENSIONS)


def test_ingest_markdown_and_latin1_text_files() -> None:
    md_bytes = b"# Distributed Attention\n\nScaled dot-product attention prevents gradient saturation.\n"
    doc = ingest_file_bytes("essay.md", md_bytes)
    assert doc.filename == "essay.md"
    assert doc.file_type == "text"
    assert doc.page_count == 1
    assert doc.raw_pdf_bytes is None
    assert "# Distributed Attention" in doc.extracted_text

    latin1_bytes = "Café résumé - naïve Bayes analysis".encode("latin-1")
    doc_latin1 = ingest_file_bytes("notes.txt", latin1_bytes)
    assert doc_latin1.file_type == "text"
    assert "Café résumé" in doc_latin1.extracted_text


def test_ingest_jupyter_notebook() -> None:
    notebook_payload = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "cells": [
            {
                "cell_type": "markdown",
                "metadata": {},
                "source": ["# Q1: Complexity Analysis\n", "We derive $O(N^2)$ memory complexity."],
            },
            {
                "cell_type": "code",
                "metadata": {},
                "source": "def square(x):\n    return x * x\nprint(square(7))",
                "outputs": [
                    {"output_type": "stream", "name": "stdout", "text": ["49\n"]},
                    {"output_type": "execute_result", "data": {"text/plain": ["49"]}},
                ],
            },
        ],
    }
    raw_nb = json.dumps(notebook_payload).encode("utf-8")
    doc = ingest_file_bytes("submission.ipynb", raw_nb)
    assert doc.filename == "submission.ipynb"
    assert doc.file_type == "notebook"
    assert doc.page_count == 1
    assert doc.raw_pdf_bytes is None
    assert "[Markdown Cell 1]" in doc.extracted_text
    assert "# Q1: Complexity Analysis" in doc.extracted_text
    assert "[Code Cell 2]" in doc.extracted_text
    assert "def square(x):" in doc.extracted_text
    assert "49" in doc.extracted_text


def test_ingest_text_rich_pdf_extracts_pages_and_drops_duplicate_bytes() -> None:
    pdf_bytes = _make_pdf_bytes(
        [
            "Page 1: Scaled Dot-Product Attention divides by sqrt(d_k) to preserve unit variance.",
            "Page 2: FlashAttention tiles Q, K, and V blocks into SRAM to avoid HBM bottlenecks.",
        ]
    )
    doc = ingest_file_bytes("solution.pdf", pdf_bytes)
    assert doc.filename == "solution.pdf"
    assert doc.file_type == "pdf"
    assert doc.page_count == 2
    assert "[Page 1]" in doc.extracted_text
    assert "Scaled Dot-Product Attention" in doc.extracted_text
    assert "[Page 2]" in doc.extracted_text
    assert "FlashAttention tiles" in doc.extracted_text
    assert doc.raw_pdf_bytes is None


def test_ingest_scanned_and_sparse_pdfs_preserve_raw_pdf_bytes() -> None:
    scanned_pdf = _make_pdf_bytes([""])
    doc_scanned = ingest_file_bytes("scanned_diagram.pdf", scanned_pdf)
    assert doc_scanned.file_type == "pdf"
    assert doc_scanned.page_count == 1
    assert doc_scanned.raw_pdf_bytes == scanned_pdf
    assert doc_scanned.extracted_text == "[PDF document attached for multimodal visual inspection]"

    sparse_pdf = _make_pdf_bytes(["Fig 1.1"])
    doc_sparse = ingest_file_bytes("sparse_diagram.pdf", sparse_pdf)
    assert doc_sparse.file_type == "pdf"
    assert doc_sparse.page_count == 1
    assert doc_sparse.raw_pdf_bytes == sparse_pdf
    assert "[Page 1]" in doc_sparse.extracted_text
    assert "Fig 1.1" in doc_sparse.extracted_text


def test_ingest_rejects_unsupported_empty_oversized_binary_and_corrupt_files() -> None:
    with pytest.raises(IngestionError, match=r"Unsupported file extension: \.exe"):
        ingest_file_bytes("payload.exe", b"MZ\x90\x00")

    with pytest.raises(IngestionError):
        ingest_file_bytes("empty.py", b"")

    with pytest.raises(IngestionError):
        ingest_file_bytes("huge.txt", b"a" * (MAX_FILE_SIZE_BYTES + 1))

    with pytest.raises(IngestionError):
        ingest_file_bytes("binary_disguised.py", b"def f():\x00\x00 pass")

    with pytest.raises(IngestionError):
        ingest_file_bytes("corrupt.ipynb", b"{bad json")

    with pytest.raises(IngestionError):
        ingest_file_bytes("corrupt.pdf", b"not a valid pdf file")
