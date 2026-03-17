"""API tests for AI Review Analysis."""
import httpx
import pytest

# Uses shared fixtures from conftest.py:
#   client, submitted_request_with_reviews, test_rule_with_domain


class TestReviewAnalysisTrigger:
    """Tests for POST /review-analysis/{id}/trigger."""

    def test_trigger_starts_background_analysis(self, client: httpx.Client, submitted_request_with_reviews):
        """AC-1: Trigger creates analysis and returns immediately."""
        review_id = submitted_request_with_reviews["reviewId"]

        resp = client.post(f"/review-analysis/{review_id}/trigger", json={
            "triggerEvent": "manual"
        })
        # 200 (background started) or 503 (LLM not configured)
        assert resp.status_code in (200, 503), f"Unexpected: {resp.status_code} {resp.text}"
        if resp.status_code == 200:
            data = resp.json()
            assert data["status"] == "running"
            assert data["domainReviewId"] == review_id

    def test_trigger_with_invalid_review_id(self, client: httpx.Client):
        """Should return 404 for non-existent review."""
        resp = client.post("/review-analysis/00000000-0000-0000-0000-000000000000/trigger", json={
            "triggerEvent": "manual"
        })
        # Could be 404 (not found) or 503 (LLM not configured — checked first)
        assert resp.status_code in (404, 503)


class TestReviewAnalysisGet:
    """Tests for GET /review-analysis/{id}."""

    def test_get_no_analysis_returns_placeholder(self, client: httpx.Client, submitted_request_with_reviews):
        """AC-4: Returns placeholder or existing analysis."""
        review_id = submitted_request_with_reviews["reviewId"]

        resp = client.get(f"/review-analysis/{review_id}")
        assert resp.status_code == 200
        data = resp.json()
        # Either has analysis data (from submit auto-trigger) or placeholder
        if "data" in data and data["data"] is None:
            assert data["message"] == "No analysis available"
        elif data.get("status"):
            # Has analysis — verify structure
            assert data["domainReviewId"] == review_id
            assert data["version"] >= 1

    def test_get_nonexistent_review(self, client: httpx.Client):
        """Should return 404 for non-existent review (object-level auth)."""
        resp = client.get("/review-analysis/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404


class TestReviewAnalysisVersions:
    """Tests for GET /review-analysis/{id}/versions."""

    def test_get_versions_list(self, client: httpx.Client, submitted_request_with_reviews):
        """AC-5: Versions list returns all versions."""
        review_id = submitted_request_with_reviews["reviewId"]

        resp = client.get(f"/review-analysis/{review_id}/versions")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert isinstance(data["data"], list)

    def test_get_specific_version_not_found(self, client: httpx.Client, submitted_request_with_reviews):
        """Should return 404 for non-existent version."""
        review_id = submitted_request_with_reviews["reviewId"]

        resp = client.get(f"/review-analysis/{review_id}/versions/999")
        assert resp.status_code == 404


class TestAnalysisJsonSchema:
    """Tests for response structure validation (AC-18)."""

    def test_analysis_response_structure(self, client: httpx.Client, submitted_request_with_reviews):
        """AC-18: Completed analysis has correct JSON structure."""
        review_id = submitted_request_with_reviews["reviewId"]

        resp = client.get(f"/review-analysis/{review_id}")
        assert resp.status_code == 200
        data = resp.json()

        # If analysis exists and completed, validate structure
        if data.get("status") == "completed":
            assert "riskAssessment" in data
            assert "referenceCases" in data
            assert "consistencyAnalysis" in data
            assert "completenessAnalysis" in data
            assert "accuracyAnalysis" in data
            assert "overallScore" in data
            assert "summary" in data
            assert "version" in data
            assert isinstance(data["version"], int)

            # Validate risk assessment structure
            if data["riskAssessment"]:
                ra = data["riskAssessment"]
                assert "riskLevel" in ra
                assert ra["riskLevel"] in ("HIGH", "MEDIUM", "LOW")
                assert "riskFactors" in ra
                assert isinstance(ra["riskFactors"], list)

            # Validate consistency analysis structure
            if data["consistencyAnalysis"]:
                ca = data["consistencyAnalysis"]
                assert "contradictions" in ca
                assert isinstance(ca["contradictions"], list)
                assert "overallScore" in ca

            # Validate completeness analysis structure
            if data["completenessAnalysis"]:
                cpa = data["completenessAnalysis"]
                assert "completenessScore" in cpa

            # Validate accuracy analysis structure
            if data["accuracyAnalysis"]:
                aa = data["accuracyAnalysis"]
                assert "factualIssues" in aa
                assert isinstance(aa["factualIssues"], list)


class TestReviewAnalysisAuthorization:
    """P1-1: Object-level authorization tests for Review Analysis endpoints."""

    def test_nonexistent_review_returns_404(self, client: httpx.Client):
        """Non-existent review → 404 (not leak data as 200 placeholder)."""
        resp = client.get("/review-analysis/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 404

    def test_nonexistent_versions_returns_404(self, client: httpx.Client):
        """Non-existent review → 404 on versions list."""
        resp = client.get("/review-analysis/00000000-0000-0000-0000-000000000000/versions")
        assert resp.status_code == 404

    def test_admin_can_access(self, client: httpx.Client, submitted_request_with_reviews):
        """Admin always has access to analysis."""
        review_id = submitted_request_with_reviews["reviewId"]
        resp = client.get(f"/review-analysis/{review_id}")
        assert resp.status_code == 200
