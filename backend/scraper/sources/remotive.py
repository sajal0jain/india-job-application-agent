"""Read Remotive's public feed for the private discovery sweep."""

import re
from datetime import timedelta
from urllib.parse import urlsplit

from backend.accounts.settings import get_install_setting, put_setting
from backend.models.db import SessionLocal, utcnow
from backend.scraper.india_discovery import EXCLUDED_INDIA, INDIA, WORLDWIDE

API = "https://remotive.com/api/remote-jobs"
LAST_REQUEST = "india_remotive_last_request"
REQUEST_INTERVAL = timedelta(hours=6).total_seconds()
OTHER_REGIONS = re.compile(
    r"\b(?:u\.?s\.?a?\.?|united states|canada|u\.?k\.?|united kingdom|"
    r"europe|emea|latam|latin america|australia|new zealand)\b", re.I
)


def reserve_request():
    """Keep manual runs and backend restarts within the source's recommended cadence."""
    now = utcnow().timestamp()
    with SessionLocal() as db:
        try:
            previous = float(get_install_setting(db, LAST_REQUEST, "0") or 0)
        except ValueError:
            previous = 0
        if now - previous < REQUEST_INTERVAL:
            return False
        put_setting(db, LAST_REQUEST, str(now))
        db.commit()
        return True


async def postings(client):
    response = await client.get(API)
    response.raise_for_status()
    rows = response.json()["jobs"]
    result = []
    for row in rows:
        url = row.get("url") or ""
        try:
            link = urlsplit(url)
        except ValueError:
            continue
        if (link.scheme != "https" or link.netloc not in {"remotive.com", "www.remotive.com"}
                or not link.path.startswith("/remote-jobs/")):
            continue
        location = (row.get("candidate_required_location") or "").strip()
        if EXCLUDED_INDIA.search(location):
            continue
        if not (INDIA.search(location) or WORLDWIDE.search(location)) and OTHER_REGIONS.search(location):
            continue
        result.append({"title": row.get("title"), "company": row.get("company_name"),
                       "url": url, "location": location, "arrangement": "remote"})
    return result
