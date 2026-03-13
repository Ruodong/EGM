"""Test dispatch rules (matrix-based) and execute endpoints."""
import uuid
import httpx

_BASE = {
    "govProjectType": "PoC",
    "businessUnit": "IDG",
    "productSoftwareType": "Hardware",
    "productEndUser": ["Lenovo internal employee/contractors"],
    "userRegion": ["PRC"],
}


def test_list_dispatch_rules(client: httpx.Client):
    resp = client.get("/dispatch-rules/")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) >= 5  # 5 seed level-1 rules
    codes = [r["ruleCode"] for r in data]
    assert "INTERNAL" in codes
    assert "AI" in codes


def test_list_rules_has_domains(client: httpx.Client):
    """Each rule should have inline domain relationships."""
    resp = client.get("/dispatch-rules/")
    assert resp.status_code == 200
    data = resp.json()["data"]
    ai_rule = next(r for r in data if r["ruleCode"] == "AI")
    assert "domains" in ai_rule
    assert len(ai_rule["domains"]) > 0


def test_get_rule(client: httpx.Client):
    resp = client.get("/dispatch-rules/AI")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ruleCode"] == "AI"
    assert data["ruleName"]
    assert "domains" in data


def test_get_rule_not_found(client: httpx.Client):
    resp = client.get("/dispatch-rules/NONEXISTENT")
    assert resp.status_code == 404


def test_create_rule(client: httpx.Client):
    code = f"TCR_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Test Rule",
        "description": "Created by pytest",
        "sortOrder": 99,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ruleCode"] == code
    assert data["ruleName"] == "Test Rule"
    assert data["description"] == "Created by pytest"
    assert data["sortOrder"] == 99


def test_create_rule_missing_fields(client: httpx.Client):
    resp = client.post("/dispatch-rules/", json={"ruleCode": "ONLY_CODE"})
    assert resp.status_code == 400


def test_create_rule_duplicate(client: httpx.Client):
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": "INTERNAL",
        "ruleName": "Duplicate",
    })
    assert resp.status_code == 409


def test_update_rule(client: httpx.Client):
    code = f"TUP_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Before Update",
    })

    resp = client.put(f"/dispatch-rules/{code}", json={
        "ruleName": "After Update",
        "description": "Updated by pytest",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["ruleName"] == "After Update"
    assert data["description"] == "Updated by pytest"


def test_update_rule_not_found(client: httpx.Client):
    resp = client.put("/dispatch-rules/NONEXISTENT", json={"ruleName": "X"})
    assert resp.status_code == 404


def test_toggle_rule(client: httpx.Client):
    code = f"TTG_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Toggle Test",
    })
    assert resp.status_code == 200

    resp = client.delete(f"/dispatch-rules/{code}")
    assert resp.status_code == 200
    assert "inactive" in resp.json()["message"]

    resp = client.delete(f"/dispatch-rules/{code}")
    assert resp.status_code == 200
    assert "active" in resp.json()["message"]


def test_toggle_rule_not_found(client: httpx.Client):
    resp = client.delete("/dispatch-rules/NONEXISTENT")
    assert resp.status_code == 404


def test_get_matrix(client: httpx.Client):
    resp = client.get("/dispatch-rules/matrix")
    assert resp.status_code == 200
    data = resp.json()
    assert "rules" in data
    assert "domains" in data
    assert "matrix" in data
    assert len(data["rules"]) >= 5
    assert len(data["domains"]) >= 4
    assert data["matrix"]["AI"]["RAI"] == "in"
    assert data["matrix"]["AI"]["EA"] == "out"
    assert data["matrix"]["INTERNAL"]["EA"] == "in"


def test_save_matrix(client: httpx.Client):
    resp = client.get("/dispatch-rules/matrix")
    original = resp.json()["matrix"]

    modified = dict(original)
    modified["AI"] = dict(modified.get("AI", {}))
    modified["AI"]["EA"] = "in"

    resp = client.put("/dispatch-rules/matrix", json={"matrix": modified})
    assert resp.status_code == 200

    resp = client.get("/dispatch-rules/matrix")
    assert resp.json()["matrix"]["AI"]["EA"] == "in"

    # Restore original
    original["AI"]["EA"] = "out"
    client.put("/dispatch-rules/matrix", json={"matrix": original})


def test_save_matrix_empty(client: httpx.Client):
    resp = client.put("/dispatch-rules/matrix", json={})
    assert resp.status_code == 400


# ── Reorder ────────────────────────────────────────────────────

def test_reorder_rules(client: httpx.Client):
    """Reorder two test rules and verify sort order changed."""
    code_a = f"TRA_{uuid.uuid4().hex[:6].upper()}"
    code_b = f"TRB_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={"ruleCode": code_a, "ruleName": "Reorder A", "sortOrder": 10})
    client.post("/dispatch-rules/", json={"ruleCode": code_b, "ruleName": "Reorder B", "sortOrder": 11})

    # Swap order
    resp = client.put("/dispatch-rules/reorder", json={
        "orders": [
            {"ruleCode": code_a, "sortOrder": 11},
            {"ruleCode": code_b, "sortOrder": 10},
        ]
    })
    assert resp.status_code == 200

    # Verify
    resp = client.get(f"/dispatch-rules/{code_a}")
    assert resp.json()["sortOrder"] == 11
    resp = client.get(f"/dispatch-rules/{code_b}")
    assert resp.json()["sortOrder"] == 10


def test_reorder_rules_rbac():
    """Governance lead cannot reorder rules."""
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.put("/dispatch-rules/reorder", json={
            "orders": [{"ruleCode": "INTERNAL", "sortOrder": 99}]
        })
        assert resp.status_code == 403


# ── Hierarchy (child rules) ───────────────────────────────────

def test_create_child_rule(client: httpx.Client):
    """Create a child rule under INTERNAL and verify parentRuleCode."""
    code = f"TCH_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Child Rule Test",
        "parentRuleCode": "INTERNAL",
        "sortOrder": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["parentRuleCode"] == "INTERNAL"
    assert data["ruleCode"] == code


def test_create_multiple_children(client: httpx.Client):
    """Create multiple children under same parent — regression test for overwrite bug."""
    parent = "EXTERNAL"
    code_1 = f"MC1_{uuid.uuid4().hex[:6].upper()}"
    code_2 = f"MC2_{uuid.uuid4().hex[:6].upper()}"

    resp1 = client.post("/dispatch-rules/", json={
        "ruleCode": code_1, "ruleName": "Multi Child 1",
        "parentRuleCode": parent, "sortOrder": 1,
    })
    assert resp1.status_code == 200

    resp2 = client.post("/dispatch-rules/", json={
        "ruleCode": code_2, "ruleName": "Multi Child 2",
        "parentRuleCode": parent, "sortOrder": 2,
    })
    assert resp2.status_code == 200

    # Verify both children exist in list
    resp = client.get("/dispatch-rules/")
    rules = resp.json()["data"]
    children = [r for r in rules if r["parentRuleCode"] == parent]
    child_codes = [r["ruleCode"] for r in children]
    assert code_1 in child_codes
    assert code_2 in child_codes
    assert len(children) >= 2


def test_list_shows_children_with_parent(client: httpx.Client):
    """After creating a child, GET list returns it with parentRuleCode set."""
    code = f"TLC_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={
        "ruleCode": code, "ruleName": "List Child Test",
        "parentRuleCode": "AI", "sortOrder": 1,
    })

    resp = client.get("/dispatch-rules/")
    rules = resp.json()["data"]
    child = next((r for r in rules if r["ruleCode"] == code), None)
    assert child is not None
    assert child["parentRuleCode"] == "AI"


# ── RBAC ────────────────────────────────────────────────────────

def test_governance_lead_can_read_rules():
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.get("/dispatch-rules/")
        assert resp.status_code == 200


def test_governance_lead_can_read_matrix():
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.get("/dispatch-rules/matrix")
        assert resp.status_code == 200


def test_governance_lead_cannot_create_rule():
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.post("/dispatch-rules/", json={
            "ruleCode": "LEAD_TEST",
            "ruleName": "Should Fail",
        })
        assert resp.status_code == 403


def test_governance_lead_cannot_save_matrix():
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.put("/dispatch-rules/matrix", json={"matrix": {}})
        assert resp.status_code == 403


def test_viewer_cannot_read_rules():
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "viewer"}) as c:
        resp = c.get("/dispatch-rules/")
        assert resp.status_code == 403


def test_requestor_can_read_rules():
    """Requestor needs dispatch_rule:read to select rules on the create page."""
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "requestor"}) as c:
        resp = c.get("/dispatch-rules/")
        assert resp.status_code == 200


# ── Exclusions ─────────────────────────────────────────────────

def test_seed_child_rules_exist(client: httpx.Client):
    """INTERNAL_ONLY and EXTERNAL_USING should exist as children of INTERNAL."""
    resp = client.get("/dispatch-rules/")
    rules = resp.json()["data"]
    io = next((r for r in rules if r["ruleCode"] == "INTERNAL_ONLY"), None)
    eu = next((r for r in rules if r["ruleCode"] == "EXTERNAL_USING"), None)
    assert io is not None, "INTERNAL_ONLY seed rule missing"
    assert eu is not None, "EXTERNAL_USING seed rule missing"
    assert io["parentRuleCode"] == "INTERNAL"
    assert eu["parentRuleCode"] == "INTERNAL"


def test_matrix_includes_exclusions(client: httpx.Client):
    """GET /dispatch-rules/matrix should include exclusions field."""
    resp = client.get("/dispatch-rules/matrix")
    assert resp.status_code == 200
    data = resp.json()
    assert "exclusions" in data
    # Seed exclusions: INTERNAL_ONLY <-> EXTERNAL_USING
    assert "EXTERNAL_USING" in data["exclusions"].get("INTERNAL_ONLY", [])
    assert "INTERNAL_ONLY" in data["exclusions"].get("EXTERNAL_USING", [])


def test_list_rules_includes_exclusions(client: httpx.Client):
    """Each rule should have an exclusions field."""
    resp = client.get("/dispatch-rules/")
    rules = resp.json()["data"]
    io = next(r for r in rules if r["ruleCode"] == "INTERNAL_ONLY")
    assert "exclusions" in io
    assert "EXTERNAL_USING" in io["exclusions"]


def test_save_exclusions(client: httpx.Client):
    """PUT /dispatch-rules/exclusions saves and can be queried."""
    # Save a new exclusion between two level-1 rules
    resp = client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "AI", "excludedRuleCode": "OPEN_SOURCE"},
            # Also include the seed pair to preserve it
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
        ]
    })
    assert resp.status_code == 200

    # Verify via matrix endpoint
    resp = client.get("/dispatch-rules/matrix")
    excl = resp.json()["exclusions"]
    assert "OPEN_SOURCE" in excl.get("AI", [])
    assert "AI" in excl.get("OPEN_SOURCE", [])

    # Cleanup: restore only the seed exclusions
    client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
        ]
    })


def test_save_exclusions_symmetric(client: httpx.Client):
    """Saving A->B should also create B->A."""
    client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "PII", "excludedRuleCode": "EXTERNAL"},
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
        ]
    })

    resp = client.get("/dispatch-rules/matrix")
    excl = resp.json()["exclusions"]
    assert "EXTERNAL" in excl.get("PII", [])
    assert "PII" in excl.get("EXTERNAL", [])

    # Cleanup
    client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
        ]
    })


def test_save_exclusions_cross_level_rejected(client: httpx.Client):
    """Level-1 rule cannot exclude a Level-2 rule."""
    resp = client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "AI", "excludedRuleCode": "INTERNAL_ONLY"},
        ]
    })
    assert resp.status_code == 400
    assert "level" in resp.json()["detail"].lower() or "Level" in resp.json()["detail"]


def test_create_request_with_excluded_rules_fails(client: httpx.Client):
    """Submitting a request with mutually exclusive rules should fail."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Exclusion Conflict Test",
        "ruleCodes": ["INTERNAL_ONLY", "EXTERNAL_USING"],
    })
    assert resp.status_code == 400
    assert "exclusive" in resp.json()["detail"].lower()


def test_save_exclusions_rbac():
    """Non-admin cannot save exclusions."""
    with httpx.Client(base_url="http://localhost:4001/api", timeout=10, headers={"X-Dev-Role": "governance_lead"}) as c:
        resp = c.put("/dispatch-rules/exclusions", json={
            "exclusions": [{"ruleCode": "AI", "excludedRuleCode": "PII"}]
        })
        assert resp.status_code == 403


# ── Dispatch execution ─────────────────────────────────────────

def test_execute_dispatch(client: httpx.Client, create_domain):
    """Create + submit + dispatch to a specific domain."""
    resp = client.post("/governance-requests", json={**_BASE, "title": "Dispatch Exec Test"})
    rid = resp.json()["requestId"]

    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200

    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert data["dispatched"][0]["domainCode"] == create_domain["domainCode"]


def test_execute_dispatch_idempotent(client: httpx.Client, create_domain):
    """Dispatching the same domain twice should not create duplicates."""
    resp = client.post("/governance-requests", json={**_BASE, "title": "Idempotent Test"})
    rid = resp.json()["requestId"]
    client.put(f"/governance-requests/{rid}/submit")

    code = create_domain["domainCode"]

    resp1 = client.post(f"/dispatch/execute/{rid}", json={"domainCodes": [code]})
    assert resp1.json()["count"] == 1

    resp2 = client.post(f"/dispatch/execute/{rid}", json={"domainCodes": [code]})
    assert resp2.json()["count"] == 0


# ── Mandatory / Optional ──────────────────────────────────────

def test_create_rule_with_mandatory(client: httpx.Client):
    """Creating a rule with isMandatory=True should persist."""
    code = f"TMR_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Mandatory Test Rule",
        "isMandatory": True,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["isMandatory"] is True

    # GET should also return it
    resp = client.get(f"/dispatch-rules/{code}")
    assert resp.json()["isMandatory"] is True

    # Cleanup: deactivate so it doesn't affect other tests
    client.delete(f"/dispatch-rules/{code}")


def test_create_rule_default_optional(client: httpx.Client):
    """Rules default to isMandatory=False."""
    code = f"TDF_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": code,
        "ruleName": "Default Optional",
    })
    assert resp.status_code == 200
    assert resp.json()["isMandatory"] is False


def test_update_rule_mandatory(client: httpx.Client):
    """Updating isMandatory via PUT should persist."""
    code = f"TUM_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={"ruleCode": code, "ruleName": "Update Mandatory"})

    resp = client.put(f"/dispatch-rules/{code}", json={"isMandatory": True})
    assert resp.status_code == 200
    assert resp.json()["isMandatory"] is True

    resp = client.put(f"/dispatch-rules/{code}", json={"isMandatory": False})
    assert resp.status_code == 200
    assert resp.json()["isMandatory"] is False


def test_matrix_includes_is_mandatory(client: httpx.Client):
    """Matrix endpoint should return isMandatory for each rule."""
    resp = client.get("/dispatch-rules/matrix")
    assert resp.status_code == 200
    rules = resp.json()["rules"]
    assert all("isMandatory" in r for r in rules)


def test_create_request_missing_mandatory_rule_fails(client: httpx.Client):
    """Creating a request without selecting a mandatory rule should fail."""
    # Create a mandatory rule
    code = f"MND_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={"ruleCode": code, "ruleName": "Mandatory Rule", "isMandatory": True})

    # Create request without selecting it
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Missing Mandatory Test",
        "ruleCodes": ["AI"],
    })
    assert resp.status_code == 400
    assert "mandatory" in resp.json()["detail"].lower()
    assert code in resp.json()["detail"]

    # Cleanup: deactivate the mandatory rule so it doesn't affect other tests
    client.delete(f"/dispatch-rules/{code}")


def test_create_request_with_mandatory_rule_succeeds(client: httpx.Client):
    """Creating a request with the mandatory rule selected should succeed."""
    code = f"MNS_{uuid.uuid4().hex[:6].upper()}"
    client.post("/dispatch-rules/", json={"ruleCode": code, "ruleName": "Mandatory Success", "isMandatory": True})

    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Has Mandatory Test",
        "ruleCodes": [code],
    })
    assert resp.status_code == 200

    # Cleanup
    client.delete(f"/dispatch-rules/{code}")


def test_mandatory_rule_exclusion_exemption(client: httpx.Client):
    """A mandatory rule is exempt if excluded by a selected rule."""
    code_a = f"MEA_{uuid.uuid4().hex[:6].upper()}"
    code_b = f"MEB_{uuid.uuid4().hex[:6].upper()}"

    # Create two level-1 rules, A is mandatory
    client.post("/dispatch-rules/", json={"ruleCode": code_a, "ruleName": "Mandatory A", "isMandatory": True})
    client.post("/dispatch-rules/", json={"ruleCode": code_b, "ruleName": "Excluder B"})

    # Set up exclusion: A <-> B
    # First, save with both seed + new exclusion
    client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
            {"ruleCode": code_a, "excludedRuleCode": code_b},
        ]
    })

    # Create request with only B selected (A is exempt because B excludes A)
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Exclusion Exemption Test",
        "ruleCodes": [code_b],
    })
    assert resp.status_code == 200

    # Cleanup: restore seed exclusions only and deactivate test rules
    client.put("/dispatch-rules/exclusions", json={
        "exclusions": [
            {"ruleCode": "INTERNAL_ONLY", "excludedRuleCode": "EXTERNAL_USING"},
        ]
    })
    client.delete(f"/dispatch-rules/{code_a}")
    client.delete(f"/dispatch-rules/{code_b}")
