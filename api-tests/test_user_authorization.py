"""Test user authorization endpoints — employee search and multi-role CRUD."""
import httpx

BASE_URL = "http://localhost:4001/api"


def _admin_client() -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=10, headers={"X-Dev-Role": "admin"})


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


# ── Role CRUD (multi-role) ──────────────────────────────────────

def _cleanup_roles(itcode: str):
    """Clean up all role assignments for a test user."""
    with _admin_client() as c:
        c.delete(f"/user-authorization/roles/{itcode}")


def test_assign_role():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "governance_lead",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["itcode"] == "0324lq"
        assert data["role"] == "governance_lead"
        _cleanup_roles("0324lq")


def test_assign_multiple_roles():
    """A user can have multiple roles."""
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        # Assign requestor
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "requestor",
        })
        assert resp.status_code == 200

        # Assign domain_reviewer with domains
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "domain_reviewer",
            "domainCodes": ["EA"],
        })
        assert resp.status_code == 200
        assert resp.json()["domainCodes"] == ["EA"]

        # Verify both roles exist
        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 200
        roles = resp.json()["roles"]
        role_names = [r["role"] for r in roles]
        assert "requestor" in role_names
        assert "domain_reviewer" in role_names

        # Domain reviewer entry should have domainCodes
        dr = next(r for r in roles if r["role"] == "domain_reviewer")
        assert "EA" in dr["domainCodes"]

        _cleanup_roles("0324lq")


def test_assign_duplicate_role_fails():
    """Cannot assign the same role twice to the same user."""
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "requestor",
        })
        assert resp.status_code == 200

        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "requestor",
        })
        assert resp.status_code == 409
        _cleanup_roles("0324lq")


def test_list_roles():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "admin"})

        resp = c.get("/user-authorization/roles")
        assert resp.status_code == 200
        data = resp.json()
        assert "data" in data
        assert "total" in data
        assert data["total"] >= 1
        # Each entry has itcode and roles array
        user_entry = next((u for u in data["data"] if u["itcode"] == "0324lq"), None)
        assert user_entry is not None
        assert isinstance(user_entry["roles"], list)
        _cleanup_roles("0324lq")


def test_get_user_roles():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "requestor"})

        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 200
        data = resp.json()
        assert data["itcode"] == "0324lq"
        assert isinstance(data["roles"], list)
        assert any(r["role"] == "requestor" for r in data["roles"])
        _cleanup_roles("0324lq")


def test_update_domain_reviewer_domains():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "domain_reviewer",
            "domainCodes": ["EA"],
        })

        resp = c.put("/user-authorization/roles/0324lq/domain_reviewer", json={
            "domainCodes": ["EA", "BIA"],
        })
        assert resp.status_code == 200
        assert set(resp.json()["domainCodes"]) == {"EA", "BIA"}
        _cleanup_roles("0324lq")


def test_delete_single_role():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "requestor"})
        c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "domain_reviewer",
            "domainCodes": ["EA"],
        })

        # Delete just the requestor role
        resp = c.delete("/user-authorization/roles/0324lq/requestor")
        assert resp.status_code == 200

        # domain_reviewer should still exist
        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 200
        roles = resp.json()["roles"]
        assert len(roles) == 1
        assert roles[0]["role"] == "domain_reviewer"
        _cleanup_roles("0324lq")


def test_delete_all_roles():
    _cleanup_roles("0324lq")
    with _admin_client() as c:
        c.post("/user-authorization/roles", json={"itcode": "0324lq", "role": "requestor"})

        resp = c.delete("/user-authorization/roles/0324lq")
        assert resp.status_code == 200

        # Should have no roles now (returns empty roles array, not 404)
        resp = c.get("/user-authorization/roles/0324lq")
        assert resp.status_code == 200
        assert resp.json()["roles"] == []


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
            "role": "requestor",
        })
        assert resp.status_code == 404


def test_domain_reviewer_requires_domains():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "domain_reviewer",
        })
        assert resp.status_code == 400
        assert "domainCodes" in resp.json()["detail"]


def test_non_reviewer_rejects_domains():
    with _admin_client() as c:
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "admin",
            "domainCodes": ["EA"],
        })
        assert resp.status_code == 400
        _cleanup_roles("0324lq")


def test_get_nonexistent_employee_roles():
    with _admin_client() as c:
        resp = c.get("/user-authorization/roles/DOES_NOT_EXIST")
        assert resp.status_code == 404


def test_update_nonexistent_role():
    with _admin_client() as c:
        resp = c.put("/user-authorization/roles/DOES_NOT_EXIST/domain_reviewer", json={
            "domainCodes": ["EA"],
        })
        assert resp.status_code == 404


def test_delete_nonexistent_role():
    with _admin_client() as c:
        resp = c.delete("/user-authorization/roles/DOES_NOT_EXIST")
        assert resp.status_code == 404


# ── RBAC ─────────────────────────────────────────────────────────

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


def test_governance_lead_can_assign_role():
    """Governance lead now has user_authorization:write permission."""
    with _lead_client() as c:
        # Clean up first in case role exists
        c.delete("/user-authorization/roles/0324lq/requestor")
        resp = c.post("/user-authorization/roles", json={
            "itcode": "0324lq",
            "role": "requestor",
        })
        assert resp.status_code == 200
        assert resp.json()["role"] == "requestor"
        # Clean up
        c.delete("/user-authorization/roles/0324lq/requestor")


def test_requestor_cannot_search_employees():
    with _requestor_client() as c:
        resp = c.get("/user-authorization/employees", params={"search": "test"})
        assert resp.status_code == 403
