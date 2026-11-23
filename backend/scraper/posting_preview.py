"""Read structured job details from a public posting without a browser session."""

import asyncio
import json
from urllib.parse import urlsplit

import httpx
from bs4 import BeautifulSoup

from backend.scraper._shared.bot_wall import is_bot_wall
from backend.scraper._shared.html_text import html_to_text
from backend.scraper._shared.url_safety import UnsafeURLError, safe_get
from backend.scraper.alert_intake import portal


def _text(value, limit):
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def _nodes(value):
    if isinstance(value, list):
        for entry in value:
            yield from _nodes(entry)
    elif isinstance(value, dict):
        yield value
        yield from _nodes(value.get("@graph"))


def parse_posting(markup):
    soup = BeautifulSoup(markup[:1_000_000], "html.parser")
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
            for node in _nodes(data):
                kind = node.get("@type")
                if kind == "JobPosting" or isinstance(kind, list) and "JobPosting" in kind:
                    return _details(node)
        except (ValueError, RecursionError):
            continue
    return {}


def _details(node):
    employer = node.get("hiringOrganization")
    places = node.get("jobLocation")
    locations = []
    for place in places if isinstance(places, list) else [places]:
        address = place.get("address") if isinstance(place, dict) else None
        if isinstance(address, dict):
            locations.append(", ".join(filter(None, (
                _text(address.get(key), 150)
                for key in ("addressLocality", "addressRegion", "addressCountry")
            ))))
        elif isinstance(address, str):
            locations.append(_text(address, 150))
    description = node.get("description")
    return {
        "title": _text(node.get("title"), 360),
        "company": _text(employer.get("name") if isinstance(employer, dict) else employer, 240),
        "location": "; ".join(dict.fromkeys(filter(None, locations)))[:500],
        "description": html_to_text(description[:100_000]).strip()[:16000] if isinstance(description, str) else "",
    }


async def preview_posting(url):
    host = urlsplit(url).hostname or ""
    if portal(url) or host == "linkedin.com" or host.endswith(".linkedin.com"):
        return {}, "Open this posting in your browser and paste the missing details."
    try:
        response = await asyncio.wait_for(safe_get(url, timeout=10), timeout=15)
        if response.status_code in {401, 403, 429} or is_bot_wall(response.text):
            return {}, "The site restricted access. Open the posting and paste the missing details."
        response.raise_for_status()
        if response.url.scheme != "https":
            return {}, "Open the posting and paste the missing details."
        details = parse_posting(response.text)
    except UnsafeURLError:
        return {}, "This link could not be read safely. Use a public posting URL."
    except (httpx.HTTPError, TimeoutError):
        return {}, "The posting could not be read. Open it and paste the missing details."
    note = "" if details.get("description") else "No structured description was available. Paste the posting text."
    return details, note
