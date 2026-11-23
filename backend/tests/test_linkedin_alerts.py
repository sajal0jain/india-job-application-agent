import base64
from contextlib import nullcontext
from email.message import EmailMessage
from unittest.mock import AsyncMock

import httpx
import pytest

from backend.email_monitor import linkedin_alerts as gmail
from backend.models.db import Job
from backend.scraper import india_sweep as discovery


def sample_alert(sender=gmail.SENDER):
    message = EmailMessage()
    message["From"] = f"LinkedIn <{sender}>"
    message["Subject"] = "New jobs from your saved search"
    message.set_content("Your job alert")
    message.add_alternative("""
        <a href="https://www.linkedin.com/comm/jobs/view/director-ai-123/?trackingId=x">Director of AI</a>
        <a href="https://in.linkedin.com/jobs/view/123?trk=y">Director of AI</a>
        <a href="https://www.linkedin.com/jobs/view/456">Marketing Intern</a>
        <a href="https://example.org/jobs/view/789">Director of Analytics</a>
        <a href="https://www.linkedin.com/jobs/search/?currentJobId=890">See all jobs</a>
        """, subtype="html")
    return base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")


def test_alert_only_uses_direct_linkedin_posting_ids():
    jobs = gmail.alert_postings(sample_alert())
    assert [(job["url"], job["title"]) for job in jobs] == [
        ("https://www.linkedin.com/jobs/view/123", "Director of AI"),
        ("https://www.linkedin.com/jobs/view/456", "Marketing Intern"),
    ]
    assert gmail.alert_postings(sample_alert("alerts@example.org")) == []


@pytest.mark.asyncio
async def test_sweep_reads_gmail_and_imports_only_leadership_jobs(test_db, monkeypatch):
    def respond(request):
        assert request.url.host == "www.googleapis.com"
        assert request.method == "GET"
        path = request.url.path
        if path.endswith("/messages"):
            assert request.url.params["q"] == gmail.QUERY
            return httpx.Response(200, json={"messages": [{"id": "example"}]})
        assert path.endswith("/messages/example")
        assert request.url.params["format"] == "raw"
        return httpx.Response(200, json={"raw": sample_alert()})

    client = httpx.AsyncClient
    monkeypatch.setattr(gmail.httpx, "AsyncClient",
                        lambda **kw: client(transport=httpx.MockTransport(respond), **kw))
    monkeypatch.setattr(gmail, "_get_access_token", AsyncMock(return_value="sample-token"))
    monkeypatch.setattr(discovery, "SessionLocal", lambda: nullcontext(test_db))
    monkeypatch.setattr(discovery, "employer_boards", lambda: [])
    monkeypatch.setattr(discovery, "portal_credentials", lambda: {})
    monkeypatch.setattr(discovery, "remotive_enabled", lambda: False)
    monkeypatch.setenv("JN_INDIA_LINKEDIN_ALERTS", "1")

    assert discovery.IndiaSweep().configured()
    assert "LinkedIn job alerts" in discovery.IndiaSweep().status()["portals"]
    first, = await discovery.sweep()
    second, = await discovery.sweep()
    assert first["emails"] == 1 and first["received"] == 2 and first["added"] == 1
    assert second["duplicate"] == 1 and second["added"] == 0
    job = test_db.query(Job).one()
    assert job.title == "Director of AI" and job.source == "india_linkedin_alert_review"
    assert job.status == "new" and not job.location


@pytest.mark.asyncio
async def test_unconnected_gmail_gives_setup_message(monkeypatch):
    monkeypatch.setattr(gmail, "_get_access_token", AsyncMock(return_value=""))
    postings, report = await gmail.linkedin_alerts()
    assert postings == []
    assert "Connect or reconnect Gmail" in report["error"]
