"""API tests for pre-submit domain questionnaire responses."""
import httpx
import pytest

BASE_URL = "http://localhost:4001/api"


def _get_mandatory_rule_codes(client: httpx.Client) -> list[str]:
    """Get mandatory rule codes to include in request creation for submit tests."""
    resp = client.get("/dispatch-rules/")
    data = resp.json()
    rules = data.get("data", data) if isinstance(data, dict) else data
    return [r["ruleCode"] for r in rules if r.get("isMandatory")]


@pytest.fixture()
def request_with_all_rules(client: httpx.Client, test_rule_with_domain):
    """Create a request that includes mandatory rules + test rule (submittable)."""
    mandatory = _get_mandatory_rule_codes(client)
    all_rules = list(set(mandatory + [test_rule_with_domain["ruleCode"]]))
    resp = client.post("/governance-requests", json={
        "title": "Questionnaire Test",
        "description": "For questionnaire testing",
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "productSoftwareType": "Hardware",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
        "ruleCodes": all_rules,
        "projectType": "non_mspo",
        "projectCode": "QT-001",
        "projectName": "QT Test Project",
        "projectPm": "Test PM",
        "projectStartDate": "2026-01-01",
        "projectGoLiveDate": "2026-06-01",
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"governanceRequests": [data["requestId"]]})


@pytest.fixture()
def template_for_domain(client: httpx.Client, test_rule_with_domain):
    """Create a required questionnaire template for the test domain."""
    domain_code = test_rule_with_domain["domainCode"]
    resp = client.post("/questionnaire-templates", json={
        "domainCode": domain_code,
        "questionText": "Pre-submit test question?",
        "answerType": "radio",
        "options": ["Yes", "No"],
        "isRequired": True,
        "sortOrder": 0,
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})


@pytest.fixture()
def optional_template(client: httpx.Client, test_rule_with_domain):
    """Create an optional questionnaire template for the test domain."""
    domain_code = test_rule_with_domain["domainCode"]
    resp = client.post("/questionnaire-templates", json={
        "domainCode": domain_code,
        "questionText": "Optional question?",
        "answerType": "textarea",
        "isRequired": False,
        "sortOrder": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})


# ---------------------------------------------------------------------------
# GET /request-questionnaire/templates/{request_id}
# ---------------------------------------------------------------------------
class TestGetTemplates:
    def test_returns_templates_for_triggered_domains(self, client, create_request, template_for_domain):
        """Templates endpoint returns questions for triggered internal domains."""
        rid = create_request["requestId"]
        resp = client.get(f"/request-questionnaire/templates/{rid}")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        domain_entry = next(d for d in data if d["domainCode"] == template_for_domain["domainCode"])
        assert len(domain_entry["questions"]) >= 1
        q = domain_entry["questions"][0]
        assert q["questionText"] == "Pre-submit test question?"
        assert q["answerType"] == "radio"
        assert q["isRequired"] is True

    def test_returns_empty_for_no_templates(self, client, create_request):
        """Returns empty when no templates exist for triggered domains."""
        rid = create_request["requestId"]
        resp = client.get(f"/request-questionnaire/templates/{rid}")
        assert resp.status_code == 200
        # May or may not have data depending on seed data, but shouldn't error


# ---------------------------------------------------------------------------
# POST /request-questionnaire/{request_id} — save responses
# ---------------------------------------------------------------------------
class TestSaveResponses:
    def test_save_and_retrieve(self, client, create_request, template_for_domain):
        """Save a response and retrieve it."""
        rid = create_request["requestId"]
        resp = client.post(f"/request-questionnaire/{rid}", json={
            "responses": [{
                "templateId": template_for_domain["id"],
                "domainCode": template_for_domain["domainCode"],
                "answer": {"value": "Yes"},
            }],
        })
        assert resp.status_code == 200
        saved = resp.json()["data"]
        assert len(saved) == 1
        assert saved[0]["answer"]["value"] == "Yes"

        # Retrieve
        resp = client.get(f"/request-questionnaire/{rid}")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        entry = next(r for r in data if r["templateId"] == template_for_domain["id"])
        assert entry["answer"]["value"] == "Yes"

    def test_upsert_updates_existing(self, client, create_request, template_for_domain):
        """Saving again for the same template updates the answer."""
        rid = create_request["requestId"]
        # First save
        client.post(f"/request-questionnaire/{rid}", json={
            "responses": [{
                "templateId": template_for_domain["id"],
                "domainCode": template_for_domain["domainCode"],
                "answer": {"value": "Yes"},
            }],
        })
        # Update
        resp = client.post(f"/request-questionnaire/{rid}", json={
            "responses": [{
                "templateId": template_for_domain["id"],
                "domainCode": template_for_domain["domainCode"],
                "answer": {"value": "No"},
            }],
        })
        assert resp.status_code == 200
        assert resp.json()["data"][0]["answer"]["value"] == "No"

    def test_empty_responses_returns_400(self, client, create_request):
        """Empty responses array returns 400."""
        rid = create_request["requestId"]
        resp = client.post(f"/request-questionnaire/{rid}", json={"responses": []})
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Submit validation — questionnaire completion
# ---------------------------------------------------------------------------
def _answer_all_required(client: httpx.Client, request_id: str):
    """Answer all required questionnaire templates for a request with dummy data."""
    resp = client.get(f"/request-questionnaire/templates/{request_id}")
    if resp.status_code != 200:
        return
    responses = []
    for domain in resp.json()["data"]:
        for q in domain["questions"]:
            if q["isRequired"]:
                if q["answerType"] == "radio" and q.get("options"):
                    answer = {"value": q["options"][0]}
                elif q["answerType"] == "dropdown" and q.get("options"):
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


class TestSubmitValidation:
    def test_submit_blocked_without_required_answers(self, client, request_with_all_rules, template_for_domain):
        """Submit fails when required questionnaire questions are unanswered."""
        rid = request_with_all_rules["requestId"]
        # Answer all required templates EXCEPT the test template
        resp = client.get(f"/request-questionnaire/templates/{rid}")
        responses = []
        for domain in resp.json()["data"]:
            for q in domain["questions"]:
                if q["isRequired"] and q["id"] != template_for_domain["id"]:
                    if q["answerType"] == "radio" and q.get("options"):
                        answer = {"value": q["options"][0]}
                    elif q["answerType"] == "dropdown" and q.get("options"):
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
            client.post(f"/request-questionnaire/{rid}", json={"responses": responses})

        resp = client.put(f"/governance-requests/{rid}/submit")
        assert resp.status_code == 400
        assert "Incomplete domain questionnaires" in resp.json()["detail"]

    def test_submit_succeeds_with_answers(self, client, request_with_all_rules, template_for_domain):
        """Submit succeeds when all required questions are answered."""
        rid = request_with_all_rules["requestId"]
        _answer_all_required(client, rid)
        resp = client.put(f"/governance-requests/{rid}/submit")
        assert resp.status_code == 200
        assert resp.json()["status"] == "Submitted"

    def test_submit_ignores_optional_questions(self, client, request_with_all_rules, optional_template):
        """Submit succeeds even if optional questions are unanswered."""
        rid = request_with_all_rules["requestId"]
        _answer_all_required(client, rid)
        resp = client.put(f"/governance-requests/{rid}/submit")
        assert resp.status_code == 200
        assert resp.json()["status"] == "Submitted"
