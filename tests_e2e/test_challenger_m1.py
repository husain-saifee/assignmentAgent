"""Empirical Adversarial Verification Suite for Milestone 1.

Authored by: challenger_m1_1 (Empirical Challenger)
Validates strict GPU motion, spring timing, tactile recoil, breathing glow isolation,
and zero layout thrashing across studio.css and index.html.
"""

import re
from pathlib import Path

import pytest

from tests_e2e.conftest import CSSParser


@pytest.fixture
def raw_studio_css() -> str:
    css_path = Path("app/static/studio.css")
    assert css_path.exists(), f"Stylesheet not found at {css_path}"
    return css_path.read_text(encoding="utf-8")


@pytest.fixture
def raw_index_html() -> str:
    html_path = Path("app/static/index.html")
    assert html_path.exists(), f"Index HTML not found at {html_path}"
    return html_path.read_text(encoding="utf-8")


def test_adversarial_m1_no_layout_thrashing_transitions(raw_studio_css: str, css_parser: CSSParser):
    """Verify that NO transitions on width, height, margin, or padding exist on interactive elements."""
    forbidden_props = ["width", "height", "margin", "padding"]
    target_selectors = [
        r"\.btn\b",
        r"\[data-slot=\"button\"\]",
        r"\.stage-card\b",
        r"\.assign-card-item\b",
        r"\.eval-history-row\b",
        r"#submission-dropzone\b",
        r"\.card-surface\b",
        r"\.node-running\b",
    ]

    # Clean CSS of comments to avoid false positives
    clean_css = re.sub(r"/\*.*?\*/", "", raw_studio_css, flags=re.DOTALL)

    # Find all rules matching our target selectors
    for pattern in target_selectors:
        # Match selector blocks
        rule_matches = re.finditer(rf"([^{{]*{pattern}[^{{]*)\{{([^}}]+)\}}", clean_css)
        matched_any = False
        for match in rule_matches:
            matched_any = True
            selector = match.group(1).strip()
            declarations = match.group(2).strip()

            # Check transition declarations
            trans_matches = re.findall(r"(?:transition|transition-property)\s*:\s*([^;]+);", declarations, re.IGNORECASE)
            for trans_val in trans_matches:
                trans_lower = trans_val.lower()
                for prop in forbidden_props:
                    # Look for forbidden property as a word token in transition declaration
                    assert not re.search(rf"\b{prop}\b", trans_lower), (
                        f"Forbidden layout transition '{prop}' found in rule '{selector}' with declaration: '{trans_val}'"
                    )
        assert matched_any, f"Expected selector matching pattern {pattern} in studio.css"


def test_adversarial_m1_active_press_recoil_and_duration(raw_studio_css: str):
    """Verify that :active press recoil uses scale(0.975–0.985) and var(--duration-tactile-down)."""
    clean_css = re.sub(r"/\*.*?\*/", "", raw_studio_css, flags=re.DOTALL)

    active_button_match = re.search(r"(\.btn:active[^{]*)\{([^}]+)\}", clean_css)
    assert active_button_match is not None, "Missing .btn:active rule in studio.css"
    btn_block = active_button_match.group(2)

    # Verify scale
    scale_match = re.search(r"scale\(([0-9.]+)\)", btn_block)
    assert scale_match is not None, "scale() missing in .btn:active"
    btn_scale = float(scale_match.group(1))
    assert 0.975 <= btn_scale <= 0.98, f"Expected .btn:active scale in [0.975, 0.98], got {btn_scale}"

    # Verify duration
    assert "var(--duration-tactile-down)" in btn_block, (
        ".btn:active transition must reference var(--duration-tactile-down)"
    )

    # Check card active recoil (.assign-card-item and .eval-history-row)
    card_active_match = re.search(r"(\.assign-card-item:active[^{]*)\{([^}]+)\}", clean_css)
    assert card_active_match is not None, "Missing card :active rule in studio.css"
    card_block = card_active_match.group(2)

    card_scale_match = re.search(r"scale\(([0-9.]+)\)", card_block)
    assert card_scale_match is not None, "scale() missing in card :active"
    card_scale = float(card_scale_match.group(1))
    assert 0.975 <= card_scale <= 0.98, f"Expected card:active scale in [0.975, 0.98], got {card_scale}"
    assert "var(--duration-tactile-down)" in card_block, (
        "card:active transition must reference var(--duration-tactile-down)"
    )


def test_adversarial_m1_tactile_durations_in_calibrated_bounds(css_parser: CSSParser):
    """Verify that --duration-tactile-down is in 0–40ms and --duration-tactile-up is in 120–160ms."""
    vars_dict = css_parser.get_variables()

    assert "--duration-tactile-down" in vars_dict, "Missing --duration-tactile-down token"
    down_val_str = vars_dict["--duration-tactile-down"].strip().lower()
    down_ms = float(re.sub(r"[^0-9.]", "", down_val_str))
    assert 0.0 <= down_ms <= 40.0, f"--duration-tactile-down must be in [0ms, 40ms], got {down_ms}ms"

    assert "--duration-tactile-up" in vars_dict, "Missing --duration-tactile-up token"
    up_val_str = vars_dict["--duration-tactile-up"].strip().lower()
    up_ms = float(re.sub(r"[^0-9.]", "", up_val_str))
    assert 120.0 <= up_ms <= 160.0, f"--duration-tactile-up must be in [120ms, 160ms], got {up_ms}ms"


def test_adversarial_m1_ease_spring_cubic_bezier(css_parser: CSSParser):
    """Verify that --ease-spring equals cubic-bezier(0.16, 1, 0.3, 1)."""
    vars_dict = css_parser.get_variables()
    assert "--ease-spring" in vars_dict, "Missing --ease-spring token"
    spring_val = vars_dict["--ease-spring"].strip()

    # Parse cubic-bezier parameters
    bezier_match = re.search(r"cubic-bezier\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)", spring_val)
    assert bezier_match is not None, f"--ease-spring is not cubic-bezier: {spring_val}"
    x1, y1, x2, y2 = [float(v) for v in bezier_match.groups()]

    assert x1 == pytest.approx(0.16, abs=0.01), f"x1 should be ~0.16, got {x1}"
    assert y1 == pytest.approx(1.0, abs=0.01), f"y1 should be ~1.0, got {y1}"
    assert x2 == pytest.approx(0.30, abs=0.01), f"x2 should be ~0.30, got {x2}"
    assert y2 == pytest.approx(1.0, abs=0.01), f"y2 should be ~1.0, got {y2}"


def test_adversarial_m1_node_running_box_shadow_delegation_to_pseudo_element(raw_studio_css: str, css_parser: CSSParser):
    """Verify that .node-running does NOT animate box-shadow directly in keyframes, but delegates breathing glow to ::after."""
    clean_css = re.sub(r"/\*.*?\*/", "", raw_studio_css, flags=re.DOTALL)

    # 1. Assert .node-running itself has no animation property animating box-shadow
    node_running_match = re.search(r"\.node-running\s*\{([^}]+)\}", clean_css)
    assert node_running_match is not None, "Missing .node-running in studio.css"
    node_decl = node_running_match.group(1)
    assert "animation" not in node_decl, ".node-running directly should not define animation; use ::after"

    # 2. Assert .node-running::after exists and has animation
    after_match = re.search(r"\.node-running::after\s*\{([^}]+)\}", clean_css)
    assert after_match is not None, "Missing .node-running::after rule in studio.css"
    after_decl = after_match.group(1)
    assert "animation" in after_decl, ".node-running::after must declare animation"

    # 3. Check all keyframes: nodeBreathingGlow or any keyframes MUST NOT animate box-shadow
    keyframes = css_parser.get_keyframes()
    assert "nodeBreathingGlow" in keyframes, "Missing @keyframes nodeBreathingGlow in studio.css"
    glow_body = keyframes["nodeBreathingGlow"]

    assert "box-shadow" not in glow_body.lower(), (
        f"@keyframes nodeBreathingGlow MUST NOT animate box-shadow! Body: {glow_body}"
    )
    assert "opacity" in glow_body.lower(), "@keyframes nodeBreathingGlow should animate opacity"
    assert "transform" in glow_body.lower(), "@keyframes nodeBreathingGlow should animate transform"


def test_adversarial_m1_stage_card_constant_border_prevents_layout_shift(raw_studio_css: str):
    """Verify that all stage card states enforce border-width: 1px to avoid 1px box-shift layout jitter."""
    clean_css = re.sub(r"/\*.*?\*/", "", raw_studio_css, flags=re.DOTALL)

    card_rules = [r"\.stage-card\b", r"\.node-running\b", r"\.node-complete\b", r"\.node-error\b"]
    for cr in card_rules:
        match = re.search(rf"{cr}[^{{]*\{{([^}}]+)\}}", clean_css)
        assert match is not None, f"Missing rule for {cr}"
        decl = match.group(1)
        border_width_match = re.search(r"border-width\s*:\s*([^;]+);", decl)
        assert border_width_match is not None, f"{cr} must explicitly specify border-width"
        bw = border_width_match.group(1).strip()
        assert "1px" in bw, f"{cr} border-width must be 1px to prevent box-shift jitter, got {bw}"


def test_adversarial_m1_index_html_contrast_and_invariants(raw_index_html: str):
    """Verify 0 instances of low-contrast slate-400 and preservation of critical string invariants."""
    # Low-contrast check
    assert "slate-400" not in raw_index_html, (
        "Found failing low-contrast 'slate-400' in index.html (violates WCAG AA 4.5:1)"
    )

    # Invariant checks
    assert "Run 4-Agent Evaluation" in raw_index_html, (
        "Critical button text 'Run 4-Agent Evaluation' was altered or removed"
    )
    required_models = [
        "gemini-2.5-flash",
        "gemini-2.5-pro",
        "gemini-3.8-flash",
        "gemini-3.1-pro-preview",
    ]
    for model in required_models:
        assert model in raw_index_html, f"Required model {model} missing in index.html"


if __name__ == "__main__":
    import sys
    pytest.main([__file__, "-v"] + sys.argv[1:])
