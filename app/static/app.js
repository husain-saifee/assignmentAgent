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
    activeReportTab: "feedback",
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
        "rounded-xl px-5 py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-between border bg-rose-50 border-rose-200 text-rose-950 shadow-2xs animate-enter";
    } else {
      inner.className =
        "rounded-xl px-5 py-3.5 text-xs sm:text-sm font-semibold flex items-center justify-between border bg-ocean-50 border-ocean-200 text-ocean-950 shadow-2xs animate-enter";
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
      ring.setAttribute("stroke", "#0284C7"); // Nordic Ocean Cobalt
    } else if (clamped >= 55) {
      ring.setAttribute("stroke", "#D97706"); // Amber
    } else {
      ring.setAttribute("stroke", "#DC2626"); // Red
    }
  }

  function updateSlidingPill(containerEl, activeBtnEl, animate = true) {
    if (!containerEl || !activeBtnEl) return;
    const pill =
      containerEl.querySelector(".sliding-pill") ||
      containerEl.querySelector("#report-tab-indicator") ||
      containerEl.querySelector("#flow-sliding-pill");
    if (!pill) return;
    if (containerEl.offsetParent === null) return;

    const offsetLeft = activeBtnEl.offsetLeft;
    const offsetTop = activeBtnEl.offsetTop;
    const width = activeBtnEl.offsetWidth;
    const height = activeBtnEl.offsetHeight;

    if (width === 0 && height === 0) return;

    if (!animate) {
      const prevTransition = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translate3d(${offsetLeft}px, ${offsetTop}px, 0)`;
      pill.style.width = `${width}px`;
      pill.style.height = `${height}px`;
      pill.style.opacity = "1";
      void pill.offsetHeight;
      pill.style.transition = prevTransition;
    } else {
      pill.style.transform = `translate3d(${offsetLeft}px, ${offsetTop}px, 0)`;
      pill.style.width = `${width}px`;
      pill.style.height = `${height}px`;
      pill.style.opacity = "1";
    }
  }

  function syncReportTabIndicator(animate = true) {
    const tabBar = el("report-tab-bar");
    if (!tabBar) return;
    const activeBtn =
      tabBar.querySelector(`.report-tab-btn[data-tab="${state.activeReportTab || "feedback"}"]`) ||
      tabBar.querySelector(".report-tab-btn[aria-selected='true']") ||
      tabBar.querySelector(".report-tab-btn");
    if (activeBtn) {
      updateSlidingPill(tabBar, activeBtn, animate);
    }
  }

  function switchFlow(view) {
    const setupView = el("flow-view-setup");
    const reportView = el("flow-view-report");
    const setupBtn = el("flow-tab-setup-btn");
    const reportBtn = el("flow-tab-report-btn");
    if (!setupView || !reportView || !setupBtn || !reportBtn) return;

    const isReport = view === "report";
    const activeBtn = isReport ? reportBtn : setupBtn;
    const inactiveBtn = isReport ? setupBtn : reportBtn;
    const nav = setupBtn.parentElement;

    // 1. Toggle Flow views
    if (isReport) {
      setupView.classList.add("hidden");
      reportView.classList.remove("hidden");
    } else {
      reportView.classList.add("hidden");
      setupView.classList.remove("hidden");
    }

    // 2. Hardware-accelerated sliding active pill glide
    if (nav) {
      updateSlidingPill(nav, activeBtn, true);
    }

    // 3. Update ARIA accessibility attributes
    activeBtn.setAttribute("aria-selected", "true");
    inactiveBtn.setAttribute("aria-selected", "false");

    // 4. Smoothly transition active / inactive classes without abrupt replacement
    activeBtn.className =
      "flow-nav-btn active relative z-10 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-white transition-colors duration-200 bg-transparent border border-transparent";
    inactiveBtn.className =
      "flow-nav-btn relative z-10 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-800 transition-colors duration-200 bg-transparent border border-transparent";

    const activeBadge = activeBtn.querySelector("span:first-child");
    if (activeBadge) {
      activeBadge.className =
        "w-5 h-5 rounded-full bg-white text-ocean-700 text-[11px] font-mono font-extrabold flex items-center justify-center transition-colors duration-200";
    }
    const inactiveBadge = inactiveBtn.querySelector("span:first-child");
    if (inactiveBadge) {
      inactiveBadge.className =
        "w-5 h-5 rounded-full bg-[#E2E8F0] text-slate-700 text-[11px] font-mono font-extrabold flex items-center justify-center transition-colors duration-200";
    }

    // 5. Synchronize Report Tab indicator if transitioning into report view
    if (isReport) {
      requestAnimationFrame(() => {
        syncReportTabIndicator(false);
      });
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
    refreshIcons();
  }

  function resetPipelineStepper(statusLabel = "Idle · Ready") {
    const overall = el("pipeline-overall-status");
    if (overall) {
      overall.textContent = statusLabel;
      overall.className =
        "text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg bg-[#F8FAFC] text-slate-700 border border-[#E2E8F0] tabular-nums shadow-xs";
    }
    for (const stage of STAGES) {
      const card = el(`stage-${stage}`);
      if (!card) continue;
      card.className = "stage-card card-inner rounded-xl p-4 relative overflow-hidden bg-[#F8FAFC] border border-[#E2E8F0]";
      const ind = card.querySelector(".stage-indicator");
      if (ind) {
        ind.innerHTML = `<span class="px-2 py-0.5 rounded bg-[#E2E8F0] text-slate-700 font-mono text-[11px] font-bold">STANDBY</span>`;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums font-bold";
      }
    }
  }

  function updateStageState(stageName, mode, extraText = "") {
    const card = el(`stage-${stageName}`);
    if (!card) return;
    const ind = card.querySelector(".stage-indicator");

    if (mode === "running") {
      card.className =
        "stage-card card-inner node-running rounded-xl p-4 relative overflow-hidden border border-ocean-500 shadow-xs";
      if (ind) {
        ind.innerHTML = `
          <span class="inline-flex items-center gap-1.5 text-ocean-950 font-bold bg-ocean-100 border border-ocean-300 px-2.5 py-0.5 rounded-md">
            <span class="w-2 h-2 rounded-full bg-ocean-600 animate-ping"></span>
            <span>active...</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums font-bold";
      }
    } else if (mode === "complete") {
      card.className =
        "stage-card card-inner node-complete rounded-xl p-4 relative overflow-hidden border border-emerald-300";
      if (ind) {
        const label = escapeHtml(extraText || "done");
        ind.innerHTML = `
          <span class="stage-badge-complete badge-pop-in inline-flex items-center gap-1 text-emerald-950 font-bold bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
            <svg class="w-3.5 h-3.5 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.6">
              <path class="svg-check-anim" pathLength="24" stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>${label}</span>
          </span>
        `;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums font-bold";
      }
    } else if (mode === "error") {
      card.className =
        "stage-card card-inner node-error rounded-xl p-4 relative overflow-hidden border border-rose-300";
      if (ind) {
        ind.innerHTML = `<span class="px-2.5 py-0.5 rounded bg-rose-50 text-rose-950 border border-rose-200 font-mono text-[11px] font-bold">FAILED</span>`;
        ind.className = "stage-indicator text-[11px] font-mono tabular-nums font-bold";
      }
    }
  }

  function renderStructuredRubric(rubric) {
    const container = el("structured-rubric-view");
    if (!container) return;

    if (!rubric || !Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
      container.innerHTML = `<div class="p-4 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] text-xs text-slate-600 font-medium">No structured rubric cached yet. Click <strong>Parse / Refresh Rubric</strong> above or run an evaluation to parse automatically.</div>`;
      return;
    }

    const criteriaHtml = rubric.criteria
      .map((c) => {
        const bandsHtml = (c.scoring_bands || [])
          .map(
            (b) =>
              `<span class="inline-block bg-[#F8FAFC] border border-[#E2E8F0] rounded-md px-2 py-0.5 text-[11px] font-mono text-slate-700 font-bold">${escapeHtml(
                b.band_label
              )}: <strong class="text-ocean-700">${escapeHtml(b.points_range)} pts</strong></span>`
          )
          .join(" ");
        return `
        <div class="rounded-xl p-4 bg-white border border-[#E2E8F0] shadow-xs space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="font-bold text-sm text-slate-800 font-display">${escapeHtml(
              c.criterion_id
            )} · ${escapeHtml(c.title)}</span>
            <span class="font-mono font-bold text-xs px-2.5 py-0.5 rounded bg-ocean-50 text-ocean-800 border border-ocean-200 tabular-nums">${Number(
              c.max_points
            ).toFixed(1)} pts</span>
          </div>
          <p class="text-slate-600 text-xs leading-relaxed font-medium">${escapeHtml(c.description)}</p>
          <div class="flex flex-wrap gap-1.5 pt-1">${bandsHtml}</div>
        </div>
      `;
      })
      .join("");

    container.innerHTML = `
      <div class="flex items-center justify-between bg-ocean-50 border border-ocean-200 px-4 py-2.5 rounded-xl mb-3 text-xs">
        <span class="font-bold text-ocean-950 font-display">${escapeHtml(
          rubric.assignment_title || "Parsed Rubric"
        )}</span>
        <span class="font-mono font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded tabular-nums">Total: ${Number(
          rubric.total_points || 0
        ).toFixed(1)} pts</span>
      </div>
      <div class="space-y-3">${criteriaHtml}</div>
    `;
    refreshIcons();
  }

  function renderAssignmentsList() {
    const container = el("assignments-list");
    if (!container) return;

    if (state.assignments.length === 0) {
      container.innerHTML = `<span class="text-xs text-slate-500 font-semibold">No benchmarks found. Click "Reset Demos".</span>`;
      return;
    }

    container.innerHTML = state.assignments
      .map((a) => {
        const isSelected = a.id === state.activeAssignmentId;
        const typeColor =
          a.assignment_type === "code"
            ? "bg-ocean-600 text-white"
            : a.assignment_type === "theory"
            ? "bg-amber-700 text-white"
            : "bg-emerald-700 text-white";

        return `
        <div
          data-assignment-id="${escapeHtml(a.id)}"
          class="assign-card-item btn inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl cursor-pointer text-xs border transition-all ${
            isSelected
              ? "bg-ocean-50/70 border-2 border-ocean-500 text-ocean-950 font-bold shadow-2xs"
              : "bg-white border border-[#E2E8F0] text-slate-700 hover:border-slate-300 hover:text-slate-900 shadow-2xs font-semibold"
          }"
        >
          <span class="w-2.5 h-2.5 rounded-full ${isSelected ? "bg-ocean-600 ring-2 ring-ocean-200" : "bg-slate-300"}"></span>
          <span class="truncate max-w-[200px] sm:max-w-[260px] font-display">${escapeHtml(
            a.title
          )}</span>
          <span class="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold ${typeColor}">${escapeHtml(
            a.assignment_type
          )}</span>
          <button
            type="button"
            data-delete-assignment="${escapeHtml(a.id)}"
            title="Delete benchmark"
            class="text-slate-500 hover:text-rose-700 hover:bg-rose-50 rounded-md px-1.5 py-0.5 ml-1 font-extrabold leading-none transition-colors"
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
      container.innerHTML = `<div class="text-xs text-slate-500 font-semibold py-10 text-center">No evaluations recorded yet.</div>`;
      return;
    }

    container.innerHTML = state.evaluations
      .map((ev) => {
        const isSelected = state.activeEvaluation && state.activeEvaluation.id === ev.id;
        const statusColor =
          ev.status === "completed"
            ? "bg-emerald-50 text-emerald-950 border-emerald-200"
            : ev.status === "failed"
            ? "bg-rose-50 text-rose-950 border-rose-200"
            : "bg-amber-50 text-amber-950 border-amber-200";
        return `
        <div
          data-eval-id="${escapeHtml(ev.id)}"
          class="eval-history-row btn rounded-xl p-3.5 cursor-pointer transition-all flex items-center justify-between gap-3 border ${
            isSelected
              ? "bg-ocean-50/70 border-2 border-ocean-500 shadow-2xs"
              : "bg-white border border-[#E2E8F0] hover:bg-[#F8FAFC] shadow-2xs"
          }"
        >
          <div class="min-w-0">
            <div class="text-xs font-bold text-slate-800 truncate font-display">
              ${escapeHtml(ev.student_name)}
              <span class="text-slate-500 font-semibold">${
                ev.student_id ? `(${escapeHtml(ev.student_id)})` : ""
              }</span>
            </div>
            <div class="text-[11px] text-slate-500 truncate font-mono mt-0.5 font-medium">${escapeHtml(
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
        closeHistoryDrawer();
      });
    });
  }

  function renderFeedbackTab(feedback) {
    const panel = el("tab-panel-feedback");
    if (!panel) return;
    if (!feedback) {
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-xs font-semibold">No pedagogical feedback available for this evaluation.</p>`;
      return;
    }

    const strengthsHtml = (feedback.key_strengths || [])
      .map(
        (s) => `
        <li class="flex items-start gap-3 p-4 rounded-xl bg-emerald-50/60 border border-emerald-200">
          <span class="w-5 h-5 rounded-md bg-emerald-600 text-white font-extrabold flex items-center justify-center text-xs shrink-0 mt-0.5">&check;</span>
          <span class="text-emerald-950 text-xs sm:text-sm leading-relaxed font-semibold">${escapeHtml(s)}</span>
        </li>`
      )
      .join("");

    const gapsHtml = (feedback.learning_gaps || [])
      .map(
        (g, idx) => `
        <div class="card-surface rounded-2xl overflow-hidden border border-[#E2E8F0] shadow-xs">
          <div class="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center gap-3">
            <span class="font-mono text-[11px] font-bold px-2.5 py-0.5 rounded bg-ocean-50 text-ocean-800 border border-ocean-200">
              GAP 0${idx + 1}
            </span>
            <h5 class="font-display text-base font-bold text-slate-800">${escapeHtml(
              g.concept_or_skill
            )}</h5>
          </div>
          <div class="p-5 space-y-4 bg-white">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
              <div class="bg-rose-50/60 p-4 rounded-xl border border-rose-200">
                <div class="font-mono text-[11px] uppercase tracking-wider font-extrabold text-rose-950 mb-1">
                  Observed Flaw
                </div>
                <p class="text-rose-950 leading-relaxed font-semibold">${escapeHtml(g.observed_issue)}</p>
              </div>
              <div class="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200">
                <div class="font-mono text-[11px] uppercase tracking-wider font-extrabold text-emerald-950 mb-1">
                  Actionable Fix
                </div>
                <p class="text-emerald-950 leading-relaxed font-semibold">${escapeHtml(g.actionable_fix)}</p>
              </div>
            </div>
            <div class="space-y-1.5">
              <div class="font-mono text-[11px] uppercase tracking-wider text-slate-600 font-bold">
                Exemplar Pattern / Code Hint
              </div>
              <pre class="bg-[#F8FAFC] text-slate-800 font-mono text-xs p-4 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border border-[#E2E8F0] font-semibold">${escapeHtml(
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
          `<li class="flex items-start gap-3 p-4 rounded-xl bg-white border border-[#E2E8F0]">
            <span class="font-mono font-bold text-xs w-6 h-6 rounded-md bg-ocean-600 text-white flex items-center justify-center shrink-0">${
              idx + 1
            }</span>
            <span class="text-xs sm:text-sm text-slate-700 leading-relaxed pt-0.5 font-semibold">${escapeHtml(
              step
            )}</span>
          </li>`
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-6 animate-enter">
        <div class="rounded-2xl p-5 bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
          <div class="text-[11px] font-mono font-bold uppercase tracking-wider text-ocean-700">
            Executive Synthesis
          </div>
          <p class="text-slate-800 text-sm leading-relaxed font-semibold">${escapeHtml(
            feedback.executive_summary
          )}</p>
        </div>

        <div class="space-y-3">
          <h4 class="font-display text-lg tracking-tight">
            <span class="font-normal text-slate-500">Demonstrated</span> <span class="font-bold text-slate-800">Strengths</span>
          </h4>
          <ul class="grid grid-cols-1 gap-2.5">${
            strengthsHtml || "<li class='text-xs text-slate-500 font-medium'>None noted.</li>"
          }</ul>
        </div>

        <div class="space-y-3.5">
          <h4 class="font-display text-lg tracking-tight">
            <span class="font-normal text-slate-500">Actionable Learning Gaps</span> <span class="font-bold text-slate-800">&amp; Coaching</span>
          </h4>
          <div class="space-y-4">${
            gapsHtml ||
            "<p class='text-xs text-slate-500 font-medium'>No major learning gaps identified.</p>"
          }</div>
        </div>

        <div class="space-y-3">
          <h4 class="font-display text-lg tracking-tight">
            <span class="font-normal text-slate-500">Priority</span> <span class="font-bold text-slate-800">Revision Roadmap</span>
          </h4>
          <ol class="space-y-2.5">${roadmapHtml}</ol>
        </div>

        <blockquote class="rounded-2xl p-5 bg-ocean-50/50 border-l-4 border-ocean-500 text-slate-700 text-sm font-display italic font-medium leading-relaxed">
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
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-xs font-semibold">No criterion evaluations available.</p>`;
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
              `<pre class="bg-[#F8FAFC] text-slate-800 font-mono text-xs p-3.5 rounded-xl overflow-x-auto whitespace-pre-wrap leading-relaxed border border-[#E2E8F0] font-semibold">${escapeHtml(
                q
              )}</pre>`
          )
          .join("");

        const strengthsHtml = (ce.strengths_observed || [])
          .map((s) => `<li class="leading-relaxed font-semibold">&bull; ${escapeHtml(s)}</li>`)
          .join("");

        const flawsHtml = (ce.flaws_or_gaps_observed || [])
          .map((f) => `<li class="leading-relaxed font-semibold">&bull; ${escapeHtml(f)}</li>`)
          .join("");

        return `
        <div class="card-surface rounded-2xl overflow-hidden border border-[#E2E8F0] shadow-xs">
          <div class="px-5 py-3.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
              <span class="font-mono text-xs font-extrabold px-2.5 py-0.5 rounded bg-ocean-50 text-ocean-800 border border-ocean-200">${escapeHtml(
                ce.criterion_id
              )}</span>
              <h5 class="font-display text-base font-bold text-slate-800">${escapeHtml(
                ce.criterion_title
              )}</h5>
            </div>
            <div class="flex items-center gap-2 font-mono text-xs tabular-nums font-bold">
              <span class="px-2.5 py-1 rounded-lg bg-white border border-[#E2E8F0] text-slate-700">Init: ${Number(
                ce.initial_score
              ).toFixed(1)}</span>
              <span class="text-slate-500">&rarr;</span>
              <span class="px-3 py-1 rounded-lg bg-ocean-600 text-white font-bold shadow-xs">Final: ${Number(
                finalScore
              ).toFixed(1)} / ${Number(ce.max_points).toFixed(1)}</span>
              <span class="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-950 border border-emerald-200 text-[11px] uppercase font-extrabold">${escapeHtml(
                verdict
              )}</span>
            </div>
          </div>

          <div class="p-5 space-y-4 bg-white">
            <div class="w-full h-2.5 bg-[#F8FAFC] rounded-full overflow-hidden border border-[#E2E8F0]">
              <div class="h-full bg-ocean-500 rounded-full transition-all duration-500" style="width: ${pct.toFixed(
                1
              )}%"></div>
            </div>

            <p class="text-slate-700 text-xs sm:text-sm leading-relaxed"><strong class="text-slate-800 font-bold">Rationale:</strong> ${escapeHtml(
              ce.rationale
            )}</p>

            <div class="bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] space-y-1.5">
              <div class="text-[10px] font-mono font-bold uppercase tracking-wider text-ocean-700">
                Chain-of-Thought Verification Trace
              </div>
              <p class="text-slate-800 font-mono text-xs whitespace-pre-wrap leading-relaxed font-semibold">${escapeHtml(
                ce.chain_of_thought_trace
              )}</p>
            </div>

            ${
              quotesHtml
                ? `<div class="space-y-1.5"><div class="text-xs font-mono font-bold uppercase tracking-wider text-slate-600">Verbatim Student Evidence</div>${quotesHtml}</div>`
                : ""
            }

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
              <div class="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4">
                <div class="text-[10px] font-mono font-extrabold uppercase text-emerald-950 mb-1">Strengths Observed</div>
                <ul class="text-emerald-950 space-y-1 font-semibold">${strengthsHtml || "<li>None noted</li>"}</ul>
              </div>
              <div class="bg-rose-50/60 border border-rose-200 rounded-xl p-4">
                <div class="text-[10px] font-mono font-extrabold uppercase text-rose-950 mb-1">Flaws / Gaps Observed</div>
                <ul class="text-rose-950 space-y-1 font-semibold">${flawsHtml || "<li>None noted</li>"}</ul>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join("");

    panel.innerHTML = `
      <div class="space-y-4 animate-enter">
        <div class="card-surface rounded-2xl p-4 text-xs sm:text-sm leading-relaxed border border-[#E2E8F0] bg-[#F8FAFC]">
          <span class="font-mono uppercase text-[10px] tracking-wider text-ocean-700 font-bold block mb-1">
            Overall Comprehension Summary (${escapeHtml(initialEval.submission_modality)})
          </span>
          <span class="text-slate-800 font-bold">${escapeHtml(
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
      panel.innerHTML = `<p class="text-slate-500 text-center py-12 text-xs font-semibold">No reflection audit log available.</p>`;
      return;
    }

    const checksHtml = (reflectionAudit.bias_checks_performed || [])
      .map(
        (c) =>
          `<li class="flex items-center gap-2 text-xs text-slate-700 bg-[#F8FAFC] px-3.5 py-2.5 rounded-xl border border-[#E2E8F0] font-semibold"><span class="w-2.5 h-2.5 rounded-full bg-ocean-500 shrink-0"></span><span>${escapeHtml(
            c
          )}</span></li>`
      )
      .join("");

    const rowsHtml = (reflectionAudit.criterion_audits || [])
      .map(
        (ca) => `
        <tr class="border-t border-[#E2E8F0] hover:bg-ocean-50/30 text-xs">
          <td class="py-3.5 px-3 font-mono font-extrabold text-slate-800">${escapeHtml(ca.criterion_id)}</td>
          <td class="py-3.5 px-3 font-mono text-slate-500 tabular-nums font-bold">${Number(
            ca.initial_score
          ).toFixed(1)}</td>
          <td class="py-3.5 px-3 font-mono font-extrabold text-ocean-700 tabular-nums">${Number(
            ca.calibrated_score
          ).toFixed(1)}</td>
          <td class="py-3.5 px-3 font-mono font-extrabold text-amber-600 tabular-nums">${escapeHtml(
            formatDelta(ca.adjustment_delta)
          )}</td>
          <td class="py-3.5 px-3"><span class="font-mono text-[11px] font-extrabold px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#E2E8F0] text-slate-700">${escapeHtml(
            ca.audit_verdict
          )}</span></td>
          <td class="py-3.5 px-3 text-slate-800 font-semibold">${escapeHtml(ca.bias_or_error_detected)}</td>
          <td class="py-3.5 px-3 text-slate-600 font-medium">${escapeHtml(ca.calibration_reasoning)}</td>
        </tr>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="space-y-5 animate-enter">
        <div class="card-surface rounded-2xl p-5 space-y-2 border border-[#E2E8F0] bg-white">
          <div class="flex items-center justify-between">
            <span class="font-display text-base font-bold text-slate-800">Meta-Evaluator Audit Verdict</span>
            <span class="font-mono text-xs font-extrabold px-3 py-1 rounded-lg bg-ocean-50 text-ocean-800 border border-ocean-200 uppercase">${escapeHtml(
              reflectionAudit.audit_status
            )}</span>
          </div>
          <p class="text-xs sm:text-sm text-slate-700 leading-relaxed font-semibold">${escapeHtml(
            reflectionAudit.overall_audit_summary
          )}</p>
        </div>

        <div class="space-y-2.5">
          <h4 class="text-xs font-mono font-bold uppercase tracking-wider text-slate-600">
            Bias &amp; Calibration Checks Executed
          </h4>
          <ul class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">${checksHtml}</ul>
        </div>

        <div class="overflow-x-auto border border-[#E2E8F0] rounded-2xl bg-white shadow-xs">
          <table class="w-full text-left border-collapse">
            <thead class="bg-[#F8FAFC] text-slate-700 font-mono text-[11px] uppercase tracking-wider font-extrabold border-b border-[#E2E8F0]">
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

    el("report-student-header").innerHTML = `<span class="font-normal text-slate-500">${escapeHtml(record.student_name)}</span> <span class="font-bold text-slate-800">${
      record.student_id ? `(${escapeHtml(record.student_id)})` : ""
    } — ${escapeHtml(record.submission_filename)}</span>`;
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

    // Show indicator on report tab and update pill geometry if active
    el("report-ready-indicator")?.classList.remove("hidden");
    const reportBtn = el("flow-tab-report-btn");
    const isReport = !el("flow-view-report")?.classList.contains("hidden");
    if (isReport && reportBtn?.parentElement) {
      updateSlidingPill(reportBtn.parentElement, reportBtn, true);
    }
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

  async function loadEvaluationById(evaluationId, shouldSwitchFlow = true) {
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
    if (shouldSwitchFlow) {
      switchFlow("report");
    }
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

  let liveTimerInterval = null;
  let liveStartTime = 0;

  function startLiveTimer() {
    stopLiveTimer();
    liveStartTime = performance.now();
    const timerEl = el("live-agent-timer");
    if (timerEl) timerEl.textContent = "00:00.0";
    liveTimerInterval = setInterval(() => {
      const elapsedMs = performance.now() - liveStartTime;
      const totalSecs = Math.floor(elapsedMs / 1000);
      const mins = Math.floor(totalSecs / 60);
      const secs = totalSecs % 60;
      const tenths = Math.floor((elapsedMs % 1000) / 100);
      if (timerEl) {
        timerEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${tenths}`;
      }
    }, 100);
  }

  const progressController = {
    currentPct: 0,
    targetPct: 0,
    animFrameId: null,
    crawlTimer: null,

    startStage(stageName, startPct, crawlToPct) {
      this.setTarget(startPct, crawlToPct);
    },

    completeStage(completePct) {
      this.setTarget(completePct, null);
    },

    setTarget(target, crawlTarget = null) {
      this.targetPct = Math.max(5, Math.min(100, target));
      if (this.currentPct === 0) {
        this.currentPct = this.targetPct;
      }
      this._startRafLoop();

      if (this.crawlTimer) {
        clearInterval(this.crawlTimer);
        this.crawlTimer = null;
      }

      if (crawlTarget && crawlTarget > this.targetPct) {
        this.crawlTimer = setInterval(() => {
          if (this.targetPct < crawlTarget) {
            this.targetPct = Math.min(crawlTarget, this.targetPct + 0.7);
            this._startRafLoop();
          } else {
            clearInterval(this.crawlTimer);
            this.crawlTimer = null;
          }
        }, 300);
      }
    },

    _startRafLoop() {
      if (this.animFrameId) return;
      const step = () => {
        const diff = this.targetPct - this.currentPct;
        if (Math.abs(diff) < 0.2) {
          this.currentPct = this.targetPct;
          this._applyProgress(this.currentPct);
          this.animFrameId = null;
          return;
        }
        this.currentPct += diff * 0.18;
        this._applyProgress(this.currentPct);
        this.animFrameId = requestAnimationFrame(step);
      };
      this.animFrameId = requestAnimationFrame(step);
    },

    _applyProgress(pct) {
      const rounded = Math.round(pct);
      const pctLabelEl = el("live-progress-pct-label");
      if (pctLabelEl) pctLabelEl.textContent = `${rounded}%`;

      const barEl = el("live-pipeline-progress-bar") || el("evaluation-progress-fill");
      if (barEl) {
        const clamped = Math.max(5, Math.min(100, pct));
        barEl.style.width = `${clamped}%`;
        barEl.style.transform = `scaleX(${clamped / 100})`;
      }
    },

    reset() {
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      if (this.crawlTimer) {
        clearInterval(this.crawlTimer);
        this.crawlTimer = null;
      }
      this.currentPct = 0;
      this.targetPct = 0;
    },
  };

  function stopLiveTimer() {
    if (liveTimerInterval) {
      clearInterval(liveTimerInterval);
      liveTimerInterval = null;
    }
    if (progressController && progressController.crawlTimer) {
      clearInterval(progressController.crawlTimer);
      progressController.crawlTimer = null;
    }
  }

  function updateLiveProgress(pct, stageBadge, statusHeading, stageLabel, crawlTarget = null) {
    const card = el("live-agent-working-card");
    if (card) card.classList.remove("hidden");

    const badgeEl = el("live-agent-step-badge");
    if (badgeEl && stageBadge) badgeEl.textContent = stageBadge;

    const headingEl = el("live-agent-status-heading");
    if (headingEl && statusHeading) headingEl.textContent = statusHeading;

    const stageLabelEl = el("live-progress-stage-label");
    if (stageLabelEl && stageLabel) stageLabelEl.textContent = stageLabel;

    progressController.setTarget(pct, crawlTarget);
  }

  function renderFeedbackSkeleton() {
    return `
      <div class="space-y-6 animate-enter">
        <div class="card-inner rounded-2xl p-6 bg-white border border-[#E2E8F0] space-y-4">
          <div class="flex items-center justify-between">
            <div class="skeleton-shimmer h-5 w-48 rounded-md"></div>
            <div class="skeleton-shimmer h-6 w-24 rounded-full"></div>
          </div>
          <div class="space-y-2 pt-1">
            <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-11/12 rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-4/5 rounded"></div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div class="card-inner rounded-xl p-5 bg-white border border-emerald-100 space-y-3">
            <div class="flex items-center gap-2.5">
              <div class="skeleton-shimmer w-7 h-7 rounded-lg shrink-0"></div>
              <div class="skeleton-shimmer h-4 w-36 rounded"></div>
            </div>
            <div class="space-y-2 pt-1">
              <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
              <div class="skeleton-shimmer h-3.5 w-3/4 rounded"></div>
            </div>
          </div>
          <div class="card-inner rounded-xl p-5 bg-white border border-amber-100 space-y-3">
            <div class="flex items-center gap-2.5">
              <div class="skeleton-shimmer w-7 h-7 rounded-lg shrink-0"></div>
              <div class="skeleton-shimmer h-4 w-36 rounded"></div>
            </div>
            <div class="space-y-2 pt-1">
              <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
              <div class="skeleton-shimmer h-3.5 w-4/5 rounded"></div>
            </div>
          </div>
        </div>

        <div class="card-inner rounded-xl p-5 bg-white border border-[#E2E8F0] space-y-3">
          <div class="skeleton-shimmer h-4 w-44 rounded"></div>
          <div class="space-y-2 pt-1">
            <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-5/6 rounded"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderCriteriaSkeleton() {
    return `
      <div class="space-y-4 animate-enter">
        <div class="card-inner rounded-xl p-5 bg-white border border-[#E2E8F0] space-y-3.5">
          <div class="flex items-center justify-between">
            <div class="skeleton-shimmer h-5 w-44 rounded-md"></div>
            <div class="skeleton-shimmer h-6 w-20 rounded-full"></div>
          </div>
          <div class="space-y-2 pt-1">
            <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-5/6 rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-3/4 rounded"></div>
          </div>
          <div class="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-1.5">
            <div class="skeleton-shimmer h-3 w-1/3 rounded"></div>
            <div class="skeleton-shimmer h-3 w-2/3 rounded"></div>
          </div>
        </div>
        <div class="card-inner rounded-xl p-5 bg-white border border-[#E2E8F0] space-y-3.5">
          <div class="flex items-center justify-between">
            <div class="skeleton-shimmer h-5 w-52 rounded-md"></div>
            <div class="skeleton-shimmer h-6 w-20 rounded-full"></div>
          </div>
          <div class="space-y-2 pt-1">
            <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-4/5 rounded"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderReflectionSkeleton() {
    return `
      <div class="space-y-4 animate-enter">
        <div class="card-inner rounded-xl p-5 bg-white border border-[#E2E8F0] space-y-3.5">
          <div class="flex items-center justify-between">
            <div class="skeleton-shimmer h-5 w-48 rounded-md"></div>
            <div class="skeleton-shimmer h-6 w-24 rounded-full"></div>
          </div>
          <div class="space-y-2 pt-1">
            <div class="skeleton-shimmer h-3.5 w-full rounded"></div>
            <div class="skeleton-shimmer h-3.5 w-4/5 rounded"></div>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div class="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
              <div class="skeleton-shimmer h-3.5 w-2/3 rounded"></div>
              <div class="skeleton-shimmer h-3 w-full rounded"></div>
            </div>
            <div class="p-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] space-y-2">
              <div class="skeleton-shimmer h-3.5 w-1/2 rounded"></div>
              <div class="skeleton-shimmer h-3 w-full rounded"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function prepareReportForEvaluation(studentName, studentId, filename) {
    const header = el("report-student-header");
    if (header) {
      header.innerHTML = `<span class="font-normal text-slate-500">Grading In-Progress:</span> <span class="font-bold text-slate-800">${escapeHtml(
        studentName
      )}</span> <span class="text-slate-500 text-sm font-semibold">${
        studentId ? `(${escapeHtml(studentId)})` : ""
      } · ${escapeHtml(filename)}</span>`;
    }

    const auditBadge = el("report-audit-badge");
    if (auditBadge) {
      auditBadge.textContent = "Pipeline Running";
      auditBadge.className =
        "text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-ocean-50 text-ocean-800 border border-ocean-200 animate-pulse";
    }

    // Reset metric scores to shimmering skeleton placeholders
    if (el("hero-initial-score")) el("hero-initial-score").innerHTML = `<span class="skeleton-shimmer inline-block w-14 h-6 rounded-md"></span>`;
    if (el("hero-calibration-delta")) el("hero-calibration-delta").innerHTML = `<span class="skeleton-shimmer inline-block w-12 h-6 rounded-md"></span>`;
    if (el("hero-final-score")) el("hero-final-score").innerHTML = `<span class="skeleton-shimmer inline-block w-14 h-6 rounded-md"></span>`;
    if (el("hero-percentage")) el("hero-percentage").innerHTML = `<span class="skeleton-shimmer inline-block w-16 h-7 rounded-md"></span>`;
    if (el("hero-letter-grade")) el("hero-letter-grade").innerHTML = `<span class="skeleton-shimmer inline-block w-8 h-8 rounded-lg"></span>`;

    updateScoreRing(0);
    updateExportLinks(null);

    // Populate panels with structured skeleton sweeps during live evaluation
    const feedbackPanel = el("tab-panel-feedback");
    if (feedbackPanel) feedbackPanel.innerHTML = renderFeedbackSkeleton();

    const criteriaPanel = el("tab-panel-criteria");
    if (criteriaPanel) criteriaPanel.innerHTML = renderCriteriaSkeleton();

    const reflectionPanel = el("tab-panel-reflection");
    if (reflectionPanel) reflectionPanel.innerHTML = renderReflectionSkeleton();

    startLiveTimer();
    updateLiveProgress(10, "STAGE 1/4 · INITIALIZING", "Launching specialist evaluators & parsing rubric...", "Initializing Pipeline", 14);
    refreshIcons();
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

    const studentName = el("student-name-input").value.trim() || "Anonymous Student";
    const studentId = el("student-id-input").value.trim();
    const submissionFilename = el("submission-filename-input").value.trim() || "submission.txt";

    const runBtn = el("run-eval-btn");
    runBtn.disabled = true;

    // Immediately transition into the report / live progress view & reset old states
    switchFlow("report");
    resetPipelineStepper("Streaming 4-Agent Pipeline...");
    state.livePartial = { rubric: null, initialEval: null, reflection: null, feedback: null };
    prepareReportForEvaluation(studentName, studentId, submissionFilename);

    const payload = {
      assignment_id: state.activeAssignmentId,
      student_name: studentName,
      student_id: studentId,
      submission_filename: submissionFilename,
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
      stopLiveTimer();
      const card = el("live-agent-working-card");
      if (card) card.classList.add("hidden");
      showBanner(`Evaluation failed: ${err.message || err}`, true);
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = "Pipeline Error";
        overall.className =
          "text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg bg-rose-50 text-rose-950 border border-rose-300";
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
          "text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg bg-ocean-50 text-ocean-950 border border-ocean-200";
      }
      if (data.agent === "rubric_parser") {
        updateLiveProgress(15, "STAGE 1/4 · PARSER", "Deconstructing assignment rubric into atomic criteria...", "Agent 01: Rubric Parser", 32);
      } else if (data.agent === "cot_evaluator") {
        updateLiveProgress(40, "STAGE 2/4 · EVALUATOR", "Tracing code execution & evaluating criteria with Chain-of-Thought...", "Agent 02: Semantic CoT Evaluator", 57);
      } else if (data.agent === "reflection_auditor") {
        updateLiveProgress(65, "STAGE 3/4 · AUDITOR", "Auditing grading bias & calibrating confidence scores...", "Agent 03: Reflection Auditor", 82);
      } else if (data.agent === "feedback_synthesizer") {
        updateLiveProgress(85, "STAGE 4/4 · COACH", "Synthesizing executive summary & revision roadmap...", "Agent 04: Pedagogical Coach", 93);
      }
      return;
    }

    if (eventType === "agent_complete") {
      const tag = data.cached ? `cached (${data.duration_ms}ms)` : `${data.duration_ms}ms`;
      updateStageState(data.agent, "complete", tag);

      if (data.agent === "rubric_parser" && data.output) {
        state.livePartial.rubric = data.output;
        updateLiveProgress(35, "STAGE 1 COMPLETE", "Rubric deconstruction verified. Moving to code evaluation...", "Agent 01 Complete");
        const active = state.assignments.find((a) => a.id === state.activeAssignmentId);
        if (active) {
          active.structured_rubric = data.output;
          renderStructuredRubric(data.output);
          renderAssignmentsList();
        }
      } else if (data.agent === "cot_evaluator" && data.output) {
        state.livePartial.initialEval = data.output;
        updateLiveProgress(60, "STAGE 2 COMPLETE", "CoT evaluation generated. Transferring to bias auditor...", "Agent 02 Complete");
        renderCriteriaTab(state.livePartial.initialEval, null);
      } else if (data.agent === "reflection_auditor" && data.output) {
        state.livePartial.reflection = data.output;
        updateLiveProgress(85, "STAGE 3 COMPLETE", "Calibration & bias audit verified. Synthesizing coaching...", "Agent 03 Complete");
        renderCriteriaTab(state.livePartial.initialEval, state.livePartial.reflection);
        renderReflectionTab(state.livePartial.reflection);
      } else if (data.agent === "feedback_synthesizer" && data.output) {
        state.livePartial.feedback = data.output;
        updateLiveProgress(95, "STAGE 4 COMPLETE", "Pedagogical feedback generated. Finalizing package...", "Agent 04 Complete");
        renderFeedbackTab(state.livePartial.feedback);
      }
      return;
    }

    if (eventType === "evaluation_complete") {
      stopLiveTimer();
      updateLiveProgress(100, "COMPLETE", "Evaluation & Calibration Finished!", "All 4 Agents Complete");
      setTimeout(() => {
        const card = el("live-agent-working-card");
        if (card) card.classList.add("hidden");
      }, 1500);

      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = `Completed in ${data.duration_ms} ms`;
        overall.className =
          "text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-950 border border-emerald-300 tabular-nums";
      }
      renderFullEvaluationRecord(data);
      return;
    }

    if (eventType === "agent_error") {
      stopLiveTimer();
      progressController.reset();
      const card = el("live-agent-working-card");
      if (card) card.classList.add("hidden");
      showBanner(`Agent Pipeline Error: ${data.message}`, true);
      const overall = el("pipeline-overall-status");
      if (overall) {
        overall.textContent = "Error";
        overall.className =
          "text-xs font-mono font-bold px-3.5 py-1.5 rounded-lg bg-rose-50 text-rose-950 border border-rose-300";
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // R3: CRITICALLY DAMPED SPRING DRAWER & MODAL STATE MACHINES
  // Damping: 1.0 | Response: 0.35s | Duration: 350ms | Safety timeout: 380ms
  // Symmetrical dismiss along identical geometric path with transitionend
  // ═════════════════════════════════════════════════════════════════════════

  let historyCloseTimer = null;
  function openHistoryDrawer() {
    const drawer = el("history-drawer-modal");
    if (!drawer) return;
    if (historyCloseTimer) {
      clearTimeout(historyCloseTimer);
      historyCloseTimer = null;
    }
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    // Force layout reflow to establish initial transform: translateX(100%) and opacity: 0
    void drawer.offsetHeight;
    drawer.classList.add("is-open");
  }

  function closeHistoryDrawer() {
    const drawer = el("history-drawer-modal");
    if (!drawer) return;
    if (drawer.classList.contains("hidden") && !drawer.classList.contains("is-open")) return;

    if (historyCloseTimer) {
      clearTimeout(historyCloseTimer);
      historyCloseTimer = null;
    }

    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");

    let cleanedUp = false;
    const finishClose = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (historyCloseTimer) {
        clearTimeout(historyCloseTimer);
        historyCloseTimer = null;
      }
      if (!drawer.classList.contains("is-open")) {
        drawer.classList.add("hidden");
      }
    };

    // 380ms safety fallback timeout (350ms spring duration + 30ms headroom)
    historyCloseTimer = setTimeout(finishClose, 380);

    const animTarget = drawer.querySelector(".drawer-panel") || drawer;
    const onTransitionEnd = (e) => {
      if (e.target !== animTarget) return;
      animTarget.removeEventListener("transitionend", onTransitionEnd);
      finishClose();
    };
    animTarget.addEventListener("transitionend", onTransitionEnd, { once: true });
  }

  let modalCloseTimer = null;
  function openNewAssignmentModal() {
    const modal = el("new-assignment-modal");
    if (!modal) return;
    if (modalCloseTimer) {
      clearTimeout(modalCloseTimer);
      modalCloseTimer = null;
    }
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    // Force layout reflow to establish initial scale(0.95) and opacity: 0
    void modal.offsetHeight;
    modal.classList.add("is-open");
  }

  function closeNewAssignmentModal() {
    const modal = el("new-assignment-modal");
    if (!modal) return;
    if (modal.classList.contains("hidden") && !modal.classList.contains("is-open")) return;

    if (modalCloseTimer) {
      clearTimeout(modalCloseTimer);
      modalCloseTimer = null;
    }

    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    let cleanedUp = false;
    const finishClose = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (modalCloseTimer) {
        clearTimeout(modalCloseTimer);
        modalCloseTimer = null;
      }
      if (!modal.classList.contains("is-open")) {
        modal.classList.add("hidden");
      }
    };

    // 380ms safety fallback timeout (350ms spring duration + 30ms headroom)
    modalCloseTimer = setTimeout(finishClose, 380);

    const animTarget = modal.querySelector(".modal-surface") || modal;
    const onTransitionEnd = (e) => {
      if (e.target !== animTarget) return;
      animTarget.removeEventListener("transitionend", onTransitionEnd);
      finishClose();
    };
    animTarget.addEventListener("transitionend", onTransitionEnd, { once: true });
  }

  // Aliases for backward compatibility and test assertions
  const openHistory = openHistoryDrawer;
  const closeHistory = closeHistoryDrawer;
  const openModal = openNewAssignmentModal;
  const closeModal = closeNewAssignmentModal;
  window.openHistory = openHistory;
  window.closeHistory = closeHistory;
  window.openModal = openModal;
  window.closeModal = closeModal;

  function setupTabs() {
    const tabBar = el("report-tab-bar");
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
        state.activeReportTab = target;
        buttons.forEach((b) => {
          const active = b.getAttribute("data-tab") === target;
          b.setAttribute("aria-selected", active ? "true" : "false");
          b.className = active
            ? "report-tab-btn relative z-10 px-4 py-2 text-xs font-bold rounded-xl text-white transition-colors"
            : "report-tab-btn relative z-10 px-4 py-2 text-xs font-bold rounded-xl text-slate-600 hover:text-slate-800 hover:bg-white/60 transition-colors";
        });
        Object.entries(panels).forEach(([key, panel]) => {
          if (!panel) return;
          if (key === target) {
            panel.classList.remove("hidden");
          } else {
            panel.classList.add("hidden");
          }
        });
        if (tabBar) {
          updateSlidingPill(tabBar, btn, true);
        }
        refreshIcons();
      });
    });

    // Window resize synchronization with requestAnimationFrame debounce
    let resizeRaf = null;
    window.addEventListener("resize", () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        syncReportTabIndicator(false);
        const isReport = !el("flow-view-report")?.classList.contains("hidden");
        const activeFlowBtn = isReport ? el("flow-tab-report-btn") : el("flow-tab-setup-btn");
        const flowNav = activeFlowBtn?.parentElement;
        if (flowNav && activeFlowBtn) {
          updateSlidingPill(flowNav, activeFlowBtn, false);
        }
        resizeRaf = null;
      });
    });

    // Observe tab bar container resize if supported
    if (typeof ResizeObserver !== "undefined" && tabBar) {
      const ro = new ResizeObserver(() => {
        if (tabBar.offsetParent !== null) {
          syncReportTabIndicator(false);
        }
      });
      ro.observe(tabBar);
    }

    // Initial position sync (if report view is already visible)
    syncReportTabIndicator(false);
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
      dropzone.classList.add("border-ocean-500", "bg-ocean-50/50");
    });
    dropzone?.addEventListener("dragleave", () => {
      dropzone.classList.remove("border-ocean-500", "bg-ocean-50/50");
    });
    dropzone?.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("border-ocean-500", "bg-ocean-50/50");
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

    // New assignment modal triggers
    el("open-new-assignment-btn")?.addEventListener("click", openModal);
    el("close-new-assignment-btn")?.addEventListener("click", closeModal);
    el("cancel-new-assignment-btn")?.addEventListener("click", closeModal);

    // Backdrop click-outside handling
    el("new-assignment-modal")?.addEventListener("click", (e) => {
      if (e.target === el("new-assignment-modal")) {
        closeModal();
      }
    });

    // Global Escape Key Listener for Modals & Drawers
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || e.keyCode === 27) {
        const newAssignModal = el("new-assignment-modal");
        const histDrawer = el("history-drawer-modal");
        if (newAssignModal && !newAssignModal.classList.contains("hidden")) {
          closeModal();
        } else if (histDrawer && !histDrawer.classList.contains("hidden")) {
          closeHistory();
        }
      }
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        const isReport = !el("flow-view-report")?.classList.contains("hidden");
        const activeBtn = isReport ? el("flow-tab-report-btn") : el("flow-tab-setup-btn");
        const nav = activeBtn?.parentElement;
        if (nav && activeBtn) {
          updateSlidingPill(nav, activeBtn, false);
        }
        syncReportTabIndicator(false);
      });
    }

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
    // Synchronize Flow Stepper sliding active pill on initial load
    const setupBtn = el("flow-tab-setup-btn");
    const nav = setupBtn?.parentElement;
    if (nav && setupBtn) {
      updateSlidingPill(nav, setupBtn, false);
    }

    setupTabs();
    setupEventListeners();
    await fetchHealth();
    await fetchAssignmentsAndSeedIfNeeded();
    await fetchEvaluations();
    refreshIcons();
  });
})();
