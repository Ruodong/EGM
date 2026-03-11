"""Test Info Supplement Request (ISR) endpoints."""
import httpx


def test_list_isrs(client: httpx.Client):
    resp = client.get("/info-requests")
    assert resp.status_code == 200
    assert "data" in resp.json()


def test_create_isr(client: httpx.Client, dispatched_request):
    rid = dispatched_request["request"]["requestId"]
    review_id = dispatched_request["reviewId"]

    resp = client.post("/info-requests", json={
        "requestId": rid,
        "domainReviewId": review_id,
        "description": "Missing project timeline info",
        "category": "Project Details",
        "priority": "Normal",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Open"
    assert data["description"] == "Missing project timeline info"


def test_isr_changes_request_status(client: httpx.Client, dispatched_request):
    """Creating an ISR should change governance request status to Info Requested."""
    rid = dispatched_request["request"]["requestId"]
    review_id = dispatched_request["reviewId"]

    client.post("/info-requests", json={
        "requestId": rid,
        "domainReviewId": review_id,
        "description": "Need more data info",
    })

    # Check governance request status
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Info Requested"


def test_acknowledge_isr(client: httpx.Client, dispatched_request):
    rid = dispatched_request["request"]["requestId"]
    review_id = dispatched_request["reviewId"]

    # Create ISR
    resp = client.post("/info-requests", json={
        "requestId": rid,
        "domainReviewId": review_id,
        "description": "Acknowledge test",
    })
    isr_id = resp.json()["id"]

    # Acknowledge
    resp = client.put(f"/info-requests/{isr_id}/acknowledge")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Acknowledged"


def test_resolve_isr(client: httpx.Client, dispatched_request):
    rid = dispatched_request["request"]["requestId"]
    review_id = dispatched_request["reviewId"]

    # Create ISR
    resp = client.post("/info-requests", json={
        "requestId": rid,
        "domainReviewId": review_id,
        "description": "Resolve test",
    })
    isr_id = resp.json()["id"]

    # Acknowledge then resolve
    client.put(f"/info-requests/{isr_id}/acknowledge")
    resp = client.put(f"/info-requests/{isr_id}/resolve", json={
        "resolutionNote": "Data has been updated",
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Resolved"


def test_filter_isrs_by_request(client: httpx.Client, dispatched_request):
    rid = dispatched_request["request"]["requestId"]
    review_id = dispatched_request["reviewId"]

    # Create ISR
    client.post("/info-requests", json={
        "requestId": rid,
        "domainReviewId": review_id,
        "description": "Filter test",
    })

    resp = client.get("/info-requests", params={"request_id": rid})
    assert resp.status_code == 200
    assert len(resp.json()["data"]) >= 1
