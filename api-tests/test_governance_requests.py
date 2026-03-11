"""Test governance request CRUD + lifecycle."""
import httpx


def test_create_request(client: httpx.Client):
    resp = client.post("/governance-requests", json={
        "title": "API Test Request",
        "description": "Created by pytest",
        "priority": "High",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["requestId"].startswith("GR-")
    assert data["status"] == "Draft"
    assert data["priority"] == "High"
    assert data["requestor"] == "dev_admin"


def test_list_requests(client: httpx.Client):
    resp = client.get("/governance-requests")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
    assert data["total"] >= 1


def test_get_request_by_business_id(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["requestId"] == rid


def test_get_request_by_uuid(client: httpx.Client, create_request):
    uuid = create_request["id"]
    resp = client.get(f"/governance-requests/{uuid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == uuid


def test_update_request(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={
        "title": "Updated Title",
        "priority": "Critical",
    })
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"
    assert resp.json()["priority"] == "Critical"


def test_submit_request(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Submitted"


def test_submit_non_draft_fails(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    # Submit first
    client.put(f"/governance-requests/{rid}/submit")
    # Try to submit again
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 400


def test_verdict_on_draft_fails(client: httpx.Client, create_request):
    """Fix 5: verdict guard — cannot complete a Draft request."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Approved"})
    assert resp.status_code == 400
    assert "In Review" in resp.json()["detail"]


def test_verdict_invalid_value(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Maybe"})
    assert resp.status_code == 400
    assert "Invalid verdict" in resp.json()["detail"]


def test_delete_draft_request(client: httpx.Client):
    # Create a fresh one to delete
    resp = client.post("/governance-requests", json={"title": "To Delete"})
    rid = resp.json()["requestId"]

    resp = client.delete(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


def test_delete_non_draft_fails(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    client.put(f"/governance-requests/{rid}/submit")  # Make it Submitted
    resp = client.delete(f"/governance-requests/{rid}")
    assert resp.status_code == 400


def test_filter_options(client: httpx.Client):
    resp = client.get("/governance-requests/filter-options")
    assert resp.status_code == 200
    data = resp.json()
    assert "statuses" in data
    assert "priorities" in data


def test_sequence_generates_unique_ids(client: httpx.Client):
    """Fix 6: verify sequence generates unique request IDs."""
    r1 = client.post("/governance-requests", json={"title": "Seq Test 1"}).json()
    r2 = client.post("/governance-requests", json={"title": "Seq Test 2"}).json()
    assert r1["requestId"] != r2["requestId"]
    # Both should be GR-XXXXXX format
    assert r1["requestId"].startswith("GR-")
    assert r2["requestId"].startswith("GR-")


def test_verdict_approved(client: httpx.Client, dispatched_request):
    """Full lifecycle: complete review then record verdict."""
    review_id = dispatched_request["reviewId"]
    rid = dispatched_request["request"]["requestId"]

    # Assign → Start → Complete the domain review
    client.put(f"/domain-reviews/{review_id}/assign")
    client.put(f"/domain-reviews/{review_id}/start")
    client.put(f"/domain-reviews/{review_id}/complete", json={
        "outcome": "Approved",
        "notes": "All good",
    })

    # Now record verdict on the governance request
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Approved"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Completed"
    assert data["overallVerdict"] == "Approved"


def test_create_request_with_empty_optional_fields(client: httpx.Client):
    """Empty optional fields should be handled gracefully (not cause 500)."""
    resp = client.post("/governance-requests", json={
        "title": "Empty Fields Test",
        "targetDate": "",
        "projectId": "",
        "organization": "",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["requestId"].startswith("GR-")


def test_pagination(client: httpx.Client):
    """Pagination params work correctly."""
    resp = client.get("/governance-requests", params={"page": 1, "pageSize": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
    assert len(data["data"]) <= 5


def test_create_request_with_project(client: httpx.Client):
    """Create request linked to an existing project."""
    # Get first available project
    projects = client.get("/projects", params={"pageSize": 1}).json()
    if projects["total"] == 0:
        return  # No projects synced; skip
    pid = projects["data"][0]["projectId"]
    pname = projects["data"][0]["projectName"]

    resp = client.post("/governance-requests", json={
        "title": "Request with Project",
        "projectId": pid,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["projectId"] == pid
    assert data["projectName"] == pname


def test_create_request_invalid_project(client: httpx.Client):
    """Creating with non-existent projectId should fail."""
    resp = client.post("/governance-requests", json={
        "title": "Bad Project",
        "projectId": "NONEXISTENT-999",
    })
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"]


def test_filter_by_date_range(client: httpx.Client):
    """dateFrom and dateTo query params filter by create_at."""
    # Create a request so we have at least one
    client.post("/governance-requests", json={"title": "Date Range Test"})

    # Use today's date range — should include the request we just created
    from datetime import date
    today = date.today().isoformat()

    resp = client.get("/governance-requests", params={"dateFrom": today, "dateTo": today})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1

    # Use a far-future date — should return 0 results
    resp = client.get("/governance-requests", params={"dateFrom": "2099-01-01"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # Use a far-past date range — should return 0 results
    resp = client.get("/governance-requests", params={"dateTo": "2000-01-01"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_search_by_keyword(client: httpx.Client):
    """search query param filters by request_id or title."""
    resp = client.post("/governance-requests", json={"title": "UniqueSearchKeyword123"})
    assert resp.status_code == 200

    # Search by title keyword
    resp = client.get("/governance-requests", params={"search": "UniqueSearchKeyword123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert any("UniqueSearchKeyword123" in r["title"] for r in data["data"])

    # Search by non-existent keyword
    resp = client.get("/governance-requests", params={"search": "ZZZZNONEXISTENT999"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0
