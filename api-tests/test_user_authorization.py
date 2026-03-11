"""Test user authorization endpoints — employee search and role CRUD."""
import httpx
import uuid

BASE_URL = "http://localhost:4001/api"


def _admin_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10, headers={"X-Dev-Role": "admin"})


def _viewer_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10, headers={"X-Dev-Role": "viewer"})


def _requestor_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10, headers={"X-Dev-Role": "requestor"})


def _lead_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10, headers={"X-Dev-Role": "governance_lead"})


# ── Employee Search ──────────────────────────────────────────────

def test_search_employees_empty_query():
    with _admin_client() as c:
        resp = c.get("/user-authorization/employees")
        assert resp.status_code == 200
        assert resp.json()["data"] == []


def test_search_employees_by_itcode():
    with _admin_client() as c:
        # Search for a pattern that should match some employees
        resp = c.get("/user-authorization/employees", params={"search": "0324lq"})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) > 0
        assert data[0]["itcode"] == "0324lq"


def test_search_employees_by_name():
    with _admin_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "Milos"})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) > 0


def test_search_employees_limit():
    with _admin_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "a", "limit": 5})
        assert resp.status_code == 200
        assert len(resp.json()["data"]) <= 5


# ── Role CRUD ────────────────────────────────────────────────────

def _cleanup_role(itcode: str):
    """Clean up a test role assignment."""
    with _admin_client() as c:
        c.delete(f"/user-authorization/roles/{itcode}")


def test_assign_role():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "governance_lead",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["itcode"] == "0324lq"
        assert data["role"] == "governance_lead"
        assert data["name"] is not None
        _cleanup_role("0324lq")


def test_assign_role_upsert():
    """POST again with same itcode updates the role (upsert)."""
    with _admin_client() as c:
        # First assignment
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "viewer",
        })
        assert resp.status_code == 200
        assert resp.json()["role"] == "viewer"

        # Upsert to different role
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "domain_reviewer",
        })
        assert resp.status_code == 200
        assert resp.json()["role"] == "domain_reviewer"
        _cleanup_role("0324lq")


def test_list_roles():
    with _admin_client() as c:
        # Ensure at least one role exists
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "admin"})

        resp = c.get("/user-authorization/roles")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "total" in data
        assert data["total"] >= 1
        _cleanup_role("0324lq")


def test_get_role():
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "requestor"})

        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 200
        assert resp.json()["itcode"] == "0324lq"
        assert resp.json()["role"] == "requestor"
        _cleanup_role("0324lq")


def test_update_role():
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "viewer"})

        resp = c.put("/user-authorization/roles/0324lq", json={"role": "admin"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "admin"
        _cleanup_role("0324lq")


def test_delete_role():
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "viewer"})

        resp = c.delete("/user-authorization/roles/0324lq")
        assert resp.status_code == 200

        # Should be gone
        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 404


# ── Validation ───────────────────────────────────────────────────

def test_assign_role_missing_itcode():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={"role": "admin"})
        assert resp.status_code == 400


def test_assign_role_missing_role():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={"itcode": "0324lq"})
        assert resp.status_code == 400


def test_assign_role_invalid_role():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "superadmin",
        })
        assert resp.status_code == 400


def test_assign_role_nonexistent_employee():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "DOES_NOT_EXIST_XYZ",
            "role": "viewer",
        })
        assert resp.status_code == 404


def test_get_nonexistent_role():
    with _admin_client() as c:
        resp = c.get("/user-authorization/roles/DOES_NOT_EXIST")
        assert resp.status_code == 404


def test_update_nonexistent_role():
    with _admin_client() as c:
        resp = c.put("/user-authorization/roles/DOES_NOT_EXIST", json={"role": "admin"})
        assert resp.status_code == 404


def test_delete_nonexistent_role():
    with _admin_client() as c:
        resp = c.delete("/user-authorization/roles/DOES_NOT_EXIST")
        assert resp.status_code == 404


# ── RBAC ─────────────────────────────────────────────────────────

def test_viewer_cannot_assign_role():
    with _viewer_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "admin",
        })
        assert resp.status_code == 403


def test_requestor_cannot_assign_role():
    with _requestor_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "admin",
        })
        assert resp.status_code == 403


def test_governance_lead_can_read_employees():
    with _lead_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "0324lq"})
        assert resp.status_code == 200


def test_governance_lead_can_read_roles():
    with _lead_client() as c:
        resp = c.get("/user-authorization/roles")
        assert resp.status_code == 200


def test_governance_lead_cannot_assign_role():
    with _lead_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "viewer",
        })
        assert resp.status_code == 403


def test_viewer_cannot_search_employees():
    with _viewer_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "test"})
        assert resp.status_code == 403


def test_requestor_cannot_search_employees():
    with _requestor_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "test"})
        assert resp.status_code == 403
