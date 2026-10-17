(() => {
  "use strict";

  const state = {
    assignments: [],
    sampleSubmissions: {},
    activeAssignmentId: null,
    evaluations: [],
    activeEvaluation: null,
    submissionPdfBase64: null,
    userEditedSubmission: false,
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

  function refreshIcons() {
    if (typeof lucide !== "undefined" && lucide.createIcons) {
      lucide.createIcons();
    }
  }

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
        "rounded-xl px-4 py-3 text-xs sm:text-sm font-semibold flex items-center justify-between border bg-rose-50 border-rose-300 text-rose-900 shadow-sm animate-enter";
    } else {
      inner.className =
        "rounded-xl px-4 py-3 text-xs sm:text-sm font-semibold flex items-center justify-between border bg-orange-50 border-orange-300 text-orange-950 shadow-sm animate-enter";
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
    if (apiKey) {
      headers["X-Gemini-Api-Key"] = apiKey;
      headers["X-Gemini-Key"] = apiKey;
    }
    if (model) headers["X-Gemini-Model"] = model;
    return headers;
  }

  function formatDelta(delta) {
    const num = Number(delta || 0);
    if (Math.abs(num) < 1e-6) return "0.0";
    return num > 0 ? `+${num.toFixed(1)}` : num.toFixed(1);
  }

  function updateScoreRing(percentage) {
    const ring = el("score-ring-progress");
    if (!ring) return;
    const circumference = 213.6;
    const clamped = Math.max(0, Math.min(100, Number(percentage || 0)));
    const offset = circumference - (clamped / 100) * circumference;
    ring.style.strokeDashoffset = String(offset.toFixed(1));
    if (clamped >= 85) {
      ring.setAttribute("stroke", "#059669"); // Emerald
    } else if (clamped >= 70) {
      ring.setAttribute("stroke", "#EA580C"); // Orange
    } else if (clamped >= 55) {
      ring.setAttribute("stroke", "#D97706"); // Amber
    } else {
      ring.setAttribute("stroke", "#DC2626"); // Red
    }
  }

  function switchFlow(view) {
    const setupView = el("flow-view-setup");
    const reportView = el("flow-view-report");
    const setupBtn = el("flow-tab-setup-btn");
    const reportBtn = el("flow-tab-report-btn");
    if (!setupView || !reportView || !setupBtn || !reportBtn) return;

    if (view === "report") {
      setupView.classList.add("hidden");
      reportView.classList.remove("hidden");
      reportBtn.className =
        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold bg-white text-orange-800 shadow-sm transition-all border border-[#EAE3D9]";
      setupBtn.className =
        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold text-warmstone-600 hover:text-warmstone-900 transition-all border border-transparent";
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      reportView.classList.add("hidden");
      setupView.classList.remove("hidden");
      setupBtn.className =
        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold bg-white text-orange-800 shadow-sm transition-all border border-[#EAE3D9]";
      reportBtn.className =
        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold text-warmstone-600 hover:text-warmstone-900 transition-all border border-transparent";
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    refreshIcons();
  }

  function resetPipelineStepper(statusLabel = "Idle · Ready") {
    const overall = el("pipeline-overall-status");
    if (overall) {
      overall.textContent = statusLabel;
      overall.className =
        "text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-white text-warmstone-700 border border-[#EAE3D9] tabular-nums shadow-sm";
    }
    for (const stage of STAGES) {
      const card = el(`stage-${stage}`);
      if (!card) continue;
      card.className = "stage-card card-inner rounded-xl p-3.5 relative overflow-hidden";
      const ind = card.querySelector(".stage-indicator");
      if (ind) {
        ind.innerHTML = `<span class="text-warmstone-400">standby</span>`;
        ind.className = "stage-indicator text-[11px] font-mono text-warmstone-400 tabular-nums font-semibold";
      }
    }
  }

  function updateStageState(stageName, mode, extraText = "") {
    const card = el(`stage-${stageName}`);
    if (!card) return;
    const ind = card.querySelector(".stage-indicator");

    if (mode === "running") {
      card.className =
        "stage-card card-inner node-running rounded-xl p-3.5 relative overflow-hidden";
      if (ind) {
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1.5 text-orange-700 font-bold">
            <span class="w-2 h-2 rounded-full bg-orange-500 animate-ping"></span>
            <span>active...</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums";
      }
    } else if (mode === "complete") {
      card.className =
        "stage-card card-inner node-complete rounded-xl p-3.5 relative overflow-hidden";
      if (ind) {
        const label = escapeHtml(extraText || "done");
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1 text-emerald-800 font-bold">
            <svg class="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6">
              <path class="svg-check-anim" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>${label}</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums";
      }
    } else if (mode === "error") {
      card.className =
        "stage-card card-inner node-error rounded-xl p-3.5 relative overflow-hidden";
      if (ind) {
        ind.textContent = "failed";
        ind.className = "stage-indicator text-[11px] font-mono text-rose-600 font-bold";
      }
    }
  }

  function renderStructuredRubric(rubric) {
    const container = el("structured-rubric-view");
    if (!container) return;

    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      container.innerHTML = `<div class="p-4 rounded-xl bg-cream-50 border border-[#EAE3D9] text-xs text-warmstone-600">No structured rubric cached yet. Click <strong>Parse / Refresh Rubric</strong> above or run an evaluation to parse automatically.</div>`;
      return;
    }

    const criteriaHtml = rubric.criteria
      .map((c) => {
        const bandsHtml = (c.scoring_bands || [])
          .map(
            (b) =>
              `<span class="inline-block bg-cream-100 border border-[#EAE3D9] rounded-md px-2 py-0.5 text-[10px] font-mono text-warmstone-700 font-medium">${escapeHtml(
                b.band_label
              )}: <strong class="text-orange-700">${escapeHtml(b.points_range)} pts</strong></span>`
          )
          .join(" ");
        return `
        <div class="rounded-xl p-4 bg-white border border-[#EAE3D9] shadow-sm space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-sm text-warmstone-900">${escapeHtml(
              c.criterion_id
            )} · ${escapeHtml(c.title)}</span>
            <span class="font-mono font-bold text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200 tabular-nums">${Number(
              c.max_points
            ).toFixed(1)} pts</span>
          </div>
          <p class="text-warmstone-600 text-xs leading-relaxed">${escapeHtml(c.description)}</p>
          <div class="flex flex-wrap gap-1.5 pt-1">${bandsHtml}</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = `
      <div class="flex items-center justify-between bg-orange-50 border border-orange-200 px-3.5 py-2.5 rounded-xl mb-2.5 text-xs">
        <span class="font-bold text-orange-900">${escapeHtml(
          rubric.assignment_title || "Parsed Rubric"
        )}</span>
        <span class="font-mono font-bold text-emerald-800 tabular-nums">Total: ${Number(
          rubric.total_points || 0
        ).toFixed(1)} pts</span>
      </div>
      <div class="space-y-2.5">${criteriaHtml}</div>
    `;
  }

  function renderAssignmentsList() {
    const container = el("assignments-list");
    if (!container) return;

    if (state.assignments.length === 0) {
      container.innerHTML = `<span class="text-xs text-warmstone-500">No benchmarks found. Click "Reset Demos".</span>`;
      return;
    }

    container.innerHTML = state.assignments
      .map((a) => {
        const isSelected = a.id === state.activeAssignmentId;
        const typeDot =
          a.assignment_type === "code"
            ? "bg-orange-500"
            : a.assignment_type === "theory"
            ? "bg-amber-500"
            : "bg-emerald-500";

        return `
        <div
          data-assignment-id="${escapeHtml(a.id)}"
          class="assign-card-item btn inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl cursor-pointer text-xs border transition-all ${
            isSelected
              ? "bg-orange-100 border-orange-400 text-orange-950 font-bold shadow-sm"
              : "bg-white border-[#EAE3D9] text-warmstone-700 hover:border-orange-300 hover:text-warmstone-900 shadow-sm"
          }"
        >
          <span class="w-2 h-2 rounded-full ${typeDot}"></span>
          <span class="font-semibold truncate max-w-[200px] sm:max-w-[260px]">${escapeHtml(
            a.title
          )}</span>
          <span class="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-black/5 text-warmstone-500">${escapeHtml(
            a.assignment_type
          )}</span>
          <button
            type="button"
            data-delete-assignment="${escapeHtml(a.id)}"
            title="Delete benchmark"
            class="text-warmstone-400 hover:text-rose-600 ml-1 font-bold leading-none"
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
        state.userEditedSubmission = false;
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

    // Auto-fill sample submission for the active assignment if the user hasn't typed custom work
    if (!state.userEditedSubmission && state.sampleSubmissions[active.id]) {
      const sample = state.sampleSubmissions[active.id];
      if (el("student-name-input")) el("student-name-input").value = sample.student_name || "Alex Rivera";
      if (el("student-id-input")) el("student-id-input").value = sample.student_id || "STU-2049";
      if (el("submission-filename-input"))
        el("submission-filename-input").value = sample.submission_filename || "submission.py";
      if (el("submission-text-input"))
        el("submission-text-input").value = sample.submission_text || "";
      state.submissionPdfBase64 = null;
      const badge = el("ingested-file-badge");
      if (badge) {
        badge.textContent = `Sample: ${sample.submission_filename}`;
        badge.classList.remove("hidden");
      }
    }
  }

  function renderEvaluationsHistory() {
    const container = el("evaluations-history-list");
    const countBadge = el("history-count-badge");
    if (countBadge) {
      countBadge.textContent = String(state.evaluations.length || 0);
    }
    if (!container) return;

    if (state.evaluations.length === 0) {
      container.innerHTML = `<div class="text-xs text-warmstone-400 py-10 text-center">No evaluations recorded yet.</div>`;
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
          class="eval-history-row btn rounded-xl p-3.5 cursor-pointer transition-all flex items-center justify-between gap-3 border ${
            isSelected
              ? "bg-orange-100 border-orange-300 shadow-sm"
              : "bg-white border-[#EAE3D9] hover:bg-cream-100 shadow-sm"
          }"
        >
          <div class="min-w-0">
            <div class="text-xs font-bold text-warmstone-900 truncate">
              ${escapeHtml(ev.student_name)}
              <span class="text-warmstone-500 font-normal">${
                ev.student_id ? `(${escapeHtml(ev.student_id)})` : ""
              }</span>
            </div>
            <div class="text-[11px] text-warmstone-500 truncate font-mono mt-0.5">${escapeHtml(
              ev.submission_filename
            )}</div>
          </div>
          <div class="text-right shrink-0">
            <span class="text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border tabular-nums ${statusColor}">
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
      });
    });
  }

  function renderFeedbackTab(feedback) {
    const panel = el("tab-panel-feedback");
    if (!panel) return;
    if (!feedback) {
      panel.innerHTML = `<p class="text-warmstone-500 text-center py-12 text-xs">No pedagogical feedback available for this evaluation.</p>`;
      return;
    }

    const strengthsHtml = (feedback.key_strengths || [])
      .map(
        (s) => `
        <li class="flex items-start gap-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
          <span class="w-5 h-5 rounded-md bg-emerald-200 text-emerald-800 font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">&check;</span>
          <span class="text-emerald-950 text-xs sm:text-sm leading-relaxed">${escapeHtml(s)}</span>
        </li>`
      )
      .join("");

    const gapsHtml = (feedback.learning_gaps || [])
      .map(
        (g, idx) => `
        <div class="card-surface rounded-2xl overflow-hidden border border-[#EAE3D9] shadow-sm">
          <div class="px-5 py-3 bg-cream-100/80 border-b border-[#EAE3D9] flex items-center gap-2.5">
            <span class="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">
              GAP 0${idx + 1}
            </span>
            <h5 class="text-base font-bold text-warmstone-900">${escapeHtml(
              g.concept_or_skill
            )}</h5>
          </div>
          <div class="p-5 space-y-4 bg-white">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div class="bg-rose-50 p-3.5 rounded-xl border border-rose-200">
                <div class="font-mono text-[10px] uppercase tracking-wider font-bold text-rose-800 mb-1">
                  Observed Flaw
                </div>
                <p class="text-rose-950 leading-relaxed font-medium">${escapeHtml(g.observed_issue)}</p>
              </div>
              <div class="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
                <div class="font-mono text-[10px] uppercase tracking-wider font-bold text-emerald-800 mb-1">
                  Actionable Fix
                </div>
                <p class="text-emerald-950 leading-relaxed font-medium">${escapeHtml(g.actionable_fix)}</p>
              </div>
            </div>
            <div class="space-y-1.5">
              <div class="font-mono text-[10px] uppercase tracking-wider text-warmstone-500 font-bold">
                Exemplar Pattern / Code Hint
              </div>
              <pre class="bg-cream-100 text-warmstone-900 font-mono text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border border-[#EAE3D9]">${escapeHtml(
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
          `<li class="flex items-start gap-3 p-3.5 rounded-xl bg-cream-50 border border-[#EAE3D9]">
            <span class="font-mono font-bold text-xs w-6 h-6 rounded-md bg-orange-600 text-white flex items-center justify-center shrink-0">${
              idx + 1
            }</span>
            <span class="text-xs sm:text-sm text-warmstone-800 leading-relaxed pt-0.5 font-medium">${escapeHtml(
              step
            )}</span>
          </li>`
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-6 animate-enter">
        <div class="rounded-2xl p-5 bg-orange-50 border border-orange-200 space-y-1.5">
          <div class="text-[11px] font-mono font-bold uppercase tracking-widest text-orange-800">
            Executive Synthesis
          </div>
          <p class="text-warmstone-900 text-sm leading-relaxed font-medium">${escapeHtml(
            feedback.executive_summary
          )}</p>
        </div>

        <div class="space-y-2.5">
          <h4 class="text-base font-bold text-warmstone-900">
            Demonstrated Strengths
          </h4>
          <ul class="grid grid-cols-1 gap-2.5">${
            strengthsHtml || "<li class='text-xs text-warmstone-500'>None noted.</li>"
          }</ul>
        </div>

        <div class="space-y-3">
          <h4 class="text-base font-bold text-warmstone-900">
            Actionable Learning Gaps &amp; Coaching
          </h4>
          <div class="space-y-4">${
            gapsHtml ||
            "<p class='text-xs text-warmstone-500'>No major learning gaps identified.</p>"
          }</div>
        </div>

        <div class="space-y-2.5">
          <h4 class="text-base font-bold text-warmstone-900">
            Priority Revision Roadmap
          </h4>
          <ol class="space-y-2">${roadmapHtml}</ol>
        </div>

        <blockquote class="border-l-4 border-orange-500 bg-orange-50 px-5 py-3.5 text-orange-950 text-sm italic rounded-r-xl font-medium">
          &ldquo;${escapeHtml(feedback.encouraging_closing)}&rdquo;
        </blockquote>
      </div>
    `;
    refreshIcons();
  }

  function renderCriteriaTab(initialEval, reflectionAudit) {
    const panel = el("tab-panel-criteria");
    if (!panel) return;
    if (!initialEval || !Array.isArray(initialEval.criterion_evaluations)) {
      panel.innerHTML = `<p class="text-warmstone-500 text-center py-12 text-xs">No criterion evaluations available.</p>`;
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
              `<pre class="bg-cream-100 text-warmstone-900 font-mono text-xs p-3.5 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border border-[#EAE3D9]">${escapeHtml(
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
        <div class="card-surface rounded-2xl overflow-hidden border border-[#EAE3D9] shadow-sm">
          <div class="px-5 py-3.5 bg-cream-100/80 border-b border-[#EAE3D9] flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">${escapeHtml(
                ce.criterion_id
              )}</span>
              <h5 class="text-base font-bold text-warmstone-900">${escapeHtml(
                ce.criterion_title
              )}</h5>
            </div>
            <div class="flex items-center gap-2 font-mono text-xs tabular-nums">
              <span class="px-2.5 py-1 rounded-lg bg-white border border-[#EAE3D9] text-warmstone-600 font-medium">Init: ${Number(
                ce.initial_score
              ).toFixed(1)}</span>
              <span class="text-warmstone-400">&rarr;</span>
              <span class="px-3 py-1 rounded-lg bg-orange-600 text-white font-bold">Final: ${Number(
                finalScore
              ).toFixed(1)} / ${Number(ce.max_points).toFixed(1)}</span>
              <span class="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] uppercase font-bold">${escapeHtml(
                verdict
              )}</span>
            </div>
          </div>

          <div class="p-5 space-y-4 bg-white">
            <div class="w-full h-2 bg-cream-200 rounded-full overflow-hidden">
              <div class="h-full bg-gradient-to-r from-orange-500 to-amber-500 rounded-full transition-all duration-500" style="width: ${pct.toFixed(
                1
              )}%"></div>
            </div>

            <p class="text-warmstone-700 text-xs sm:text-sm leading-relaxed"><strong class="text-warmstone-900">Rationale:</strong> ${escapeHtml(
              ce.rationale
            )}</p>

            <div class="bg-cream-50 border-l-4 border-orange-500 p-4 rounded-r-xl border border-[#EAE3D9] space-y-1.5">
              <div class="text-[10px] font-mono font-bold uppercase tracking-widest text-orange-800">
                Chain-of-Thought Verification Trace
              </div>
              <p class="text-warmstone-800 font-mono text-xs whitespace-pre-wrap leading-relaxed">${escapeHtml(
                ce.chain_of_thought_trace
              )}</p>
            </div>

            ${
              quotesHtml
                ? `<div class="space-y-1.5"><div class="text-[10px] font-mono font-bold uppercase tracking-wider text-warmstone-500">Verbatim Student Evidence</div>${quotesHtml}</div>`
                : ""
            }

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
                <div class="text-[10px] font-mono font-bold uppercase text-emerald-800 mb-1">Strengths Observed</div>
                <ul class="text-emerald-950 space-y-1 font-medium">${strengthsHtml || "<li>None noted</li>"}</ul>
              </div>
              <div class="bg-rose-50 border border-rose-200 rounded-xl p-3.5">
                <div class="text-[10px] font-mono font-bold uppercase text-rose-800 mb-1">Flaws / Gaps Observed</div>
                <ul class="text-rose-950 space-y-1 font-medium">${flawsHtml || "<li>None noted</li>"}</ul>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    panel.innerHTML = `
      <div class="space-y-4 animate-enter">
        <div class="card-surface rounded-2xl p-4 text-xs sm:text-sm leading-relaxed border border-[#EAE3D9] bg-cream-50">
          <span class="font-mono uppercase text-[10px] tracking-widest text-orange-700 font-bold block mb-1">
            Overall Comprehension Summary (${escapeHtml(initialEval.submission_modality)})
          </span>
          <span class="text-warmstone-800 font-medium">${escapeHtml(
            initialEval.overall_comprehension_summary
          )}</span>
        </div>
        ${cardsHtml}
      </div>
    `;
    refreshIcons();
  }

  function renderReflectionTab(reflectionAudit) {
    const panel = el("tab-panel-reflection");
    if (!panel) return;
    if (!reflectionAudit) {
      panel.innerHTML = `<p class="text-warmstone-500 text-center py-12 text-xs">No reflection audit log available.</p>`;
      return;
    }

    const checksHtml = (reflectionAudit.bias_checks_performed || [])
      .map(
        (c) =>
          `<li class="flex items-center gap-2 text-xs text-warmstone-800 bg-cream-50 px-3.5 py-2.5 rounded-xl border border-[#EAE3D9] font-medium"><span class="w-2 h-2 rounded-full bg-orange-500 shrink-0"></span><span>${escapeHtml(
            c
          )}</span></li>`
      )
      .join("");

    const rowsHtml = (reflectionAudit.criterion_audits || [])
      .map(
        (ca) => `
        <tr class="border-t border-[#EAE3D9] hover:bg-cream-50 text-xs">
          <td class="py-3 px-3 font-mono font-bold text-warmstone-900">${escapeHtml(ca.criterion_id)}</td>
          <td class="py-3 px-3 font-mono text-warmstone-600 tabular-nums">${Number(
            ca.initial_score
          ).toFixed(1)}</td>
          <td class="py-3 px-3 font-mono font-bold text-orange-700 tabular-nums">${Number(
            ca.calibrated_score
          ).toFixed(1)}</td>
          <td class="py-3 px-3 font-mono font-bold text-amber-700 tabular-nums">${escapeHtml(
            formatDelta(ca.adjustment_delta)
          )}</td>
          <td class="py-3 px-3"><span class="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-cream-100 border border-[#DDD4C7] text-warmstone-700">${escapeHtml(
            ca.audit_verdict
          )}</span></td>
          <td class="py-3 px-3 text-warmstone-800">${escapeHtml(ca.bias_or_error_detected)}</td>
          <td class="py-3 px-3 text-warmstone-600">${escapeHtml(ca.calibration_reasoning)}</td>
        </tr>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-5 animate-enter">
        <div class="card-surface rounded-2xl p-5 space-y-2 border border-[#EAE3D9] bg-white">
          <div class="flex items-center justify-between">
            <span class="text-base font-bold text-warmstone-900">Meta-Evaluator Audit Verdict</span>
            <span class="font-mono text-xs font-bold px-3 py-1 rounded-lg bg-orange-100 text-orange-800 border border-orange-200 uppercase">${escapeHtml(
              reflectionAudit.audit_status
            )}</span>
          </div>
          <p class="text-xs sm:text-sm text-warmstone-700 leading-relaxed font-medium">${escapeHtml(
            reflectionAudit.overall_audit_summary
          )}</p>
        </div>

        <div class="space-y-2.5">
          <h4 class="text-[11px] font-mono font-bold uppercase tracking-widest text-warmstone-500">
            Bias &amp; Calibration Checks Executed
          </h4>
          <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2">${checksHtml}</ul>
        </div>

        <div class="overflow-x-auto border border-[#EAE3D9] rounded-2xl bg-white shadow-sm">
          <table class="w-full text-left border-collapse">
            <thead class="bg-cream-100 text-warmstone-700 font-mono text-[10px] uppercase tracking-wider font-bold">
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
    refreshIcons();
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
    const pctNum = maxScore > 0 ? (finalScore / maxScore) * 100 : 0;
    const pct = maxScore > 0 ? `${pctNum.toFixed(1)}%` : "N/A";

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

    updateScoreRing(pctNum);
    renderFeedbackTab(record.feedback_report);
    renderCriteriaTab(record.initial_evaluation, record.reflection_audit);
    renderReflectionTab(record.reflection_audit);
    updateExportLinks(record.id);

    // Show indicator on report tab
    el("report-ready-indicator")?.classList.remove("hidden");
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
    state.userEditedSubmission = false;
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
        "No sample submission tied to this custom assignment. Select a default benchmark first.",
        true
      );
      return;
    }
    state.userEditedSubmission = false;
    el("student-name-input").value = sample.student_name || "Alex Rivera";
    el("student-id-input").value = sample.student_id || "STU-2049";
    el("submission-filename-input").value =
      sample.submission_filename || "submission.py";
    el("submission-text-input").value = sample.submission_text || "";
    state.submissionPdfBase64 = null;
    const badge = el("ingested-file-badge");
    if (badge) {
      badge.textContent = `Sample: ${sample.submission_filename}`;
      badge.classList.remove("hidden");
    }
    showBanner(`Loaded sample work for ${sample.student_name}. Click "Run 4-Agent Evaluation" to grade.`);
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
        updateStageState(stage, "complete", "verified");
      }
    }
    renderFullEvaluationRecord(record);
    switchFlow("report");
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

    // Immediately transition into the report / live progress view
    switchFlow("report");
    resetPipelineStepper("Streaming 4-Agent Pipeline...");
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
        overall.textContent = "Pipeline Error";
        overall.className =
          "text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-rose-100 text-rose-800 border border-rose-300";
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
        overall.textContent = `Active: ${data.label || data.agent}`;
        overall.className =
          "text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-orange-100 text-orange-800 border border-orange-300";
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
          "text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 border border-emerald-300 tabular-nums";
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
          "text-xs font-mono font-bold px-3 py-1.5 rounded-lg bg-rose-100 text-rose-800 border border-rose-300";
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
            ? "report-tab-btn px-4 py-2 text-xs font-bold rounded-xl bg-orange-600 text-white shadow-sm transition-all"
            : "report-tab-btn px-4 py-2 text-xs font-semibold rounded-xl text-warmstone-600 hover:text-warmstone-900 hover:bg-cream-200 transition-all";
        });
        Object.entries(panels).forEach(([key, panel]) => {
          if (!panel) return;
          if (key === target) {
            panel.classList.remove("hidden");
          } else {
            panel.classList.add("hidden");
          }
        });
        refreshIcons();
      });
    });
  }

  function setupEventListeners() {
    // Flow view tabs
    el("flow-tab-setup-btn")?.addEventListener("click", () => switchFlow("setup"));
    el("flow-tab-report-btn")?.addEventListener("click", () => switchFlow("report"));
    el("back-to-setup-btn")?.addEventListener("click", () => switchFlow("setup"));

    // Spec inspector toggle
    el("inspect-rubric-toggle-btn")?.addEventListener("click", () => {
      const spec = el("left-pane-spec");
      if (spec) spec.classList.toggle("hidden");
    });
    el("close-spec-view-btn")?.addEventListener("click", () => {
      el("left-pane-spec")?.classList.add("hidden");
    });

    el("status-banner-close")?.addEventListener("click", hideBanner);
    el("seed-btn")?.addEventListener("click", seedAssignments);
    el("load-sample-btn")?.addEventListener("click", loadSampleSubmissionForActiveAssignment);
    el("refresh-history-btn")?.addEventListener("click", fetchEvaluations);
    el("evaluate-form")?.addEventListener("submit", handleRunEvaluation);

    // API Key Popover
    const keyPopover = el("key-popover-panel");
    el("toggle-key-popover-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      keyPopover?.classList.toggle("hidden");
    });
    document.addEventListener("click", (e) => {
      if (
        keyPopover &&
        !keyPopover.classList.contains("hidden") &&
        !keyPopover.contains(e.target) &&
        !el("toggle-key-popover-btn")?.contains(e.target)
      ) {
        keyPopover.classList.add("hidden");
      }
    });

    // History drawer
    const historyDrawer = el("history-drawer-modal");
    const openHistory = () => historyDrawer?.classList.remove("hidden");
    const closeHistory = () => historyDrawer?.classList.add("hidden");
    el("open-history-drawer-btn")?.addEventListener("click", openHistory);
    el("close-history-drawer-btn")?.addEventListener("click", closeHistory);
    el("history-drawer-backdrop")?.addEventListener("click", closeHistory);

    // Track user edits & clear cached PDF bytes
    el("submission-text-input")?.addEventListener("input", () => {
      state.userEditedSubmission = true;
      state.submissionPdfBase64 = null;
    });

    // Submission dropzone & file input
    const dropzone = el("submission-dropzone");
    const fileInput = el("submission-file-input");
    dropzone?.addEventListener("click", () => fileInput?.click());
    dropzone?.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("border-orange-500", "bg-orange-50");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("border-orange-500", "bg-orange-50");
    });
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-orange-500", "bg-orange-50");
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
      state.userEditedSubmission = true;
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
    if (state.evaluations.length > 0 && state.evaluations[0].status === "completed") {
      await loadEvaluationById(state.evaluations[0].id);
    }
    refreshIcons();
  });
})();
