(() => {
  const STAGES = [
    "rubric_parser",
    "cot_evaluator",
    "reflection_auditor",
    "feedback_synthesizer",
  ];

  const state = {
    assignments: [],
    sampleSubmissions: {},
    activeAssignmentId: null,
    evaluations: [],
    activeEvaluation: null,
    submissionPdfBase64: null,
    livePartial: {
      rubric: null,
      initialEval: null,
      reflection: null,
      feedback: null,
    },
  };

  const el = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildHeaders(extra = {}) {
    const headers = { ...extra };
    const apiKey = el("api-key-input")?.value.trim();
    const model = el("model-select")?.value.trim();
    if (apiKey) headers["X-Gemini-Api-Key"] = apiKey;
    if (model) headers["X-Gemini-Model"] = model;
    return headers;
  }

  function showBanner(message, isError = false) {
    const banner = el("status-banner");
    const text = el("status-banner-text");
    if (!banner || !text) return;
    text.textContent = message;
    banner.className = isError
      ? "bg-rose-50 border-b border-rose-200 px-4 py-2 text-xs text-rose-900"
      : "bg-indigo-50 border-b border-indigo-200 px-4 py-2 text-xs text-indigo-900";
    banner.classList.remove("hidden");
  }

  function hideBanner() {
    el("status-banner")?.classList.add("hidden");
  }

  function formatDelta(delta) {
    const num = Number(delta || 0);
    return num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1);
  }

  function resetPipelineStepper(statusText = "Idle") {
    const overall = el("pipeline-overall-status");
    if (overall) {
      overall.textContent = statusText;
      overall.className =
        "text-xs font-mono px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600";
    }
    for (const stage of STAGES) {
      const card = el(`stage-card-${stage}`);
      const badge = el(`stage-badge-${stage}`);
      if (card) {
        card.className =
          "border border-slate-200 rounded-lg p-2.5 bg-slate-50/70 flex flex-col justify-between";
      }
      if (badge) {
        badge.textContent = "pending";
        badge.className = "text-[10px] font-mono text-slate-400";
      }
    }
  }

  function updateStageState(stage, mode, detailText = "") {
    const card = el(`stage-card-${stage}`);
    const badge = el(`stage-badge-${stage}`);
    if (!card || !badge) return;

    if (mode === "running") {
      card.className =
        "border-2 border-indigo-500 rounded-lg p-2.5 bg-indigo-50/60 flex flex-col justify-between shadow-xs";
      badge.textContent = "running...";
      badge.className =
        "text-[10px] font-mono text-indigo-700 font-semibold animate-pulse";
    } else if (mode === "complete") {
      card.className =
        "border border-emerald-300 rounded-lg p-2.5 bg-emerald-50/40 flex flex-col justify-between";
      badge.textContent = detailText || "done";
      badge.className = "text-[10px] font-mono text-emerald-700 font-semibold";
    } else if (mode === "error") {
      card.className =
        "border border-rose-300 rounded-lg p-2.5 bg-rose-50/60 flex flex-col justify-between";
      badge.textContent = "failed";
      badge.className = "text-[10px] font-mono text-rose-700 font-semibold";
    }
  }

  function renderAssignmentsList() {
    const container = el("assignments-list");
    if (!container) return;

    if (!state.assignments.length) {
      container.innerHTML = `<div class="p-4 text-xs text-slate-400 text-center">No assignments saved. Click "Seed / Reset Sample Assignments".</div>`;
      return;
    }

    container.innerHTML = state.assignments
      .map((a) => {
        const isSelected = a.id === state.activeAssignmentId;
        const hasRubric = Boolean(a.structured_rubric);
        const hasSample = Boolean(state.sampleSubmissions[a.id]);
        return `
        <div
          data-assign-id="${escapeHtml(a.id)}"
          class="assignment-row px-3.5 py-2.5 cursor-pointer transition-colors flex items-start justify-between gap-2 ${
            isSelected ? "bg-indigo-50/90 border-l-4 border-indigo-600" : "hover:bg-slate-50"
          }"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 mb-0.5">
              <span class="text-[10px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">${escapeHtml(
                a.assignment_type
              )}</span>
              ${
                hasRubric
                  ? `<span class="text-[10px] font-mono text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 rounded">rubric ready</span>`
                  : `<span class="text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-200 px-1.5 rounded">unparsed</span>`
              }
              ${
                hasSample
                  ? `<span class="text-[10px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 rounded">sample</span>`
                  : ""
              }
            </div>
            <div class="text-xs font-semibold text-slate-800 truncate">${escapeHtml(a.title)}</div>
          </div>
          <button
            type="button"
            data-delete-assign="${escapeHtml(a.id)}"
            title="Delete assignment"
            class="text-slate-400 hover:text-rose-600 text-xs px-1.5 py-0.5 rounded"
          >&times;</button>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll(".assignment-row").forEach((row) => {
      row.addEventListener("click", (evt) => {
        const delBtn = evt.target.closest("[data-delete-assign]");
        if (delBtn) return;
        const id = row.getAttribute("data-assign-id");
        selectAssignment(id);
      });
    });

    container.querySelectorAll("[data-delete-assign]").forEach((btn) => {
      btn.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        const id = btn.getAttribute("data-delete-assign");
        if (!id) return;
        await deleteAssignment(id);
      });
    });
  }

  function renderStructuredRubric(rubric) {
    const container = el("active-rubric-container");
    const pointsBadge = el("rubric-points-badge");
    if (!container || !pointsBadge) return;

    if (!rubric || !Array.isArray(rubric.criteria) || !rubric.criteria.length) {
      pointsBadge.textContent = "Unparsed";
      container.innerHTML = `<p class="text-slate-400">No structured rubric cached yet. Stage 1 will automatically parse or synthesize it when evaluation runs.</p>`;
      return;
    }

    pointsBadge.textContent = `${Number(rubric.total_max_points || 0).toFixed(0)} pts`;
    container.innerHTML = rubric.criteria
      .map((c) => {
        const bandsHtml = (c.scoring_bands || [])
          .map(
            (b) => `
            <div class="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1">
              <span class="font-semibold text-slate-700">${escapeHtml(b.band_label)} (${escapeHtml(
              b.points_range
            )} pts):</span>
              <span class="text-slate-600">${escapeHtml(b.description)}</span>
            </div>
          `
          )
          .join("");
        return `
        <div class="border border-slate-200 rounded-lg p-2.5 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-slate-800">${escapeHtml(c.criterion_id)}: ${escapeHtml(
          c.title
        )}</span>
            <span class="text-[11px] font-mono bg-indigo-50 text-indigo-800 px-2 py-0.5 rounded border border-indigo-200">${Number(
              c.max_points
            ).toFixed(1)} pts &bull; ${escapeHtml(c.evaluation_focus)}</span>
          </div>
          <p class="text-slate-600 text-[11px]">${escapeHtml(c.description)}</p>
          <div class="grid grid-cols-1 gap-1 pt-1">${bandsHtml}</div>
        </div>
      `;
      })
      .join("");
  }

  function selectAssignment(assignmentId) {
    state.activeAssignmentId = assignmentId;
    const active = state.assignments.find((a) => a.id === assignmentId) || null;
    renderAssignmentsList();

    if (!active) {
      el("active-assignment-title").textContent = "Select or Seed an Assignment";
      el("active-assignment-badge").textContent = "NONE";
      el("active-assignment-prompt").textContent = "No assignment selected.";
      el("active-assignment-reference").textContent = "None provided.";
      renderStructuredRubric(null);
      return;
    }

    el("active-assignment-title").textContent = active.title;
    el("active-assignment-badge").textContent = active.assignment_type.toUpperCase();
    el("active-assignment-prompt").textContent = active.prompt_text;
    el("active-assignment-reference").textContent =
      active.reference_solution_text || "None provided.";
    renderStructuredRubric(active.structured_rubric);
  }

  function renderEvaluationsHistory() {
    const container = el("evaluations-list");
    if (!container) return;

    if (!state.evaluations.length) {
      container.innerHTML = `<div class="p-4 text-xs text-slate-400 text-center">No evaluations recorded yet.</div>`;
      return;
    }

    container.innerHTML = state.evaluations
      .map((ev) => {
        const isSelected = state.activeEvaluation && state.activeEvaluation.id === ev.id;
        const statusColor =
          ev.status === "completed"
            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
            : ev.status === "failed"
            ? "bg-rose-50 text-rose-700 border-rose-200"
            : "bg-amber-50 text-amber-700 border-amber-200";
        return `
        <div
          data-eval-id="${escapeHtml(ev.id)}"
          class="eval-history-row px-3.5 py-2.5 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
            isSelected ? "bg-indigo-50/90 border-l-4 border-indigo-600" : "hover:bg-slate-50"
          }"
        >
          <div class="min-w-0">
            <div class="text-xs font-semibold text-slate-800 truncate">
              ${escapeHtml(ev.student_name)}
              <span class="text-slate-400 font-normal">${
                ev.student_id ? `(${escapeHtml(ev.student_id)})` : ""
              }</span>
            </div>
            <div class="text-[11px] text-slate-500 truncate font-mono">${escapeHtml(
              ev.submission_filename
            )}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded border ${statusColor}">
              ${
                ev.status === "completed"
                  ? `${Number(ev.total_final_score).toFixed(1)}/${Number(
                      ev.max_possible_score
                    ).toFixed(0)} (${escapeHtml(ev.letter_grade)})`
                  : escapeHtml(ev.status)
              }
            </span>
          </div>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll(".eval-history-row").forEach((row) => {
      row.addEventListener("click", async () => {
        const id = row.getAttribute("data-eval-id");
        if (!id) return;
        await loadEvaluationById(id);
      });
    });
  }

  function renderFeedbackTab(feedback) {
    const panel = el("tab-panel-feedback");
    if (!panel) return;
    if (!feedback) {
      panel.innerHTML = `<p class="text-slate-400 text-center py-8">No pedagogical feedback available for this evaluation.</p>`;
      return;
    }

    const strengthsHtml = (feedback.key_strengths || [])
      .map((s) => `<li class="flex items-start gap-2"><span class="text-emerald-600 font-bold">&check;</span><span>${escapeHtml(s)}</span></li>`)
      .join("");

    const gapsHtml = (feedback.learning_gaps || [])
      .map(
        (g, idx) => `
        <div class="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-1.5">
          <div class="font-semibold text-indigo-900">${idx + 1}. ${escapeHtml(g.concept_or_skill)}</div>
          <p class="text-slate-700"><span class="font-semibold">Observed Issue:</span> ${escapeHtml(g.observed_issue)}</p>
          <p class="text-slate-700"><span class="font-semibold">Actionable Fix:</span> ${escapeHtml(g.actionable_fix)}</p>
          <pre class="bg-slate-900 text-slate-100 font-mono text-[11px] p-2.5 rounded overflow-x-auto whitespace-pre-wrap">${escapeHtml(
            g.example_or_hint
          )}</pre>
        </div>
      `
      )
      .join("");

    const roadmapHtml = (feedback.revision_roadmap || [])
      .map(
        (step, idx) =>
          `<li class="flex items-start gap-2"><span class="font-mono font-bold text-indigo-600">${
            idx + 1
          }.</span><span>${escapeHtml(step)}</span></li>`
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-4">
        <div class="bg-indigo-50/70 border border-indigo-200 rounded-lg p-3">
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-indigo-900 mb-1">Executive Summary</h4>
          <p class="text-slate-800 leading-relaxed">${escapeHtml(feedback.executive_summary)}</p>
        </div>

        <div>
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">Key Strengths</h4>
          <ul class="space-y-1 text-slate-700">${strengthsHtml || "<li>None noted.</li>"}</ul>
        </div>

        <div>
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">Actionable Learning Gaps</h4>
          <div class="space-y-2.5">${gapsHtml || "<p class='text-slate-500'>No major learning gaps identified.</p>"}</div>
        </div>

        <div>
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-2">Priority Revision Roadmap</h4>
          <ol class="space-y-1.5 text-slate-700">${roadmapHtml}</ol>
        </div>

        <blockquote class="border-l-4 border-emerald-500 bg-emerald-50/70 px-3 py-2 text-emerald-950 italic rounded-r">
          ${escapeHtml(feedback.encouraging_closing)}
        </blockquote>
      </div>
    `;
  }

  function renderCriteriaTab(initialEval, reflectionAudit) {
    const panel = el("tab-panel-criteria");
    if (!panel) return;
    if (!initialEval || !Array.isArray(initialEval.criterion_evaluations)) {
      panel.innerHTML = `<p class="text-slate-400 text-center py-8">No criterion evaluations available.</p>`;
      return;
    }

    const auditsById = {};
    if (reflectionAudit && Array.isArray(reflectionAudit.criterion_audits)) {
      for (const a of reflectionAudit.criterion_audits) {
        auditsById[String(a.criterion_id).trim()] = a;
      }
    }

    const cardsHtml = initialEval.criterion_evaluations
      .map((ce) => {
        const audit = auditsById[String(ce.criterion_id).trim()];
        const finalScore = audit ? audit.calibrated_score : ce.initial_score;
        const verdict = audit ? audit.audit_verdict : "verified";

        const quotesHtml = (ce.student_evidence_quotes || [])
          .map(
            (q) =>
              `<pre class="bg-slate-900 text-amber-200 font-mono text-[11px] p-2 rounded overflow-x-auto whitespace-pre-wrap">${escapeHtml(
                q
              )}</pre>`
          )
          .join("");

        const strengthsHtml = (ce.strengths_observed || [])
          .map((s) => `<li>&bull; ${escapeHtml(s)}</li>`)
          .join("");

        const flawsHtml = (ce.flaws_or_gaps_observed || [])
          .map((f) => `<li>&bull; ${escapeHtml(f)}</li>`)
          .join("");

        return `
        <div class="border border-slate-200 rounded-xl p-3.5 space-y-2.5 bg-white">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div class="font-semibold text-slate-900">${escapeHtml(ce.criterion_id)}: ${escapeHtml(
          ce.criterion_title
        )}</div>
            <div class="flex items-center gap-1.5 font-mono text-[11px]">
              <span class="px-2 py-0.5 rounded bg-slate-100 text-slate-700">Init: ${Number(
                ce.initial_score
              ).toFixed(1)}</span>
              <span>&rarr;</span>
              <span class="px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold">Final: ${Number(
                finalScore
              ).toFixed(1)} / ${Number(ce.max_points).toFixed(1)}</span>
              <span class="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">${escapeHtml(verdict)}</span>
            </div>
          </div>

          <p class="text-slate-700"><span class="font-semibold">Rationale:</span> ${escapeHtml(
            ce.rationale
          )}</p>

          <div class="bg-slate-50 border-l-4 border-indigo-500 p-2.5 rounded-r space-y-1">
            <div class="text-[10px] font-bold uppercase tracking-wider text-indigo-800">
              Chain-of-Thought Verification Trace
            </div>
            <p class="text-slate-700 font-mono text-[11px] whitespace-pre-wrap leading-relaxed">${escapeHtml(
              ce.chain_of_thought_trace
            )}</p>
          </div>

          ${
            quotesHtml
              ? `<div class="space-y-1"><div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Student Evidence Quotes</div>${quotesHtml}</div>`
              : ""
          }

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <div class="bg-emerald-50/60 border border-emerald-200 rounded p-2">
              <div class="text-[10px] font-bold uppercase text-emerald-800 mb-1">Strengths Observed</div>
              <ul class="text-emerald-950 space-y-0.5">${strengthsHtml || "<li>None noted</li>"}</ul>
            </div>
            <div class="bg-rose-50/60 border border-rose-200 rounded p-2">
              <div class="text-[10px] font-bold uppercase text-rose-800 mb-1">Flaws / Gaps Observed</div>
              <ul class="text-rose-950 space-y-0.5">${flawsHtml || "<li>None noted</li>"}</ul>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    panel.innerHTML = `
      <div class="space-y-3">
        <div class="bg-slate-100 border border-slate-200 rounded-lg p-3">
          <span class="font-semibold text-slate-800">Overall Comprehension Summary (${escapeHtml(
            initialEval.submission_modality
          )}):</span>
          <span class="text-slate-700"> ${escapeHtml(initialEval.overall_comprehension_summary)}</span>
        </div>
        ${cardsHtml}
      </div>
    `;
  }

  function renderReflectionTab(reflectionAudit) {
    const panel = el("tab-panel-reflection");
    if (!panel) return;
    if (!reflectionAudit) {
      panel.innerHTML = `<p class="text-slate-400 text-center py-8">No reflection audit log available.</p>`;
      return;
    }

    const checksHtml = (reflectionAudit.bias_checks_performed || [])
      .map((c) => `<li class="flex items-center gap-2"><span class="text-indigo-600">&bull;</span><span>${escapeHtml(c)}</span></li>`)
      .join("");

    const rowsHtml = (reflectionAudit.criterion_audits || [])
      .map(
        (ca) => `
        <tr class="border-t border-slate-200">
          <td class="py-2 px-2 font-mono font-bold text-slate-800">${escapeHtml(ca.criterion_id)}</td>
          <td class="py-2 px-2 font-mono">${Number(ca.initial_score).toFixed(1)}</td>
          <td class="py-2 px-2 font-mono font-bold text-indigo-700">${Number(ca.calibrated_score).toFixed(1)}</td>
          <td class="py-2 px-2 font-mono">${escapeHtml(formatDelta(ca.adjustment_delta))}</td>
          <td class="py-2 px-2"><span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-300">${escapeHtml(
            ca.audit_verdict
          )}</span></td>
          <td class="py-2 px-2 text-slate-700">${escapeHtml(ca.bias_or_error_detected)}</td>
          <td class="py-2 px-2 text-slate-600">${escapeHtml(ca.calibration_reasoning)}</td>
        </tr>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-4">
        <div class="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-800">Audit Status</span>
            <span class="font-mono text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-900 font-bold">${escapeHtml(
              reflectionAudit.audit_status
            )}</span>
          </div>
          <p class="text-slate-700">${escapeHtml(reflectionAudit.overall_audit_summary)}</p>
        </div>

        <div>
          <h4 class="text-[11px] font-bold uppercase tracking-wider text-slate-700 mb-1.5">Bias &amp; Calibration Checks Performed</h4>
          <ul class="space-y-1 text-slate-700">${checksHtml}</ul>
        </div>

        <div class="overflow-x-auto border border-slate-200 rounded-lg">
          <table class="w-full text-left border-collapse text-[11px]">
            <thead class="bg-slate-100 text-slate-700">
              <tr>
                <th class="py-2 px-2">ID</th>
                <th class="py-2 px-2">Initial</th>
                <th class="py-2 px-2">Calibrated</th>
                <th class="py-2 px-2">Delta</th>
                <th class="py-2 px-2">Verdict</th>
                <th class="py-2 px-2">Bias / Error Detected</th>
                <th class="py-2 px-2">Calibration Reasoning</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function updateExportLinks(evaluationId) {
    const mdLink = el("export-md-link");
    const htmlLink = el("export-html-link");
    if (!mdLink || !htmlLink) return;

    if (evaluationId) {
      mdLink.href = `/api/evaluations/${encodeURIComponent(evaluationId)}/export?format=md`;
      htmlLink.href = `/api/evaluations/${encodeURIComponent(evaluationId)}/export?format=html`;
      mdLink.classList.remove("pointer-events-none", "opacity-50");
      htmlLink.classList.remove("pointer-events-none", "opacity-50");
    } else {
      mdLink.href = "#";
      htmlLink.href = "#";
      mdLink.classList.add("pointer-events-none", "opacity-50");
      htmlLink.classList.add("pointer-events-none", "opacity-50");
    }
  }

  function renderFullEvaluationRecord(record) {
    state.activeEvaluation = record;
    renderEvaluationsHistory();

    const maxScore = Number(record.max_possible_score || 0);
    const initScore = Number(record.total_initial_score || 0);
    const finalScore = Number(record.total_final_score || 0);
    const delta = finalScore - initScore;
    const pct = maxScore > 0 ? `${((finalScore / maxScore) * 100).toFixed(1)}%` : "N/A";

    el("report-student-header").textContent = `${record.student_name} ${
      record.student_id ? `(${record.student_id})` : ""
    } — ${record.submission_filename}`;
    el("report-audit-badge").textContent = record.reflection_audit
      ? `Audit: ${record.reflection_audit.audit_status}`
      : record.status;

    el("hero-initial-score").textContent = `${initScore.toFixed(1)}/${maxScore.toFixed(0)}`;
    el("hero-calibration-delta").textContent = formatDelta(delta);
    el("hero-final-score").textContent = `${finalScore.toFixed(1)}/${maxScore.toFixed(0)}`;
    el("hero-percentage").textContent = pct;
    el("hero-letter-grade").textContent = record.letter_grade || "N/A";

    renderFeedbackTab(record.feedback_report);
    renderCriteriaTab(record.initial_evaluation, record.reflection_audit);
    renderReflectionTab(record.reflection_audit);
    updateExportLinks(record.id);
  }

  async function fetchHealth() {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const data = await res.json();
    if (data.default_model && el("model-select")) {
      const select = el("model-select");
      if ([...select.options].some((o) => o.value === data.default_model)) {
        select.value = data.default_model;
      }
    }
    const badge = el("env-key-badge");
    if (badge) {
      if (data.has_env_api_key) {
        badge.classList.remove("hidden");
        badge.classList.add("inline-flex");
      } else {
        badge.classList.add("hidden");
      }
    }
  }

  async function fetchAssignmentsAndSeedIfNeeded() {
    const res = await fetch("/api/assignments");
    if (!res.ok) return;
    let data = await res.json();
    if (!data.assignments || data.assignments.length === 0) {
      const seedRes = await fetch("/api/assignments/seed", { method: "POST" });
      if (seedRes.ok) {
        data = await seedRes.json();
      }
    }
    state.assignments = data.assignments || [];
    state.sampleSubmissions = data.sample_submissions || {};
    if (!state.activeAssignmentId && state.assignments.length > 0) {
      state.activeAssignmentId = state.assignments[0].id;
    }
    selectAssignment(state.activeAssignmentId);
  }

  async function fetchEvaluations() {
    const res = await fetch("/api/evaluations");
    if (!res.ok) return;
    const data = await res.json();
    state.evaluations = Array.isArray(data) ? data : data.evaluations || [];
    renderEvaluationsHistory();
  }

  async function seedAssignments() {
    const res = await fetch("/api/assignments/seed", { method: "POST" });
    if (!res.ok) {
      showBanner("Failed to seed sample assignments.", true);
      return;
    }
    const data = await res.json();
    state.assignments = data.assignments || [];
    state.sampleSubmissions = data.sample_submissions || {};
    if (state.assignments.length > 0) {
      selectAssignment(state.assignments[0].id);
    }
    showBanner("Sample assignments seeded and ready.");
  }

  function loadSampleSubmissionForActiveAssignment() {
    if (!state.activeAssignmentId) {
      showBanner("Please select or seed an assignment first.", true);
      return;
    }
    const sample =
      state.sampleSubmissions[state.activeAssignmentId] ||
      Object.values(state.sampleSubmissions)[0];
    if (!sample) {
      showBanner(
        "No sample submission tied to this custom assignment. Select a seeded sample assignment first.",
        true
      );
      return;
    }
    el("student-name-input").value = sample.student_name || "Sample Student";
    el("student-id-input").value = sample.student_id || "STU-1001";
    el("submission-filename-input").value =
      sample.submission_filename || "sample_submission.py";
    el("submission-text-input").value = sample.submission_text || "";
    state.submissionPdfBase64 = null;
    const badge = el("ingested-file-badge");
    if (badge) {
      badge.textContent = `Loaded sample: ${sample.submission_filename}`;
      badge.classList.remove("hidden");
    }
    showBanner(`Loaded sample submission for ${sample.student_name}.`);
  }

  async function deleteAssignment(assignmentId) {
    const res = await fetch(`/api/assignments/${encodeURIComponent(assignmentId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      showBanner("Could not delete assignment.", true);
      return;
    }
    state.assignments = state.assignments.filter((a) => a.id !== assignmentId);
    if (state.activeAssignmentId === assignmentId) {
      state.activeAssignmentId = state.assignments[0]?.id || null;
    }
    selectAssignment(state.activeAssignmentId);
    await fetchEvaluations();
  }

  async function loadEvaluationById(evaluationId) {
    const res = await fetch(`/api/evaluations/${encodeURIComponent(evaluationId)}`);
    if (!res.ok) {
      showBanner("Could not load evaluation details.", true);
      return;
    }
    const record = await res.json();
    if (record.assignment_id && record.assignment_id !== state.activeAssignmentId) {
      const exists = state.assignments.some((a) => a.id === record.assignment_id);
      if (exists) selectAssignment(record.assignment_id);
    }
    resetPipelineStepper(record.status === "completed" ? `Completed (${record.duration_ms} ms)` : record.status);
    if (record.status === "completed") {
      for (const stage of STAGES) {
        updateStageState(stage, "complete", "done");
      }
    }
    renderFullEvaluationRecord(record);
  }

  async function ingestFileToTarget(file, onLoaded) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/ingest-file", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.detail || "File ingestion failed.", true);
      return;
    }
    onLoaded(data);
  }

  async function handleRunEvaluation(evt) {
    evt.preventDefault();
    hideBanner();

    if (!state.activeAssignmentId) {
      showBanner("Please select or create an assignment before running an evaluation.", true);
      return;
    }

    const submissionText = el("submission-text-input").value.trim();
    if (!submissionText) {
      showBanner("Submission text cannot be empty.", true);
      return;
    }

    const runBtn = el("run-eval-btn");
    runBtn.disabled = true;

    resetPipelineStepper("Running...");
    state.livePartial = { rubric: null, initialEval: null, reflection: null, feedback: null };

    const payload = {
      assignment_id: state.activeAssignmentId,
      student_name: el("student-name-input").value.trim() || "Anonymous Student",
      student_id: el("student-id-input").value.trim(),
      submission_filename: el("submission-filename-input").value.trim() || "submission.txt",
      submission_text: submissionText,
      force_reparse_rubric: Boolean(el("force-reparse-checkbox").checked),
      pdf_base64: state.submissionPdfBase64,
    };

    try {
      const res = await fetch("/api/evaluate/stream", {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const block of parts) {
          const lines = block.trim().split("\n");
          let eventType = "message";
          let dataStr = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataStr += line.slice(5).trim();
            }
          }
          if (!dataStr) continue;
          const eventData = JSON.parse(dataStr);
          handleSseEvent(eventType, eventData);
        }
      }

      await fetchEvaluations();
    } catch (err) {
      showBanner(`Evaluation failed: ${err.message || err}`, true);
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = "Failed";
        overall.className = "text-xs font-mono px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800";
      }
    } finally {
      runBtn.disabled = false;
    }
  }

  function handleSseEvent(eventType, data) {
    if (eventType === "agent_start") {
      updateStageState(data.agent, "running");
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = `Running: ${data.label || data.agent}`;
        overall.className =
          "text-xs font-mono px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800";
      }
      return;
    }

    if (eventType === "agent_complete") {
      const tag = data.cached ? `cached (${data.duration_ms}ms)` : `${data.duration_ms}ms`;
      updateStageState(data.agent, "complete", tag);

      if (data.agent === "rubric_parser" && data.output) {
        state.livePartial.rubric = data.output;
        const active = state.assignments.find((a) => a.id === state.activeAssignmentId);
        if (active) {
          active.structured_rubric = data.output;
          renderStructuredRubric(data.output);
          renderAssignmentsList();
        }
      } else if (data.agent === "cot_evaluator" && data.output) {
        state.livePartial.initialEval = data.output;
        renderCriteriaTab(state.livePartial.initialEval, null);
      } else if (data.agent === "reflection_auditor" && data.output) {
        state.livePartial.reflection = data.output;
        renderCriteriaTab(state.livePartial.initialEval, state.livePartial.reflection);
        renderReflectionTab(state.livePartial.reflection);
      } else if (data.agent === "feedback_synthesizer" && data.output) {
        state.livePartial.feedback = data.output;
        renderFeedbackTab(state.livePartial.feedback);
      }
      return;
    }

    if (eventType === "evaluation_complete") {
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = `Completed in ${data.duration_ms} ms`;
        overall.className =
          "text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800";
      }
      renderFullEvaluationRecord(data);
      return;
    }

    if (eventType === "agent_error") {
      showBanner(`Agent Pipeline Error: ${data.message}`, true);
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = "Error";
        overall.className =
          "text-xs font-mono px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800";
      }
    }
  }

  function setupTabs() {
    const buttons = document.querySelectorAll(".report-tab-btn");
    const panels = {
      feedback: el("tab-panel-feedback"),
      criteria: el("tab-panel-criteria"),
      reflection: el("tab-panel-reflection"),
      export: el("tab-panel-export"),
    };

    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.getAttribute("data-tab");
        buttons.forEach((b) => {
          const active = b.getAttribute("data-tab") === target;
          b.className = active
            ? "report-tab-btn px-3 py-2 text-xs font-semibold rounded-t-lg border-b-2 border-indigo-600 text-indigo-700 bg-white"
            : "report-tab-btn px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 border-transparent text-slate-600 hover:text-slate-900";
        });
        Object.entries(panels).forEach(([key, panel]) => {
          if (!panel) return;
          if (key === target) {
            panel.classList.remove("hidden");
          } else {
            panel.classList.add("hidden");
          }
        });
      });
    });
  }

  function setupEventListeners() {
    el("status-banner-close")?.addEventListener("click", hideBanner);
    el("seed-btn")?.addEventListener("click", seedAssignments);
    el("load-sample-btn")?.addEventListener("click", loadSampleSubmissionForActiveAssignment);
    el("refresh-history-btn")?.addEventListener("click", fetchEvaluations);
    el("evaluate-form")?.addEventListener("submit", handleRunEvaluation);

    // Clear cached PDF bytes if user manually edits submission text
    el("submission-text-input")?.addEventListener("input", () => {
      state.submissionPdfBase64 = null;
    });

    // Submission dropzone & file input
    const dropzone = el("submission-dropzone");
    const fileInput = el("submission-file-input");
    dropzone?.addEventListener("click", () => fileInput?.click());
    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("border-indigo-500", "bg-indigo-50/40");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("border-indigo-500", "bg-indigo-50/40");
    });
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-indigo-500", "bg-indigo-50/40");
      const file = e.dataTransfer?.files?.[0];
      if (file) handleStudentFileUpload(file);
    });
    fileInput?.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) handleStudentFileUpload(file);
    });

    // Re-parse rubric on active assignment
    el("reparse-rubric-btn")?.addEventListener("click", async () => {
      if (!state.activeAssignmentId) return;
      const btn = el("reparse-rubric-btn");
      btn.disabled = true;
      btn.textContent = "Parsing...";
      try {
        const res = await fetch(
          `/api/assignments/${encodeURIComponent(state.activeAssignmentId)}/parse-rubric`,
          {
            method: "POST",
            headers: buildHeaders(),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          showBanner(data.detail || "Failed to parse rubric.", true);
          return;
        }
        const idx = state.assignments.findIndex((a) => a.id === data.id);
        if (idx >= 0) state.assignments[idx] = data;
        selectAssignment(data.id);
        showBanner("Structured rubric parsed and saved.");
      } finally {
        btn.disabled = false;
        btn.textContent = "Parse / Refresh Rubric";
      }
    });

    // New assignment modal
    const modal = el("new-assignment-modal");
    const openModal = () => modal?.classList.remove("hidden");
    const closeModal = () => modal?.classList.add("hidden");
    el("open-new-assignment-btn")?.addEventListener("click", openModal);
    el("close-new-assignment-btn")?.addEventListener("click", closeModal);
    el("cancel-new-assignment-btn")?.addEventListener("click", closeModal);

    el("new-assign-prompt-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        ingestFileToTarget(file, (doc) => {
          el("new-assign-prompt").value = doc.extracted_text;
        });
      }
    });

    el("new-assign-rubric-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) {
        ingestFileToTarget(file, (doc) => {
          el("new-assign-rubric").value = doc.extracted_text;
        });
      }
    });

    el("new-assignment-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = el("submit-new-assignment-btn");
      submitBtn.disabled = true;
      try {
        const body = {
          title: el("new-assign-title").value.trim(),
          assignment_type: el("new-assign-type").value,
          prompt_text: el("new-assign-prompt").value.trim(),
          raw_rubric_text: el("new-assign-rubric").value.trim(),
          reference_solution_text: el("new-assign-reference").value.trim(),
          parse_rubric_now: Boolean(el("new-assign-parse-now").checked),
        };
        const res = await fetch("/api/assignments", {
          method: "POST",
          headers: buildHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(body),
        });
        const created = await res.json();
        if (!res.ok) {
          showBanner(created.detail || "Failed to create assignment.", true);
          return;
        }
        state.assignments.unshift(created);
        selectAssignment(created.id);
        e.target.reset();
        closeModal();
        showBanner(`Created assignment "${created.title}".`);
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function handleStudentFileUpload(file) {
    ingestFileToTarget(file, (doc) => {
      el("submission-filename-input").value = doc.filename;
      el("submission-text-input").value = doc.extracted_text;
      state.submissionPdfBase64 = doc.has_raw_pdf ? doc.pdf_base64 || null : null;
      const badge = el("ingested-file-badge");
      if (badge) {
        badge.textContent = `${doc.filename} (${doc.file_type}${
          doc.has_raw_pdf ? ", multimodal PDF" : ""
        })`;
        badge.classList.remove("hidden");
      }
      showBanner(`Ingested file "${doc.filename}" (${doc.file_type}).`);
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    setupTabs();
    setupEventListeners();
    await fetchHealth();
    await fetchAssignmentsAndSeedIfNeeded();
    await fetchEvaluations();
  });
})();
