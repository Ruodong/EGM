"""Test projects API (read-only, synced from EAM)."""
import httpx


def test_list_projects(client: httpx.Client):
    resp = client.get("/projects")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert "total" in data
    assert data["total"] >= 0


def test_list_projects_with_search(client: httpx.Client):
    resp = client.get("/projects", params={"search": "FY"})
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data


def test_list_projects_page_size(client: httpx.Client):
    resp = client.get("/projects", params={"pageSize": 5})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["data"]) <= 5


def test_get_project_not_found(client: httpx.Client):
    resp = client.get("/projects/NONEXISTENT-999")
    assert resp.status_code == 404


def test_get_project_by_id(client: httpx.Client):
    """Get the first project and then fetch it by ID."""
    listing = client.get("/projects", params={"pageSize": 1}).json()
    if listing["total"] == 0:
        return  # No projects synced; skip
    pid = listing["data"][0]["projectId"]
    resp = client.get(f"/projects/{pid}")
    assert resp.status_code == 200
    assert resp.json()["projectId"] == pid
