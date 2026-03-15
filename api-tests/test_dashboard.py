"""Test dashboard, progress, and audit log endpoints."""
import httpx


def test_dashboard_stats(client: httpx.Client):
    resp = client.get("/dashboard/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "totalRequests" in data
    assert "byStatus" in data
    assert "reviewCounts" in data
    assert isinstance(data["totalRequests"], int)


def test_home_stats(client: httpx.Client):
    resp = client.get("/dashboard/home-stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "totalRequests" in data
    assert "inReview" in data
    assert "completed" in data
    # openInfoRequests removed (ISR deprecated)


def test_progress(client: httpx.Client, submitted_request_with_reviews):
    rid = submitted_request_with_reviews["request"]["requestId"]
    resp = client.get(f"/progress/{rid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["requestId"] == rid
    assert "totalDomains" in data
    assert "progressPercent" in data
    assert "domains" in data
    assert data["totalDomains"] >= 1


def test_progress_not_found(client: httpx.Client):
    resp = client.get("/progress/GR-999999")
    assert resp.status_code == 404


def test_audit_log(client: httpx.Client):
    resp = client.get("/audit-log")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
