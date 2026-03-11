"""Test domain registry endpoints."""
import uuid
import httpx


def test_list_domains(client: httpx.Client):
    resp = client.get("/domains")
    assert resp.status_code == 200
    data = resp.json()
    assert "data" in data
    assert isinstance(data["data"], list)


def test_create_domain(client: httpx.Client):
    code = f"TST_{uuid.uuid4().hex[:6].upper()}"
    resp = client.post("/domains", json={
        "domainCode": code,
        "domainName": f"Test Domain {code}",
        "description": "Integration test domain",
        "integrationType": "internal",
        "sortOrder": 99,
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["domainCode"] == code
    assert data["integrationType"] == "internal"
    assert data["isActive"] is True


def test_get_domain(client: httpx.Client, create_domain):
    code = create_domain["domainCode"]
    resp = client.get(f"/domains/{code}")
    assert resp.status_code == 200
    assert resp.json()["domainCode"] == code


def test_update_domain(client: httpx.Client, create_domain):
    code = create_domain["domainCode"]
    resp = client.put(f"/domains/{code}", json={
        "domainName": "Updated Domain Name",
        "description": "Updated description",
    })
    assert resp.status_code == 200
    assert resp.json()["domainName"] == "Updated Domain Name"


def test_get_nonexistent_domain(client: httpx.Client):
    resp = client.get("/domains/NONEXISTENT_CODE")
    assert resp.status_code == 404
