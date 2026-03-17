"""Tests for Domain Questionnaire — reviewer-side questionnaire responses."""
import httpx
import pytest
import uuid

BASE_URL = "http://localhost:4001/api"

ADMIN = {"X-Dev-Role": "admin"}


@pytest.fixture()
def reviewer_template(client: httpx.Client, test_rule_with_domain):
    """Create a reviewer-audience questionnaire template for the test domain."""
    domain_code = test_rule_with_domain["domainCode"]
    resp = client.post("/questionnaire-templates", json={
        "domainCode": domain_code,
        "section": "Reviewer Section",
        "questionNo": 1,
        "questionText": "Is compliance met?",
        "answerType": "radio",
        "options": ["Yes", "No"],
        "isRequired": True,
        "sortOrder": 1,
        "audience": "reviewer",
    })
    assert resp.status_code == 200
    data = resp.json()
    yield data
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        c.post("/dev/delete", json={"questionnaireTemplates": [data["id"]]})


@pytest.fixture()
def accepted_review(client: httpx.Client, submitted_request_with_reviews):
    """Accept the first domain review so it can receive reviewer questionnaire responses."""
    review_id = submitted_request_with_reviews["reviewId"]
    resp = client.put(f"/domain-reviews/{review_id}/accept")
    assert resp.status_code == 200
    return submitted_request_with_reviews


class TestReviewerTemplates:
    """GET /domain-questionnaire/templates/{domain_review_id}."""

    def test_get_reviewer_templates(self, client: httpx.Client, accepted_review, reviewer_template):
        """Returns only audience='reviewer' active templates for the review's domain."""
        review_id = accepted_review["reviewId"]
        resp = client.get(f"/domain-questionnaire/templates/{review_id}", headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        # Should include our reviewer template
        ids = [q["id"] for q in data]
        assert reviewer_template["id"] in ids
        # All returned should have correct fields
        for q in data:
            assert "questionText" in q
            assert "answerType" in q

    def test_get_reviewer_templates_404(self, client: httpx.Client):
        """Non-existent review returns 404."""
        fake_id = str(uuid.uuid4())
        resp = client.get(f"/domain-questionnaire/templates/{fake_id}", headers=ADMIN)
        assert resp.status_code == 404


class TestReviewerResponses:
    """GET/POST /domain-questionnaire/{domain_review_id}."""

    def test_get_responses_empty(self, client: httpx.Client, accepted_review):
        """No responses initially."""
        review_id = accepted_review["reviewId"]
        resp = client.get(f"/domain-questionnaire/{review_id}", headers=ADMIN)
        assert resp.status_code == 200
        assert resp.json()["data"] == []

    def test_save_responses(self, client: httpx.Client, accepted_review, reviewer_template):
        """Upsert reviewer answers when review is in Accept status."""
        review_id = accepted_review["reviewId"]
        resp = client.post(f"/domain-questionnaire/{review_id}", json={
            "responses": [
                {"templateId": reviewer_template["id"], "answer": {"value": "Yes"}},
            ],
        }, headers=ADMIN)
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) >= 1
        assert data[0]["templateId"] == reviewer_template["id"]

        # Verify via GET
        resp2 = client.get(f"/domain-questionnaire/{review_id}", headers=ADMIN)
        assert resp2.status_code == 200
        assert len(resp2.json()["data"]) >= 1

    def test_save_responses_not_accept_status(self, client: httpx.Client, submitted_request_with_reviews, reviewer_template):
        """400 when review is not in Accept status."""
        review_id = submitted_request_with_reviews["reviewId"]
        # Review is in 'Waiting for Accept' — should fail
        resp = client.post(f"/domain-questionnaire/{review_id}", json={
            "responses": [
                {"templateId": reviewer_template["id"], "answer": {"value": "Yes"}},
            ],
        }, headers=ADMIN)
        assert resp.status_code == 400
        assert "Accept" in resp.json()["detail"]

    def test_save_responses_empty_array(self, client: httpx.Client, accepted_review):
        """400 when no responses provided."""
        review_id = accepted_review["reviewId"]
        resp = client.post(f"/domain-questionnaire/{review_id}", json={
            "responses": [],
        }, headers=ADMIN)
        assert resp.status_code == 400


class TestReviewerQuestionnaireBlocking:
    """Approve/not-pass blocked when required reviewer questions unanswered."""

    def test_approve_blocked_by_incomplete_reviewer_questionnaire(
        self, client: httpx.Client, submitted_request_with_reviews, reviewer_template,
    ):
        """Accept review, add required reviewer template, attempt approve without answering → 400."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Accept the review
        resp = client.put(f"/domain-reviews/{review_id}/accept")
        assert resp.status_code == 200

        # Try to approve — should be blocked because required reviewer template is unanswered
        resp = client.put(f"/domain-reviews/{review_id}/approve")
        assert resp.status_code == 400
        assert "required reviewer questions" in resp.json()["detail"].lower()

    def test_approve_succeeds_after_answering_all_reviewer_questions(
        self, client: httpx.Client, submitted_request_with_reviews, reviewer_template,
    ):
        """Answer ALL required reviewer questions → approve succeeds."""
        review_id = submitted_request_with_reviews["reviewId"]

        # Accept
        resp = client.put(f"/domain-reviews/{review_id}/accept")
        assert resp.status_code == 200

        # Get all reviewer templates to answer them all
        resp = client.get(f"/domain-questionnaire/templates/{review_id}", headers=ADMIN)
        assert resp.status_code == 200
        templates = resp.json()["data"]

        # Answer ALL required reviewer templates
        responses = []
        for tmpl in templates:
            if tmpl.get("isRequired"):
                if tmpl["answerType"] in ("radio", "dropdown") and tmpl.get("options"):
                    answer = {"value": tmpl["options"][0]}
                elif tmpl["answerType"] == "multiselect" and tmpl.get("options"):
                    answer = {"value": [tmpl["options"][0]]}
                else:
                    answer = {"value": "Test answer"}
                responses.append({"templateId": tmpl["id"], "answer": answer})

        if responses:
            resp = client.post(f"/domain-questionnaire/{review_id}", json={
                "responses": responses,
            }, headers=ADMIN)
            assert resp.status_code == 200

        # Now approve should succeed
        resp = client.put(f"/domain-reviews/{review_id}/approve")
        assert resp.status_code == 200
        assert resp.json()["status"] == "Approved"
