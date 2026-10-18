"""Global Pytest Configuration & Fixtures for Opaque-Box E2E Testing."""

import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Optional

import pytest
from starlette.testclient import TestClient

from app.main import create_app


def pytest_configure(config: Any) -> None:
    """Register custom markers for 4-tier taxonomy and requirement mapping."""
    config.addinivalue_line("markers", "tier1: Tier 1 Feature Coverage tests")
    config.addinivalue_line("markers", "tier2: Tier 2 Boundary & Corner Case tests")
    config.addinivalue_line("markers", "tier3: Tier 3 Cross-Feature Combination tests")
    config.addinivalue_line("markers", "tier4: Tier 4 Real-World Application Scenario tests")
    config.addinivalue_line("markers", "r1: Requirement 1 Tactile Springs & Active Pills")
    config.addinivalue_line("markers", "r2: Requirement 2 Telemetry & Stepper Motion")
    config.addinivalue_line("markers", "r3: Requirement 3 Drawer & Modal Spring Physics")
    config.addinivalue_line("markers", "r4: Requirement 4 Skeleton Shimmer Sweeps")
    config.addinivalue_line("markers", "r5: Requirement 5 GPU Motion & Accessibility Audit")
    config.addinivalue_line("markers", "milestone1: Milestone 1 CSS Motion Engine")
    config.addinivalue_line("markers", "milestone2: Milestone 2 Active Pills & Modal/Drawer Springs")
    config.addinivalue_line("markers", "milestone3: Milestone 3 Telemetry & Skeletons")
    config.addinivalue_line("markers", "milestone4: Milestone 4 Final Hardening")


class DOMNode:
    """Represents a lightweight parsed DOM node."""

    def __init__(self, tag: str, attrs: dict[str, str], parent: Optional["DOMNode"] = None):
        self.tag = tag.lower()
        self.attrs = attrs
        self.parent = parent
        self.children: list[DOMNode] = []
        self.text_fragments: list[str] = []

    @property
    def id(self) -> str:
        return self.attrs.get("id", "")

    @property
    def classes(self) -> list[str]:
        class_str = self.attrs.get("class", "")
        return [c for c in class_str.split() if c]

    @property
    def text(self) -> str:
        return "".join(self.text_fragments).strip()


class DOMTree(HTMLParser):
    """Simple DOM tree builder based on standard library HTMLParser."""

    def __init__(self, html: str):
        super().__init__()
        self.root = DOMNode("document", {})
        self.current = self.root
        self.all_nodes: list[DOMNode] = []
        self.feed(html)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr_dict = {k.lower(): (v if v is not None else "") for k, v in attrs}
        node = DOMNode(tag, attr_dict, self.current)
        self.current.children.append(node)
        self.all_nodes.append(node)
        # Handle self-closing tags
        if tag.lower() not in {"meta", "link", "img", "br", "hr", "input"}:
            self.current = node

    def handle_endtag(self, tag: str) -> None:
        if self.current.parent is not None and self.current.tag == tag.lower():
            self.current = self.current.parent

    def handle_data(self, data: str) -> None:
        clean = data.strip()
        if clean:
            self.current.text_fragments.append(clean)

    def find_by_id(self, elem_id: str) -> DOMNode | None:
        for node in self.all_nodes:
            if node.id == elem_id:
                return node
        return None

    def find_all_by_class(self, class_name: str) -> list[DOMNode]:
        return [node for node in self.all_nodes if class_name in node.classes]

    def find_all_by_tag(self, tag_name: str) -> list[DOMNode]:
        t = tag_name.lower()
        return [node for node in self.all_nodes if node.tag == t]


class CSSParser:
    """Lexical extractor for CSS variables, keyframes, and media queries."""

    def __init__(self, css_text: str):
        self.css_text = css_text

    def get_variables(self) -> dict[str, str]:
        """Extract :root CSS variables with comment stripping."""
        vars_dict: dict[str, str] = {}
        clean_css = re.sub(r"/\*.*?\*/", "", self.css_text, flags=re.DOTALL)
        root_match = re.search(r":root\s*\{([^}]+)\}", clean_css, re.DOTALL)
        if root_match:
            lines = root_match.group(1).split(";")
            for line in lines:
                parts = line.split(":", 1)
                if len(parts) == 2 and parts[0].strip().startswith("--"):
                    vars_dict[parts[0].strip()] = parts[1].strip()
        return vars_dict

    def get_keyframes(self) -> dict[str, str]:
        """Extract @keyframes declarations with nested brace tracking."""
        keyframes: dict[str, str] = {}
        pattern = re.compile(r"@keyframes\s+([a-zA-Z0-9_-]+)\s*\{")
        for match in pattern.finditer(self.css_text):
            name = match.group(1).strip()
            start = match.end()
            depth = 1
            i = start
            while i < len(self.css_text) and depth > 0:
                if self.css_text[i] == "{":
                    depth += 1
                elif self.css_text[i] == "}":
                    depth -= 1
                i += 1
            keyframes[name] = self.css_text[start:i - 1].strip()
        return keyframes

    def get_media_queries(self) -> dict[str, str]:
        """Extract @media blocks with nested brace tracking."""
        media_blocks: dict[str, str] = {}
        pattern = re.compile(r"@media\s*\(([^)]+)\)\s*\{")
        for match in pattern.finditer(self.css_text):
            query = match.group(1).strip()
            start = match.end()
            depth = 1
            i = start
            while i < len(self.css_text) and depth > 0:
                if self.css_text[i] == "{":
                    depth += 1
                elif self.css_text[i] == "}":
                    depth -= 1
                i += 1
            media_blocks[query] = self.css_text[start:i - 1].strip()
        return media_blocks


class A11yEngine:
    """WCAG 2.2 Relative Luminance and Text Contrast Evaluation Engine."""

    @staticmethod
    def hex_to_rgb(hex_str: str) -> tuple[int, int, int]:
        h = hex_str.strip().lstrip("#")
        if len(h) == 3:
            h = "".join([c * 2 for c in h])
        if len(h) != 6:
            return (0, 0, 0)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    @classmethod
    def relative_luminance(cls, hex_color: str) -> float:
        r_255, g_255, b_255 = cls.hex_to_rgb(hex_color)

        def channel_lum(val: int) -> float:
            c = val / 255.0
            return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

        r = channel_lum(r_255)
        g = channel_lum(g_255)
        b = channel_lum(b_255)
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    @classmethod
    def contrast_ratio(cls, hex_fg: str, hex_bg: str) -> float:
        l1 = cls.relative_luminance(hex_fg)
        l2 = cls.relative_luminance(hex_bg)
        lighter = max(l1, l2)
        darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    """Returns a test client isolated with a temporary SQLite database."""
    test_db = tmp_path / "e2e_test.db"
    app = create_app(db_path=str(test_db))
    return TestClient(app)


@pytest.fixture
def index_html(client: TestClient) -> str:
    """Fetches the root index.html."""
    res = client.get("/")
    assert res.status_code == 200
    return res.text


@pytest.fixture
def dom_tree(index_html: str) -> DOMTree:
    """Returns a parsed DOM tree of index.html."""
    return DOMTree(index_html)


@pytest.fixture
def studio_css(client: TestClient) -> str:
    """Fetches the /static/studio.css stylesheet."""
    res = client.get("/static/studio.css")
    assert res.status_code == 200
    return res.text


@pytest.fixture
def css_parser(studio_css: str) -> CSSParser:
    """Returns a parsed CSS helper."""
    return CSSParser(studio_css)


@pytest.fixture
def app_js(client: TestClient) -> str:
    """Fetches the /static/app.js client controller."""
    res = client.get("/static/app.js")
    assert res.status_code == 200
    return res.text
