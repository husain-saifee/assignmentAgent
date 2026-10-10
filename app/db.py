import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.schemas import (
    AssignmentRecord,
    EvaluationRecord,
    EvaluatorOutput,
    FeedbackOutput,
    ReflectionOutput,
    StructuredRubric,
)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


class Database:
    def __init__(self, db_path: str = "data/evaluations.db") -> None:
        self.db_path = db_path

    def _connect(self) -> sqlite3.Connection:
        db_file = Path(self.db_path)
        if db_file.parent and str(db_file.parent) != ".":
            db_file.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
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
                """
            )

    @staticmethod
    def _row_to_assignment(row: sqlite3.Row) -> AssignmentRecord:
        rubric_json = row["structured_rubric_json"]
        structured_rubric = (
            StructuredRubric.model_validate_json(rubric_json) if rubric_json else None
        )
        return AssignmentRecord(
            id=row["id"],
            title=row["title"],
            assignment_type=row["assignment_type"],
            prompt_text=row["prompt_text"],
            raw_rubric_text=row["raw_rubric_text"] or "",
            reference_solution_text=row["reference_solution_text"] or "",
            structured_rubric=structured_rubric,
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_evaluation(row: sqlite3.Row) -> EvaluationRecord:
        rubric_json = row["rubric_used_json"]
        initial_json = row["initial_evaluation_json"]
        reflection_json = row["reflection_audit_json"]
        feedback_json = row["feedback_report_json"]
        return EvaluationRecord(
            id=row["id"],
            assignment_id=row["assignment_id"],
            student_name=row["student_name"],
            student_id=row["student_id"] or "",
            submission_filename=row["submission_filename"] or "submission.txt",
            submission_text=row["submission_text"],
            status=row["status"],
            rubric_used=StructuredRubric.model_validate_json(rubric_json) if rubric_json else None,
            initial_evaluation=(
                EvaluatorOutput.model_validate_json(initial_json) if initial_json else None
            ),
            reflection_audit=(
                ReflectionOutput.model_validate_json(reflection_json) if reflection_json else None
            ),
            feedback_report=(
                FeedbackOutput.model_validate_json(feedback_json) if feedback_json else None
            ),
            total_initial_score=float(row["total_initial_score"] or 0.0),
            total_final_score=float(row["total_final_score"] or 0.0),
            max_possible_score=float(row["max_possible_score"] or 0.0),
            letter_grade=row["letter_grade"] or "N/A",
            duration_ms=int(row["duration_ms"] or 0),
            error_message=row["error_message"] or "",
            created_at=row["created_at"],
        )

    def create_assignment(
        self,
        *,
        title: str,
        assignment_type: str = "hybrid",
        prompt_text: str,
        raw_rubric_text: str = "",
        reference_solution_text: str = "",
        structured_rubric: StructuredRubric | None = None,
        assignment_id: str | None = None,
    ) -> AssignmentRecord:
        if assignment_id is not None:
            existing = self.get_assignment(assignment_id)
            if existing is not None:
                return existing

        aid = assignment_id or str(uuid.uuid4())
        created_at = _utc_now_iso()
        rubric_json = structured_rubric.model_dump_json() if structured_rubric else None

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO assignments (
                    id, title, assignment_type, prompt_text,
                    raw_rubric_text, reference_solution_text,
                    structured_rubric_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    aid,
                    title,
                    assignment_type,
                    prompt_text,
                    raw_rubric_text,
                    reference_solution_text,
                    rubric_json,
                    created_at,
                ),
            )

        record = self.get_assignment(aid)
        assert record is not None
        return record

    def list_assignments(self) -> list[AssignmentRecord]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM assignments ORDER BY created_at DESC, rowid DESC"
            ).fetchall()
        return [self._row_to_assignment(r) for r in rows]

    def get_assignment(self, assignment_id: str) -> AssignmentRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM assignments WHERE id = ?", (assignment_id,)
            ).fetchone()
        return self._row_to_assignment(row) if row else None

    def update_assignment_rubric(
        self, assignment_id: str, structured_rubric: StructuredRubric
    ) -> AssignmentRecord | None:
        rubric_json = structured_rubric.model_dump_json()
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE assignments SET structured_rubric_json = ? WHERE id = ?",
                (rubric_json, assignment_id),
            )
            if cur.rowcount == 0:
                return None
        return self.get_assignment(assignment_id)

    def delete_assignment(self, assignment_id: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM assignments WHERE id = ?", (assignment_id,))
            return cur.rowcount > 0

    def create_evaluation(
        self,
        *,
        assignment_id: str,
        student_name: str,
        student_id: str = "",
        submission_filename: str = "submission.txt",
        submission_text: str,
    ) -> EvaluationRecord:
        eid = str(uuid.uuid4())
        created_at = _utc_now_iso()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO evaluations (
                    id, assignment_id, student_name, student_id,
                    submission_filename, submission_text, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
                """,
                (
                    eid,
                    assignment_id,
                    student_name,
                    student_id,
                    submission_filename,
                    submission_text,
                    created_at,
                ),
            )
        record = self.get_evaluation(eid)
        assert record is not None
        return record

    def complete_evaluation(
        self,
        *,
        evaluation_id: str,
        rubric_used: StructuredRubric,
        initial_evaluation: EvaluatorOutput,
        reflection_audit: ReflectionOutput,
        feedback_report: FeedbackOutput,
        total_initial_score: float,
        total_final_score: float,
        max_possible_score: float,
        letter_grade: str,
        duration_ms: int,
    ) -> EvaluationRecord:
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE evaluations
                SET status = 'completed',
                    rubric_used_json = ?,
                    initial_evaluation_json = ?,
                    reflection_audit_json = ?,
                    feedback_report_json = ?,
                    total_initial_score = ?,
                    total_final_score = ?,
                    max_possible_score = ?,
                    letter_grade = ?,
                    duration_ms = ?,
                    error_message = ''
                WHERE id = ?
                """,
                (
                    rubric_used.model_dump_json(),
                    initial_evaluation.model_dump_json(),
                    reflection_audit.model_dump_json(),
                    feedback_report.model_dump_json(),
                    total_initial_score,
                    total_final_score,
                    max_possible_score,
                    letter_grade,
                    duration_ms,
                    evaluation_id,
                ),
            )
        record = self.get_evaluation(evaluation_id)
        if record is None:
            raise KeyError(f"Evaluation {evaluation_id} not found")
        return record

    def fail_evaluation(
        self, evaluation_id: str, error_message: str, duration_ms: int = 0
    ) -> EvaluationRecord | None:
        with self._connect() as conn:
            cur = conn.execute(
                """
                UPDATE evaluations
                SET status = 'failed',
                    error_message = ?,
                    duration_ms = ?
                WHERE id = ?
                """,
                (error_message, duration_ms, evaluation_id),
            )
            if cur.rowcount == 0:
                return None
        return self.get_evaluation(evaluation_id)

    def get_evaluation(self, evaluation_id: str) -> EvaluationRecord | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM evaluations WHERE id = ?", (evaluation_id,)
            ).fetchone()
        return self._row_to_evaluation(row) if row else None

    def list_evaluations(self, assignment_id: str | None = None) -> list[EvaluationRecord]:
        with self._connect() as conn:
            if assignment_id:
                rows = conn.execute(
                    "SELECT * FROM evaluations WHERE assignment_id = ? ORDER BY created_at DESC, rowid DESC",
                    (assignment_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM evaluations ORDER BY created_at DESC, rowid DESC"
                ).fetchall()
        return [self._row_to_evaluation(r) for r in rows]
