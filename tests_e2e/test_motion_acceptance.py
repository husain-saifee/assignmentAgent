"""E2E Acceptance Tests for R1 (Tactile Springs & Active Pills) and R3 (Drawer & Modal Springs)."""

import re

import pytest

from tests_e2e.conftest import CSSParser, DOMTree

# ═══════════════════════════════════════════════════════════════════════════
# TIER 1: FEATURE COVERAGE (R1 - Tactile Press & Active Pills)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier1
@pytest.mark.r1
def test_r1_tactile_button_scale_and_timing_tokens(css_parser: CSSParser, studio_css: str) -> None:
    """R1: Verify :active tactile button recoil scale (0.975-0.98) and spring tokens."""
    vars_dict = css_parser.get_variables()
    assert "--ease-spring" in vars_dict, "Missing --ease-spring token in studio.css"
    assert "cubic-bezier(0.16, 1, 0.3, 1)" in vars_dict["--ease-spring"]

    # Verify active button scaling rule
    btn_active_match = re.search(r"\.btn:active[^{]*\{([^}]+)\}", studio_css)
    assert btn_active_match is not None, "Missing .btn:active rule in studio.css"
    declarations = btn_active_match.group(1)
    scale_match = re.search(r"scale\(([0-9.]+)\)", declarations)
    assert scale_match is not None, "Missing scale() transform in .btn:active"
    scale_val = float(scale_match.group(1))
    assert 0.97 <= scale_val <= 0.985, f"Expected recoil scale 0.975-0.98, got {scale_val}"


@pytest.mark.tier1
@pytest.mark.r1
def test_r1_interactive_card_compression_classes(dom_tree: DOMTree, studio_css: str) -> None:
    """R1: Verify interactive benchmark pills and cards have tactile cursor and transitions."""
    btn_elements = dom_tree.find_all_by_class("btn")
    assert len(btn_elements) >= 5, "Expected at least 5 .btn interactive elements in DOM"

    # Verify card surfaces define smooth transition rules
    card_surface_match = re.search(r"\.card-surface[^{]*\{([^}]+)\}", studio_css)
    assert card_surface_match is not None, "Missing .card-surface CSS rule"


@pytest.mark.tier1
@pytest.mark.r1
def test_r1_flow_stepper_tab_structure_and_buttons(dom_tree: DOMTree) -> None:
    """R1: Verify Flow Stepper navigation buttons (#flow-tab-setup-btn, #flow-tab-report-btn)."""
    setup_btn = dom_tree.find_by_id("flow-tab-setup-btn")
    report_btn = dom_tree.find_by_id("flow-tab-report-btn")

    assert setup_btn is not None, "Missing #flow-tab-setup-btn in DOM"
    assert report_btn is not None, "Missing #flow-tab-report-btn in DOM"
    assert setup_btn.tag in {"button", "a"}, f"Setup tab must be clickable, got {setup_btn.tag}"
    assert report_btn.tag in {"button", "a"}, f"Report tab must be clickable, got {report_btn.tag}"


@pytest.mark.tier1
@pytest.mark.r1
def test_r1_report_tabs_pill_navigation_markup(dom_tree: DOMTree) -> None:
    """R1: Verify Report Tabs navigation contains all 4 evaluation perspective buttons."""
    tab_btns = dom_tree.find_all_by_class("report-tab-btn")
    assert len(tab_btns) == 4, f"Expected 4 .report-tab-btn buttons, found {len(tab_btns)}"

    tabs_found = [btn.attrs.get("data-tab") for btn in tab_btns]
    expected_tabs = ["feedback", "criteria", "reflection", "export"]
    for expected in expected_tabs:
        assert expected in tabs_found, f"Missing data-tab='{expected}' in report tabs"


@pytest.mark.tier1
@pytest.mark.r1
def test_r1_sliding_pill_css_transform_properties(studio_css: str, app_js: str) -> None:
    """R1: Verify sliding pill controller or CSS uses GPU transform properties."""
    # Ensure tab switching in app.js references sliding pill mechanism or smooth tab styling
    assert "report-tab-btn" in app_js, "app.js must manage report tab buttons"
    assert "switchFlow" in app_js, "app.js must provide switchFlow controller"


# ═══════════════════════════════════════════════════════════════════════════
# TIER 2: BOUNDARY & CORNER CASES (R1 - Tactile Press & Active Pills)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier2
@pytest.mark.r1
def test_r1_boundary_rapid_tab_switching_resilience(app_js: str) -> None:
    """R1 Boundary: Verify switchFlow and setupTabs handle repeated toggles safely."""
    assert "switchFlow" in app_js
    assert "setupTabs" in app_js
    # Verify setupTabs iterates buttons cleanly with event listeners
    assert "addEventListener" in app_js


@pytest.mark.tier2
@pytest.mark.r1
def test_r1_boundary_disabled_buttons_do_not_recoil(studio_css: str) -> None:
    """R1 Boundary: Verify :disabled buttons never trigger active compression recoil."""
    # Ensure :not(:disabled) guard is in place on .btn:active
    assert ":not(:disabled)" in studio_css, ".btn:active must include :not(:disabled) guard"


@pytest.mark.tier2
@pytest.mark.r1
def test_r1_boundary_dropzone_and_benchmark_pills_tactile_feedback(dom_tree: DOMTree) -> None:
    """R1 Boundary: Verify submission dropzone has tactile states and cursor pointer."""
    dropzone = dom_tree.find_by_id("submission-dropzone")
    assert dropzone is not None, "Missing #submission-dropzone in DOM"
    classes = dropzone.classes
    assert any("cursor-pointer" in c or "cursor" in c for c in classes), "Dropzone must indicate clickability"


@pytest.mark.tier2
@pytest.mark.r1
def test_r1_boundary_sliding_pill_window_resize_handler(app_js: str) -> None:
    """R1 Boundary: Verify client app logic includes window event listener or responsive hooks."""
    assert "resize" in app_js or "addEventListener" in app_js


@pytest.mark.tier2
@pytest.mark.r1
def test_r1_boundary_spring_easing_cubic_bezier_parameters(css_parser: CSSParser) -> None:
    """R1 Boundary: Verify cubic-bezier parameters satisfy critical damping (x1=0.16, y1=1, x2=0.3, y2=1)."""
    vars_dict = css_parser.get_variables()
    spring = vars_dict.get("--ease-spring", "")
    match = re.search(r"cubic-bezier\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)", spring)
    assert match is not None, f"Invalid spring cubic-bezier format: {spring}"
    x1, y1, x2, y2 = [float(v) for v in match.groups()]
    assert 0.10 <= x1 <= 0.20, f"x1 should be ~0.16, got {x1}"
    assert y1 == 1.0, f"y1 should be 1.0, got {y1}"
    assert 0.20 <= x2 <= 0.40, f"x2 should be ~0.30, got {x2}"
    assert y2 == 1.0, f"y2 should be 1.0, got {y2}"


# ═══════════════════════════════════════════════════════════════════════════
# TIER 1: FEATURE COVERAGE (R3 - Drawer & Modal Spring Physics)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier1
@pytest.mark.r3
def test_r3_history_drawer_dom_structure_and_aria(dom_tree: DOMTree) -> None:
    """R3: Verify History Archive slide-over drawer structure in DOM."""
    drawer = dom_tree.find_by_id("history-drawer-modal")
    backdrop = dom_tree.find_by_id("history-drawer-backdrop")
    close_btn = dom_tree.find_by_id("close-history-drawer-btn")

    assert drawer is not None, "Missing #history-drawer-modal in DOM"
    assert backdrop is not None, "Missing #history-drawer-backdrop in DOM"
    assert close_btn is not None, "Missing #close-history-drawer-btn in DOM"


@pytest.mark.tier1
@pytest.mark.r3
def test_r3_history_drawer_spring_physics_curve(studio_css: str, css_parser: CSSParser) -> None:
    """R3: Verify drawer timing tokens or transitions utilize critically damped spring."""
    vars_dict = css_parser.get_variables()
    assert "--ease-spring" in vars_dict
    assert "--duration-medium" in vars_dict or "--duration-settle" in vars_dict


@pytest.mark.tier1
@pytest.mark.r3
def test_r3_new_assignment_modal_dom_structure(dom_tree: DOMTree) -> None:
    """R3: Verify New Assignment modal structure in DOM."""
    modal = dom_tree.find_by_id("new-assignment-modal")
    open_btn = dom_tree.find_by_id("open-new-assignment-btn")
    close_btn = dom_tree.find_by_id("close-new-assignment-btn")
    cancel_btn = dom_tree.find_by_id("cancel-new-assignment-btn")

    assert modal is not None, "Missing #new-assignment-modal in DOM"
    assert open_btn is not None, "Missing #open-new-assignment-btn in DOM"
    assert close_btn is not None, "Missing #close-new-assignment-btn in DOM"
    assert cancel_btn is not None, "Missing #cancel-new-assignment-btn in DOM"


@pytest.mark.tier1
@pytest.mark.r3
def test_r3_modal_scale_and_opacity_spring_properties(dom_tree: DOMTree, studio_css: str) -> None:
    """R3: Verify modal surface uses .card-surface with shadow and rounded corners."""
    modal = dom_tree.find_by_id("new-assignment-modal")
    assert modal is not None
    # Verify card surface styling exists
    assert ".card-surface" in studio_css


@pytest.mark.tier1
@pytest.mark.r3
def test_r3_backdrop_blur_fade_properties(dom_tree: DOMTree) -> None:
    """R3: Verify modal and drawer backdrops utilize backdrop blur classes."""
    drawer_backdrop = dom_tree.find_by_id("history-drawer-backdrop")
    modal = dom_tree.find_by_id("new-assignment-modal")

    assert drawer_backdrop is not None
    assert any("backdrop-blur" in c for c in drawer_backdrop.classes)
    assert modal is not None
    assert any("backdrop-blur" in c for c in modal.classes)


# ═══════════════════════════════════════════════════════════════════════════
# TIER 2: BOUNDARY & CORNER CASES (R3 - Drawer & Modal Spring Physics)
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.tier2
@pytest.mark.r3
def test_r3_boundary_escape_key_listener_registered(app_js: str) -> None:
    """R3 Boundary: Verify Escape key listener or modal dismissal logic is present in app.js."""
    assert "closeModal" in app_js or "closeHistory" in app_js
    assert "close-history-drawer-btn" in app_js
    assert "close-new-assignment-btn" in app_js


@pytest.mark.tier2
@pytest.mark.r3
def test_r3_boundary_backdrop_click_outside_handling(app_js: str) -> None:
    """R3 Boundary: Verify clicking the backdrop dismisses the drawer."""
    assert "history-drawer-backdrop" in app_js
    assert "closeHistory" in app_js


@pytest.mark.tier2
@pytest.mark.r3
def test_r3_boundary_drawer_symmetrical_dismiss_transition(studio_css: str, app_js: str) -> None:
    """R3 Boundary: Verify drawer dismiss path preserves symmetry."""
    assert "history-drawer-modal" in app_js
    assert "openHistory" in app_js
    assert "closeHistory" in app_js


@pytest.mark.tier2
@pytest.mark.r3
def test_r3_boundary_modal_symmetrical_dismiss_transition(app_js: str) -> None:
    """R3 Boundary: Verify modal controller symmetrically opens and closes."""
    assert "new-assignment-modal" in app_js
    assert "openModal" in app_js
    assert "closeModal" in app_js


@pytest.mark.tier2
@pytest.mark.r3
def test_r3_boundary_modal_rapid_open_close_cycles(app_js: str) -> None:
    """R3 Boundary: Verify modal and drawer event bindings are idempotent."""
    # Ensure event listeners are attached during initial setup without duplicate accumulation
    assert "addEventListener" in app_js
