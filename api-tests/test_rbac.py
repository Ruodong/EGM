"""Test role-based access control — verify permission enforcement across roles."""
import httpx

BASE_URL = "http://localhost:4001/api"


def _client_as(role: str) -> httpx.Client:
    """Create a client that impersonates a specific role."""
    return httpx.Client(
        base_url=BASE_URL,
        timeout=10,
        headers={"X-Dev-Role": role},
    )


# --- Requestor role ---

def test_requestor_can_create_request():
    with _client_as("requestor") as c:
        resp = c.post("/governance-requests", json={"title": "Requestor Test"})
        assert resp.status_code == 200
        assert resp.json()["requestId"].startswith("GR-")


def test_requestor_can_list_requests():
    with _client_as("requestor") as c:
        resp = c.get("/governance-requests")
        assert resp.status_code == 200
        assert "data" in resp.json()


def test_requestor_cannot_create_domain():
    with _client_as("requestor") as c:
        resp = c.post("/domains", json={
            "domainCode": "RBAC_TEST",
            "domainName": "Should Fail",
            "integrationType": "internal",
        })
        assert resp.status_code == 403


def test_requestor_cannot_create_dispatch_rule():
    with _client_as("requestor") as c:
        resp = c.post("/dispatch-rules", json={
            "ruleName": "Should Fail",
            "domainCode": "TEST",
            "conditionType": "always",
        })
        assert resp.status_code == 403


def test_requestor_cannot_create_template():
    with _client_as("requestor") as c:
        resp = c.post("/intake/templates", json={
            "sectionType": "common",
            "section": "Test",
            "questionNo": 1,
            "questionText": "Fail?",
            "answerType": "text",
        })
        assert resp.status_code == 403


# --- Domain Reviewer role ---

def test_reviewer_can_list_reviews():
    with _client_as("domain_reviewer") as c:
        resp = c.get("/domain-reviews")
        assert resp.status_code == 200
        assert "data" in resp.json()


def test_reviewer_can_read_requests():
    with _client_as("domain_reviewer") as c:
        resp = c.get("/governance-requests")
        assert resp.status_code == 200


def test_reviewer_cannot_create_request():
    with _client_as("domain_reviewer") as c:
        resp = c.post("/governance-requests", json={"title": "Should Fail"})
        assert resp.status_code == 403


def test_reviewer_cannot_create_domain():
    with _client_as("domain_reviewer") as c:
        resp = c.post("/domains", json={
            "domainCode": "RBAC_REV",
            "domainName": "Fail",
            "integrationType": "internal",
        })
        assert resp.status_code == 403


def test_reviewer_cannot_delete_dispatch_rule():
    with _client_as("domain_reviewer") as c:
        resp = c.delete("/dispatch-rules/00000000-0000-0000-0000-000000000000")
        assert resp.status_code == 403


# --- Viewer role ---

def test_viewer_can_read_requests():
    with _client_as("viewer") as c:
        resp = c.get("/governance-requests")
        assert resp.status_code == 200


def test_viewer_cannot_create_request():
    with _client_as("viewer") as c:
        resp = c.post("/governance-requests", json={"title": "Should Fail"})
        assert resp.status_code == 403


def test_viewer_cannot_write_intake():
    with _client_as("viewer") as c:
        resp = c.post("/intake/responses", json={
            "requestId": "GR-000001",
            "responses": [],
        })
        assert resp.status_code == 403
