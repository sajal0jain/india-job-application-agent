"""Preview leadership roles on explicitly selected employer ATS boards."""

import asyncio
import re
from urllib.parse import urlsplit

from backend.scraper.ats import ashby, greenhouse, lever
from backend.scraper._shared.dedup import _normalize_url

BOARDS = {
    "boards.greenhouse.io": greenhouse,
    "job-boards.greenhouse.io": greenhouse,
    "jobs.lever.co": lever,
    "jobs.ashbyhq.com": ashby,
}
DOMAIN = re.compile(
    r"\b(?:analytics|data scien(?:ce|tists?)|decision science|business intelligence|"
    r"bi|(?:data|customer|product|business) insights|artificial intelligence|"
    r"ai|genai|generative ai|applied ai|ai/ml|machine learning)\b", re.I
)
DIRECTOR = re.compile(r"\b(?:director|head)\b", re.I)
MANAGER = re.compile(r"\bmanager\b", re.I)
SUPPORT = re.compile(r"\b(?:assistant to|executive assistant|account manager|"
                     r"project manager|program manager|product manager)\b", re.I)
NCR = re.compile(r"\b(?:gurugram|gurgaon|delhi(?:[ -]?ncr)?|new delhi|"
                 r"(?:greater )?noida|ghaziabad|faridabad)\b", re.I)
INDIA = re.compile(r"\bindia\b", re.I)
REMOTE = re.compile(r"\b(?:remote|work from home)\b", re.I)
EXCLUDED_INDIA = re.compile(r"\b(?:except|excluding|outside|not based in)\s+india\b", re.I)


def board_source(url):
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.netloc.lower() not in BOARDS
            or parsed.query or parsed.fragment
            or not re.fullmatch(r"/[a-zA-Z0-9_-]+/?", parsed.path)):
        raise ValueError("Enter an HTTPS employer board homepage on Greenhouse, Lever, or Ashby.")
    return BOARDS[parsed.netloc.lower()], parsed.path.strip("/")


def role_level(title):
    if SUPPORT.search(title) or not DOMAIN.search(title):
        return None
    if DIRECTOR.search(title):
        return "Director"
    if MANAGER.search(title):
        return "Manager"
    return None


def location_match(posting):
    places = list(dict.fromkeys(filter(None, [posting.get("location"), *posting.get("locations", [])])))
    arrangement = (posting.get("arrangement") or "").strip().lower()
    # Evaluate separate listed locations independently. A remote option for a foreign
    # office must not turn another location into an India-wide remote posting.
    entries = [part.strip() for place in places for part in re.split(r"[;/|]", place)]
    if arrangement not in {"hybrid", "onsite", "on-site", "on site"}:
        for entry in entries:
            if EXCLUDED_INDIA.search(entry):
                continue
            if (INDIA.search(entry) or NCR.search(entry)) and (
                arrangement == "remote" or REMOTE.search(entry)
            ):
                return "match", "Remote with an India location", ", ".join(places)
    if arrangement != "remote" and any(NCR.search(entry) for entry in entries):
        return "match", "Delhi NCR location", ", ".join(places)
    if arrangement == "remote" or any(REMOTE.search(entry) for entry in entries):
        return "review", "Remote eligibility for India needs confirmation", ", ".join(places)
    if not entries:
        return "review", "Employer feed does not specify a location", ""
    return "outside", "", ", ".join(places)


async def preview_boards(urls, level):
    # Validate every URL before any outbound request.
    boards = [(url, *board_source(url)) for url in urls]
    matches, errors, seen = [], [], set()
    for url, adapter, company in boards:
        try:
            postings, rejected = await asyncio.wait_for(adapter.scrape(url, debug=True), timeout=20)
        except Exception:
            errors.append({"board": url, "reason": "Employer feed could not be loaded."})
            continue
        if not postings and any(item.get("title") == "(none)" for item in rejected):
            errors.append({"board": url, "reason": "Employer feed could not be loaded."})
            continue
        for posting in postings:
            title = posting["title"]
            role = role_level(title)
            if not role or (level != "All" and role != level):
                continue
            decision, reason, location = location_match(posting)
            if decision == "outside":
                continue
            link = posting["url"]
            try:
                parsed = urlsplit(link)
                if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                    continue
                identity = _normalize_url(link) or link
            except ValueError:
                continue
            if identity in seen:
                continue
            seen.add(identity)
            matches.append({"title": title, "company": company, "url": link, "board": url,
                            "level": role, "decision": decision, "reason": reason, "location": location})
    matches.sort(key=lambda item: (item["decision"], item["level"], item["title"].casefold()))
    return {"jobs": matches[:200], "total": len(matches), "errors": errors}
