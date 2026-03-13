"""Test intake endpoints — templates + responses + evaluate."""
import httpx
from conftest import _dev_delete


def test_list_templates(client: httpx.Client):
    resp = client.get("/intake/templates")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert isinstance(data["data"], list)


def test_list_templates_filter_section_type(client: httpx.Client):
    resp = client.get("/intake/templates", params={"section_type": "scoping"})
    assert resp.status_code == 200
    data = resp.json()
    for t in data["data"]:
        assert t["sectionType"] == "scoping"


def test_list_templates_admin(client: httpx.Client):
    resp = client.get("/intake/templates/admin")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data


def test_create_template(client: httpx.Client):
    resp = client.post("/intake/templates", json={
        "sectionType": "common",
        "section": "API Test Section",
        "questionNo": 99,
        "questionText": "Is this an API test question?",
        "answerType": "yes_no",
        "isRequired": True,
        "sortOrder": 999,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["sectionType"] == "common"
    assert data["questionText"] == "Is this an API test question?"
    assert data["isRequired"] is True
    _dev_delete({"intakeTemplates": [data["id"]]})


def test_update_template(client: httpx.Client, create_template):
    tid = create_template["id"]
    resp = client.put(f"/intake/templates/{tid}", json={
        "questionText": "Updated question text?",
        "isRequired": True,
    })
    assert resp.status_code == 200
    assert resp.json()["questionText"] == "Updated question text?"
    assert resp.json()["isRequired"] is True


def test_delete_template(client: httpx.Client, create_template):
    tid = create_template["id"]
    resp = client.delete(f"/intake/templates/{tid}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


def test_save_and_get_responses(client: httpx.Client, create_request, create_template):
    """Save a response and verify it's retrievable."""
    rid = create_request["requestId"]
    tid = create_template["id"]

    # Save response with plain text answer
    resp = client.post("/intake/responses", json={
        "requestId": rid,
        "answers": [
            {"templateId": tid, "answer": "This is a text answer"},
        ],
    })
    assert resp.status_code == 200
    assert len(resp.json()["data"]) == 1

    # Get responses using business ID
    resp = client.get(f"/intake/responses/{rid}")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) >= 1
    assert any(r["templateId"] == tid for r in data)


def test_save_response_array_answer(client: httpx.Client, create_request, create_template):
    """Verify array answers work with JSONB cast."""
    rid = create_request["requestId"]
    tid = create_template["id"]

    resp = client.post("/intake/responses", json={
        "requestId": rid,
        "answers": [
            {"templateId": tid, "answer": ["option1", "option2"]},
        ],
    })
    assert resp.status_code == 200


def test_evaluate_scoping(client: httpx.Client, create_request):
    """Evaluate scoping — should succeed even with no scoping answers."""
    rid = create_request["requestId"]
    resp = client.post(f"/intake/evaluate/{rid}")
    assert resp.status_code == 200
    data = resp.json()
    assert "triggeredDomains" in data


def test_get_changelog(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.get(f"/intake/changelog/{rid}")
    assert resp.status_code == 200
    assert "data" in resp.json()


def test_changelog_records_changes(client: httpx.Client, create_request, create_template):
    """Updating an answer should create a changelog entry."""
    rid = create_request["requestId"]
    tid = create_template["id"]

    # Save initial answer
    client.post("/intake/responses", json={
        "requestId": rid,
        "answers": [{"templateId": tid, "answer": "Initial answer"}],
    })

    # Update to a different answer (no changeReason — column is UUID type for ISR references)
    client.post("/intake/responses", json={
        "requestId": rid,
        "answers": [{"templateId": tid, "answer": "Updated answer"}],
    })

    # Changelog should have an entry
    resp = client.get(f"/intake/changelog/{rid}")
    assert resp.status_code == 200
    entries = resp.json()["data"]
    matching = [e for e in entries if e.get("templateId") == tid]
    assert len(matching) >= 1
