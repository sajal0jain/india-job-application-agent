import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.routes_india_discovery import router
from backend.scraper.india_discovery import ashby, greenhouse, location_match, role_level

BOARD = "https://job-boards.greenhouse.io/sample"


@pytest.mark.parametrize(("title", "level"), [
    ("Senior Analytics Manager", "Manager"),
    ("Manager, Decision Science", "Manager"),
    ("Data Science Manager", "Manager"),
    ("Director, Generative AI", "Director"),
    ("Associate Director – Analytics", "Director"),
    ("Head of Data Science", "Director"),
    ("Director of Data Scientists", "Director"),
    ("Senior Data Scientist", None),
    ("Assistant to the Director of Analytics", None),
    ("AI Product Manager", None),
])
def test_titles(title, level):
    assert role_level(title) == level


@pytest.mark.parametrize(("location", "arrangement", "expected"), [
    ("Gurgaon, Haryana", "hybrid", "match"),
    ("Delhi NCR", None, "match"),
    ("Greater Noida", "onsite", "match"),
    ("India", "Remote", "match"),
    ("Remote - India", None, "match"),
    ("Remote - Worldwide", None, "match"),
    ("Worldwide", "Remote", "match"),
    ("Work from anywhere", None, "match"),
    ("Remote worldwide, excluding India", None, "review"),
    ("Remote worldwide; United States only", None, "review"),
    ("Worldwide", None, "outside"),
    ("Remote - United States; Bengaluru, India", None, "review"),
    ("Remote excluding India", None, "review"),
    ("Remote - EMEA", None, "review"),
    ("India", "hybrid", "outside"),
    ("Bengaluru", "onsite", "outside"),
    (None, None, "review"),
])
def test_locations(location, arrangement, expected):
    assert location_match({"location": location, "arrangement": arrangement})[0] == expected


def test_preview_filters_and_reports_feed_failures(monkeypatch):
    async def postings(url, debug):
        assert url == BOARD and debug
        jobs = [
            {"title": "Director of Analytics", "url": f"{BOARD}/jobs/{number}", "location": "Gurugram"}
            for number in (10, 20)
        ]
        return [
            *jobs, jobs[0],
            {"title": "AI Director", "url": f"{BOARD}/jobs/30", "location": "Remote"},
            {"title": "Analytics Manager", "url": f"{BOARD}/jobs/40", "location": "Noida"},
            {"title": "Analytics Director", "url": f"{BOARD}/jobs/50", "location": "Mumbai"},
            {"title": "AI Director", "url": "javascript:alert(1)", "location": "Delhi"},
        ], []

    async def unavailable(*args, **kwargs):
        return [], [{"title": "(none)", "reason": "HTTP 429"}]

    monkeypatch.setattr(greenhouse, "scrape", postings)
    monkeypatch.setattr(ashby, "scrape", unavailable)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    response = client.post("/india-discovery/preview", json={
        "boards": [BOARD, "https://jobs.ashbyhq.com/sample"], "level": "Director",
    })
    assert response.status_code == 200
    data = response.json()
    assert [item["decision"] for item in data["jobs"]] == ["match", "match", "review"]
    assert data["total"] == 3
    assert data["errors"] == [{
        "board": "https://jobs.ashbyhq.com/sample", "reason": "Employer feed could not be loaded.",
    }]


@pytest.mark.parametrize("bad_url", [
    "https://jobs.lever.co.example.org/sample",
    "https://example.org/jobs.lever.co/sample",
    "https://jobs.ashbyhq.com/sample/job",
    "https://jobs.lever.co/sample?team=analytics",
    "http://jobs.lever.co/sample",
    "https://[invalid",
])
def test_rejects_invalid_board_before_fetch(bad_url, monkeypatch):
    async def should_not_fetch(*args, **kwargs):
        pytest.fail("Invalid request must not fetch any boards")

    monkeypatch.setattr(greenhouse, "scrape", should_not_fetch)
    app = FastAPI()
    app.include_router(router)
    response = TestClient(app).post("/india-discovery/preview", json={"boards": [BOARD, bad_url]})
    assert response.status_code == 422
