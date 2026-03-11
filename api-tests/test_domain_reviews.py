"""Test domain review lifecycle endpoints."""
import httpx


def test_list_reviews(client: httpx.Client):
    resp = client.get("/domain-reviews")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data


def test_dispatch_creates_review(client: httpx.Client, dispatched_request):
    """Dispatch should create at least one domain review."""
    dispatch = dispatched_request["dispatched"]
    assert dispatch["count"] >= 1
    assert len(dispatch["dispatched"]) >= 1
    assert dispatch["dispatched"][0]["status"] == "Pending"


def test_get_review(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    resp = client.get(f"/domain-reviews/{review_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == review_id
    assert data["status"] == "Pending"


def test_assign_reviewer(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    resp = client.put(f"/domain-reviews/{review_id}/assign", json={
        "reviewer": "test_reviewer",
        "reviewerName": "Test Reviewer",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Assigned"
    assert resp.json()["reviewer"] == "test_reviewer"


def test_start_review(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    # Assign first
    client.put(f"/domain-reviews/{review_id}/assign")
    # Start
    resp = client.put(f"/domain-reviews/{review_id}/start")
    assert resp.status_code == 200
    assert resp.json()["status"] == "In Progress"


def test_complete_review(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    # Assign → Start → Complete
    client.put(f"/domain-reviews/{review_id}/assign")
    client.put(f"/domain-reviews/{review_id}/start")
    resp = client.put(f"/domain-reviews/{review_id}/complete", json={
        "outcome": "Approved",
        "outcomeNotes": "Looks good",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Review Complete"
    assert resp.json()["outcome"] == "Approved"


def test_complete_invalid_outcome(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    resp = client.put(f"/domain-reviews/{review_id}/complete", json={
        "outcome": "InvalidValue",
    })
    assert resp.status_code == 400


def test_waive_review(client: httpx.Client, dispatched_request):
    review_id = dispatched_request["reviewId"]
    resp = client.put(f"/domain-reviews/{review_id}/waive")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Waived"


def test_filter_reviews_by_request(client: httpx.Client, dispatched_request):
    rid = dispatched_request["request"]["requestId"]
    resp = client.get("/domain-reviews", params={"request_id": rid})
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1
