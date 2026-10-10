(() => {
  "use strict";

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

  const STAGES = [
    "rubric_parser",
    "cot_evaluator",
    "reflection_auditor",
    "feedback_synthesizer",
  ];

  const el = (id) => document.getElementById(id);

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function showBanner(message, isError = false) {
    const wrapper = el("status-banner");
    const inner = el("status-banner-inner");
    const text = el("status-banner-text");
    if (!wrapper || !inner || !text) return;

    text.textContent = message;
    wrapper.classList.remove("hidden");
    if (isError) {
      inner.className =
        "rounded-2xl px-5 py-3.5 text-xs sm:text-sm flex items-center justify-between border bg-rose-50 border-rose-200 text-rose-900 shadow-xs animate-reveal";
    } else {
      inner.className =
        "rounded-2xl px-5 py-3.5 text-xs sm:text-sm flex items-center justify-between border bg-emerald-50 border-emerald-200 text-emerald-900 shadow-xs animate-reveal";
    }
  }

  function hideBanner() {
    const wrapper = el("status-banner");
    if (wrapper) wrapper.classList.add("hidden");
  }

  function buildHeaders(extra = {}) {
    const headers = { ...extra };
    const apiKey = el("api-key-input")?.value.trim();
    const model = el("model-select")?.value.trim();
    if (apiKey) headers["X-Gemini-Key"] = apiKey;
    if (model) headers["X-Gemini-Model"] = model;
    return headers;
  }

  function formatDelta(delta) {
    const num = Number(delta || 0);
    if (Math.abs(num) < 1e-6) return "0.0";
    return num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1);
  }

  function resetPipelineStepper(statusLabel = "Idle · Ready") {
    const overall = el("pipeline-overall-status");
    if (overall) {
      overall.textContent = statusLabel;
      overall.className =
        "text-xs font-mono font-medium px-3.5 py-1.5 rounded-full bg-canvas-subtle text-ink-secondary tabular-nums border border-black/[0.06]";
    }
    for (const stage of STAGES) {
      const card = el(`stage-${stage}`);
      if (!card) continue;
      card.className =
        "stage-card border border-black/[0.08] rounded-2xl p-4 bg-canvas/60 transition-all duration-300";
      const ind = card.querySelector(".stage-indicator");
      if (ind) {
        ind.innerHTML = `<span class="text-ink-muted">waiting</span>`;
        ind.className = "stage-indicator text-[11px] font-mono text-ink-muted tabular-nums";
      }
    }
  }

  function updateStageState(stageName, mode, extraText = "") {
    const card = el(`stage-${stageName}`);
    if (!card) return;
    const ind = card.querySelector(".stage-indicator");

    if (mode === "running") {
      card.className =
        "stage-card border-2 border-indigo-600 rounded-2xl p-4 bg-indigo-50/40 stage-running-glow transition-all duration-300";
      if (ind) {
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1.5 text-indigo-700 font-semibold">
            <span class="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
            <span>running...</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums";
      }
    } else if (mode === "complete") {
      card.className =
        "stage-card border border-emerald-300/90 rounded-2xl p-4 bg-emerald-50/35 transition-all duration-300";
      if (ind) {
        const label = escapeHtml(extraText || "done");
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1 text-emerald-800 font-semibold">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path class="svg-check-draw" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>${label}</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums";
      }
    } else if (mode === "error") {
      card.className =
        "stage-card border-2 border-rose-400 rounded-2xl p-4 bg-rose-50/50 transition-all duration-300";
      if (ind) {
        ind.textContent = "error";
        ind.className = "stage-indicator text-[11px] font-mono text-rose-700 font-semibold";
      }
    }
  }

  function renderStructuredRubric(rubric) {
    const container = el("structured-rubric-view");
    if (!container) return;

    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      container.innerHTML = `<p class="text-ink-muted italic py-2">No structured rubric cached yet. Click "Parse / Refresh Rubric" above or run an evaluation to parse automatically.</p>`;
      return;
    }

    const criteriaHtml = rubric.criteria
      .map((c) => {
        const bandsHtml = (c.scoring_bands || [])
          .map(
            (b) =>
              `<span class="inline-block bg-canvas border border-black/[0.08] rounded-md px-2 py-0.5 text-[10px] font-mono text-ink-secondary">${escapeHtml(
                b.band_label
              )}: ${escapeHtml(b.points_range)}</span>`
          )
          .join(" ");
        return `
        <div class="border border-black/[0.07] rounded-xl p-3 bg-[#FAF8F5]/60 space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold text-ink">${escapeHtml(c.criterion_id)} · ${escapeHtml(
          c.title
        )}</span>
            <span class="font-mono font-semibold text-indigo-700 text-[11px] tabular-nums">${Number(
              c.max_points
            ).toFixed(1)} pts</span>
          </div>
          <p class="text-ink-secondary text-[11px] leading-relaxed">${escapeHtml(c.description)}</p>
          <div class="flex flex-wrap gap-1 pt-0.5">${bandsHtml}</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = `
      <div class="flex items-center justify-between text-xs font-semibold text-ink pb-2 mb-2 border-b border-black/[0.07]">
        <span>${escapeHtml(rubric.assignment_title || "Parsed Rubric")}</span>
        <span class="font-mono text-indigo-700 tabular-nums">Total: ${Number(
          rubric.total_points || 0
        ).toFixed(1)} pts</span>
      </div>
      <div class="space-y-2">${criteriaHtml}</div>
    `;
  }

  function renderAssignmentsList() {
    const container = el("assignments-list");
    if (!container) return;

    if (state.assignments.length === 0) {
      container.innerHTML = `<div class="text-xs text-ink-muted py-6 text-center">No assignments found. Click "Reset Demos" above to load samples.</div>`;
      return;
    }

    container.innerHTML = state.assignments
      .map((a) => {
        const isSelected = a.id === state.activeAssignmentId;
        const typeBadge =
          a.assignment_type === "code"
            ? "bg-indigo-50 text-indigo-700 border-indigo-200/70"
            : a.assignment_type === "theory"
            ? "bg-amber-50 text-amber-800 border-amber-200/70"
            : "bg-teal-50 text-teal-800 border-teal-200/70";
        const rubricStatus = a.structured_rubric ? "Rubric Ready" : "Raw Rubric";

        return `
        <div
          data-assignment-id="${escapeHtml(a.id)}"
          class="assign-card-item rounded-2xl p-3.5 cursor-pointer transition-all flex items-start justify-between gap-3 border ${
            isSelected
              ? "bg-indigo-50/50 border-indigo-600 shadow-2xs"
              : "bg-white border-black/[0.08] hover:bg-canvas/60"
          }"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full shrink-0 ${
                isSelected ? "bg-indigo-600" : "bg-stone-300"
              }"></span>
              <div class="text-xs font-semibold text-ink truncate">${escapeHtml(a.title)}</div>
            </div>
            <div class="flex items-center gap-2 mt-1.5 pl-4">
              <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md border ${typeBadge}">${escapeHtml(
          a.assignment_type
        )}</span>
              <span class="text-[11px] font-mono text-ink-muted">${rubricStatus}</span>
            </div>
          </div>
          <button
            type="button"
            data-delete-assignment="${escapeHtml(a.id)}"
            title="Delete assignment"
            class="text-ink-muted hover:text-rose-600 text-sm px-1.5 py-0.5 rounded-lg leading-none transition-colors"
          >
            &times;
          </button>
        </div>
      `;
      })
      .join("");

    container.querySelectorAll(".assign-card-item").forEach((row) => {
      row.addEventListener("click", (e) => {
        const delBtn = e.target.closest("[data-delete-assignment]");
        if (delBtn) return;
        const id = row.getAttribute("data-assignment-id");
        selectAssignment(id);
      });
    });

    container.querySelectorAll("[data-delete-assignment]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute("data-delete-assignment");
        if (!id) return;
        await deleteAssignment(id);
      });
    });
  }

  function selectAssignment(assignmentId) {
    state.activeAssignmentId = assignmentId;
    const active = state.assignments.find((a) => a.id === assignmentId) || null;
    renderAssignmentsList();

    const titleEl = el("assignment-detail-title");
    const typeBadgeEl = el("assignment-type-badge");
    const promptEl = el("assignment-prompt-view");
    const refEl = el("assignment-reference-view");

    if (!active) {
      if (titleEl) titleEl.textContent = "Select an Assignment";
      if (typeBadgeEl) typeBadgeEl.textContent = "--";
      if (promptEl) promptEl.textContent = "No assignment selected.";
      if (refEl) refEl.textContent = "No reference solution.";
      renderStructuredRubric(null);
      return;
    }

    if (titleEl) titleEl.textContent = active.title;
    if (typeBadgeEl) typeBadgeEl.textContent = active.assignment_type;
    if (promptEl) promptEl.textContent = active.prompt_text || "";
    if (refEl) {
      refEl.textContent =
        active.reference_solution_text || "No reference solution provided.";
    }
    renderStructuredRubric(active.structured_rubric);
  }

  function renderEvaluationsHistory() {
    const container = el("evaluations-history-list");
    const countBadge = el("history-count-badge");
    if (countBadge) {
      countBadge.textContent = String(state.evaluations.length || 0);
    }
    if (!container) return;

    if (state.evaluations.length === 0) {
      container.innerHTML = `<div class="text-xs text-ink-muted py-10 text-center">No evaluations recorded yet. Run your first 4-agent evaluation to populate the archive.</div>`;
      return;
    }

    container.innerHTML = state.evaluations
      .map((ev) => {
        const isSelected = state.activeEvaluation && state.activeEvaluation.id === ev.id;
        const statusColor =
          ev.status === "completed"
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : ev.status === "failed"
            ? "bg-rose-50 text-rose-800 border-rose-200"
            : "bg-amber-50 text-amber-800 border-amber-200";
        return `
        <div
          data-eval-id="${escapeHtml(ev.id)}"
          class="eval-history-row rounded-2xl p-4 cursor-pointer transition-all flex items-center justify-between gap-3 border ${
            isSelected
              ? "bg-indigo-50/70 border-indigo-600 shadow-2xs"
              : "bg-white border-black/[0.07] hover:border-indigo-300"
          }"
        >
          <div class="min-w-0">
            <div class="text-xs font-semibold text-ink truncate">
              ${escapeHtml(ev.student_name)}
              <span class="text-ink-muted font-normal">${
                ev.student_id ? `(${escapeHtml(ev.student_id)})` : ""
              }</span>
            </div>
            <div class="text-[11px] text-ink-secondary truncate font-mono mt-0.5">${escapeHtml(
              ev.submission_filename
            )}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[11px] font-mono font-semibold px-2.5 py-1 rounded-lg border tabular-nums ${statusColor}">
              ${
                ev.status === "completed"
                  ? `${Number(ev.total_final_score).toFixed(1)}/${Number(
                      ev.max_possible_score
                    ).toFixed(0)} · ${escapeHtml(ev.letter_grade)}`
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
        el("history-drawer-modal")?.classList.add("hidden");
      });
    });
  }

  function renderFeedbackTab(feedback) {
    const panel = el("tab-panel-feedback");
    if (!panel) return;
    if (!feedback) {
      panel.innerHTML = `<p class="text-ink-muted text-center py-12 text-xs">No pedagogical feedback available for this evaluation.</p>`;
      return;
    }

    const strengthsHtml = (feedback.key_strengths || [])
      .map(
        (s) => `
        <li class="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50/50 border border-emerald-200/60">
          <span class="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs shrink-0 mt-0.5">&check;</span>
          <span class="text-ink text-xs leading-relaxed">${escapeHtml(s)}</span>
        </li>`
      )
      .join("");

    const gapsHtml = (feedback.learning_gaps || [])
      .map(
        (g, idx) => `
        <div class="border border-black/[0.08] rounded-2xl p-5 bg-[#FAF8F5] space-y-3 animate-reveal" style="--stagger: ${idx}">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900">
              Gap 0${idx + 1}
            </span>
            <h5 class="font-editorial text-xl text-ink">${escapeHtml(g.concept_or_skill)}</h5>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div class="bg-white p-3.5 rounded-xl border border-black/[0.06]">
              <div class="font-mono text-[10px] uppercase tracking-wider text-rose-700 font-semibold mb-1">
                Observed Issue
              </div>
              <p class="text-ink-secondary leading-relaxed">${escapeHtml(g.observed_issue)}</p>
            </div>
            <div class="bg-white p-3.5 rounded-xl border border-black/[0.06]">
              <div class="font-mono text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">
                Actionable Fix
              </div>
              <p class="text-ink-secondary leading-relaxed">${escapeHtml(g.actionable_fix)}</p>
            </div>
          </div>
          <div class="space-y-1">
            <div class="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
              Conceptual Hint / Exemplar Snippet
            </div>
            <pre class="bg-[#141413] text-stone-100 font-mono text-[11px] p-4 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed">${escapeHtml(
              g.example_or_hint
            )}</pre>
          </div>
        </div>
      `
      )
      .join("");

    const roadmapHtml = (feedback.revision_roadmap || [])
      .map(
        (step, idx) =>
          `<li class="flex items-start gap-3 p-3 rounded-xl bg-canvas border border-black/[0.06]">
            <span class="font-editorial text-lg leading-none w-6 h-6 rounded-full bg-ink text-white flex items-center justify-center shrink-0">${
              idx + 1
            }</span>
            <span class="text-xs text-ink leading-relaxed pt-0.5">${escapeHtml(step)}</span>
          </li>`
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-7 tab-content-enter">
        <div class="bg-indigo-50/60 border border-indigo-200/80 rounded-2xl p-5 space-y-1.5">
          <div class="text-[10px] font-mono font-semibold uppercase tracking-widest text-indigo-800">
            Executive Assessment Summary
          </div>
          <p class="text-ink text-sm leading-relaxed">${escapeHtml(feedback.executive_summary)}</p>
        </div>

        <div class="space-y-2.5">
          <h4 class="font-editorial text-2xl text-ink">Demonstrated Strengths</h4>
          <ul class="grid grid-cols-1 gap-2">${
            strengthsHtml || "<li class='text-xs text-ink-muted'>None noted.</li>"
          }</ul>
        </div>

        <div class="space-y-3">
          <h4 class="font-editorial text-2xl text-ink">Targeted Learning Gaps &amp; Coaching</h4>
          <div class="space-y-4">${
            gapsHtml ||
            "<p class='text-xs text-ink-muted'>No major learning gaps identified.</p>"
          }</div>
        </div>

        <div class="space-y-2.5">
          <h4 class="font-editorial text-2xl text-ink">Priority Revision Roadmap</h4>
          <ol class="space-y-2">${roadmapHtml}</ol>
        </div>

        <blockquote class="border-l-4 border-emerald-600 bg-emerald-50/60 px-5 py-4 text-emerald-950 font-editorial text-xl italic rounded-r-2xl">
          &ldquo;${escapeHtml(feedback.encouraging_closing)}&rdquo;
        </blockquote>
      </div>
    `;
  }

  function renderCriteriaTab(initialEval, reflectionAudit) {
    const panel = el("tab-panel-criteria");
    if (!panel) return;
    if (!initialEval || !Array.isArray(initialEval.criterion_evaluations)) {
      panel.innerHTML = `<p class="text-ink-muted text-center py-12 text-xs">No criterion evaluations available.</p>`;
      return;
    }

    const auditsById = {};
    if (reflectionAudit && Array.isArray(reflectionAudit.criterion_audits)) {
      for (const a of reflectionAudit.criterion_audits) {
        auditsById[String(a.criterion_id).trim()] = a;
      }
    }

    const cardsHtml = initialEval.criterion_evaluations
      .map((ce, idx) => {
        const audit = auditsById[String(ce.criterion_id).trim()];
        const finalScore = audit ? audit.calibrated_score : ce.initial_score;
        const verdict = audit ? audit.audit_verdict : "verified";
        const pct =
          ce.max_points > 0 ? Math.min(100, Math.max(0, (finalScore / ce.max_points) * 100)) : 0;

        const quotesHtml = (ce.student_evidence_quotes || [])
          .map(
            (q) =>
              `<pre class="bg-[#141413] text-amber-200/95 font-mono text-[11px] p-3.5 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed">${escapeHtml(
                q
              )}</pre>`
          )
          .join("");

        const strengthsHtml = (ce.strengths_observed || [])
          .map((s) => `<li class="leading-relaxed">&bull; ${escapeHtml(s)}</li>`)
          .join("");

        const flawsHtml = (ce.flaws_or_gaps_observed || [])
          .map((f) => `<li class="leading-relaxed">&bull; ${escapeHtml(f)}</li>`)
          .join("");

        return `
        <div class="border border-black/[0.08] rounded-2xl p-5 space-y-4 bg-[#FAF8F5]/70 animate-reveal" style="--stagger: ${idx}">
          <div class="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.07] pb-3">
            <div>
              <span class="font-mono text-[11px] text-indigo-700 font-semibold">${escapeHtml(
                ce.criterion_id
              )}</span>
              <h5 class="font-editorial text-2xl text-ink leading-snug">${escapeHtml(
                ce.criterion_title
              )}</h5>
            </div>
            <div class="flex items-center gap-2 font-mono text-xs tabular-nums">
              <span class="px-2.5 py-1 rounded-lg bg-white border border-black/[0.08] text-ink-secondary">Init: ${Number(
                ce.initial_score
              ).toFixed(1)}</span>
              <span class="text-ink-muted">&rarr;</span>
              <span class="px-3 py-1 rounded-lg bg-ink text-white font-semibold">Final: ${Number(
                finalScore
              ).toFixed(1)} / ${Number(ce.max_points).toFixed(1)}</span>
              <span class="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-800 border border-indigo-200/70 text-[11px]">${escapeHtml(
                verdict
              )}</span>
            </div>
          </div>

          <!-- Score Bar -->
          <div class="w-full h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
            <div class="h-full bg-indigo-600 rounded-full transition-all duration-500" style="width: ${pct.toFixed(
              1
            )}%"></div>
          </div>

          <p class="text-ink text-xs leading-relaxed"><strong class="font-semibold">Scoring Rationale:</strong> ${escapeHtml(
            ce.rationale
          )}</p>

          <div class="bg-white border-l-4 border-indigo-600 p-4 rounded-r-xl border border-black/[0.06] space-y-1.5">
            <div class="text-[10px] font-mono font-semibold uppercase tracking-widest text-indigo-800">
              Chain-of-Thought Verification Trace
            </div>
            <p class="text-ink-secondary font-mono text-[11px] whitespace-pre-wrap leading-relaxed">${escapeHtml(
              ce.chain_of_thought_trace
            )}</p>
          </div>

          ${
            quotesHtml
              ? `<div class="space-y-1.5"><div class="text-[10px] font-mono font-semibold uppercase tracking-wider text-ink-muted">Verbatim Student Evidence</div>${quotesHtml}</div>`
              : ""
          }

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs">
            <div class="bg-emerald-50/60 border border-emerald-200/70 rounded-xl p-3.5">
              <div class="text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-800 mb-1.5">Strengths Observed</div>
              <ul class="text-emerald-950 space-y-1">${strengthsHtml || "<li>None noted</li>"}</ul>
            </div>
            <div class="bg-rose-50/60 border border-rose-200/70 rounded-xl p-3.5">
              <div class="text-[10px] font-mono font-semibold uppercase tracking-wider text-rose-800 mb-1.5">Flaws / Gaps Observed</div>
              <ul class="text-rose-950 space-y-1">${flawsHtml || "<li>None noted</li>"}</ul>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    panel.innerHTML = `
      <div class="space-y-5 tab-content-enter">
        <div class="bg-canvas border border-black/[0.07] rounded-2xl p-4 text-xs leading-relaxed">
          <span class="font-mono uppercase text-[10px] tracking-wider text-indigo-700 font-semibold block mb-1">
            Overall Comprehension Summary (${escapeHtml(initialEval.submission_modality)})
          </span>
          <span class="text-ink">${escapeHtml(initialEval.overall_comprehension_summary)}</span>
        </div>
        ${cardsHtml}
      </div>
    `;
  }

  function renderReflectionTab(reflectionAudit) {
    const panel = el("tab-panel-reflection");
    if (!panel) return;
    if (!reflectionAudit) {
      panel.innerHTML = `<p class="text-ink-muted text-center py-12 text-xs">No reflection audit log available.</p>`;
      return;
    }

    const checksHtml = (reflectionAudit.bias_checks_performed || [])
      .map(
        (c) =>
          `<li class="flex items-center gap-2 text-xs text-ink bg-canvas px-3 py-2 rounded-xl border border-black/[0.06]"><span class="w-1.5 h-1.5 rounded-full bg-indigo-600"></span><span>${escapeHtml(
            c
          )}</span></li>`
      )
      .join("");

    const rowsHtml = (reflectionAudit.criterion_audits || [])
      .map(
        (ca) => `
        <tr class="border-t border-black/[0.07] hover:bg-canvas/50">
          <td class="py-3 px-3 font-mono font-semibold text-ink">${escapeHtml(ca.criterion_id)}</td>
          <td class="py-3 px-3 font-mono tabular-nums">${Number(ca.initial_score).toFixed(1)}</td>
          <td class="py-3 px-3 font-mono font-semibold text-indigo-700 tabular-nums">${Number(
            ca.calibrated_score
          ).toFixed(1)}</td>
          <td class="py-3 px-3 font-mono tabular-nums">${escapeHtml(
            formatDelta(ca.adjustment_delta)
          )}</td>
          <td class="py-3 px-3"><span class="font-mono text-[10px] px-2 py-0.5 rounded-md bg-canvas border border-black/10">${escapeHtml(
            ca.audit_verdict
          )}</span></td>
          <td class="py-3 px-3 text-ink-secondary">${escapeHtml(ca.bias_or_error_detected)}</td>
          <td class="py-3 px-3 text-ink-secondary">${escapeHtml(ca.calibration_reasoning)}</td>
        </tr>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-6 tab-content-enter">
        <div class="bg-canvas border border-black/[0.07] rounded-2xl p-5 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-editorial text-2xl text-ink">Meta-Evaluator Audit Verdict</span>
            <span class="font-mono text-xs px-3 py-1 rounded-full bg-indigo-100 text-indigo-900 font-semibold">${escapeHtml(
              reflectionAudit.audit_status
            )}</span>
          </div>
          <p class="text-xs text-ink-secondary leading-relaxed">${escapeHtml(
            reflectionAudit.overall_audit_summary
          )}</p>
        </div>

        <div class="space-y-2.5">
          <h4 class="text-[11px] font-mono font-semibold uppercase tracking-widest text-ink-secondary">
            Bias &amp; Calibration Checks Executed
          </h4>
          <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">${checksHtml}</ul>
        </div>

        <div class="overflow-x-auto border border-black/[0.08] rounded-2xl bg-white">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-canvas text-ink-secondary font-mono text-[10px] uppercase tracking-wider">
              <tr>
                <th class="py-3 px-3">ID</th>
                <th class="py-3 px-3">Initial</th>
                <th class="py-3 px-3">Calibrated</th>
                <th class="py-3 px-3">Delta</th>
                <th class="py-3 px-3">Verdict</th>
                <th class="py-3 px-3">Bias / Error Check</th>
                <th class="py-3 px-3">Calibration Reasoning</th>
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
      const pill = el("active-model-pill");
      if (pill) pill.textContent = select.value;
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
    showBanner("Sample benchmark assignments seeded and ready.");
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
    showBanner(
      `Loaded sample submission for ${sample.student_name}. Click "Run 4-Agent Evaluation" to begin.`
    );
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
    resetPipelineStepper(
      record.status === "completed"
        ? `Completed (${record.duration_ms} ms)`
        : record.status
    );
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
      showBanner(
        "Submission text cannot be empty. Click 'Auto-Fill Sample Submission' or drop a file first.",
        true
      );
      return;
    }

    const runBtn = el("run-eval-btn");
    runBtn.disabled = true;

    resetPipelineStepper("Running 4-Agent Pipeline...");
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
        overall.className =
          "text-xs font-mono font-semibold px-3.5 py-1.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200";
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
          "text-xs font-mono font-semibold px-3.5 py-1.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200";
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
          "text-xs font-mono font-semibold px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 tabular-nums";
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
          "text-xs font-mono font-semibold px-3.5 py-1.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200";
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
            ? "report-tab-btn btn-tactile px-4 py-2.5 text-xs font-semibold rounded-t-xl border-b-2 border-indigo-600 text-indigo-900 bg-white shadow-2xs"
            : "report-tab-btn btn-tactile px-4 py-2.5 text-xs font-medium rounded-t-xl border-b-2 border-transparent text-ink-secondary hover:text-ink";
        });
        Object.entries(panels).forEach(([key, panel]) => {
          if (!panel) return;
          if (key === target) {
            panel.classList.remove("hidden");
            panel.classList.remove("tab-content-enter");
            void panel.offsetWidth;
            panel.classList.add("tab-content-enter");
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

    // Settings popover
    const settingsPopover = el("settings-popover");
    el("toggle-settings-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsPopover?.classList.toggle("hidden");
    });
    el("close-settings-btn")?.addEventListener("click", () => {
      settingsPopover?.classList.add("hidden");
    });
    document.addEventListener("click", (e) => {
      if (
        settingsPopover &&
        !settingsPopover.classList.contains("hidden") &&
        !settingsPopover.contains(e.target) &&
        !el("toggle-settings-btn")?.contains(e.target)
      ) {
        settingsPopover.classList.add("hidden");
      }
    });
    el("model-select")?.addEventListener("change", (e) => {
      const pill = el("active-model-pill");
      if (pill) pill.textContent = e.target.value;
    });

    // History slide-over drawer
    const historyDrawer = el("history-drawer-modal");
    const openHistory = () => historyDrawer?.classList.remove("hidden");
    const closeHistory = () => historyDrawer?.classList.add("hidden");
    el("open-history-drawer-btn")?.addEventListener("click", openHistory);
    el("close-history-drawer-btn")?.addEventListener("click", closeHistory);
    el("history-drawer-backdrop")?.addEventListener("click", closeHistory);

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
      dropzone.classList.add("border-indigo-600", "bg-indigo-50/40");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("border-indigo-600", "bg-indigo-50/40");
    });
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-indigo-600", "bg-indigo-50/40");
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
        showBanner("Structured rubric parsed and cached.");
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
