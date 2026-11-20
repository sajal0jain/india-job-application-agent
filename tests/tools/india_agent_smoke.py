"""Exercise the isolated Phase 1 stack using synthetic records."""
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from uuid import uuid4


BASE_URL = "http://127.0.0.1:8088"


def request(path, *, key=None, data=None, expected=200):
    headers = {}
    if key:
        headers["X-API-Key"] = key
    payload = None
    if data is not None:
        payload = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    try:
        response = urlopen(Request(BASE_URL + path, data=payload, headers=headers), timeout=15)
    except HTTPError as error:
        response = error
    with response:
        if response.status != expected:
            raise RuntimeError(f"{path}: expected HTTP {expected}, got {response.status}")
        return response.read()


def main():
    env = Path(__file__).resolve().parents[2] / ".env"
    settings = dict(
        line.split("=", 1)
        for line in env.read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )
    key = settings["INITIAL_API_KEY"].strip()
    health = json.loads(request("/health"))
    assert health["status"] == "ok" and not health["image_outdated"], health
    assert b"<html" in request("/")
    request("/api/jobs", expected=401)
    request("/api/jobs", key=key)

    sample = uuid4().hex[:12]
    posting = {
        "title": "Analytics Manager",
        "company": f"Phase 1 Synthetic Employer {sample}",
        "location": "Gurugram, India",
        "url": f"https://example.invalid/jobs/{sample}",
    }
    job = json.loads(request("/api/jobs/manual", key=key, data=posting))
    duplicate = json.loads(request("/api/jobs/manual", key=key, data=posting))
    assert job["created"] and not duplicate["created"] and job["id"] == duplicate["id"]

    # This endpoint logs a record only. The fixture points to a reserved domain.
    record = json.loads(request("/api/applications", key=key, data=posting))
    assert record["job_id"] == job["id"] and record["status"] == "applied"
    request("/api/applications", key=key, data=posting, expected=409)
    tracked = json.loads(request("/api/applications", key=key))
    assert any(row["id"] == record["id"] for row in tracked["applications"])
    print("Passed health, dashboard, authentication, job dedup and application tracking.")


if __name__ == "__main__":
    main()
