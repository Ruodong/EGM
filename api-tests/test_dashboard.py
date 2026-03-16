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


def test_pending_tasks_reviewer_fields(client: httpx.Client):
    """Pending tasks response includes reviewer arrays."""
    resp = client.get("/dashboard/pending-tasks")
    assert resp.status_code == 200
    data = resp.json()
    assert "returnForAdditional" in data
    assert "assignedActions" in data
    assert "reviewerFirstSubmit" in data
    assert "reviewerResubmitted" in data
    assert "reviewerPendingActions" in data
    assert isinstance(data["reviewerFirstSubmit"], list)
    assert isinstance(data["reviewerResubmitted"], list)
    assert isinstance(data["reviewerPendingActions"], list)


def test_pending_tasks_my_only_param(client: httpx.Client):
    """myOnly query param is accepted and doesn't error."""
    for val in ["true", "false"]:
        resp = client.get(f"/dashboard/pending-tasks?myOnly={val}")
        assert resp.status_code == 200
        data = resp.json()
        assert "reviewerResubmitted" in data
        assert "reviewerPendingActions" in data


def test_pending_tasks_first_submit_not_affected_by_my_only(client: httpx.Client):
    """reviewerFirstSubmit returns same results regardless of myOnly."""
    resp_true = client.get("/dashboard/pending-tasks?myOnly=true")
    resp_false = client.get("/dashboard/pending-tasks?myOnly=false")
    assert resp_true.status_code == 200
    assert resp_false.status_code == 200
    # firstSubmit should be same count regardless of myOnly
    assert len(resp_true.json()["reviewerFirstSubmit"]) == len(resp_false.json()["reviewerFirstSubmit"])


def test_audit_log(client: httpx.Client):
    resp = client.get("/audit-log")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
