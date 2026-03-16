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


# ---------------------------------------------------------------------------
# AC-13: Dependency — question depends on another question's answer
# ---------------------------------------------------------------------------
class TestDependency:
    def test_create_with_dependency(self, client, internal_domain):
        """Create a question that depends on another question's answer."""
        # Create parent question
        resp1 = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "section": "Dep Section",
            "questionText": "Is this a vendor project?",
            "answerType": "radio",
            "options": ["Yes", "No"],
            "sortOrder": 0,
        })
        assert resp1.status_code == 200
        parent_id = resp1.json()["id"]

        # Create dependent question
        resp2 = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "section": "Dep Section",
            "questionText": "Provide vendor details",
            "answerType": "textarea",
            "sortOrder": 1,
            "dependency": {"questionId": parent_id, "answer": "Yes"},
        })
        assert resp2.status_code == 200
        data = resp2.json()
        assert data["dependency"] is not None
        assert data["dependency"]["questionId"] == parent_id
        assert data["dependency"]["answer"] == "Yes"

        # Cleanup
        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [parent_id, data["id"]]})

    def test_update_dependency(self, client, template):
        """Update a question to add/change dependency."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "dependency": {"questionId": "00000000-0000-0000-0000-000000000001", "answer": "No"},
        })
        assert resp.status_code == 200
        assert resp.json()["dependency"]["answer"] == "No"

        # Clear dependency
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "dependency": None,
        })
        assert resp.status_code == 200
        assert resp.json()["dependency"] is None

    def test_dependency_returned_in_list(self, client, internal_domain):
        """Dependency field is returned when listing templates."""
        resp1 = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Parent Q?",
            "answerType": "radio",
            "options": ["A", "B"],
            "sortOrder": 0,
        })
        parent_id = resp1.json()["id"]

        resp2 = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Child Q?",
            "answerType": "textarea",
            "sortOrder": 1,
            "dependency": {"questionId": parent_id, "answer": "A"},
        })
        child_id = resp2.json()["id"]

        resp = client.get(f"/questionnaire-templates/{internal_domain['domainCode']}")
        assert resp.status_code == 200
        templates = resp.json()["data"]
        child = next(t for t in templates if t["id"] == child_id)
        assert child["dependency"]["questionId"] == parent_id

        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [parent_id, child_id]})


# ---------------------------------------------------------------------------
# AC-14: Description Box — additional text box for any question type
# ---------------------------------------------------------------------------
class TestDescriptionBox:
    def test_create_with_description_box(self, client, internal_domain):
        """Create a question with description box enabled."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Rate the risk?",
            "answerType": "radio",
            "options": ["Low", "Medium", "High"],
            "hasDescriptionBox": True,
            "descriptionBoxTitle": "Explain your rating",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["hasDescriptionBox"] is True
        assert data["descriptionBoxTitle"] == "Explain your rating"

        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})

    def test_create_with_default_title(self, client, internal_domain):
        """Create question with description box but no custom title — uses None."""
        resp = client.post("/questionnaire-templates", json={
            "domainCode": internal_domain["domainCode"],
            "questionText": "Approve?",
            "answerType": "radio",
            "options": ["Yes", "No"],
            "hasDescriptionBox": True,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["hasDescriptionBox"] is True
        assert data["descriptionBoxTitle"] is None  # NULL — frontend uses default

        with httpx.Client(base_url=BASE_URL, timeout=30) as c:
            c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})

    def test_update_description_box(self, client, template):
        """Update template to enable/disable description box."""
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "hasDescriptionBox": True,
            "descriptionBoxTitle": "Custom title",
        })
        assert resp.status_code == 200
        assert resp.json()["hasDescriptionBox"] is True
        assert resp.json()["descriptionBoxTitle"] == "Custom title"

        # Disable
        resp = client.put(f"/questionnaire-templates/{template['id']}", json={
            "hasDescriptionBox": False,
        })
        assert resp.status_code == 200
        assert resp.json()["hasDescriptionBox"] is False


# ---------------------------------------------------------------------------
# AC-15: System Config — default description box title
# ---------------------------------------------------------------------------
class TestSystemConfig:
    def test_get_default_title(self, client):
        """Read the default description box title from system config."""
        resp = client.get("/system-config/questionnaire.descriptionBoxDefaultTitle")
        assert resp.status_code == 200
        assert resp.json()["value"] == "Justify your answer below"

    def test_update_default_title(self, client):
        """Admin can update the default title."""
        original = client.get("/system-config/questionnaire.descriptionBoxDefaultTitle").json()["value"]
        resp = client.put("/system-config/questionnaire.descriptionBoxDefaultTitle", json={
            "value": "Please explain",
        })
        assert resp.status_code == 200
        assert resp.json()["value"] == "Please explain"

        # Restore
        client.put("/system-config/questionnaire.descriptionBoxDefaultTitle", json={
            "value": original,
        })

    def test_list_config(self, client):
        """List all config keys."""
        resp = client.get("/system-config")
        assert resp.status_code == 200
        data = resp.json()["data"]
        keys = [d["key"] for d in data]
        assert "questionnaire.descriptionBoxDefaultTitle" in keys

    def test_get_nonexistent_key(self, client):
        """Nonexistent key returns 404."""
        resp = client.get("/system-config/nonexistent.key")
        assert resp.status_code == 404
