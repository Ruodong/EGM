"""Test employee search endpoint."""
import httpx


def test_search_employees_by_itcode(client: httpx.Client):
    """Search employees by itcode returns results."""
    # First find any employee to get a real itcode
    resp = client.get("/employees/search", params={"q": "a"})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["data"]) >= 1
    itcode = data["data"][0]["itcode"]
    # Now search by that exact itcode
    resp2 = client.get("/employees/search", params={"q": itcode})
    assert resp2.status_code == 200
    assert any(r["itcode"] == itcode for r in resp2.json()["data"])


def test_search_employees_by_name(client: httpx.Client):
    """Search employees by name returns results."""
    # Search with a common letter to get results
    resp = client.get("/employees/search", params={"q": "a"})
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert len(data["data"]) >= 1
    # Each result should have itcode, name
    for emp in data["data"]:
        assert "itcode" in emp
        assert "name" in emp


def test_search_employees_min_length(client: httpx.Client):
    """Empty query should fail (min_length=1)."""
    resp = client.get("/employees/search", params={"q": ""})
    assert resp.status_code == 422  # FastAPI validation error


def test_search_employees_no_match(client: httpx.Client):
    """Non-existent query returns empty results."""
    resp = client.get("/employees/search", params={"q": "ZZZNONEXISTENT999"})
    assert resp.status_code == 200
    assert resp.json()["data"] == []


def test_search_employees_limit(client: httpx.Client):
    """Search returns at most 10 results."""
    resp = client.get("/employees/search", params={"q": "a"})
    assert resp.status_code == 200
    assert len(resp.json()["data"]) <= 10
