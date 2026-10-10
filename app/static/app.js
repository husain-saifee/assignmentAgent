(() => {
  "use strict";

  const state = {
    activeStep: 1,
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

  function switchStep(stepNumber) {
    state.activeStep = Number(stepNumber);
    [1, 2, 3].forEach((n) => {
      const view = el(`view-step-${n}`);
      if (!view) return;
      if (n === state.activeStep) {
        view.classList.remove("hidden");
        view.classList.remove("view-animate");
        void view.offsetWidth;
        view.classList.add("view-animate");
      } else {
        view.classList.add("hidden");
      }
    });

    document.querySelectorAll(".step-nav-btn").forEach((btn) => {
      const target = Number(btn.getAttribute("data-step-target"));
      if (target === state.activeStep) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });
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
        "rounded-xl px-5 py-3.5 text-sm font-semibold flex items-center justify-between border-2 bg-rose-50 border-rose-300 text-rose-900 shadow-sm";
    } else {
      inner.className =
        "rounded-xl px-5 py-3.5 text-sm font-semibold flex items-center justify-between border-2 bg-emerald-50 border-emerald-300 text-emerald-900 shadow-sm";
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
        "text-sm font-mono font-bold px-4 py-2 rounded-xl bg-slate-200 text-slate-800 border border-slate-300 tabular-nums";
    }
    for (const stage of STAGES) {
      const card = el(`stage-${stage}`);
      if (!card) continue;
      card.className =
        "stage-card border-2 border-slate-200 rounded-2xl p-5 bg-slate-50 transition-all";
      const ind = card.querySelector(".stage-indicator");
      if (ind) {
        ind.innerHTML = `<span class="text-slate-500">waiting</span>`;
        ind.className = "stage-indicator text-xs font-mono font-semibold text-slate-500 tabular-nums";
      }
    }
  }

  function updateStageState(stageName, mode, extraText = "") {
    const card = el(`stage-${stageName}`);
    if (!card) return;
    const ind = card.querySelector(".stage-indicator");

    if (mode === "running") {
      card.className =
        "stage-card border-2 border-blue-600 rounded-2xl p-5 bg-blue-50/70 stage-running transition-all";
      if (ind) {
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1.5 text-blue-700 font-bold">
            <span class="w-2.5 h-2.5 rounded-full bg-blue-600 animate-ping"></span>
            <span>running...</span>
          </span>
        `;
        ind.className = "stage-indicator text-xs font-mono tabular-nums";
      }
    } else if (mode === "complete") {
      card.className =
        "stage-card border-2 border-emerald-500 rounded-2xl p-5 bg-emerald-50/50 transition-all";
      if (ind) {
        const label = escapeHtml(extraText || "done");
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1.5 text-emerald-800 font-bold">
            <svg class="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.8">
              <path class="check-animated" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>${label}</span>
          </span>
        `;
        ind.className = "stage-indicator text-xs font-mono tabular-nums";
      }
    } else if (mode === "error") {
      card.className =
        "stage-card border-2 border-rose-500 rounded-2xl p-5 bg-rose-50 transition-all";
      if (ind) {
        ind.textContent = "error";
        ind.className = "stage-indicator text-xs font-mono text-rose-700 font-bold";
      }
    }
  }

  function renderStructuredRubric(rubric) {
    const container = el("structured-rubric-view");
    if (!container) return;

    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      container.innerHTML = `<div class="p-4 rounded-xl bg-slate-50 border-2 border-slate-200 text-sm text-slate-500">No structured rubric cached yet. Click <strong>Parse / Refresh Rubric</strong> above or run an evaluation to parse automatically.</div>`;
      return;
    }

    const criteriaHtml = rubric.criteria
      .map((c) => {
        const bandsHtml = (c.scoring_bands || [])
          .map(
            (b) =>
              `<span class="inline-block bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-mono font-medium text-slate-700">${escapeHtml(
                b.band_label
              )}: <strong>${escapeHtml(b.points_range)} pts</strong></span>`
          )
          .join(" ");
        return `
        <div class="border-2 border-slate-200 rounded-xl overflow-hidden bg-white">
          <div class="bg-slate-100 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2">
            <span class="font-display font-bold text-base text-slate-900">${escapeHtml(
              c.criterion_id
            )} · ${escapeHtml(c.title)}</span>
            <span class="font-mono font-bold text-xs px-2.5 py-1 rounded-md bg-blue-600 text-white tabular-nums">${Number(
              c.max_points
            ).toFixed(1)} pts</span>
          </div>
          <div class="p-4 space-y-2.5">
            <p class="text-slate-700 text-sm leading-relaxed">${escapeHtml(c.description)}</p>
            <div class="flex flex-wrap gap-1.5 pt-1">${bandsHtml}</div>
          </div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = `
      <div class="flex items-center justify-between bg-[#0B0F19] text-white px-4 py-3 rounded-xl mb-3">
        <span class="font-display font-bold text-sm">${escapeHtml(
          rubric.assignment_title || "Parsed Rubric"
        )}</span>
        <span class="font-mono font-bold text-xs px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 tabular-nums">Total: ${Number(
          rubric.total_points || 0
        ).toFixed(1)} pts</span>
      </div>
      <div class="space-y-3">${criteriaHtml}</div>
    `;
  }

  function renderAssignmentsList() {
    const container = el("assignments-list");
    if (!container) return;

    if (state.assignments.length === 0) {
      container.innerHTML = `<div class="text-sm text-slate-500 py-8 text-center">No assignments found. Click "Reset Demos" above to load samples.</div>`;
      return;
    }

    container.innerHTML = state.assignments
      .map((a) => {
        const isSelected = a.id === state.activeAssignmentId;
        const typeBadge =
          a.assignment_type === "code"
            ? "bg-blue-100 text-blue-800 border-blue-300"
            : a.assignment_type === "theory"
            ? "bg-amber-100 text-amber-900 border-amber-300"
            : "bg-teal-100 text-teal-900 border-teal-300";
        const rubricStatus = a.structured_rubric ? "✓ Rubric Parsed" : "Raw Rubric";

        return `
        <div
          data-assignment-id="${escapeHtml(a.id)}"
          class="assign-card-item rounded-xl p-4 cursor-pointer transition-all flex items-start justify-between gap-3 border-2 ${
            isSelected
              ? "bg-blue-50/80 border-blue-600 shadow-sm"
              : "bg-slate-50 border-slate-200 hover:border-slate-400 hover:bg-white"
          }"
        >
          <div class="min-w-0 flex-1 space-y-2">
            <div class="font-display font-bold text-base text-slate-900 leading-snug">
              ${escapeHtml(a.title)}
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-mono font-bold uppercase px-2.5 py-0.5 rounded-md border ${typeBadge}">
                ${escapeHtml(a.assignment_type)}
              </span>
              <span class="text-xs font-mono font-medium text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200">
                ${rubricStatus}
              </span>
            </div>
          </div>
          <button
            type="button"
            data-delete-assignment="${escapeHtml(a.id)}"
            title="Delete assignment"
            class="w-7 h-7 rounded-lg bg-white hover:bg-rose-100 text-slate-400 hover:text-rose-700 border border-slate-200 flex items-center justify-center font-bold text-base shrink-0"
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
    const step2Label = el("step2-active-assignment-label");

    if (!active) {
      if (titleEl) titleEl.textContent = "Select an Assignment";
      if (typeBadgeEl) typeBadgeEl.textContent = "--";
      if (promptEl) promptEl.textContent = "No assignment selected.";
      if (refEl) refEl.textContent = "No reference solution.";
      if (step2Label) step2Label.textContent = "No assignment selected";
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
    if (step2Label) {
      step2Label.textContent = `${active.title} (${active.assignment_type.toUpperCase()})`;
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
      container.innerHTML = `<div class="text-sm text-slate-500 py-10 text-center">No evaluations recorded yet.</div>`;
      return;
    }

    container.innerHTML = state.evaluations
      .map((ev) => {
        const isSelected = state.activeEvaluation && state.activeEvaluation.id === ev.id;
        const statusColor =
          ev.status === "completed"
            ? "bg-emerald-100 text-emerald-900 border-emerald-300"
            : ev.status === "failed"
            ? "bg-rose-100 text-rose-900 border-rose-300"
            : "bg-amber-100 text-amber-900 border-amber-300";
        return `
        <div
          data-eval-id="${escapeHtml(ev.id)}"
          class="eval-history-row rounded-xl p-4 cursor-pointer transition-all flex items-center justify-between gap-3 border-2 ${
            isSelected
              ? "bg-blue-50 border-blue-600 shadow-sm"
              : "bg-white border-slate-200 hover:border-slate-400"
          }"
        >
          <div class="min-w-0">
            <div class="font-display font-bold text-base text-slate-900 truncate">
              ${escapeHtml(ev.student_name)}
              <span class="text-slate-500 font-normal text-sm">${
                ev.student_id ? `(${escapeHtml(ev.student_id)})` : ""
              }</span>
            </div>
            <div class="text-xs text-slate-600 truncate font-mono mt-0.5">${escapeHtml(
              ev.submission_filename
            )}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-xs font-mono font-bold px-3 py-1.5 rounded-lg border tabular-nums ${statusColor}">
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
        el("history-drawer-modal")?.classList.add("hidden");
        switchStep(3);
      });
    });
  }

  function renderFeedbackTab(feedback) {
    const panel = el("tab-panel-feedback");
    if (!panel) return;
    if (!feedback) {
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-base">No pedagogical feedback available for this evaluation.</p>`;
      return;
    }

    const strengthsHtml = (feedback.key_strengths || [])
      .map(
        (s) => `
        <li class="flex items-start gap-3 p-4 rounded-xl bg-emerald-50/80 border-2 border-emerald-200">
          <span class="w-6 h-6 rounded-lg bg-emerald-600 text-white font-bold flex items-center justify-center text-sm shrink-0 mt-0.5">&check;</span>
          <span class="text-slate-900 text-sm font-medium leading-relaxed">${escapeHtml(s)}</span>
        </li>`
      )
      .join("");

    const gapsHtml = (feedback.learning_gaps || [])
      .map(
        (g, idx) => `
        <div class="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
          <div class="bg-slate-100 px-5 py-3.5 border-b-2 border-slate-200 flex items-center gap-3">
            <span class="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-blue-600 text-white">
              Gap 0${idx + 1}
            </span>
            <h5 class="font-display text-lg font-bold text-slate-900">${escapeHtml(
              g.concept_or_skill
            )}</h5>
          </div>
          <div class="p-5 space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="bg-rose-50/60 p-4 rounded-xl border-2 border-rose-200">
                <div class="font-mono text-xs uppercase font-bold text-rose-800 mb-1.5">
                  Observed Issue in Submission
                </div>
                <p class="text-slate-800 text-sm leading-relaxed">${escapeHtml(
                  g.observed_issue
                )}</p>
              </div>
              <div class="bg-emerald-50/60 p-4 rounded-xl border-2 border-emerald-200">
                <div class="font-mono text-xs uppercase font-bold text-emerald-800 mb-1.5">
                  Actionable Fix
                </div>
                <p class="text-slate-800 text-sm leading-relaxed">${escapeHtml(
                  g.actionable_fix
                )}</p>
              </div>
            </div>
            <div>
              <div class="font-mono text-xs uppercase font-bold text-slate-600 mb-1.5">
                Conceptual Hint &amp; Exemplar Pattern
              </div>
              <pre class="bg-[#0B0F19] text-slate-100 font-mono text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border-2 border-slate-800">${escapeHtml(
                g.example_or_hint
              )}</pre>
            </div>
          </div>
        </div>
      `
      )
      .join("");

    const roadmapHtml = (feedback.revision_roadmap || [])
      .map(
        (step, idx) =>
          `<li class="flex items-start gap-3.5 p-4 rounded-xl bg-slate-50 border-2 border-slate-200">
            <span class="font-display font-bold text-sm w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">${
              idx + 1
            }</span>
            <span class="text-sm font-medium text-slate-800 leading-relaxed pt-0.5">${escapeHtml(
              step
            )}</span>
          </li>`
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-8">
        <!-- Executive Summary Box -->
        <div class="bg-blue-50/80 border-2 border-blue-200 rounded-2xl p-6 space-y-2">
          <div class="text-xs font-mono font-bold uppercase tracking-wider text-blue-800">
            Executive Assessment Summary
          </div>
          <p class="text-slate-900 text-base leading-relaxed font-medium">${escapeHtml(
            feedback.executive_summary
          )}</p>
        </div>

        <!-- Key Strengths -->
        <div class="space-y-3">
          <h4 class="font-display text-xl font-bold text-slate-900">
            Demonstrated Strengths
          </h4>
          <ul class="grid grid-cols-1 gap-3">${
            strengthsHtml || "<li class='text-sm text-slate-500'>None noted.</li>"
          }</ul>
        </div>

        <!-- Learning Gaps -->
        <div class="space-y-4">
          <h4 class="font-display text-xl font-bold text-slate-900">
            Actionable Learning Gaps &amp; Coaching
          </h4>
          <div class="space-y-5">${
            gapsHtml ||
            "<p class='text-sm text-slate-500'>No major learning gaps identified.</p>"
          }</div>
        </div>

        <!-- Revision Roadmap -->
        <div class="space-y-3">
          <h4 class="font-display text-xl font-bold text-slate-900">
            Priority Revision Roadmap
          </h4>
          <ol class="space-y-2.5">${roadmapHtml}</ol>
        </div>

        <!-- Encouraging Closing -->
        <blockquote class="border-l-4 border-emerald-600 bg-emerald-50 px-6 py-4 text-emerald-950 font-medium text-base italic rounded-r-xl">
          &ldquo;${escapeHtml(feedback.encouraging_closing)}&rdquo;
        </blockquote>
      </div>
    `;
  }

  function renderCriteriaTab(initialEval, reflectionAudit) {
    const panel = el("tab-panel-criteria");
    if (!panel) return;
    if (!initialEval || !Array.isArray(initialEval.criterion_evaluations)) {
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-base">No criterion evaluations available.</p>`;
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
        const pct =
          ce.max_points > 0 ? Math.min(100, Math.max(0, (finalScore / ce.max_points) * 100)) : 0;

        const quotesHtml = (ce.student_evidence_quotes || [])
          .map(
            (q) =>
              `<pre class="bg-[#0B0F19] text-amber-300 font-mono text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border-2 border-slate-800">${escapeHtml(
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
        <div class="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
          <!-- Criterion Header Bar -->
          <div class="bg-slate-100 px-6 py-4 border-b-2 border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <span class="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-slate-900 text-white">${escapeHtml(
                ce.criterion_id
              )}</span>
              <h5 class="font-display text-xl font-bold text-slate-900">${escapeHtml(
                ce.criterion_title
              )}</h5>
            </div>
            <div class="flex items-center gap-2 font-mono text-xs tabular-nums">
              <span class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-slate-700 font-semibold">Init: ${Number(
                ce.initial_score
              ).toFixed(1)}</span>
              <span class="text-slate-400 font-bold">&rarr;</span>
              <span class="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-bold">Final: ${Number(
                finalScore
              ).toFixed(1)} / ${Number(ce.max_points).toFixed(1)}</span>
              <span class="px-2.5 py-1.5 rounded-lg bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold uppercase">${escapeHtml(
                verdict
              )}</span>
            </div>
          </div>

          <div class="p-6 space-y-5">
            <!-- Score Progress Bar -->
            <div class="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
              <div class="h-full bg-blue-600 rounded-full transition-all duration-500" style="width: ${pct.toFixed(
                1
              )}%"></div>
            </div>

            <p class="text-slate-800 text-sm leading-relaxed"><strong class="font-bold text-slate-950">Scoring Rationale:</strong> ${escapeHtml(
              ce.rationale
            )}</p>

            <div class="bg-slate-50 border-l-4 border-blue-600 p-4 rounded-r-xl border border-slate-200 space-y-1.5">
              <div class="text-xs font-mono font-bold uppercase tracking-wider text-blue-800">
                Chain-of-Thought Verification Trace
              </div>
              <p class="text-slate-700 font-mono text-xs whitespace-pre-wrap leading-relaxed">${escapeHtml(
                ce.chain_of_thought_trace
              )}</p>
            </div>

            ${
              quotesHtml
                ? `<div class="space-y-2"><div class="text-xs font-mono font-bold uppercase tracking-wider text-slate-600">Verbatim Student Evidence Quotes</div>${quotesHtml}</div>`
                : ""
            }

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-sm">
              <div class="bg-emerald-50/70 border-2 border-emerald-200 rounded-xl p-4">
                <div class="text-xs font-mono font-bold uppercase text-emerald-900 mb-2">Strengths Observed</div>
                <ul class="text-emerald-950 space-y-1">${strengthsHtml || "<li>None noted</li>"}</ul>
              </div>
              <div class="bg-rose-50/70 border-2 border-rose-200 rounded-xl p-4">
                <div class="text-xs font-mono font-bold uppercase text-rose-900 mb-2">Flaws / Gaps Observed</div>
                <ul class="text-rose-950 space-y-1">${flawsHtml || "<li>None noted</li>"}</ul>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    panel.innerHTML = `
      <div class="space-y-6">
        <div class="bg-slate-100 border-2 border-slate-200 rounded-2xl p-5 text-sm leading-relaxed">
          <span class="font-mono uppercase text-xs font-bold text-blue-700 block mb-1">
            Overall Submission Comprehension (${escapeHtml(initialEval.submission_modality)})
          </span>
          <span class="text-slate-900 font-medium">${escapeHtml(
            initialEval.overall_comprehension_summary
          )}</span>
        </div>
        ${cardsHtml}
      </div>
    `;
  }

  function renderReflectionTab(reflectionAudit) {
    const panel = el("tab-panel-reflection");
    if (!panel) return;
    if (!reflectionAudit) {
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-base">No reflection audit log available.</p>`;
      return;
    }

    const checksHtml = (reflectionAudit.bias_checks_performed || [])
      .map(
        (c) =>
          `<li class="flex items-center gap-2.5 text-sm font-medium text-slate-800 bg-slate-50 px-4 py-3 rounded-xl border-2 border-slate-200"><span class="w-2 h-2 rounded-full bg-blue-600 shrink-0"></span><span>${escapeHtml(
            c
          )}</span></li>`
      )
      .join("");

    const rowsHtml = (reflectionAudit.criterion_audits || [])
      .map(
        (ca) => `
        <tr class="border-t-2 border-slate-200 hover:bg-slate-50 text-sm">
          <td class="py-3.5 px-4 font-mono font-bold text-slate-900">${escapeHtml(
            ca.criterion_id
          )}</td>
          <td class="py-3.5 px-4 font-mono tabular-nums">${Number(ca.initial_score).toFixed(1)}</td>
          <td class="py-3.5 px-4 font-mono font-bold text-blue-700 tabular-nums">${Number(
            ca.calibrated_score
          ).toFixed(1)}</td>
          <td class="py-3.5 px-4 font-mono font-bold tabular-nums">${escapeHtml(
            formatDelta(ca.adjustment_delta)
          )}</td>
          <td class="py-3.5 px-4"><span class="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-slate-200 text-slate-800">${escapeHtml(
            ca.audit_verdict
          )}</span></td>
          <td class="py-3.5 px-4 text-slate-700">${escapeHtml(ca.bias_or_error_detected)}</td>
          <td class="py-3.5 px-4 text-slate-700">${escapeHtml(ca.calibration_reasoning)}</td>
        </tr>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-6">
        <div class="bg-slate-100 border-2 border-slate-200 rounded-2xl p-6 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-display text-xl font-bold text-slate-900">Meta-Evaluator Audit Verdict</span>
            <span class="font-mono text-xs font-bold px-3.5 py-1.5 rounded-lg bg-blue-600 text-white uppercase">${escapeHtml(
              reflectionAudit.audit_status
            )}</span>
          </div>
          <p class="text-sm text-slate-700 leading-relaxed">${escapeHtml(
            reflectionAudit.overall_audit_summary
          )}</p>
        </div>

        <div class="space-y-3">
          <h4 class="font-display text-lg font-bold text-slate-900">
            Bias &amp; Calibration Checks Performed
          </h4>
          <ul class="grid grid-cols-1 md:grid-cols-2 gap-3">${checksHtml}</ul>
        </div>

        <div class="overflow-x-auto border-2 border-slate-200 rounded-2xl bg-white">
          <table class="w-full text-left border-collapse">
            <thead class="bg-[#0B0F19] text-white font-mono text-xs uppercase">
              <tr>
                <th class="py-3.5 px-4">ID</th>
                <th class="py-3.5 px-4">Initial</th>
                <th class="py-3.5 px-4">Calibrated</th>
                <th class="py-3.5 px-4">Delta</th>
                <th class="py-3.5 px-4">Verdict</th>
                <th class="py-3.5 px-4">Bias / Error Detected</th>
                <th class="py-3.5 px-4">Calibration Reasoning</th>
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
      mdLink.classList.remove("pointer-events-none", "opacity-40");
      htmlLink.classList.remove("pointer-events-none", "opacity-40");
    } else {
      mdLink.href = "#";
      htmlLink.href = "#";
      mdLink.classList.add("pointer-events-none", "opacity-40");
      htmlLink.classList.add("pointer-events-none", "opacity-40");
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
    showBanner("Sample benchmark assignments restored.");
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
        "No sample submission tied to this custom assignment. Select a default benchmark assignment first.",
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
      badge.textContent = `Loaded Sample: ${sample.submission_filename}`;
      badge.classList.remove("hidden");
    }
    switchStep(2);
    showBanner(
      `Loaded sample submission for ${sample.student_name}. Click "Run 4-Agent Evaluation" below to start grading!`
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
        "Submission text cannot be empty. Click 'Auto-Fill Sample Submission' or upload a file first.",
        true
      );
      return;
    }

    const runBtn = el("run-eval-btn");
    runBtn.disabled = true;

    // Automatically transition user to Step 3 (Live Pipeline & Report)
    switchStep(3);

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
          "text-sm font-mono font-bold px-4 py-2 rounded-xl bg-rose-100 text-rose-900 border-2 border-rose-300";
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
          "text-sm font-mono font-bold px-4 py-2 rounded-xl bg-blue-100 text-blue-900 border-2 border-blue-300";
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
          "text-sm font-mono font-bold px-4 py-2 rounded-xl bg-emerald-100 text-emerald-900 border-2 border-emerald-300 tabular-nums";
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
          "text-sm font-mono font-bold px-4 py-2 rounded-xl bg-rose-100 text-rose-900 border-2 border-rose-300";
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
            ? "report-tab-btn px-5 py-3 text-sm font-display font-bold rounded-t-xl border-t-2 border-x-2 border-slate-300 bg-white text-blue-700 -mb-[2px]"
            : "report-tab-btn px-5 py-3 text-sm font-display font-semibold rounded-t-xl border-t-2 border-x-2 border-transparent text-slate-600 hover:text-slate-900";
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
    // Step navigation buttons
    document.querySelectorAll(".step-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const step = Number(btn.getAttribute("data-step-target"));
        if (step) switchStep(step);
      });
    });
    el("go-to-step-2-btn")?.addEventListener("click", () => switchStep(2));
    el("back-to-step-1-btn")?.addEventListener("click", () => switchStep(1));

    el("status-banner-close")?.addEventListener("click", hideBanner);
    el("seed-btn")?.addEventListener("click", seedAssignments);
    el("load-sample-btn")?.addEventListener("click", loadSampleSubmissionForActiveAssignment);
    el("quick-demo-btn")?.addEventListener("click", loadSampleSubmissionForActiveAssignment);
    el("refresh-history-btn")?.addEventListener("click", fetchEvaluations);
    el("evaluate-form")?.addEventListener("submit", handleRunEvaluation);

    // History drawer
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
      dropzone.classList.add("border-blue-600", "bg-blue-50");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("border-blue-600", "bg-blue-50");
    });
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-blue-600", "bg-blue-50");
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
