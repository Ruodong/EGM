"""Test governance request CRUD + lifecycle."""
import httpx

# Required fields for all governance request creation calls
_BASE = {
    "govProjectType": "PoC",
    "businessUnit": "IDG",
    "productSoftwareType": "Hardware",
    "productEndUser": ["Lenovo internal employee/contractors"],
    "userRegion": ["PRC"],
}


def test_create_request(client: httpx.Client, cleanup_requests):
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "API Test Request",
        "description": "Created by pytest",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["requestId"].startswith("EGQ")
    assert data["status"] == "Draft"
    assert data["productSoftwareType"] == "Hardware"
    assert data["productEndUser"] == ["Lenovo internal employee/contractors"]
    assert data["userRegion"] == ["PRC"]
    assert data["requestor"] == "dev_admin"


def test_list_requests(client: httpx.Client):
    resp = client.get("/governance-requests")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
    assert data["total"] >= 1


def test_get_request_by_business_id(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["requestId"] == rid


def test_get_request_by_uuid(client: httpx.Client, create_request):
    uuid = create_request["id"]
    resp = client.get(f"/governance-requests/{uuid}")
    assert resp.status_code == 200
    assert resp.json()["id"] == uuid


def test_update_request(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={
        "title": "Updated Title",
        "productSoftwareType": "Software-Web Based",
    })
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated Title"
    assert resp.json()["productSoftwareType"] == "Software-Web Based"


def test_submit_request(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 200
    assert resp.json()["status"] == "Submitted"


def test_submit_non_draft_fails(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    # Submit first
    client.put(f"/governance-requests/{rid}/submit")
    # Try to submit again
    resp = client.put(f"/governance-requests/{rid}/submit")
    assert resp.status_code == 400


def test_verdict_on_draft_fails(client: httpx.Client, create_request):
    """Fix 5: verdict guard — cannot complete a Draft request."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Approved"})
    assert resp.status_code == 400
    assert "In Progress" in resp.json()["detail"]


def test_verdict_invalid_value(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Maybe"})
    assert resp.status_code == 400
    assert "Invalid verdict" in resp.json()["detail"]


def test_delete_draft_request(client: httpx.Client):
    # Create a fresh one to delete
    resp = client.post("/governance-requests", json={**_BASE, "title": "To Delete"})
    rid = resp.json()["requestId"]

    resp = client.delete(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


def test_delete_non_draft_fails(client: httpx.Client, create_request):
    rid = create_request["requestId"]
    client.put(f"/governance-requests/{rid}/submit")  # Make it Submitted
    resp = client.delete(f"/governance-requests/{rid}")
    assert resp.status_code == 400


def test_filter_options(client: httpx.Client):
    resp = client.get("/governance-requests/filter-options")
    assert resp.status_code == 200
    data = resp.json()
    assert "statuses" in data


def test_sequence_generates_unique_ids(client: httpx.Client, cleanup_requests):
    """Fix 6: verify sequence generates unique request IDs."""
    r1 = client.post("/governance-requests", json={**_BASE, "title": "Seq Test 1"})
    assert r1.status_code == 200
    cleanup_requests.append(r1.json()["requestId"])
    r1 = r1.json()
    r2 = client.post("/governance-requests", json={**_BASE, "title": "Seq Test 2"})
    assert r2.status_code == 200
    cleanup_requests.append(r2.json()["requestId"])
    r2 = r2.json()
    assert r1["requestId"] != r2["requestId"]
    # Both should be EGQ format
    assert r1["requestId"].startswith("EGQ")
    assert r2["requestId"].startswith("EGQ")


def test_verdict_approved(client: httpx.Client, dispatched_request):
    """Full lifecycle: complete review then record verdict."""
    review_id = dispatched_request["reviewId"]
    rid = dispatched_request["request"]["requestId"]

    # Assign → Start → Complete the domain review
    client.put(f"/domain-reviews/{review_id}/assign")
    client.put(f"/domain-reviews/{review_id}/start")
    client.put(f"/domain-reviews/{review_id}/complete", json={
        "outcome": "Approved",
        "notes": "All good",
    })

    # Now record verdict on the governance request
    resp = client.put(f"/governance-requests/{rid}/verdict", json={"verdict": "Approved"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "Completed"
    assert data["overallVerdict"] == "Approved"


def test_create_request_with_empty_optional_fields(client: httpx.Client, cleanup_requests):
    """Empty optional fields should be handled gracefully (not cause 500)."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Empty Fields Test",
        "projectId": "",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["requestId"].startswith("EGQ")


def test_pagination(client: httpx.Client):
    """Pagination params work correctly."""
    resp = client.get("/governance-requests", params={"page": 1, "pageSize": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
    assert len(data["data"]) <= 5


def test_create_request_with_project(client: httpx.Client, cleanup_requests):
    """Create request linked to an existing project."""
    # Get first available project
    projects = client.get("/projects", params={"pageSize": 1}).json()
    if projects["total"] == 0:
        return  # No projects synced; skip
    pid = projects["data"][0]["projectId"]
    pname = projects["data"][0]["projectName"]

    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Request with Project",
        "projectId": pid,
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["projectId"] == pid
    assert data["projectName"] == pname


def test_create_request_invalid_project(client: httpx.Client):
    """Creating with non-existent projectId should fail."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Bad Project",
        "projectId": "NONEXISTENT-999",
    })
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"]


def test_filter_by_date_range(client: httpx.Client, cleanup_requests):
    """dateFrom and dateTo query params filter by create_at."""
    # Create a request so we have at least one
    resp = client.post("/governance-requests", json={**_BASE, "title": "Date Range Test"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])

    # Use UTC date (DB stores timestamps in UTC via Docker PostgreSQL)
    from datetime import datetime, timezone
    today = datetime.now(timezone.utc).date().isoformat()

    resp = client.get("/governance-requests", params={"dateFrom": today, "dateTo": today})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1

    # Use a far-future date — should return 0 results
    resp = client.get("/governance-requests", params={"dateFrom": "2099-01-01"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0

    # Use a far-past date range — should return 0 results
    resp = client.get("/governance-requests", params={"dateTo": "2000-01-01"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_search_by_keyword(client: httpx.Client, cleanup_requests):
    """search query param filters by request_id or title."""
    resp = client.post("/governance-requests", json={**_BASE, "title": "UniqueSearchKeyword123"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])

    # Search by title keyword
    resp = client.get("/governance-requests", params={"search": "UniqueSearchKeyword123"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert any("UniqueSearchKeyword123" in r["title"] for r in data["data"])

    # Search by non-existent keyword
    resp = client.get("/governance-requests", params={"search": "ZZZZNONEXISTENT999"})
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


def test_sort_by_title_asc(client: httpx.Client, cleanup_requests):
    """sortField=title&sortOrder=ASC returns alphabetically sorted data."""
    # Create two requests with known titles
    resp = client.post("/governance-requests", json={**_BASE, "title": "AAA Sort First"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    resp = client.post("/governance-requests", json={**_BASE, "title": "ZZZ Sort Last"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])

    resp = client.get("/governance-requests", params={
        "sortField": "title",
        "sortOrder": "ASC",
        "pageSize": 100,
    })
    assert resp.status_code == 200
    data = resp.json()["data"]
    titles = [r["title"] for r in data]
    assert titles == sorted(titles, key=str.lower)


def test_sort_by_create_at_desc(client: httpx.Client):
    """Default sort (create_at DESC) returns newest first."""
    resp = client.get("/governance-requests", params={"pageSize": 10})
    assert resp.status_code == 200
    data = resp.json()["data"]
    if len(data) >= 2:
        dates = [r["createAt"] for r in data]
        assert dates == sorted(dates, reverse=True)


def test_filter_by_status(client: httpx.Client, cleanup_requests):
    """status query param filters results correctly (no ambiguous column with JOIN)."""
    # Create a Draft request
    resp = client.post("/governance-requests", json={**_BASE, "title": "Status Filter Test"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])

    # Filter by Draft — should return at least one result, all with Draft status
    resp = client.get("/governance-requests", params={"status": "Draft", "pageSize": 100})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert all(r["status"] == "Draft" for r in data["data"])

    # Filter by Completed — should return 200 (not 500) even if 0 results
    resp = client.get("/governance-requests", params={"status": "Completed"})
    assert resp.status_code == 200


def test_create_request_product_fields(client: httpx.Client, cleanup_requests):
    """New product/business fields are stored and returned correctly."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "productSoftwareType": "Other",
        "productSoftwareTypeOther": "Custom Device",
        "productEndUser": ["Lenovo internal employee/contractors", "External customer-facing"],
        "userRegion": ["PRC", "EMEA", "NA"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["productSoftwareType"] == "Other"
    assert data["productSoftwareTypeOther"] == "Custom Device"
    assert set(data["productEndUser"]) == {"Lenovo internal employee/contractors", "External customer-facing"}
    assert set(data["userRegion"]) == {"PRC", "EMEA", "NA"}


# ── Compliance Rule association tests ─────────────────────────


def test_create_request_with_rule_codes(client: httpx.Client, cleanup_requests):
    """Create request with rule associations."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Request with Rules",
        "description": "Testing ruleCodes",
        "ruleCodes": ["AI", "PII"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    # AI and PII are both level-1 seed rules — no auto-aggregation
    assert sorted(data["ruleCodes"]) == ["AI", "PII"]
    assert data["autoRuleCodes"] == []


def test_create_request_without_rule_codes(client: httpx.Client, cleanup_requests):
    """Create request without ruleCodes still works (backward compat)."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Request No Rules",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["ruleCodes"] == []


def test_get_request_returns_rule_codes(client: httpx.Client, cleanup_requests):
    """GET single request returns associated ruleCodes."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Get Rules Test",
        "ruleCodes": ["INTERNAL", "AI"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    rid = resp.json()["requestId"]

    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    # INTERNAL and AI are both level-1, not mutually exclusive — no auto-aggregation
    assert sorted(resp.json()["ruleCodes"]) == ["AI", "INTERNAL"]
    assert resp.json()["autoRuleCodes"] == []


def test_get_request_no_rules_returns_empty_array(client: httpx.Client, cleanup_requests):
    """GET request with no rules returns empty ruleCodes array."""
    resp = client.post("/governance-requests", json={**_BASE, "title": "No Rules Get"})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    rid = resp.json()["requestId"]

    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    assert resp.json()["ruleCodes"] == []


def test_update_request_rule_codes(client: httpx.Client, cleanup_requests):
    """PUT request can update ruleCodes."""
    # Create with initial rules
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Update Rules Test",
        "ruleCodes": ["AI"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    rid = resp.json()["requestId"]

    # Update to different rules
    resp = client.put(f"/governance-requests/{rid}", json={
        "ruleCodes": ["PII", "INTERNAL"],
    })
    assert resp.status_code == 200
    # PII and INTERNAL are both level-1 — no auto-aggregation
    assert sorted(resp.json()["ruleCodes"]) == ["INTERNAL", "PII"]
    assert resp.json()["autoRuleCodes"] == []

    # Verify via GET
    resp = client.get(f"/governance-requests/{rid}")
    assert sorted(resp.json()["ruleCodes"]) == ["INTERNAL", "PII"]


def test_update_request_clear_rule_codes(client: httpx.Client, cleanup_requests):
    """PUT with empty ruleCodes clears all associations."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Clear Rules Test",
        "ruleCodes": ["AI", "PII"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    rid = resp.json()["requestId"]

    resp = client.put(f"/governance-requests/{rid}", json={
        "ruleCodes": [],
    })
    assert resp.status_code == 200
    assert resp.json()["ruleCodes"] == []


def test_create_request_ignores_invalid_rule_codes(client: httpx.Client, cleanup_requests):
    """Invalid or inactive rule codes are silently ignored."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Invalid Rules Test",
        "ruleCodes": ["AI", "NONEXISTENT_RULE"],
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    # AI is valid, no parent to auto-aggregate
    assert resp.json()["ruleCodes"] == ["AI"]


# ── MSPO / Non-MSPO project type tests ──────────────────────


def test_create_mspo_project(client: httpx.Client, cleanup_requests):
    """Create request with projectType=mspo snapshots project data."""
    projects = client.get("/projects", params={"pageSize": 1}).json()
    if projects["total"] == 0:
        return
    proj = projects["data"][0]
    pid = proj["projectId"]

    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "MSPO Test",
        "projectType": "mspo",
        "projectId": pid,
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["projectType"] == "mspo"
    assert data["projectId"] == pid
    assert data["projectCode"] == pid
    assert data["projectName"] == proj["projectName"]
    assert data["projectPm"] == proj["pm"]
    assert data["projectProjType"] == proj["type"]
    assert data["projectStatus"] == proj["status"]


def test_create_non_mspo_project(client: httpx.Client, cleanup_requests):
    """Create request with projectType=non_mspo stores manual fields."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Non-MSPO Test",
        "projectType": "non_mspo",
        "projectCode": "NMP-001",
        "projectName": "Manual Project",
        "projectDescription": "A manual project",
        "projectPm": "John Doe",
        "projectStartDate": "2026-01-01",
        "projectGoLiveDate": "2026-06-01",
        "projectEndDate": "2026-12-31",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["projectType"] == "non_mspo"
    assert data["projectId"] is None
    assert data["projectCode"] == "NMP-001"
    assert data["projectName"] == "Manual Project"
    assert data["projectDescription"] == "A manual project"
    assert data["projectPm"] == "John Doe"
    assert data["projectStartDate"] == "2026-01-01"
    assert data["projectGoLiveDate"] == "2026-06-01"
    assert data["projectEndDate"] == "2026-12-31"


def test_create_mspo_without_project_id_fails(client: httpx.Client):
    """MSPO without projectId should fail."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "MSPO No PID",
        "projectType": "mspo",
    })
    assert resp.status_code == 400
    assert "projectId" in resp.json()["detail"]


def test_get_request_returns_project_fields(client: httpx.Client, cleanup_requests):
    """GET single request returns all project snapshot fields."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "title": "Project Fields Get Test",
        "projectType": "non_mspo",
        "projectCode": "PFG-001",
        "projectName": "Fields Test Project",
        "projectPm": "Test PM",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    rid = resp.json()["requestId"]

    resp = client.get(f"/governance-requests/{rid}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["projectType"] == "non_mspo"
    assert data["projectCode"] == "PFG-001"
    assert data["projectName"] == "Fields Test Project"


# ── EGQ ID + govProjectType tests ─────────────────────────────


def test_request_id_format(client: httpx.Client, cleanup_requests):
    """Request ID should be auto-generated in EGQyymmdd#### format."""
    resp = client.post("/governance-requests", json={**_BASE})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["requestId"] is not None
    # Format: EGQ + 6 digits (yymmdd) + 4 digits (seq)
    import re
    assert re.match(r"^EGQ\d{10}$", data["requestId"]), f"Request ID format invalid: {data['requestId']}"
    # egqId key should no longer exist
    assert "egqId" not in data


def test_request_id_daily_sequence(client: httpx.Client, cleanup_requests):
    """Two consecutive requests should have sequential request IDs."""
    resp1 = client.post("/governance-requests", json={**_BASE})
    assert resp1.status_code == 200
    cleanup_requests.append(resp1.json()["requestId"])
    r1 = resp1.json()
    resp2 = client.post("/governance-requests", json={**_BASE})
    assert resp2.status_code == 200
    cleanup_requests.append(resp2.json()["requestId"])
    r2 = resp2.json()
    # Same date prefix, sequential suffix
    assert r1["requestId"][:9] == r2["requestId"][:9]  # EGQyymmdd
    seq1 = int(r1["requestId"][9:])
    seq2 = int(r2["requestId"][9:])
    assert seq2 == seq1 + 1


def test_create_without_title(client: httpx.Client, cleanup_requests):
    """Title is no longer required — auto-set to request ID."""
    resp = client.post("/governance-requests", json={**_BASE})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    # title should be auto-set to the request ID
    assert data["title"] == data["requestId"]


def test_gov_project_type(client: httpx.Client, cleanup_requests):
    """govProjectType is saved and returned."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "govProjectType": "poc",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["govProjectType"] == "poc"

    # Verify via GET
    rid = data["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.json()["govProjectType"] == "poc"


def test_update_gov_project_type(client: httpx.Client, create_request):
    """govProjectType can be updated via PUT."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={
        "govProjectType": "new_solution",
    })
    assert resp.status_code == 200
    assert resp.json()["govProjectType"] == "new_solution"


def test_search_by_request_id(client: httpx.Client, cleanup_requests):
    """Search param should match request_id (EGQ format)."""
    resp = client.post("/governance-requests", json={**_BASE})
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    request_id = resp.json()["requestId"]

    resp = client.get("/governance-requests", params={"search": request_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 1
    assert any(r["requestId"] == request_id for r in data["data"])


# ── Business Unit tests ──────────────────────────────────────


def test_create_request_with_business_unit(client: httpx.Client, cleanup_requests):
    """businessUnit is saved and returned on create."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "businessUnit": "IDG",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["businessUnit"] == "IDG"

    # Verify via GET
    rid = data["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.json()["businessUnit"] == "IDG"


def test_update_request_business_unit(client: httpx.Client, create_request):
    """businessUnit can be updated via PUT."""
    rid = create_request["requestId"]
    resp = client.put(f"/governance-requests/{rid}", json={
        "businessUnit": "Moto",
    })
    assert resp.status_code == 200
    assert resp.json()["businessUnit"] == "Moto"


def test_submit_request_without_business_unit(client: httpx.Client, cleanup_requests):
    """businessUnit is required on submit — missing returns 400."""
    # Create draft without businessUnit (allowed)
    resp = client.post("/governance-requests", json={"govProjectType": "PoC"})
    assert resp.status_code == 200
    rid = resp.json()["requestId"]
    cleanup_requests.append(rid)
    # Submit should fail
    resp = client.put(f"/governance-requests/{rid}/submit", json={})
    assert resp.status_code == 400
    assert "businessUnit" in resp.json()["detail"]


# ── Attachment tests ─────────────────────────────────────────


def test_upload_attachment(client: httpx.Client, create_request):
    """Upload a file attachment to a governance request."""
    rid = create_request["requestId"]
    file_content = b"Hello, this is a test file."
    files = {"file": ("test.txt", file_content, "text/plain")}
    resp = client.post(f"/governance-requests/{rid}/attachments", files=files)
    assert resp.status_code == 200
    data = resp.json()
    assert data["fileName"] == "test.txt"
    assert data["fileSize"] == len(file_content)
    assert data["contentType"] == "text/plain"
    assert "id" in data


def test_list_attachments(client: httpx.Client, create_request):
    """List attachments returns uploaded files."""
    rid = create_request["requestId"]
    # Upload two files
    client.post(f"/governance-requests/{rid}/attachments",
                files={"file": ("a.txt", b"aaa", "text/plain")})
    client.post(f"/governance-requests/{rid}/attachments",
                files={"file": ("b.txt", b"bbb", "text/plain")})

    resp = client.get(f"/governance-requests/{rid}/attachments")
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data) >= 2
    names = [a["fileName"] for a in data]
    assert "a.txt" in names
    assert "b.txt" in names


def test_download_attachment(client: httpx.Client, create_request):
    """Download attachment returns binary content with correct headers."""
    rid = create_request["requestId"]
    content = b"download me"
    up = client.post(f"/governance-requests/{rid}/attachments",
                     files={"file": ("dl.txt", content, "text/plain")})
    att_id = up.json()["id"]

    resp = client.get(f"/governance-requests/{rid}/attachments/{att_id}")
    assert resp.status_code == 200
    assert resp.content == content
    assert "attachment" in resp.headers.get("content-disposition", "")


def test_delete_attachment(client: httpx.Client, create_request):
    """Delete attachment removes it."""
    rid = create_request["requestId"]
    up = client.post(f"/governance-requests/{rid}/attachments",
                     files={"file": ("del.txt", b"delete me", "text/plain")})
    att_id = up.json()["id"]

    resp = client.delete(f"/governance-requests/{rid}/attachments/{att_id}")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True

    # Verify it's gone
    resp = client.get(f"/governance-requests/{rid}/attachments/{att_id}")
    assert resp.status_code == 404


def test_upload_attachment_invalid_request(client: httpx.Client):
    """Upload to non-existent request returns 404."""
    resp = client.post("/governance-requests/NONEXISTENT/attachments",
                       files={"file": ("x.txt", b"x", "text/plain")})
    assert resp.status_code == 404


# ── Non-MSPO PM itcode tests ────────────────────────────────


def test_create_nonmspo_with_pm_itcode(client: httpx.Client, cleanup_requests):
    """Non-MSPO with projectPmItcode saves it."""
    # Get a real employee itcode
    emp_resp = client.get("/employees/search", params={"q": "a"})
    assert emp_resp.status_code == 200
    employees = emp_resp.json()["data"]
    assert len(employees) >= 1
    itcode = employees[0]["itcode"]
    name = employees[0]["name"]

    resp = client.post("/governance-requests", json={
        **_BASE,
        "projectType": "non_mspo",
        "projectCode": "PM-IT-001",
        "projectName": "PM itcode Test",
        "projectPm": name,
        "projectPmItcode": itcode,
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["projectPmItcode"] == itcode
    assert data["projectPm"] == name

    # Verify via GET
    rid = data["requestId"]
    resp = client.get(f"/governance-requests/{rid}")
    assert resp.json()["projectPmItcode"] == itcode


def test_create_nonmspo_without_pm_itcode(client: httpx.Client, cleanup_requests):
    """Non-MSPO without projectPmItcode still works (itcode optional, pm required)."""
    resp = client.post("/governance-requests", json={
        **_BASE,
        "projectType": "non_mspo",
        "projectCode": "PM-NOIT-001",
        "projectName": "No PM itcode",
        "projectPm": "Manual PM Name",
    })
    assert resp.status_code == 200
    cleanup_requests.append(resp.json()["requestId"])
    data = resp.json()
    assert data["projectPmItcode"] is None
    assert data["projectPm"] == "Manual PM Name"


def test_submit_missing_required_fields(client: httpx.Client, cleanup_requests):
    """Missing required fields blocks submit — returns 400."""
    # Create draft with no required fields (allowed for draft)
    resp = client.post("/governance-requests", json={})
    assert resp.status_code == 200
    rid = resp.json()["requestId"]
    cleanup_requests.append(rid)
    # Submit should fail with all missing fields
    resp = client.put(f"/governance-requests/{rid}/submit", json={})
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "govProjectType" in detail
    assert "businessUnit" in detail
    assert "productSoftwareType" in detail
    assert "productEndUser" in detail
    assert "userRegion" in detail


def test_submit_nonmspo_missing_project_fields(client: httpx.Client, cleanup_requests):
    """Non-MSPO missing projectCode/projectName/projectPm blocks submit."""
    # Create draft with non_mspo but no project fields (allowed for draft)
    resp = client.post("/governance-requests", json={
        **_BASE,
        "projectType": "non_mspo",
    })
    assert resp.status_code == 200
    rid = resp.json()["requestId"]
    cleanup_requests.append(rid)
    # Submit should fail with missing project fields
    resp = client.put(f"/governance-requests/{rid}/submit", json={})
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "projectCode" in detail
    assert "projectName" in detail
    assert "projectPm" in detail
