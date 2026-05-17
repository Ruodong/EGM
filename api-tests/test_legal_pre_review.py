"""Tests for the Legal Pre-Review endpoint (claude-for-legal PoC integration)."""
import httpx
import pytest

BASE_URL = "http://localhost:4001/api"

ADMIN = {"X-Dev-Role": "admin"}
REVIEWER = {"X-Dev-Role": "domain_reviewer"}


class TestLegalPreReview:
    """Smoke tests for POST /domain-reviews/{id}/legal-pre-review."""

    def test_endpoint_responds(self, client: httpx.Client, submitted_request_with_reviews):
        """Endpoint returns 200 with draft (LLM configured) or 503 (not configured)."""
        review_id = submitted_request_with_reviews["reviewId"]
        with httpx.Client(base_url=BASE_URL, timeout=120) as c:
            resp = c.post(
                f"/domain-reviews/{review_id}/legal-pre-review",
                json={},
                headers=ADMIN,
            )
            # 200 = LLM configured, 503 = LLM env vars not set,
            # 502 = LLM call failed (e.g., network/auth)
            assert resp.status_code in (200, 502, 503)
            if resp.status_code == 200:
                body = resp.json()
                assert isinstance(body.get("draft"), str) and body["draft"]
                assert body["plugin"] == "claude-for-legal/commercial-legal"
                assert isinstance(body["skillsUsed"], list) and body["skillsUsed"]
                assert body["domainCode"]

    def test_not_found(self, client: httpx.Client):
        """Returns 404 for nonexistent domain review."""
        resp = client.post(
            "/domain-reviews/00000000-0000-0000-0000-000000000000/legal-pre-review",
            json={},
            headers=ADMIN,
        )
        assert resp.status_code == 404


class TestLegalPluginAssets:
    """The vendored plugin files must be present at the expected path."""

    def test_vendored_plugin_files_present(self):
        import pathlib

        root = pathlib.Path(__file__).resolve().parents[1] / ".claude" / "plugins" / "claude-for-legal" / "commercial-legal"
        assert root.exists(), f"Plugin not vendored at {root}"
        assert (root / "CLAUDE.md").exists()
        assert (root / "skills" / "review" / "SKILL.md").exists()
        assert (root / "skills" / "vendor-agreement-review" / "SKILL.md").exists()
