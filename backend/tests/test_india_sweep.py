import asyncio
from contextlib import nullcontext
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.models.db import Job
from backend.scraper import india_sweep as discovery
from backend.scraper.ats import lever, workday


@pytest.mark.asyncio
async def test_portal_request_shapes():
    def transport(request):
        if request.url.host == "api.adzuna.com":
            assert request.url.path == "/v1/api/jobs/in/search/2"
            assert request.url.params["what"] == "director AI"
            return httpx.Response(200, json={"results": [{
                "title": "Director AI", "company": {"display_name": "Example"},
                "location": {"display_name": "Gurgaon"}, "redirect_url": "https://example.invalid/a",
            }]})
        assert request.url.host == "in.jooble.org"
        assert request.method == "POST" and request.url.path == "/api/test-key"
        return httpx.Response(200, json={"jobs": [{
            "title": "Head of AI", "company": "Example", "location": "Remote India",
            "link": "https://example.invalid/b",
        }]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        adzuna = await discovery.portal_page(client, "india_adzuna", ("test-id", "test-key"), "director AI", "Gurgaon", 2)
        jooble = await discovery.portal_page(client, "india_jooble", ("test-key",), "head of AI", "India", 2)
    assert adzuna[0]["location"] == "Gurgaon" and adzuna[0]["company"] == "Example"
    assert jooble[0]["location"] == "Remote India" and jooble[0]["title"] == "Head of AI"


def test_import_marks_location_review_and_skips_duplicate(test_db, monkeypatch):
    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    postings = [
        {"title": "Director of AI", "company": "Sample", "url": "https://jobs.lever.co/sample/one", "location": "Gurgaon"},
        {"title": "Director of AI", "company": "Sample", "url": "https://jobs.lever.co/sample/two", "location": "Remote"},
        {"title": "Director of AI", "company": "Sample", "url": "https://jobs.lever.co/sample/three", "location": "Mumbai"},
        {"title": "Junior Analyst", "company": "Sample", "url": "https://jobs.lever.co/sample/four", "location": "Gurgaon"},
    ]
    counts = discovery.import_candidates(postings, "india_employer")
    assert counts == {"matches": 1, "review": 1, "added": 2, "duplicate": 0}
    assert {row.source for row in test_db.query(Job)} == {"india_employer", "india_employer_review"}
    assert discovery.import_candidates(postings, "india_employer")["duplicate"] == 2
    assert test_db.query(Job).count() == 2


def test_catalog_and_schedule(test_db, monkeypatch):
    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    lever_board = "https://jobs.lever.co/sample"
    workday_board = "https://sample.wd5.myworkdayjobs.com/en-US/External"
    monkeypatch.setenv("JN_INDIA_EMPLOYER_BOARDS", f"{lever_board}, {workday_board}, {lever_board}/")
    monkeypatch.setenv("JN_INDIA_SWEEP_HOURS", "1")
    assert discovery.schedule_hours() == 6
    assert discovery.employer_boards() == [lever_board, workday_board]
    assert discovery.employer_adapter(lever_board) == (lever, "sample")
    assert discovery.employer_adapter(workday_board) == (workday, "sample")
    with pytest.raises(ValueError):
        discovery.employer_adapter(workday_board + "/job/id")


@pytest.mark.asyncio
async def test_sweep_does_not_overlap(monkeypatch):
    monkeypatch.setattr(discovery, "employer_boards", lambda: [])
    monkeypatch.setenv("JOOBLE_API_KEY", "test-key")
    scheduler = discovery.IndiaSweep()
    pending = asyncio.Event()

    async def execute():
        await pending.wait()

    monkeypatch.setattr(scheduler, "execute", execute)
    assert scheduler.trigger()
    assert not scheduler.trigger()
    assert scheduler.status()["running"]
    await scheduler.stop()
    assert not scheduler.status()["running"]


@pytest.mark.asyncio
async def test_board_failure_isolated_from_portal_pagination(test_db, monkeypatch):
    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    monkeypatch.setenv("JN_INDIA_EMPLOYER_BOARDS", "https://jobs.lever.co/sample")
    monkeypatch.setenv("JOOBLE_API_KEY", "test-key")
    monkeypatch.setenv("ADZUNA_APP_ID", "")
    monkeypatch.setattr(discovery, "AREAS", ("Gurgaon",))
    monkeypatch.setattr(discovery, "TERMS", ("director analytics",))
    monkeypatch.setattr(discovery.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(lever, "scrape", AsyncMock(side_effect=RuntimeError("test failure")))
    portal = AsyncMock(side_effect=[[{"title": "Director of Analytics"}], []])
    monkeypatch.setattr(discovery, "portal_page", portal)
    monkeypatch.setattr(discovery, "import_candidates", lambda *_: {"added": 1})
    result = await discovery.sweep()
    assert result[0]["error"] and result[1]["source"] == "Jooble"
    assert result[1]["added"] == 1 and portal.await_count == 2


@pytest.mark.asyncio
async def test_remotive_feed_and_repeat_limit(test_db, monkeypatch):
    from backend.scraper.sources import remotive

    monkeypatch.setattr(remotive, "SessionLocal", lambda: nullcontext(test_db))
    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    assert remotive.reserve_request()
    assert not remotive.reserve_request()

    regions = ["India", "Worldwide", "United States only", "Worldwide except India", "APAC"]
    jobs = [
        {"title": "Director of Analytics", "company_name": "Example",
         "candidate_required_location": region, "url": f"https://remotive.com/remote-jobs/data/example-{i}"}
        for i, region in enumerate(regions)
    ]
    jobs.append({**jobs[0], "url": "https://other.invalid/remote-jobs/data/example"})
    transport = httpx.MockTransport(lambda req: httpx.Response(200, json={"jobs": jobs}))
    async with httpx.AsyncClient(transport=transport) as client:
        rows = await remotive.postings(client)

    counts = discovery.import_candidates(rows, "india_remotive")
    assert counts == {"matches": 2, "review": 1, "added": 3, "duplicate": 0}
    assert {row.url for row in test_db.query(Job)} == {jobs[i]["url"] for i in (0, 1, 4)}


@pytest.mark.asyncio
async def test_remotive_runs_without_portal_keys(monkeypatch):
    monkeypatch.setenv("JN_INDIA_REMOTIVE", "1")
    monkeypatch.setattr(discovery, "employer_boards", lambda: [])
    monkeypatch.setattr(discovery, "portal_credentials", lambda: {})
    monkeypatch.setattr(discovery.remotive, "reserve_request", lambda: True)
    monkeypatch.setattr(discovery.remotive, "postings", AsyncMock(return_value=[]))
    monkeypatch.setattr(discovery, "import_candidates", lambda *args: {"added": 0})
    scheduler = discovery.IndiaSweep()
    assert scheduler.configured()
    assert scheduler.status()["portals"] == ["Remotive"]
    assert await discovery.sweep() == [{"source": "Remotive", "received": 0, "added": 0}]


def test_dashboard_watchlist_replaces_environment_and_rejects_invalid_boards(test_db, monkeypatch):
    from backend.api import routes_india_discovery as api

    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    monkeypatch.setenv("JN_INDIA_EMPLOYER_BOARDS", "https://jobs.lever.co/previous")
    assert discovery.employer_boards() == ["https://jobs.lever.co/previous"]
    monkeypatch.setattr(api, "owner_account_id", lambda: None)
    with pytest.raises(api.HTTPException) as blocked:
        api.save_watchlist(api.WatchlistRequest(boards=[]), test_db)
    assert blocked.value.status_code == 403

    monkeypatch.setattr(api, "owner_account_id", lambda: api.current_account.get())
    with pytest.raises(api.HTTPException) as invalid:
        api.save_watchlist(api.WatchlistRequest(boards=["https://example.invalid/private"]), test_db)
    assert invalid.value.status_code == 422
    board = "https://jobs.ashbyhq.com/approved"
    assert api.save_watchlist(api.WatchlistRequest(boards=[board, board + "/"]), test_db) == {"boards": [board]}
    assert discovery.employer_boards() == [board]
    api.save_watchlist(api.WatchlistRequest(boards=[]), test_db)
    assert discovery.employer_boards() == []
