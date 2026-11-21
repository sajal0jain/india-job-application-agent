"""Opt-in recurring discovery from portal APIs and an employer allowlist."""

import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit, urlunsplit

import httpx

from backend.accounts.context import owner_context, run_in_clean_context
from backend.analyzer.location import apply_location_to_job
from backend.analyzer.work_arrangement import apply_arrangement_to_job
from backend.models.db import Job, SessionLocal
from backend.scraper._shared.dedup import make_content_hash, make_external_id
from backend.scraper._shared.html_text import html_to_text
from backend.scraper.ats import workday
from backend.scraper.sources import remotive
from backend.scraper.india_discovery import board_source, location_match, role_level
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)
TERMS = ("analytics manager", "data science manager", "AI manager", "machine learning manager",
         "business intelligence manager", "director analytics", "director data science",
         "director AI", "director machine learning", "head of AI", "head of data science", "head of analytics")
AREAS = ("Gurgaon", "Gurugram", "Delhi NCR", "India")
PORTAL_LABELS = {"india_adzuna": "Adzuna", "india_jooble": "Jooble"}


def integer_setting(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def schedule_hours():
    value = integer_setting("JN_INDIA_SWEEP_HOURS", 0)
    return max(6, min(168, value)) if value > 0 else 0


def portal_pages():
    return max(1, integer_setting("JN_INDIA_PORTAL_PAGES", 2))


def employer_boards():
    return list(dict.fromkeys(
        url.strip().rstrip("/") for url in os.getenv("JN_INDIA_EMPLOYER_BOARDS", "").split(",")
        if url.strip()
    ))


def remotive_enabled():
    return os.getenv("JN_INDIA_REMOTIVE", "").strip() == "1"


def portal_credentials():
    return {
        "india_adzuna": (os.getenv("ADZUNA_APP_ID", "").strip(), os.getenv("ADZUNA_APP_KEY", "").strip()),
        "india_jooble": (os.getenv("JOOBLE_API_KEY", "").strip(),),
    }


def employer_adapter(url):
    parts = urlsplit(url)
    if (parts.scheme == "https"
            and re.fullmatch(r"[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com", parts.netloc)
            and re.fullmatch(r"/(?:[a-z]{2}(?:-[A-Z]{2})?/)?[A-Za-z0-9_-]+/?", parts.path)
            and not parts.query and not parts.fragment):
        return workday, parts.hostname.split(".")[0]
    return board_source(url)


class WorkdayClient(httpx.AsyncClient):
    """Use ordinary HTTPS and stop if the tenant blocks or rate limits access."""

    async def post(self, *args, **kwargs):
        response = await super().post(*args, **kwargs)
        if response.status_code in {401, 403, 429}:
            response.raise_for_status()
        await asyncio.sleep(0.5)
        return response


async def portal_page(client, source, keys, query, area, page):
    if source == "india_adzuna":
        response = await client.get(f"https://api.adzuna.com/v1/api/jobs/in/search/{page}", params={
            "app_id": keys[0], "app_key": keys[1], "what": query, "where": area,
            "results_per_page": 50, "sort_by": "date",
        })
        response.raise_for_status()
        data = response.json()
        return [
            {"title": row.get("title"), "company": (row.get("company") or {}).get("display_name"),
             "description": html_to_text(row.get("description") or ""), "url": row.get("redirect_url"), "location": (row.get("location") or {}).get("display_name")}
            for row in data["results"]
        ]
    response = await client.post(f"https://in.jooble.org/api/{quote(keys[0], safe='')}", json={
        "keywords": query, "location": area, "page": str(page),
    })
    response.raise_for_status()
    return [
        {"title": row.get("title"), "company": row.get("company"), "url": row.get("link"),
         "location": row.get("location"), "description": html_to_text(row.get("snippet") or "")}
        for row in response.json()["jobs"]
    ]


def import_candidates(postings, source):
    counts = {"matches": 0, "review": 0, "added": 0, "duplicate": 0}
    with SessionLocal() as db:
        for posting in postings:
            title = (posting.get("title") or "").strip()
            if not role_level(title):
                continue
            decision, _, location = location_match(posting)
            if decision == "outside":
                continue
            url = (posting.get("url") or "").strip()
            try:
                parts = urlsplit(url)
                if (source == "india_adzuna" and parts.scheme == "http"
                        and parts.hostname in {"adzuna.in", "www.adzuna.in", "adzuna.co.uk", "www.adzuna.co.uk"}):
                    parts = parts._replace(scheme="https")
                    url = urlunsplit(parts)
                if (parts.scheme != "https" or not parts.hostname or parts.username or parts.password
                        or len(url) > 2000 or any(ord(char) <= 32 for char in url)):
                    continue
            except ValueError:
                continue
            counts["matches" if decision == "match" else "review"] += 1
            company = (posting.get("company") or "").strip()[:240]
            external_id = make_external_id(company, title, url)
            if db.query(Job.id).filter(Job.external_id == external_id).first():
                counts["duplicate"] += 1
                continue
            job = Job(external_id=external_id, content_hash=make_content_hash(company, title),
                      title=title[:350], company=company, location=location[:500] or None, url=url,
                      description=(posting.get("description") or "")[:16000] or None,
                      source=source if decision == "match" else f"{source}_review",
                      status="new", seen=False, saved=False)
            apply_arrangement_to_job(job, structured=posting.get("arrangement"))
            apply_location_to_job(job, extra=posting.get("locations"))
            try:
                with db.begin_nested():
                    db.add(job)
                    db.flush()
            except IntegrityError:
                if not db.query(Job.id).filter(Job.external_id == external_id).first():
                    raise
                counts["duplicate"] += 1
            else:
                counts["added"] += 1
        db.commit()
    return counts


async def sweep():
    report = []
    # Direct postings are ingested first so the canonical employer link wins where it is available.
    for index, url in enumerate(employer_boards(), start=1):
        label = f"Employer board {index}"
        try:
            adapter, company = employer_adapter(url)
            label = company
            options = {"client_factory": WorkdayClient} if adapter is workday else {}
            postings, rejected = await asyncio.wait_for(adapter.scrape(url, debug=True, **options), timeout=60)
            for posting in postings:
                posting["company"] = company
            counts = import_candidates(postings, "india_employer")
            entry = {"source": company, "received": len(postings), **counts}
            if any(row.get("title") == "(none)" for row in rejected):
                entry["error"] = "The employer feed returned an error or a partial result."
            report.append(entry)
        except Exception as error:
            logger.warning("Employer sweep failed (%s)", type(error).__name__)
            report.append({"source": label, "error": "Could not search this board. Check the URL and access."})
        await asyncio.sleep(1)

    pages = portal_pages()
    async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
        if remotive_enabled():
            entry = {"source": "Remotive"}
            report.append(entry)
            try:
                if remotive.reserve_request():
                    rows = await remotive.postings(client)
                    entry.update(received=len(rows), **import_candidates(rows, "india_remotive"))
                else:
                    entry["note"] = "The feed refreshes at most once every six hours."
            except Exception as error:
                logger.warning("Remotive sweep failed (%s)", type(error).__name__)
                entry["error"] = "The public remote jobs feed could not be loaded."
        for source, keys in portal_credentials().items():
            if not all(keys):
                continue
            entry = {"source": PORTAL_LABELS[source], "received": 0,
                     "matches": 0, "review": 0, "added": 0, "duplicate": 0, "capped_queries": 0}
            report.append(entry)
            try:
                for area in AREAS:
                    for term in TERMS:
                        query = f"{term} remote" if area == "India" else term
                        for page in range(1, pages + 1):
                            rows = await portal_page(client, source, keys, query, area, page)
                            entry["received"] += len(rows)
                            if rows:
                                for key, count in import_candidates(rows, source).items():
                                    entry[key] += count
                            await asyncio.sleep(1)
                            if not rows:
                                break
                        else:
                            entry["capped_queries"] += 1
            except Exception as error:
                logger.warning("Portal sweep failed for %s (%s)", source, type(error).__name__)
                entry["error"] = "Search stopped. Check provider access, country coverage, and API quota."
    return report


class IndiaSweep:
    def __init__(self):
        self.scheduler = None
        self.run = None
        self.last = None

    def configured(self):
        return bool(employer_boards() or remotive_enabled() or any(all(keys) for keys in portal_credentials().values()))

    def start(self):
        hours = schedule_hours()
        if hours and self.configured():
            self.scheduler = asyncio.create_task(self.repeat(hours))

    def trigger(self):
        if not self.configured() or (self.run and not self.run.done()):
            return False
        self.run = run_in_clean_context(asyncio.create_task, self.execute())
        return True

    async def repeat(self, hours):
        while True:
            if self.trigger():
                await asyncio.shield(self.run)
            await asyncio.sleep(hours * 3600)

    async def execute(self):
        try:
            with owner_context():
                sources = await sweep()
            self.last = {"finished_at": datetime.now(timezone.utc).isoformat(), "sources": sources}
        except Exception as error:
            logger.warning("India sweep failed (%s)", type(error).__name__)
            self.last = {"finished_at": datetime.now(timezone.utc).isoformat(), "sources": [],
                         "error": "Could not complete the sweep."}

    async def stop(self):
        tasks = [task for task in (self.scheduler, self.run) if task]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.scheduler = self.run = None

    def status(self):
        portals = [PORTAL_LABELS[source] for source, keys in portal_credentials().items() if all(keys)]
        if remotive_enabled():
            portals.append("Remotive")
        return {"enabled_hours": schedule_hours(), "boards": len(employer_boards()),
                "portals": portals,
                "running": bool(self.run and not self.run.done()), "last": self.last}


india_sweep = IndiaSweep()
