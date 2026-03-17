"""Test domain review lifecycle endpoints (new 6-state machine)."""
import httpx

BASE_URL = "http://localhost:4001/api"
ADMIN = {"X-Dev-Role": "admin"}


def _answer_reviewer_questionnaires(client: httpx.Client, review_id: str):
    """Answer all required reviewer questionnaire templates for a domain review."""
    resp = client.get(f"/domain-questionnaire/templates/{review_id}", headers=ADMIN)
    if resp.status_code != 200:
        return
    templates = resp.json().get("data", [])
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
        client.post(f"/domain-questionnaire/{review_id}", json={
            "responses": responses,
        }, headers=ADMIN)


def test_list_reviews(client: httpx.Client):
    resp = client.get("/domain-reviews")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data


def test_submit_creates_reviews(client: httpx.Client, submitted_request_with_reviews):
    """Submit should auto-create domain reviews with 'Waiting for Accept' status."""
    reviews = submitted_request_with_reviews["reviews"]
    assert len(reviews) >= 1
    assert reviews[0]["status"] == "Waiting for Accept"


def test_get_review(client: httpx.Client, submitted_request_with_reviews):
    review_id = submitted_request_with_reviews["reviewId"]
    resp = client.get(f"/domain-reviews/{review_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == review_id
    assert data["status"] == "Waiting for Accept"


def test_accept_review(client: httpx.Client, submitted_request_with_reviews):
    """Accept: Waiting for Accept → Accept. First accept transitions request to In Progress."""
    review_id = submitted_request_with_reviews["reviewId"]
    rid = submitted_request_with_reviews["request"]["requestId"]

    resp = client.put(f"/domain-reviews/{review_id}/accept")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Accept"
    assert resp.json()["reviewer"] is not None
    assert resp.json()["startedAt"] is not None

    # Request should now be In Progress
    gr_resp = client.get(f"/governance-requests/{rid}")
    assert gr_resp.status_code == 200
    assert gr_resp.json()["status"] == "In Progress"


def test_accept_requires_waiting_status(client: httpx.Client, submitted_request_with_reviews):
    """Cannot accept a review that's not in 'Waiting for Accept' status."""
    review_id = submitted_request_with_reviews["reviewId"]
    # Accept first
    client.put(f"/domain-reviews/{review_id}/accept")
    # Try accept again (now in 'Accept' status)
    resp = client.put(f"/domain-reviews/{review_id}/accept")
    assert resp.status_code == 400


def test_return_review(client: httpx.Client, submitted_request_with_reviews):
    """Return: Waiting for Accept → Return for Additional Information."""
    review_id = submitted_request_with_reviews["reviewId"]

    resp = client.put(f"/domain-reviews/{review_id}/return", json={
        "reason": "Need more details about the architecture"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Return for Additional Information"
    assert resp.json()["returnReason"] == "Need more details about the architecture"


def test_return_requires_reason(client: httpx.Client, submitted_request_with_reviews):
    """Return without reason should fail."""
    review_id = submitted_request_with_reviews["reviewId"]
    resp = client.put(f"/domain-reviews/{review_id}/return", json={"reason": ""})
    assert resp.status_code == 400


def test_return_does_not_change_request_status(client: httpx.Client, submitted_request_with_reviews):
    """Return should NOT change governance request status."""
    review_id = submitted_request_with_reviews["reviewId"]
    rid = submitted_request_with_reviews["request"]["requestId"]

    # Check initial request status
    gr_before = client.get(f"/governance-requests/{rid}").json()
    initial_status = gr_before["status"]

    # Return the review
    client.put(f"/domain-reviews/{review_id}/return", json={"reason": "Test reason"})

    # Request status should be unchanged
    gr_after = client.get(f"/governance-requests/{rid}").json()
    assert gr_after["status"] == initial_status


def test_resubmit_review(client: httpx.Client, submitted_request_with_reviews):
    """Resubmit: Return for Additional Information → Waiting for Accept."""
    review_id = submitted_request_with_reviews["reviewId"]

    # Return first
    client.put(f"/domain-reviews/{review_id}/return", json={"reason": "Need info"})

    # Resubmit
    resp = client.put(f"/domain-reviews/{review_id}/resubmit")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Waiting for Accept"
    assert resp.json()["returnReason"] is None  # cleared


def test_resubmit_requires_return_status(client: httpx.Client, submitted_request_with_reviews):
    """Cannot resubmit a review not in 'Return for Additional Information' status."""
    review_id = submitted_request_with_reviews["reviewId"]
    # Review is in 'Waiting for Accept', not 'Return for Additional Information'
    resp = client.put(f"/domain-reviews/{review_id}/resubmit")
    assert resp.status_code == 400


def test_approve_review(client: httpx.Client, submitted_request_with_reviews):
    """Approve: Accept → Approved (terminal)."""
    review_id = submitted_request_with_reviews["reviewId"]

    # Accept first
    client.put(f"/domain-reviews/{review_id}/accept")

    # Answer required reviewer questionnaires
    _answer_reviewer_questionnaires(client, review_id)

    # Approve
    resp = client.put(f"/domain-reviews/{review_id}/approve")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Approved"
    assert resp.json()["completedAt"] is not None


def test_approve_with_exception(client: httpx.Client, submitted_request_with_reviews):
    """Approve with exception: Accept → Approved with Exception (terminal)."""
    review_id = submitted_request_with_reviews["reviewId"]

    client.put(f"/domain-reviews/{review_id}/accept")
    _answer_reviewer_questionnaires(client, review_id)

    resp = client.put(f"/domain-reviews/{review_id}/approve-with-exception", json={
        "outcomeNotes": "Exception: requires follow-up audit"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Approved with Exception"
    assert resp.json()["outcomeNotes"] == "Exception: requires follow-up audit"


def test_not_pass_review(client: httpx.Client, submitted_request_with_reviews):
    """Not pass: Accept → Not Passed (terminal)."""
    review_id = submitted_request_with_reviews["reviewId"]

    client.put(f"/domain-reviews/{review_id}/accept")
    _answer_reviewer_questionnaires(client, review_id)

    resp = client.put(f"/domain-reviews/{review_id}/not-pass", json={
        "outcomeNotes": "Does not meet compliance requirements"
    })
    assert resp.status_code == 200
    assert resp.json()["status"] == "Not Passed"


def test_terminal_requires_accept_status(client: httpx.Client, submitted_request_with_reviews):
    """Cannot approve/not-pass a review that's not in 'Accept' status."""
    review_id = submitted_request_with_reviews["reviewId"]
    # Review is in 'Waiting for Accept'
    resp = client.put(f"/domain-reviews/{review_id}/approve")
    assert resp.status_code == 400

    resp = client.put(f"/domain-reviews/{review_id}/approve-with-exception")
    assert resp.status_code == 400

    resp = client.put(f"/domain-reviews/{review_id}/not-pass")
    assert resp.status_code == 400


def test_accept_is_one_way(client: httpx.Client, submitted_request_with_reviews):
    """After Accept, cannot return to 'Return for Additional Information'."""
    review_id = submitted_request_with_reviews["reviewId"]
    client.put(f"/domain-reviews/{review_id}/accept")

    # Try to return — should fail because status is 'Accept', not 'Waiting for Accept'
    resp = client.put(f"/domain-reviews/{review_id}/return", json={"reason": "Try to return"})
    assert resp.status_code == 400


def test_auto_complete_request(client: httpx.Client, submitted_request_with_reviews):
    """When all reviews reach terminal status, request auto-transitions to Complete."""
    reviews = submitted_request_with_reviews["reviews"]
    rid = submitted_request_with_reviews["request"]["requestId"]

    # Accept, answer reviewer questionnaires, and approve all reviews
    for review in reviews:
        client.put(f"/domain-reviews/{review['id']}/accept")
        _answer_reviewer_questionnaires(client, review["id"])
        client.put(f"/domain-reviews/{review['id']}/approve")

    # Request should now be Complete
    gr_resp = client.get(f"/governance-requests/{rid}")
    assert gr_resp.status_code == 200
    assert gr_resp.json()["status"] == "Complete"


def test_filter_reviews_by_request(client: httpx.Client, submitted_request_with_reviews):
    rid = submitted_request_with_reviews["request"]["requestId"]
    resp = client.get("/domain-reviews", params={"request_id": rid})
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1
