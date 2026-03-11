"""Test auth endpoints including dev-mode role switching."""
import httpx

BASE_URL = "http://localhost:4001/api"


def test_auth_me(client):
    resp = client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "dev_admin"
    assert data["role"] == "admin"
    assert "*:*" in data["permissions"]


def test_auth_permissions(client):
    resp = client.get("/auth/permissions")
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "admin"
    assert isinstance(data["permissions"], list)


def test_switch_role_to_requestor():
    """X-Dev-Role header switches role and permissions in dev mode."""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        resp = c.get("/auth/me", headers={"X-Dev-Role": "requestor"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "requestor"
        assert data["name"] == "Requestor"
        assert "*:*" not in data["permissions"]
        assert "governance_request:read" in data["permissions"]
        assert "governance_request:write" in data["permissions"]


def test_switch_role_to_reviewer():
    """X-Dev-Role header switches to domain_reviewer."""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        resp = c.get("/auth/me", headers={"X-Dev-Role": "domain_reviewer"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "domain_reviewer"
        assert data["name"] == "Domain Reviewer"
        assert "domain_review:read" in data["permissions"]
        assert "domain_review:write" in data["permissions"]


def test_switch_role_invalid_falls_back():
    """Invalid X-Dev-Role falls back to default admin."""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        resp = c.get("/auth/me", headers={"X-Dev-Role": "nonexistent_role"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "admin"
