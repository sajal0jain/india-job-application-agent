import shutil

import pytest
from fastapi import HTTPException, Response
from playwright.async_api import async_playwright

from backend.analyzer.india_workflow import application_target, requirements_from_posting
from backend.api import routes_india_workflow as routes
from backend.api import routes_resumes
from backend.models.db import Application, Job
from backend.scraper._shared.dedup import make_external_id

URL = "https://jobs.lever.co/example/abc-123"
DESCRIPTION = "Lead analytics teams.\nBuild forecasting systems.\nDeploy Python pipelines."
FACTS = [
    ("Name", "Asha Sample"), ("Email", "asha@example.invalid"),
    ("Experience", "Lead analytics teams"),
    ("Experience", "Built reliable Python pipelines"),
    ("Experience", "Managed reporting for three departments"),
    ("Summary", "Analytics manager with experience in experimentation"),
    ("Education", "Master of Statistics, Example University"),
    ("Skills", "SQL, Python, experimentation"),
    ("Screening", "Available after 30 days"),
]


@pytest.fixture
def candidate(test_db):
    job = Job(company="Example", title="Director of Analytics", location="Gurgaon",
              url=URL, description=DESCRIPTION, external_id=make_external_id("", "", URL))
    test_db.add(job)
    test_db.commit()
    profile = routes.ProfileInput(verified=True, facts=[
        routes.Fact(section=section, text=text, source="Synthetic source") for section, text in FACTS
    ])
    data = routes.save_profile(profile, test_db)
    return job.id, profile, data["facts"]


@pytest.mark.asyncio
async def test_draft_approval_origin_revoke_and_tracking(candidate, test_db, monkeypatch):
    job_id, profile, facts = candidate

    async def rendered(*args):
        return b"fake PDF"

    monkeypatch.setattr(routes, "render_resume", rendered)
    draft = await routes.match_job(job_id, routes.MatchInput(), test_db)
    assert draft["analysis"]["points"] == {"role": 20, "location": 20, "requirements": 40}
    with pytest.raises(HTTPException, match="approve"):
        routes.fill(job_id, routes.Fill(page_url=URL), Response(), test_db)

    screen = next(f for f in facts if f["section"] == "Screening")
    edit = routes.Edit(revision=draft["revision"], resume_fact_ids=draft["resume_fact_ids"], answers=[
        routes.Answer(question="When can you start?", fact_id=screen["id"]),
        routes.Answer(question="Do you have a work permit?"),
    ])
    fresh = routes.edit_draft(job_id, edit, test_db)
    assert not fresh["approved"] and fresh["revision"] != edit.revision
    payload = routes.Approval(revision=fresh["revision"], confirmed=True)
    assert (await routes.approve(job_id, payload, test_db))["approved"]

    for page in (URL.replace("abc-123", "other"), URL.replace("jobs.lever.co", "example.invalid"), URL.replace("https:", "http:")):
        with pytest.raises(HTTPException, match="supported employer ATS"):
            routes.fill(job_id, routes.Fill(page_url=page), Response(), test_db)
    response = Response()
    approved = routes.fill(job_id, routes.Fill(page_url=URL + "/apply"), response, test_db)
    assert response.headers["Cache-Control"] == "no-store"
    assert approved["fields"] == [
        {"label": "Full name", "value": "Asha Sample"},
        {"label": "Email", "value": "asha@example.invalid"},
        {"label": "When can you start?", "value": "Available after 30 days"},
    ]
    first = routes.submitted(job_id, payload, test_db)
    duplicate = routes.submitted(job_id, payload, test_db)
    assert first["created"] and duplicate == {"application_id": first["application_id"], "created": False}
    assert test_db.query(Application).count() == 1
    with pytest.raises(HTTPException, match="already tracked"):
        routes.fill(job_id, routes.Fill(page_url=URL), Response(), test_db)

    routes.revoke(job_id, test_db)
    with pytest.raises(HTTPException, match="approve"):
        routes.fill(job_id, routes.Fill(page_url=URL), Response(), test_db)
    with pytest.raises(HTTPException, match="approve"):
        await routes.approve(job_id, payload, test_db)
    profile.facts[0].text = "Asha Example"
    routes.save_profile(profile, test_db)
    assert routes.queue(test_db)[0]["stale"]


@pytest.mark.asyncio
async def test_hosted_opt_in_and_model_cannot_add_unquoted_requirements(candidate, test_db, monkeypatch):
    job_id, _, _ = candidate
    payload = routes.MatchInput(provider="openrouter", model="sample/model")
    with pytest.raises(HTTPException, match="Approve sending"):
        await routes.match_job(job_id, payload, test_db)

    def key(*args):
        return "test-key"

    async def hosted(prompt, system, model, key, cap, **kwargs):
        assert prompt == DESCRIPTION and "Asha" not in prompt
        assert cap == 600 and kwargs["max_retries"] == 0
        return {"text": '{"requirements":["Lead analytics teams.","Invent a doctorate"]}'}

    monkeypatch.setattr(routes.llm_client, "provider_api_key", key)
    monkeypatch.setattr(routes.llm_client, "_call_openai", hosted)
    payload.hosted_consent = True
    draft = await routes.match_job(job_id, payload, test_db)
    assert [item["requirement"] for item in draft["analysis"]["evidence"]] == ["Lead analytics teams."]
    monkeypatch.setattr(routes, "DAILY_AI_RUNS", 1)
    with pytest.raises(HTTPException, match="Daily AI limit"):
        await routes.match_job(job_id, payload, test_db)


@pytest.mark.asyncio
async def test_two_page_resume_preserves_verified_text(candidate, test_db, monkeypatch):
    executable = shutil.which("chromium")
    if not executable:
        pytest.skip("System Chromium is required for the real PDF integration check")
    job_id, _, _ = candidate
    draft = await routes.match_job(job_id, routes.MatchInput(), test_db)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=executable, headless=True)

        async def get_browser():
            return browser

        monkeypatch.setattr(routes_resumes, "_get_browser", get_browser)
        response = await routes.download_resume(job_id, test_db)
        assert response.body.startswith(b"%PDF")
        assert response.media_type == "application/pdf"
        approved = await routes.approve(job_id, routes.Approval(
            revision=draft["revision"], confirmed=True,
        ), test_db)
        assert approved["approved"]
        await browser.close()


def test_reject_altered_quote_and_unapproved_target():
    assert requirements_from_posting("Experience: SQL.", {"requirements": ["Experience: SQL and Rust"]}) == []
    assert application_target("https://jobs.lever.co.evil/example/abc") is None
    assert application_target("https://[bad") is None
    assert application_target(URL + "?gh_jid=other") is None


@pytest.mark.asyncio
async def test_ollama_only_receives_posting_and_keeps_unverified_answers_blank(candidate, test_db, monkeypatch):
    job_id, _, facts = candidate

    async def local(prompt, system, model, cap):
        assert prompt == DESCRIPTION and model == "sample:3b" and cap == 600
        return {"text": '{"requirements":["Deploy Python pipelines."]}'}

    async def hosted(*args, **kwargs):
        pytest.fail("Local model selection must never fall back to hosted AI")

    monkeypatch.setattr(routes.llm_client, "_call_ollama", local)
    monkeypatch.setattr(routes.llm_client, "_call_openai", hosted)
    result = await routes.match_job(job_id, routes.MatchInput(provider="ollama", model="sample:3b"), test_db)
    invalid = routes.Edit(revision=result["revision"], resume_fact_ids=result["resume_fact_ids"],
                          answers=[routes.Answer(question="Visa status?", fact_id=facts[0]["id"])])
    with pytest.raises(HTTPException, match="verified screening fact"):
        routes.edit_draft(job_id, invalid, test_db)
    assert routes.read_job(job_id, test_db)["draft"]["answers"] == []
