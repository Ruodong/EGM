"""API tests for Questionnaire Template management."""
import httpx
import pytest
import uuid

BASE_URL = "http://localhost:4001/api"


@pytest.fixture()
def internal_domain(client: httpx.Client):
    """Create an internal test domain for questionnaire tests."""
    code = f"QT_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/domains", json={
        "domainCode": code,
        "domainName": f"QT Test Domain {code}",
        "description": "For questionnaire template testing",
        "integrationType": "internal",
    })
    assert resp.status_code == 200
    yield resp.json()
    # Cleanup domain + any templates
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"domains": [code]})


@pytest.fixture()
def external_domain(client: httpx.Client):
    """Create an external test domain."""
    code = f"QTE_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/domains", json={
        "domainCode": code,
        "domainName": f"QT External {code}",
        "integrationType": "external",
    })
    assert resp.status_code == 200
    yield resp.json()
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"domains": [code]})


@pytest.fixture()
def template(client: httpx.Client, internal_domain):
    """Create a questionnaire template question."""
    resp = client.post("/questionnaire-templates", json={
        "domainCode": internal_domain["domainCode"],
        "section": "General",
        "questionNo": 1,
        "questionText": "Test question?",
        "answerType": "radio",
        "options": ["Yes", "No"],
        "isRequired": True,
        "sortOrder": 1,
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})


# ---------------------------------------------------------------------------
# AC-1: GET returns templates grouped by internal domains
# ---------------------------------------------------------------------------
class TestListTemplates:
    def test_list_returns_internal_domains_only(self, client, internal_domain, external_domain):
        """AC-1: Only internal domains appear in the list."""
        resp = client.get("/questionnaire-templates")
        assert resp.status_code == 200
        data = resp.json()["data"]
        codes = [d["domainCode"] for d in data]
        assert internal_domain["domainCode"] in codes
        assert external_domain["domainCode"] not in codes

    def test_list_includes_templates(self, client, template, internal_domain):
        """AC-1: Templates are grouped under their domain."""
        resp = client.get("/questionnaire-templates")
        assert resp.status_code == 200
        data = resp.json()["data"]
        domain_entry = next(d for d in data if d["domainCode"] == internal_domain["domainCode"])
        assert len(domain_entry["templates"]) >= 1
        t = domain_entry["templates"][0]
        assert t["questionText"] == "Test question?"
        assert t["answerType"] == "radio"
        assert t["options"] == ["Yes", "No"]

    def test_list_domain_templates(self, client, template, internal_domain):
        """AC-1: GET /{domain_code} returns templates for a specific domain."""
        code = internal_domain["domainCode"]
        resp = client.get(f"/questionnaire-templates/{code}")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        assert data[0]["domainCode"] == code


# ---------------------------------------------------------------------------
# AC-3: POST creates template with valid answer types
# ---------------------------------------------------------------------------
class TestCreateTemplate:
    def test_create_radio(self, client, internal_domain):
        """AC-3: Create radio-type question."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Radio question?",
            "answerType": "radio",
            "options": ["A", "B", "C"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["answerType"] == "radio"
        assert data["options"] == ["A", "B", "C"]
        # Cleanup
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})

    def test_create_textarea(self, client, internal_domain):
        """AC-3: Create textarea-type question (no options needed)."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Describe in detail?",
            "questionDescription": "Please provide a thorough explanation",
            "answerType": "textarea",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["answerType"] == "textarea"
        assert data["options"] is None
        assert data["questionDescription"] == "Please provide a thorough explanation"
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})

    def test_create_multiselect_with_other(self, client, internal_domain):
        """AC-3: Create multiselect question with Other option."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Select applicable?",
            "answerType": "multiselect",
            "options": ["Option A", "Option B", "Other"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "Other" in data["options"]
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})

    def test_create_dropdown(self, client, internal_domain):
        """AC-3: Create dropdown-type question."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Choose one?",
            "answerType": "dropdown",
            "options": ["X", "Y", "Z"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["answerType"] == "dropdown"
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})


# ---------------------------------------------------------------------------
# AC-4: POST rejects invalid answer types
# ---------------------------------------------------------------------------
class TestValidation:
    def test_reject_invalid_answer_type(self, client, internal_domain):
        """AC-4: Invalid answer type returns 400."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Bad type?",
            "answerType": "boolean",
        })
        assert resp.status_code == 400
        assert "answerType" in resp.json()["detail"]

    def test_reject_missing_domain(self, client):
        """AC-4: Missing domainCode returns 400."""
        resp = client.post("/questionnaire-templates", json={
            "questionText": "No domain?",
            "answerType": "textarea",
        })
        assert resp.status_code == 400

    def test_reject_radio_without_options(self, client, internal_domain):
        """AC-5: Radio type without options returns 400."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "No options?",
            "answerType": "radio",
        })
        assert resp.status_code == 400
        assert "options" in resp.json()["detail"]

    def test_reject_external_domain(self, client, external_domain):
        """AC-4: External domains cannot have questionnaire templates."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": external_domain["domainCode"],
            "questionText": "External?",
            "answerType": "textarea",
        })
        assert resp.status_code == 400
        assert "internal" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# AC-6: PUT updates template fields
# ---------------------------------------------------------------------------
class TestUpdateTemplate:
    def test_update_question_text(self, client, template):
        """AC-6: Update question text."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "questionText": "Updated question?",
        })
        assert resp.status_code == 200
        assert resp.json()["questionText"] == "Updated question?"

    def test_update_question_description(self, client, template):
        """AC-6: Update question description."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "questionDescription": "New description",
        })
        assert resp.status_code == 200
        assert resp.json()["questionDescription"] == "New description"

    def test_update_answer_type_and_options(self, client, template):
        """AC-6: Update answer type from radio to dropdown with new options."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "answerType": "dropdown",
            "options": ["New A", "New B", "Other"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["answerType"] == "dropdown"
        assert data["options"] == ["New A", "New B", "Other"]

    def test_update_no_fields_returns_400(self, client, template):
        """AC-6: Empty update returns 400."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={})
        assert resp.status_code == 400

    def test_update_nonexistent_returns_404(self, client):
        """AC-6: Nonexistent ID returns 404."""
        fake_id = str(uuid.uuid4())
        resp = client.put(f"/questionnaire-templates/{fake_id}", json={
            "questionText": "Does not exist",
        })
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# AC-7: DELETE toggles is_active
# ---------------------------------------------------------------------------
class TestToggleActive:
    def test_toggle_deactivate(self, client, template):
        """AC-7: DELETE toggles active → inactive."""
        assert template["isActive"] is True
        resp = client.delete(f"/questionnaire-templates/{template['id']}")
        assert resp.status_code == 200
        assert resp.json()["isActive"] is False

    def test_toggle_reactivate(self, client, template):
        """AC-7: Toggle twice reactivates."""
        client.delete(f"/questionnaire-templates/{template['id']}")
        resp = client.delete(f"/questionnaire-templates/{template['id']}")
        assert resp.status_code == 200
        assert resp.json()["isActive"] is True

    def test_toggle_nonexistent_returns_404(self, client):
        """AC-7: Toggle nonexistent template returns 404."""
        fake_id = str(uuid.uuid4())
        resp = client.delete(f"/questionnaire-templates/{fake_id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# AC-12: PUT /reorder updates sort_order
# ---------------------------------------------------------------------------
class TestReorder:
    def test_reorder_swaps_sort_order(self, client, internal_domain):
        """AC-12: Reorder swaps sort_order of two templates."""
        # Create two templates
        ids = []
        for i in range(2):
            resp = client.post("/questionnaire-templates", json={
                "domainCode": internal_domain["domainCode"],
                "questionText": f"Reorder Q{i}?",
                "answerType": "textarea",
                "sortOrder": i,
            })
            assert resp.status_code == 200
            ids.append(resp.json()["id"])

        # Swap order: Q0 → sortOrder 1, Q1 → sortOrder 0
        resp = client.put("/questionnaire-templates/reorder", json={
            "orders": [
                {"id": ids[0], "sortOrder": 1},
                {"id": ids[1], "sortOrder": 0},
            ],
        })
        assert resp.status_code == 200

        # Verify new order
        resp = client.get(f"/questionnaire-templates/{internal_domain['domainCode']}")
        assert resp.status_code == 200
        data = resp.json()["data"]
        ordered = sorted(data, key=lambda t: t["sortOrder"])
        assert ordered[0]["id"] == ids[1]
        assert ordered[1]["id"] == ids[0]

        # Cleanup
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": ids})
