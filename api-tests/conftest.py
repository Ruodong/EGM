"""Shared fixtures for API tests."""
import httpx
import pytest
import uuid

BASE_URL = "http://localhost:4001/api"


def _cleanup():
    """Call the dev cleanup endpoint to remove all transactional test data."""
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        resp = c.post("/dev/cleanup")
        assert resp.status_code == 200, f"Cleanup failed: {resp.text}"


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
    """Clean test data before and after the entire test session."""
    _cleanup()
    mandatory_codes = _reset_mandatory_rules()
    yield
    _restore_mandatory_rules(mandatory_codes)
    _cleanup()


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def client():
    """Synchronous httpx client for API tests."""
    with httpx.Client(base_url=BASE_URL, timeout=10) as c:
        yield c


@pytest.fixture()
def create_request(client: httpx.Client):
    """Helper: create a governance request and return it."""
    resp = client.post("/governance-requests", json={
        "title": "Test Request",
        "description": "Created by pytest",
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "productSoftwareType": "Hardware",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
    })
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture()
def submitted_request(client: httpx.Client, create_request):
    """Create and submit a governance request."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture()
def create_domain(client: httpx.Client):
    """Create a unique test domain and return it."""
    code = f"TEST_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/domains", json={
        "domainCode": code,
        "domainName": f"Test Domain {code}",
        "description": "Created by pytest",
        "integrationType": "internal",
    })
    assert resp.status_code == 200
    return resp.json()


@pytest.fixture()
def dispatched_request(client: httpx.Client, create_domain):
    """Create → submit → dispatch a governance request with a domain review."""
    # Create request
    resp = client.post("/governance-requests", json={
        "title": "Dispatch Test",
        "description": "For dispatch testing",
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "productSoftwareType": "Hardware",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
    })
    assert resp.status_code == 200
    gr = resp.json()
    rid = gr["requestId"]

    # Submit
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200

    # Dispatch with specific domain
    resp = client.post(f"/dispatch/execute/{rid}", json={
        "domainCodes": [create_domain["domainCode"]],
    })
    assert resp.status_code == 200
    dispatch_result = resp.json()

    return {
        "request": gr,
        "domain": create_domain,
        "dispatched": dispatch_result,
        "reviewId": dispatch_result["dispatched"][0]["id"] if dispatch_result["dispatched"] else None,
    }


@pytest.fixture()
def create_template(client: httpx.Client):
    """Create an intake template and return it."""
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
    return resp.json()
