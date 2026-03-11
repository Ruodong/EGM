"""Test dispatch rules and execute endpoints."""
import uuid
import httpx


def test_list_dispatch_rules(client: httpx.Client):
    resp = client.get("/dispatch-rules")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data


def test_create_dispatch_rule(client: httpx.Client, create_domain):
    resp = client.post("/dispatch-rules", json={
        "ruleName": f"Test Rule {uuid.uuid4().hex[:6]}",
        "domainCode": create_domain["domainCode"],
        "conditionType": "always",
        "priority": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["conditionType"] == "always"
    assert data["domainCode"] == create_domain["domainCode"]


def test_update_dispatch_rule(client: httpx.Client, create_domain):
    # Create a rule first
    resp = client.post("/dispatch-rules", json={
        "ruleName": f"Update Test {uuid.uuid4().hex[:6]}",
        "domainCode": create_domain["domainCode"],
        "conditionType": "always",
    })
    rule_id = resp.json()["id"]

    # Update
    resp = client.put(f"/dispatch-rules/{rule_id}", json={
        "priority": 10,
        "ruleName": "Updated Rule Name",
    })
    assert resp.status_code == 200
    assert resp.json()["priority"] == 10
    assert resp.json()["ruleName"] == "Updated Rule Name"


def test_delete_dispatch_rule(client: httpx.Client, create_domain):
    resp = client.post("/dispatch-rules", json={
        "ruleName": f"Delete Test {uuid.uuid4().hex[:6]}",
        "domainCode": create_domain["domainCode"],
        "conditionType": "always",
    })
    rule_id = resp.json()["id"]

    resp = client.delete(f"/dispatch-rules/{rule_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_execute_dispatch(client: httpx.Client, create_domain):
    """Create + submit + dispatch to a specific domain."""
    # Create request
    resp = client.post("/governance-requests", json={"title": "Dispatch Exec Test"})
    rid = resp.json()["requestId"]

    # Submit
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200

    # Dispatch with explicit domain
    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 1
    assert data["dispatched"][0]["domainCode"] == create_domain["domainCode"]


def test_execute_dispatch_idempotent(client: httpx.Client, create_domain):
    """Dispatching the same domain twice should not create duplicates."""
    resp = client.post("/governance-requests", json={"title": "Idempotent Test"})
    rid = resp.json()["requestId"]
    client.put(f"/governance-requests/{rid}/submit")

    code = create_domain["domainCode"]

    # First dispatch
    resp1 = client.post(f"/dispatch/execute/{rid}", json={"domainCodes": [code]})
    assert resp1.json()["count"] == 1

    # Second dispatch — same domain should be skipped
    resp2 = client.post(f"/dispatch/execute/{rid}", json={"domainCodes": [code]})
    assert resp2.json()["count"] == 0


def test_create_scoping_answer_rule(client: httpx.Client, create_domain):
    """Create a dispatch rule with scoping_answer condition type."""
    resp = client.post("/dispatch-rules", json={
        "ruleName": f"Scoping Rule {uuid.uuid4().hex[:6]}",
        "domainCode": create_domain["domainCode"],
        "conditionType": "scoping_answer",
        "conditionField": "some-template-id",
        "conditionOperator": "equals",
        "conditionValue": "Yes",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["conditionType"] == "scoping_answer"


def test_create_field_value_rule(client: httpx.Client, create_domain):
    """Create a dispatch rule with field_value condition type."""
    resp = client.post("/dispatch-rules", json={
        "ruleName": f"Field Rule {uuid.uuid4().hex[:6]}",
        "domainCode": create_domain["domainCode"],
        "conditionType": "field_value",
        "conditionField": "priority",
        "conditionOperator": "equals",
        "conditionValue": "Critical",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["conditionType"] == "field_value"
