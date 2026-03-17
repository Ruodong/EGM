"""
State Machine Regression Test Suite
====================================

Covers ALL status transitions for Governance Requests and Domain Reviews.
Uses existing master data (domains, rules, users) — does NOT create/modify any.

Usage:
    # Run and KEEP test data (default):
    python3 -m pytest api-tests/test_state_regression.py -v --tb=short

    # Run and CLEANUP test data:
    python3 -m pytest api-tests/test_state_regression.py -v --tb=short --cleanup

Master data used:
    - Rule: INTERNAL (triggers all 8 domains)
    - Requestor: cuixy7
    - Admin: yangrd
    - Governance Lead: cswafford
    - Domain Reviewers: zhangqiong2 (DP), alopez9 (DD), luoyl2 (EA), amcmillian (RAI)
    - For domains without assigned reviewer (BIA, IP, OSC, TC): use governance_lead
"""

import os
import pytest
import requests

BASE = "http://localhost:4001/api"

# ── Master data constants ──
REQUESTOR = "cuixy7"
ADMIN = "yangrd"
GOV_LEAD = "cswafford"

# Use multiple rules to trigger all available domains:
# INTERNAL → BIA, EA; EXTERNAL → DD; AI → RAI; PII → DP; OPEN_SOURCE → OSC
RULE_CODES = ["INTERNAL", "EXTERNAL", "AI", "PII", "OPEN_SOURCE"]
EXPECTED_DOMAINS = sorted(["BIA", "EA", "DD", "RAI", "DP", "OSC"])  # 6 domains

# Domain → who can accept/return (governance_lead allowed)
DOMAIN_ACCEPTER = {
    "DP": "zhangqiong2",
    "DD": "alopez9",
    "EA": "luoyl2",
    "RAI": "amcmillian",
    # Domains without assigned reviewer → governance_lead can accept/return
    "BIA": GOV_LEAD,
    "OSC": GOV_LEAD,
}

# Domain → who can approve/not-pass/exception (governance_lead NOT allowed, need admin or assigned reviewer)
DOMAIN_DECIDER = {
    "DP": "zhangqiong2",
    "DD": "alopez9",
    "EA": "luoyl2",
    "RAI": "amcmillian",
    # No assigned reviewer → admin must make terminal decisions
    "BIA": ADMIN,
    "OSC": ADMIN,
}

# Combined lookup for backward compat
DOMAIN_REVIEWER = DOMAIN_ACCEPTER

# ── Track created requests for cleanup ──
_created_request_ids: list[str] = []

# ── Cleanup controlled via --cleanup flag or env var ──
CLEANUP = os.environ.get("STATE_REGRESSION_CLEANUP", "0") == "1"


def pytest_addoption(parser):
    parser.addoption("--cleanup", action="store_true", default=False,
                     help="Delete test data after regression run")


def pytest_configure(config):
    global CLEANUP
    if config.getoption("--cleanup", default=False):
        CLEANUP = True


@pytest.fixture(scope="session", autouse=True)
def cleanup_after_all():
    """Session-scoped fixture: optionally delete all created requests after tests."""
    yield
    if CLEANUP:
        print(f"\n  Cleaning up {len(_created_request_ids)} test requests...")
        for rid in _created_request_ids:
            requests.delete(f"{BASE}/governance-requests/{rid}",
                            headers=_h(ADMIN))
        print(f"  Cleanup complete.")
    else:
        print(f"\n  Keeping {len(_created_request_ids)} test requests: {_created_request_ids}")


# ═══════════════════════════════════════════════════════
# Helper functions
# ═══════════════════════════════════════════════════════

def _h(user: str) -> dict:
    """Build auth header. Uses X-Dev-User to impersonate a real user."""
    return {"X-Dev-User": user, "Content-Type": "application/json"}


def create_draft() -> dict:
    """Create a Draft request with INTERNAL rule, fill required fields + questionnaires."""
    # 1. Create
    resp = requests.post(f"{BASE}/governance-requests", headers=_h(REQUESTOR), json={
        "govProjectType": "PoC",
        "businessUnit": "IDG",
        "ruleCodes": RULE_CODES,
        "productSoftwareType": "Web Application",
        "productEndUser": ["Lenovo internal employee/contractors"],
        "userRegion": ["PRC"],
        "projectType": "non_mspo",
        "projectCode": "REGTEST",
        "projectName": "State Regression Test",
        "projectPm": "Test PM",
        "projectStartDate": "2026-01-01",
        "projectGoLiveDate": "2026-06-01",
    })
    assert resp.status_code == 200, f"Create failed: {resp.text}"
    data = resp.json()
    rid = data["requestId"]
    _created_request_ids.append(rid)

    # 2. Fill required questionnaires
    tmpl_resp = requests.get(f"{BASE}/request-questionnaire/templates/{rid}", headers=_h(REQUESTOR))
    assert tmpl_resp.status_code == 200
    templates = tmpl_resp.json().get("data", [])
    answers = []
    for domain_group in templates:
        for q in domain_group.get("questions", []):
            if not q.get("isRequired"):
                continue
            at = q["answerType"]
            opts = q.get("options") or []
            if at in ("radio", "dropdown") and opts:
                ans = {"value": opts[0]}
            elif at == "multiselect" and opts:
                ans = {"value": [opts[0]]}
            else:
                ans = {"value": "Regression test answer"}
            answers.append({"templateId": q["id"], "domainCode": domain_group["domainCode"], "answer": ans})

    if answers:
        save_resp = requests.post(f"{BASE}/request-questionnaire/{rid}",
                                  headers=_h(REQUESTOR), json={"responses": answers})
        assert save_resp.status_code == 200, f"Save questionnaire failed: {save_resp.text}"

    return data


def submit_request(rid: str) -> dict:
    """Submit a Draft request."""
    resp = requests.put(f"{BASE}/governance-requests/{rid}/submit", headers=_h(REQUESTOR))
    assert resp.status_code == 200, f"Submit failed: {resp.text}"
    return resp.json()


def get_request(rid: str) -> dict:
    """Get request details."""
    resp = requests.get(f"{BASE}/governance-requests/{rid}", headers=_h(ADMIN))
    assert resp.status_code == 200
    return resp.json()


def get_reviews(rid: str) -> list[dict]:
    """Get all domain reviews for a request, returns list sorted by domainCode."""
    resp = requests.get(f"{BASE}/domain-reviews", headers=_h(ADMIN),
                        params={"request_id": rid, "pageSize": 50})
    assert resp.status_code == 200
    reviews = resp.json().get("data", [])
    return sorted(reviews, key=lambda r: r["domainCode"])


def get_review_by_domain(rid: str, domain_code: str) -> dict:
    """Get a specific domain review by request ID and domain code."""
    reviews = get_reviews(rid)
    for r in reviews:
        if r["domainCode"] == domain_code:
            return r
    raise ValueError(f"No review found for domain {domain_code} in request {rid}")


def review_action(review_id: str, action: str, user: str, body: dict | None = None) -> requests.Response:
    """Execute a domain review action."""
    resp = requests.put(f"{BASE}/domain-reviews/{review_id}/{action}",
                        headers=_h(user), json=body or {})
    return resp


def answer_reviewer_qs(review_id: str):
    """Answer all required reviewer questionnaire templates for a domain review."""
    resp = requests.get(f"{BASE}/domain-questionnaire/templates/{review_id}", headers=_h(ADMIN))
    if resp.status_code != 200:
        return
    templates = resp.json().get("data", [])
    responses = []
    for tmpl in templates:
        if tmpl.get("isRequired"):
            at = tmpl["answerType"]
            opts = tmpl.get("options")
            if at in ("radio", "dropdown") and opts:
                answer = {"value": opts[0]}
            elif at == "multiselect" and opts:
                answer = {"value": [opts[0]]}
            else:
                answer = {"value": "Test answer"}
            responses.append({"templateId": tmpl["id"], "answer": answer})
    if responses:
        requests.post(f"{BASE}/domain-questionnaire/{review_id}",
                       headers=_h(ADMIN), json={"responses": responses})


def accept_all(rid: str):
    """Accept all domain reviews for a request."""
    for r in get_reviews(rid):
        if r["status"] != "Waiting for Accept":
            continue
        reviewer = DOMAIN_REVIEWER[r["domainCode"]]
        resp = review_action(r["id"], "accept", reviewer)
        assert resp.status_code == 200, f"Accept {r['domainCode']} failed: {resp.text}"


def answer_all_reviewer_qs(rid: str):
    """Answer reviewer questionnaires for ALL reviews in a request."""
    for r in get_reviews(rid):
        if r["status"] == "Accept":
            answer_reviewer_qs(r["id"])


def get_activity_log(rid: str) -> list[dict]:
    """Get the activity log for a request."""
    resp = requests.get(f"{BASE}/governance-requests/{rid}/activity-log", headers=_h(ADMIN))
    assert resp.status_code == 200
    return resp.json().get("data", [])


def create_and_submit() -> str:
    """Create + fill questionnaires + submit. Returns requestId."""
    data = create_draft()
    rid = data["requestId"]
    submit_request(rid)
    return rid


# ═══════════════════════════════════════════════════════
# S1: Happy Path — All Approved
# ═══════════════════════════════════════════════════════

class TestS1HappyPath:
    """Draft -> Submitted -> In Progress -> Complete (all Approved)"""

    def test_s1_full_lifecycle(self):
        # Create + Submit
        rid = create_and_submit()
        req = get_request(rid)
        assert req["status"] == "Submitted"

        reviews = get_reviews(rid)
        assert len(reviews) == len(EXPECTED_DOMAINS), f"Expected {len(EXPECTED_DOMAINS)} reviews, got {len(reviews)}: {[r['domainCode'] for r in reviews]}"
        assert all(r["status"] == "Waiting for Accept" for r in reviews)

        # Accept first domain -> Request becomes In Progress
        first_review = reviews[0]
        reviewer = DOMAIN_REVIEWER[first_review["domainCode"]]
        resp = review_action(first_review["id"], "accept", reviewer)
        assert resp.status_code == 200
        req = get_request(rid)
        assert req["status"] == "In Progress"

        # Accept remaining domains
        for r in reviews[1:]:
            reviewer = DOMAIN_REVIEWER[r["domainCode"]]
            resp = review_action(r["id"], "accept", reviewer)
            assert resp.status_code == 200

        # Answer reviewer questionnaires and approve all -> Request becomes Complete
        answer_all_reviewer_qs(rid)
        reviews = get_reviews(rid)
        for r in reviews:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Verify all reviews are Approved
        reviews = get_reviews(rid)
        assert all(r["status"] == "Approved" for r in reviews)

        # Verify activity log has entries
        log = get_activity_log(rid)
        actions = [e["action"] for e in log]
        assert "Draft Creation" in actions
        assert "Submit" in actions
        assert "Request In Progress" in actions
        assert "Request Complete" in actions


# ═══════════════════════════════════════════════════════
# S2: Approve with Exception (+ outcomeNotes in log)
# ═══════════════════════════════════════════════════════

class TestS2ApproveWithException:
    """Some domains Approved, some Approved with Exception. Verify outcomeNotes in activity log."""

    def test_s2_exception_flow(self):
        rid = create_and_submit()
        accept_all(rid)
        answer_all_reviewer_qs(rid)

        reviews = get_reviews(rid)
        half = len(reviews) // 2
        # First half: Approve normally
        for r in reviews[:half]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        # Second half: Approve with Exception
        for r in reviews[half:]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            notes = f"Exception note for {r['domainCode']}"
            resp = review_action(r["id"], "approve-with-exception", decider,
                                 {"outcomeNotes": notes})
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Verify activity log shows outcomeNotes for exception reviews
        log = get_activity_log(rid)
        exception_entries = [e for e in log if "Approve with Exception" in e["action"]]
        expected_exception_count = len(reviews) - len(reviews) // 2
        assert len(exception_entries) == expected_exception_count
        for entry in exception_entries:
            domain = entry["domainCode"]
            assert entry["details"] == f"Exception note for {domain}"


# ═══════════════════════════════════════════════════════
# S3: Not Passed
# ═══════════════════════════════════════════════════════

class TestS3NotPassed:
    """One domain Not Passed, rest Approved. Still auto-completes."""

    def test_s3_not_pass(self):
        rid = create_and_submit()
        accept_all(rid)
        answer_all_reviewer_qs(rid)

        reviews = get_reviews(rid)
        # Not Pass first domain
        first = reviews[0]
        decider = DOMAIN_DECIDER[first["domainCode"]]
        resp = review_action(first["id"], "not-pass", decider,
                             {"outcomeNotes": f"Failed: {first['domainCode']}"})
        assert resp.status_code == 200

        # Approve the rest
        for r in reviews[1:]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Verify the Not Passed review
        review = get_review_by_domain(rid, first["domainCode"])
        assert review["status"] == "Not Passed"

        # Verify activity log
        log = get_activity_log(rid)
        np_entries = [e for e in log if "Not Pass" in e["action"]]
        assert len(np_entries) == 1
        assert np_entries[0]["details"] == f"Failed: {first['domainCode']}"


# ═══════════════════════════════════════════════════════
# S4: Return -> Resubmit -> Accept -> Approve
# ═══════════════════════════════════════════════════════

class TestS4ReturnResubmit:
    """Return one domain, resubmit, then accept and approve all."""

    def test_s4_return_resubmit(self):
        rid = create_and_submit()

        # Return DD domain
        dd_review = get_review_by_domain(rid, "DD")
        resp = review_action(dd_review["id"], "return", "alopez9",
                             {"reason": "Need more details about data flow"})
        assert resp.status_code == 200

        # Verify DD is now "Return for Additional Information"
        dd_review = get_review_by_domain(rid, "DD")
        assert dd_review["status"] == "Return for Additional Information"

        # Request status should NOT change (stays Submitted)
        req = get_request(rid)
        assert req["status"] == "Submitted"

        # Resubmit DD (as requestor)
        resp = review_action(dd_review["id"], "resubmit", REQUESTOR)
        assert resp.status_code == 200

        # DD should be back to "Waiting for Accept"
        dd_review = get_review_by_domain(rid, "DD")
        assert dd_review["status"] == "Waiting for Accept"

        # Now accept all, answer reviewer qs, and approve all
        accept_all(rid)
        answer_all_reviewer_qs(rid)
        reviews = get_reviews(rid)
        for r in reviews:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Verify activity log has return and resubmit entries
        log = get_activity_log(rid)
        actions = [e["action"] for e in log]
        assert any("Return by DD" in a for a in actions)
        assert any("Resubmit for DD" in a for a in actions)

        # Verify return reason in log details
        return_entry = [e for e in log if "Return by DD" in e["action"]][0]
        assert return_entry["details"] == "Need more details about data flow"


# ═══════════════════════════════════════════════════════
# S5: Multiple Return -> Resubmit cycles
# ═══════════════════════════════════════════════════════

class TestS5MultipleReturns:
    """Return -> Resubmit -> Return again -> Resubmit -> Accept -> Approve."""

    def test_s5_double_return(self):
        rid = create_and_submit()

        # First return
        dp_review = get_review_by_domain(rid, "DP")
        resp = review_action(dp_review["id"], "return", "zhangqiong2",
                             {"reason": "First return reason"})
        assert resp.status_code == 200

        # First resubmit
        dp_review = get_review_by_domain(rid, "DP")
        resp = review_action(dp_review["id"], "resubmit", REQUESTOR)
        assert resp.status_code == 200
        dp_review = get_review_by_domain(rid, "DP")
        assert dp_review["status"] == "Waiting for Accept"

        # Second return
        resp = review_action(dp_review["id"], "return", "zhangqiong2",
                             {"reason": "Second return reason"})
        assert resp.status_code == 200
        dp_review = get_review_by_domain(rid, "DP")
        assert dp_review["status"] == "Return for Additional Information"

        # Second resubmit
        resp = review_action(dp_review["id"], "resubmit", REQUESTOR)
        assert resp.status_code == 200

        # Accept all and approve all
        accept_all(rid)
        answer_all_reviewer_qs(rid)
        reviews = get_reviews(rid)
        for r in reviews:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"


# ═══════════════════════════════════════════════════════
# S6: Mixed terminal statuses (Approved + Exception + Not Passed)
# ═══════════════════════════════════════════════════════

class TestS6MixedTerminal:
    """All 3 terminal types in one request."""

    def test_s6_mixed(self):
        rid = create_and_submit()
        accept_all(rid)
        answer_all_reviewer_qs(rid)

        reviews = get_reviews(rid)
        n = len(reviews)
        third = n // 3
        # Split into 3 groups: Approved, Exception, Not Passed
        for r in reviews[:third]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        for r in reviews[third:2*third]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve-with-exception", decider,
                                 {"outcomeNotes": f"Mixed exception {r['domainCode']}"})
            assert resp.status_code == 200

        for r in reviews[2*third:]:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "not-pass", decider,
                                 {"outcomeNotes": f"Mixed not pass {r['domainCode']}"})
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Verify each terminal status is present
        reviews = get_reviews(rid)
        statuses = {r["status"] for r in reviews}
        assert "Approved" in statuses
        assert "Approved with Exception" in statuses
        assert "Not Passed" in statuses


# ═══════════════════════════════════════════════════════
# S7: Cancel Draft
# ═══════════════════════════════════════════════════════

class TestS7CancelDraft:
    """Create Draft -> Cancel."""

    def test_s7_cancel(self):
        data = create_draft()
        rid = data["requestId"]

        resp = requests.put(f"{BASE}/governance-requests/{rid}/cancel", headers=_h(REQUESTOR))
        assert resp.status_code == 200

        req = get_request(rid)
        assert req["lifecycleStatus"] == "Cancelled"
        assert req["status"] == "Draft"  # workflow status unchanged


# ═══════════════════════════════════════════════════════
# S8: Archive Complete request
# ═══════════════════════════════════════════════════════

class TestS8ArchiveComplete:
    """Full lifecycle -> Archive."""

    def test_s8_archive(self):
        rid = create_and_submit()
        accept_all(rid)
        answer_all_reviewer_qs(rid)

        # Approve all to reach Complete
        reviews = get_reviews(rid)
        for r in reviews:
            decider = DOMAIN_DECIDER[r["domainCode"]]
            resp = review_action(r["id"], "approve", decider)
            assert resp.status_code == 200

        req = get_request(rid)
        assert req["status"] == "Complete"

        # Archive
        resp = requests.put(f"{BASE}/governance-requests/{rid}/archive", headers=_h(GOV_LEAD))
        assert resp.status_code == 200

        req = get_request(rid)
        assert req["lifecycleStatus"] == "Archived"


# ═══════════════════════════════════════════════════════
# S9: Invalid transitions (negative tests)
# ═══════════════════════════════════════════════════════

class TestS9InvalidTransitions:
    """All invalid state transitions should return 400."""

    def test_s9a_cannot_return_after_accept(self):
        """Accept is one-way -- cannot return after accepting."""
        rid = create_and_submit()
        review = get_reviews(rid)[0]
        reviewer = DOMAIN_REVIEWER[review["domainCode"]]

        # Accept
        resp = review_action(review["id"], "accept", reviewer)
        assert resp.status_code == 200

        # Try to return -> should fail
        resp = review_action(review["id"], "return", reviewer,
                             {"reason": "Too late"})
        assert resp.status_code == 400

    def test_s9b_cannot_approve_without_accept(self):
        """Cannot approve a review that hasn't been accepted."""
        rid = create_and_submit()
        # Use DD domain (assigned reviewer can attempt approve)
        review = get_review_by_domain(rid, "DD")
        decider = DOMAIN_DECIDER["DD"]

        # Try to approve directly -> should fail
        resp = review_action(review["id"], "approve", decider)
        assert resp.status_code == 400

    def test_s9c_cannot_accept_twice(self):
        """Cannot accept an already accepted review."""
        rid = create_and_submit()
        review = get_reviews(rid)[0]
        reviewer = DOMAIN_REVIEWER[review["domainCode"]]

        resp = review_action(review["id"], "accept", reviewer)
        assert resp.status_code == 200

        # Try to accept again -> should fail
        resp = review_action(review["id"], "accept", reviewer)
        assert resp.status_code == 400

    def test_s9d_cannot_resubmit_non_returned(self):
        """Cannot resubmit a review that isn't in 'Return for Additional Information'."""
        rid = create_and_submit()
        review = get_reviews(rid)[0]

        # Review is "Waiting for Accept" -- resubmit should fail
        resp = review_action(review["id"], "resubmit", REQUESTOR)
        assert resp.status_code == 400

    def test_s9e_cannot_operate_on_terminal(self):
        """Cannot perform any action on a terminal (Approved) review."""
        rid = create_and_submit()
        # Use DD domain (has assigned reviewer alopez9 who can both accept and approve)
        review = get_review_by_domain(rid, "DD")
        accepter = DOMAIN_ACCEPTER["DD"]
        decider = DOMAIN_DECIDER["DD"]

        # Accept, answer reviewer qs, then approve
        review_action(review["id"], "accept", accepter)
        answer_reviewer_qs(review["id"])
        review_action(review["id"], "approve", decider)

        # All further actions should fail
        assert review_action(review["id"], "accept", accepter).status_code == 400
        assert review_action(review["id"], "return", accepter,
                             {"reason": "x"}).status_code == 400
        assert review_action(review["id"], "approve", decider).status_code == 400
        assert review_action(review["id"], "not-pass", decider,
                             {"outcomeNotes": "x"}).status_code == 400

    def test_s9f_cannot_cancel_non_draft(self):
        """Cannot cancel a Submitted request."""
        rid = create_and_submit()
        resp = requests.put(f"{BASE}/governance-requests/{rid}/cancel", headers=_h(REQUESTOR))
        assert resp.status_code == 400

    def test_s9g_cannot_archive_non_complete(self):
        """Cannot archive a request that isn't Complete."""
        rid = create_and_submit()
        resp = requests.put(f"{BASE}/governance-requests/{rid}/archive", headers=_h(GOV_LEAD))
        assert resp.status_code == 400

    def test_s9h_cannot_submit_twice(self):
        """Cannot submit an already Submitted request."""
        rid = create_and_submit()
        resp = requests.put(f"{BASE}/governance-requests/{rid}/submit", headers=_h(REQUESTOR))
        assert resp.status_code == 400

    def test_s9i_return_requires_reason(self):
        """Return without reason should fail."""
        rid = create_and_submit()
        review = get_reviews(rid)[0]
        reviewer = DOMAIN_REVIEWER[review["domainCode"]]

        resp = review_action(review["id"], "return", reviewer, {})
        assert resp.status_code == 400
