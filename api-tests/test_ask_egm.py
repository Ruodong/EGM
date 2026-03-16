"""Tests for Ask EGM — AI chat endpoints."""
import httpx
import pytest

BASE_URL = "http://localhost:4001/api"

ADMIN = {"X-Dev-Role": "admin"}
REVIEWER = {"X-Dev-Role": "domain_reviewer"}
REQUESTOR = {"X-Dev-Role": "requestor"}


class TestAskEgm:
    """Ask EGM conversation history and chat tests."""

    def test_get_history_empty(self, client: httpx.Client, submitted_request_with_reviews):
        """History is empty for a new domain review."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert isinstance(data, list)
        assert len(data) == 0

    def test_chat_returns_sse_or_503(self, client: httpx.Client, submitted_request_with_reviews):
        """POST chat returns SSE stream (200) or 503 if Azure OpenAI not configured."""
        review_id = submitted_request_with_reviews["reviewId"]
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "Hello, what is this review about?"},
                headers=ADMIN,
            )
            # 200 = Azure OpenAI configured, 503 = not configured
            assert resp.status_code in (200, 503)
            if resp.status_code == 200:
                assert "text/event-stream" in resp.headers.get("content-type", "")
                assert "data:" in resp.text

    def test_chat_saves_user_message_when_configured(self, client: httpx.Client, submitted_request_with_reviews):
        """When Azure OpenAI is configured, chat persists user + assistant messages."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Clear any prior history
        client.delete(f"/ask-egm/{review_id}/history", headers=ADMIN)

        # Attempt a chat
        with httpx.Client(base_url=BASE_URL, timeout=60) as c:
            resp = c.post(
                f"/ask-egm/{review_id}/chat",
                json={"message": "List the key risks"},
                headers=ADMIN,
            )
        if resp.status_code == 503:
            pytest.skip("Azure OpenAI not configured — skipping persistence check")

        # Check history has user message
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        user_msgs = [m for m in data if m["role"] == "user"]
        assert len(user_msgs) >= 1

    def test_clear_history(self, client: httpx.Client, submitted_request_with_reviews):
        """DELETE history should clear all messages."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Clear (works even if empty)
        resp = client.delete(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        # Verify empty
        resp = client.get(f"/ask-egm/{review_id}/history", headers=ADMIN)
        assert resp.status_code == 200
        assert len(resp.json()["data"]) == 0

    def test_empty_message_rejected(self, client: httpx.Client, submitted_request_with_reviews):
        """Empty messages should be rejected."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.post(
            f"/ask-egm/{review_id}/chat",
            json={"message": "   "},
            headers=ADMIN,
        )
        assert resp.status_code == 422
