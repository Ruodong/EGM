"""Shared fixtures for API tests."""
import httpx
import pytest
import uuid

BASE_URL = "http://localhost:4001/api"


def _dev_delete(payload: dict):
    """Call POST /dev/delete to remove specific test-created resources."""
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        resp = c.post("/dev/delete", json=payload)
        assert resp.status_code == 200, f"Dev delete failed: {resp.text}"


def _answer_all_required_questionnaires(client: httpx.Client, request_id: str):
    """Answer all required domain questionnaire templates for a request."""
    resp = client.get(f"/request-questionnaire/templates/{request_id}")
    if resp.status_code != 200:
        return
    responses = []
    for domain in resp.json().get("data", []):
        for q in domain["questions"]:
            if q["isRequired"]:
                if q["answerType"] in ("radio", "dropdown") and q.get("options"):
                    answer = {"value": q["options"][0]}
                elif q["answerType"] == "multiselect" and q.get("options"):
                    answer = {"value": [q["options"][0]]}
                else:
                    answer = {"value": "Test answer"}
                responses.append({
                    "templateId": q["id"],
                    "domainCode": domain["domainCode"],
                    "answer": answer,
                })
    if responses:
        client.post(f"/request-questionnaire/{request_id}", json={"responses": responses})


def _reset_mandatory_rules():
    """Reset all mandatory dispatch rule flags and return codes to restore."""
    codes = []
    with httpx.Client(base_url=BASE_URL, timeout=30, headers={"X-Dev-Role": "admin"}) as c:
        resp = c.get("/dispatch-rules/")
        rules = resp.json().get("data", resp.json()) if isinstance(resp.json(), dict) else resp.json()
        for r in rules:
            if r.get("isMandatory"):
                codes.append(r["ruleCode"])
                c.put(f"/dispatch-rules/{r['ruleCode']}", json={"isMandatory": False})
    return codes


def _restore_mandatory_rules(codes: list[str]):
    """Restore mandatory flags."""
    with httpx.Client(base_url=BASE_URL, timeout=30, headers={"X-Dev-Role": "admin"}) as c:
        for code in codes:
            c.put(f"/dispatch-rules/{code}", json={"isMandatory": True})


@pytest.fixture(autouse=True, scope="session")
def auto_cleanup():
    """Reset mandatory rules before and restore after the entire test session."""
    mandatory_codes = _reset_mandatory_rules()
    yield
    _restore_mandatory_rules(mandatory_codes)


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def client():
    """Synchronous httpx client for API tests."""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        yield c


@pytest.fixture()
def cleanup_requests():
    """Collect governance request IDs for cleanup after the test."""
    ids: list[str] = []
    yield ids
    if ids:
        _dev_delete({"governanceRequests": ids})


@pytest.fixture()
def cleanup_dispatch():
    """Collect dispatch rule codes and governance request IDs for cleanup."""
    data: dict[str, list[str]] = {"rules": [], "requests": []}
    yield data
    payload: dict[str, list[str]] = {}
    if data["requests"]:
        payload["governanceRequests"] = data["requests"]
    if data["rules"]:
        payload["dispatchRules"] = data["rules"]
    if payload:
        _dev_delete(payload)


@pytest.fixture(scope="session")
def test_rule_with_domain(client: httpx.Client):
    """Create a test dispatch rule mapped to a test domain (session-scoped).

    This ensures that governance requests created with this rule will have at
    least one triggered domain, satisfying the submit validation.
    """
    domain_code = "PYTEST_DOM"
    rule_code = "PYTEST_RULE"

    # Create domain (ignore 409 if already exists)
    resp = client.post("/domains", json={
        "domainCode": domain_code,
        "domainName": "Pytest Test Domain",
        "description": "Auto-created for API tests",
        "integrationType": "internal",
    })
    assert resp.status_code in (200, 409)

    # Create dispatch rule (ignore 409 if already exists)
    resp = client.post("/dispatch-rules/", json={
        "ruleCode": rule_code,
        "ruleName": "Pytest Test Rule",
        "description": "Auto-created for API tests",
    })
    assert resp.status_code in (200, 409)

    # Map rule → domain via direct SQL through dev endpoint
    # Use the matrix endpoint but only for this specific rule
    # Instead, insert directly: need the rule's UUID first
    resp = client.get("/dispatch-rules/")
    rules = resp.json().get("data", resp.json()) if isinstance(resp.json(), dict) else resp.json()
    rule_id = None
    for r in rules:
        if r["ruleCode"] == rule_code:
            rule_id = r["id"]
            break
    assert rule_id, f"Rule {rule_code} not found after creation"

    # Save matrix entry for just this rule (use PUT matrix with only our rule)
    # This is destructive to other mappings! Instead, use raw SQL via dev endpoint.
    # Better: POST a mapping directly. But there's no endpoint for that.
    # Safest: use the dev/exec endpoint if it exists, or add one.
    # Actually, let's just call save_matrix with ALL existing mappings + ours.
    # Fetch current matrix first:
    resp = client.get("/dispatch-rules/matrix")
    assert resp.status_code == 200
    matrix_data = resp.json()
    current_matrix = matrix_data.get("matrix", {})

    # Add our mapping
    current_matrix[rule_code] = {domain_code: "in"}

    # Save
    resp = client.put("/dispatch-rules/matrix", json={"matrix": current_matrix})
    assert resp.status_code == 200

    yield {"ruleCode": rule_code, "domainCode": domain_code}

    # Cleanup: remove the mapping, rule, and domain
    # Re-save matrix without our rule
    if rule_code in current_matrix:
        del current_matrix[rule_code]
    client.put("/dispatch-rules/matrix", json={"matrix": current_matrix})
    _dev_delete({"dispatchRules": [rule_code], "domains": [domain_code]})


@pytest.fixture()
def create_request(client: httpx.Client, test_rule_with_domain):
    """Helper: create a governance request with a rule that triggers a domain. Auto-cleans up."""
    resp = client.post("/governance-requests", json={
        "title": "Test Request",
        "description": "Created by pytest",
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "productSoftwareType": "Hardware",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
        "ruleCodes": [test_rule_with_domain["ruleCode"]],
        "projectType": "non_mspo",
        "projectCode": "TEST-001",
        "projectName": "Test Project",
        "projectPm": "Test PM",
        "projectStartDate": "2026-01-01",
        "projectGoLiveDate": "2026-06-01",
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    _dev_delete({"governanceRequests": [data["requestId"]]})


@pytest.fixture()
def submitted_request(client: httpx.Client, create_request):
    """Create and submit a governance request."""
    rid = create_request["requestId"]
    _answer_all_required_questionnaires(client, rid)
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200
    yield resp.json()
    # No cleanup needed — create_request fixture handles GR deletion


@pytest.fixture()
def create_domain(client: httpx.Client):
    """Create a unique test domain and return it. Auto-cleans up."""
    code = f"TEST_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/domains", json={
        "domainCode": code,
        "domainName": f"Test Domain {code}",
        "description": "Created by pytest",
        "integrationType": "internal",
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    _dev_delete({"domains": [code]})


@pytest.fixture()
def submitted_request_with_reviews(client: httpx.Client, test_rule_with_domain):
    """Create → submit a governance request (submit auto-creates domain reviews).

    Returns dict with 'request' and 'reviewId' (first review).
    """
    resp = client.post("/governance-requests", json={
        "title": "Review Test",
        "description": "For domain review testing",
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "productSoftwareType": "Hardware",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
        "ruleCodes": [test_rule_with_domain["ruleCode"]],
        "projectType": "non_mspo",
        "projectCode": "REV-001",
        "projectName": "Review Test Project",
        "projectPm": "Test PM",
        "projectStartDate": "2026-01-01",
        "projectGoLiveDate": "2026-06-01",
    })
    assert resp.status_code == 200
    gr = resp.json()
    rid = gr["requestId"]

    # Answer required questionnaires before submit
    _answer_all_required_questionnaires(client, rid)

    # Submit (auto-creates domain reviews with 'Waiting for Accept')
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200

    # Fetch the created domain reviews
    resp = client.get("/domain-reviews", params={"request_id": rid})
    assert resp.status_code == 200
    reviews = resp.json()["data"]
    assert len(reviews) >= 1, "Submit should create at least one domain review"

    yield {
        "request": gr,
        "reviewId": reviews[0]["id"],
        "reviews": reviews,
    }
    _dev_delete({"governanceRequests": [rid]})


@pytest.fixture()
def create_template(client: httpx.Client):
    """Create an intake template and return it. Auto-cleans up."""
    resp = client.post("/intake/templates", json={
        "sectionType": "common",
        "section": "Test Section",
        "questionNo": 1,
        "questionText": f"Test Question {uuid.uuid4().hex[:6]}?",
        "answerType": "text",
        "isRequired": False,
        "sortOrder": 100,
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    _dev_delete({"intakeTemplates": [data["id"]]})
