import html

from app.schemas import AssignmentRecord, CriterionAudit, EvaluationRecord


def _format_delta(delta: float) -> str:
    if delta > 0:
        return f"+{delta:.1f}"
    return f"{delta:.1f}"


def _format_percentage(score: float, max_score: float) -> str:
    if max_score <= 0:
        return "N/A"
    return f"{(score / max_score) * 100.0:.1f}%"


def render_markdown_report(
    assignment: AssignmentRecord | None,
    evaluation: EvaluationRecord,
) -> str:
    assignment_title = assignment.title if assignment else f"Assignment ({evaluation.assignment_id})"
    assignment_type = assignment.assignment_type if assignment else "hybrid"
    delta = round(evaluation.total_final_score - evaluation.total_initial_score, 2)
    pct_str = _format_percentage(evaluation.total_final_score, evaluation.max_possible_score)

    lines: list[str] = [
        f"# Evaluation Report: {assignment_title}",
        "",
        "## Submission & Metadata",
        f"- **Student Name:** {evaluation.student_name}",
        f"- **Student ID:** {evaluation.student_id or 'N/A'}",
        f"- **Submission File:** `{evaluation.submission_filename}`",
        f"- **Assignment Modality:** `{assignment_type}`",
        f"- **Evaluation ID:** `{evaluation.id}`",
        f"- **Timestamp (UTC):** {evaluation.created_at}",
        f"- **Pipeline Duration:** {evaluation.duration_ms} ms",
        "",
        "## Score & Calibration Summary",
        f"- **Initial Evaluator Score:** {evaluation.total_initial_score:.1f} / {evaluation.max_possible_score:.1f}",
        f"- **Reflection Calibration Delta:** {_format_delta(delta)} pts",
        f"- **Final Calibrated Score:** **{evaluation.total_final_score:.1f} / {evaluation.max_possible_score:.1f}** ({pct_str})",
        f"- **Letter Grade:** **{evaluation.letter_grade}**",
        "",
    ]

    if evaluation.feedback_report:
        fb = evaluation.feedback_report
        lines.extend(
            [
                "## Pedagogical Feedback & Revision Roadmap",
                "",
                "### Executive Summary",
                fb.executive_summary,
                "",
                "### Key Strengths",
            ]
        )
        if fb.key_strengths:
            for strength in fb.key_strengths:
                lines.append(f"- {strength}")
        else:
            lines.append("- None noted.")
        lines.append("")

        lines.append("### Actionable Learning Gaps")
        if fb.learning_gaps:
            for idx, gap in enumerate(fb.learning_gaps, start=1):
                lines.extend(
                    [
                        f"#### {idx}. {gap.concept_or_skill}",
                        f"- **Observed Issue:** {gap.observed_issue}",
                        f"- **Actionable Fix:** {gap.actionable_fix}",
                        f"- **Example / Hint:** `{gap.example_or_hint}`",
                        "",
                    ]
                )
        else:
            lines.append("No major learning gaps identified.")
            lines.append("")

        lines.append("### Priority Revision Roadmap")
        for idx, step in enumerate(fb.revision_roadmap, start=1):
            lines.append(f"{idx}. {step}")
        lines.extend(
            [
                "",
                f"> {fb.encouraging_closing}",
                "",
            ]
        )

    audit_by_id: dict[str, CriterionAudit] = {}
    if evaluation.reflection_audit:
        for audit in evaluation.reflection_audit.criterion_audits:
            audit_by_id[audit.criterion_id.strip()] = audit

    if evaluation.initial_evaluation:
        init_eval = evaluation.initial_evaluation
        lines.extend(
            [
                "## Criterion Breakdown & Chain-of-Thought Trace",
                "",
                f"**Overall Comprehension Summary:** {init_eval.overall_comprehension_summary}",
                "",
            ]
        )
        for ce in init_eval.criterion_evaluations:
            audit = audit_by_id.get(ce.criterion_id.strip())
            final_pts = audit.calibrated_score if audit else ce.initial_score
            verdict = audit.audit_verdict if audit else "verified"
            lines.extend(
                [
                    f"### {ce.criterion_id}: {ce.criterion_title}",
                    f"- **Initial Score:** {ce.initial_score:.1f} / {ce.max_points:.1f}",
                    f"- **Calibrated Final Score:** **{final_pts:.1f} / {ce.max_points:.1f}** (`{verdict}`)",
                    f"- **Evaluator Rationale:** {ce.rationale}",
                    "- **Chain-of-Thought Verification Trace:**",
                    f"  {ce.chain_of_thought_trace}",
                ]
            )
            if ce.student_evidence_quotes:
                lines.append("- **Student Evidence Quotes:**")
                for quote in ce.student_evidence_quotes:
                    lines.append(f"  - `{quote}`")
            if ce.strengths_observed:
                lines.append("- **Strengths Observed:**")
                for s in ce.strengths_observed:
                    lines.append(f"  - {s}")
            if ce.flaws_or_gaps_observed:
                lines.append("- **Flaws / Gaps Observed:**")
                for f in ce.flaws_or_gaps_observed:
                    lines.append(f"  - {f}")
            lines.append("")

    if evaluation.reflection_audit:
        ref = evaluation.reflection_audit
        lines.extend(
            [
                "## Reflection & Bias Audit Log",
                f"- **Audit Status:** `{ref.audit_status}`",
                f"- **Overall Audit Summary:** {ref.overall_audit_summary}",
                "",
                "### Bias Checks Performed",
            ]
        )
        for check in ref.bias_checks_performed:
            lines.append(f"- {check}")
        lines.extend(
            [
                "",
                "### Criterion Calibration Table",
                "| Criterion | Initial | Calibrated | Delta | Verdict | Bias / Error Detected | Calibration Reasoning |",
                "| :--- | :---: | :---: | :---: | :---: | :--- | :--- |",
            ]
        )
        for ca in ref.criterion_audits:
            lines.append(
                f"| {ca.criterion_id} | {ca.initial_score:.1f} | {ca.calibrated_score:.1f} | "
                f"{_format_delta(ca.adjustment_delta)} | `{ca.audit_verdict}` | "
                f"{ca.bias_or_error_detected} | {ca.calibration_reasoning} |"
            )
        lines.append("")

    return "\n".join(lines).strip() + "\n"


def render_html_report(
    assignment: AssignmentRecord | None,
    evaluation: EvaluationRecord,
) -> str:
    esc = html.escape
    assignment_title = assignment.title if assignment else f"Assignment ({evaluation.assignment_id})"
    assignment_type = assignment.assignment_type if assignment else "hybrid"
    delta = round(evaluation.total_final_score - evaluation.total_initial_score, 2)
    pct_str = _format_percentage(evaluation.total_final_score, evaluation.max_possible_score)

    audit_by_id: dict[str, CriterionAudit] = {}
    if evaluation.reflection_audit:
        for audit in evaluation.reflection_audit.criterion_audits:
            audit_by_id[audit.criterion_id.strip()] = audit

    feedback_html = ""
    if evaluation.feedback_report:
        fb = evaluation.feedback_report
        strengths_items = "".join(f"<li>{esc(s)}</li>" for s in fb.key_strengths) or "<li>None noted.</li>"
        gaps_cards = "".join(
            f"""
            <div class="card subcard">
              <h4>{idx}. {esc(gap.concept_or_skill)}</h4>
              <p><strong>Observed Issue:</strong> {esc(gap.observed_issue)}</p>
              <p><strong>Actionable Fix:</strong> {esc(gap.actionable_fix)}</p>
              <pre class="code-block">{esc(gap.example_or_hint)}</pre>
            </div>
            """
            for idx, gap in enumerate(fb.learning_gaps, start=1)
        )
        roadmap_items = "".join(f"<li>{esc(step)}</li>" for step in fb.revision_roadmap)
        feedback_html = f"""
        <section class="section">
          <h2>1. Pedagogical Feedback &amp; Learning Gaps</h2>
          <div class="card">
            <h3>Executive Summary</h3>
            <p>{esc(fb.executive_summary)}</p>
            <h3>Key Strengths</h3>
            <ul>{strengths_items}</ul>
            <h3>Actionable Learning Gaps</h3>
            {gaps_cards or '<p>No major learning gaps identified.</p>'}
            <h3>Revision Roadmap</h3>
            <ol>{roadmap_items}</ol>
            <blockquote class="closing">{esc(fb.encouraging_closing)}</blockquote>
          </div>
        </section>
        """

    criteria_html = ""
    if evaluation.initial_evaluation:
        init_eval = evaluation.initial_evaluation
        crit_blocks: list[str] = []
        for ce in init_eval.criterion_evaluations:
            audit = audit_by_id.get(ce.criterion_id.strip())
            final_pts = audit.calibrated_score if audit else ce.initial_score
            verdict = audit.audit_verdict if audit else "verified"
            quotes_html = "".join(f"<li><code>{esc(q)}</code></li>" for q in ce.student_evidence_quotes)
            strengths_html = "".join(f"<li>{esc(s)}</li>" for s in ce.strengths_observed)
            flaws_html = "".join(f"<li>{esc(f)}</li>" for f in ce.flaws_or_gaps_observed)
            crit_blocks.append(
                f"""
                <div class="card subcard">
                  <div class="crit-header">
                    <h3>{esc(ce.criterion_id)}: {esc(ce.criterion_title)}</h3>
                    <span class="score-badge">
                      Initial: {ce.initial_score:.1f} &rarr; Final: <strong>{final_pts:.1f} / {ce.max_points:.1f}</strong>
                      ({esc(verdict)})
                    </span>
                  </div>
                  <p><strong>Evaluator Rationale:</strong> {esc(ce.rationale)}</p>
                  <div class="cot-box">
                    <strong>Chain-of-Thought Verification Trace:</strong>
                    <p>{esc(ce.chain_of_thought_trace)}</p>
                  </div>
                  <div class="grid-2">
                    <div>
                      <strong>Strengths Observed</strong>
                      <ul>{strengths_html or '<li>None noted</li>'}</ul>
                    </div>
                    <div>
                      <strong>Flaws / Gaps Observed</strong>
                      <ul>{flaws_html or '<li>None noted</li>'}</ul>
                    </div>
                  </div>
                  <div>
                    <strong>Student Evidence Quotes</strong>
                    <ul>{quotes_html or '<li>No direct quotes</li>'}</ul>
                  </div>
                </div>
                """
            )
        criteria_html = f"""
        <section class="section">
          <h2>2. Criterion Breakdown &amp; Chain-of-Thought Reasoning Trace</h2>
          <p class="summary-line"><strong>Overall Comprehension Summary:</strong> {esc(init_eval.overall_comprehension_summary)}</p>
          {''.join(crit_blocks)}
        </section>
        """

    reflection_html = ""
    if evaluation.reflection_audit:
        ref = evaluation.reflection_audit
        checks_html = "".join(f"<li>{esc(c)}</li>" for c in ref.bias_checks_performed)
        rows_html = "".join(
            f"""
            <tr>
              <td><strong>{esc(ca.criterion_id)}</strong></td>
              <td>{ca.initial_score:.1f}</td>
              <td><strong>{ca.calibrated_score:.1f}</strong></td>
              <td>{esc(_format_delta(ca.adjustment_delta))}</td>
              <td><span class="tag">{esc(ca.audit_verdict)}</span></td>
              <td>{esc(ca.bias_or_error_detected)}</td>
              <td>{esc(ca.calibration_reasoning)}</td>
            </tr>
            """
            for ca in ref.criterion_audits
        )
        reflection_html = f"""
        <section class="section">
          <h2>3. Reflection &amp; Bias Audit Log</h2>
          <div class="card">
            <p><strong>Audit Status:</strong> <span class="tag">{esc(ref.audit_status)}</span></p>
            <p><strong>Audit Summary:</strong> {esc(ref.overall_audit_summary)}</p>
            <h3>Bias Checks Performed</h3>
            <ul>{checks_html}</ul>
            <h3>Criterion Calibration Audit</h3>
            <table>
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Initial</th>
                  <th>Calibrated</th>
                  <th>Delta</th>
                  <th>Verdict</th>
                  <th>Bias / Error Detected</th>
                  <th>Calibration Reasoning</th>
                </tr>
              </thead>
              <tbody>{rows_html}</tbody>
            </table>
          </div>
        </section>
        """

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Evaluation Report - {esc(evaluation.student_name)} - {esc(assignment_title)}</title>
  <style>
    :root {{
      --ink: #0f172a;
      --muted: #475569;
      --border: #cbd5e1;
      --bg: #f8fafc;
      --card: #ffffff;
      --accent: #1e3a8a;
      --accent-soft: #eff6ff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
      color: var(--ink);
      background: var(--bg);
      margin: 0;
      padding: 2rem;
      line-height: 1.55;
    }}
    .container {{
      max-width: 980px;
      margin: 0 auto;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 2rem 2.5rem;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
    }}
    .top-bar {{
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid var(--accent);
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
    }}
    h1 {{ margin: 0 0 0.35rem 0; font-size: 1.6rem; color: var(--accent); }}
    h2 {{ font-size: 1.25rem; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 0.4rem; margin-top: 2rem; }}
    h3 {{ font-size: 1.05rem; margin: 0.75rem 0 0.4rem 0; }}
    h4 {{ font-size: 0.98rem; margin: 0 0 0.4rem 0; color: var(--accent); }}
    .meta-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
    }}
    .hero-scores {{
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 0.75rem;
      background: var(--accent-soft);
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1.5rem;
      text-align: center;
    }}
    .hero-scores .metric-label {{ font-size: 0.75rem; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; }}
    .hero-scores .metric-value {{ font-size: 1.35rem; font-weight: 700; color: var(--accent); margin-top: 0.2rem; }}
    .card {{
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.1rem 1.25rem;
      margin-bottom: 1rem;
      background: #fff;
    }}
    .subcard {{ background: #fcfdff; }}
    .crit-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 0.5rem;
      margin-bottom: 0.75rem;
    }}
    .score-badge {{
      background: var(--accent-soft);
      color: var(--accent);
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      font-size: 0.85rem;
    }}
    .cot-box {{
      background: #f1f5f9;
      border-left: 3px solid var(--accent);
      padding: 0.75rem 1rem;
      border-radius: 4px;
      margin: 0.75rem 0;
      font-size: 0.92rem;
    }}
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin: 0.75rem 0;
    }}
    .code-block {{
      background: #0f172a;
      color: #f8fafc;
      padding: 0.65rem 0.9rem;
      border-radius: 6px;
      overflow-x: auto;
      font-family: Consolas, Monaco, monospace;
      font-size: 0.85rem;
    }}
    .closing {{
      margin: 1rem 0 0 0;
      padding: 0.75rem 1rem;
      background: #f0fdf4;
      border-left: 4px solid #16a34a;
      color: #166534;
      font-style: italic;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
      margin-top: 0.5rem;
    }}
    th, td {{
      border: 1px solid var(--border);
      padding: 0.5rem 0.65rem;
      text-align: left;
      vertical-align: top;
    }}
    th {{ background: #f1f5f9; font-weight: 600; }}
    .tag {{
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      background: #e2e8f0;
      font-size: 0.8rem;
      font-family: monospace;
    }}
    .print-btn {{
      background: var(--accent);
      color: #fff;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
    }}
    @media print {{
      body {{ background: #fff; padding: 0; }}
      .container {{ border: none; box-shadow: none; padding: 0; max-width: 100%; }}
      .no-print {{ display: none !important; }}
      .card {{ break-inside: avoid; }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div>
        <h1>{esc(assignment_title)}</h1>
        <div>Autonomous 4-Agent Academic Evaluation Report &bull; Modality: <code>{esc(assignment_type)}</code></div>
      </div>
      <button class="print-btn no-print" onclick="window.print()">Print / Save PDF</button>
    </div>

    <div class="meta-grid">
      <div><strong>Student Name:</strong> {esc(evaluation.student_name)}</div>
      <div><strong>Student ID:</strong> {esc(evaluation.student_id or 'N/A')}</div>
      <div><strong>Submission File:</strong> <code>{esc(evaluation.submission_filename)}</code></div>
      <div><strong>Evaluated At:</strong> {esc(evaluation.created_at)}</div>
    </div>

    <div class="hero-scores">
      <div>
        <div class="metric-label">Initial Score</div>
        <div class="metric-value">{evaluation.total_initial_score:.1f} / {evaluation.max_possible_score:.1f}</div>
      </div>
      <div>
        <div class="metric-label">Calibration Delta</div>
        <div class="metric-value">{esc(_format_delta(delta))}</div>
      </div>
      <div>
        <div class="metric-label">Final Score</div>
        <div class="metric-value">{evaluation.total_final_score:.1f} / {evaluation.max_possible_score:.1f}</div>
      </div>
      <div>
        <div class="metric-label">Percentage</div>
        <div class="metric-value">{esc(pct_str)}</div>
      </div>
      <div>
        <div class="metric-label">Letter Grade</div>
        <div class="metric-value">{esc(evaluation.letter_grade)}</div>
      </div>
    </div>

    {feedback_html}
    {criteria_html}
    {reflection_html}
  </div>
</body>
</html>
"""
