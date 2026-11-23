"""Read LinkedIn job alerts through the existing read-only Gmail connection."""

import base64
import re
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from urllib.parse import quote, urlsplit

import httpx

from backend.email_monitor.gmail_client import GMAIL_API_BASE, _get_access_token
from backend.scraper.alert_intake import extract_alert

SENDER = "jobalerts-noreply@linkedin.com"
QUERY = f"newer_than:14d from:{SENDER}"
MAX_MESSAGES = 50
MAX_MESSAGE_BYTES = 750_000
POSTING_PATH = re.compile(r"/(?:comm/)?jobs/view/(?:[^/]+-)?([0-9]+)/?")


def alert_postings(raw):
    """Use the email's visible job title and keep only direct LinkedIn job IDs."""
    if not isinstance(raw, str) or len(raw) > MAX_MESSAGE_BYTES:
        return []
    message = BytesParser(policy=policy.default).parsebytes(
        base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    )
    if parseaddr(str(message.get("From", "")))[1].casefold() != SENDER:
        return []
    body = message.get_body(preferencelist=("html", "plain"))
    if body is None:
        return []
    content = body.get_content()
    if not isinstance(content, str):
        return []
    postings = {}
    for job in extract_alert(content):
        if job["portal"] != "LinkedIn" or not job["title"]:
            continue
        match = POSTING_PATH.fullmatch(urlsplit(job["url"]).path)
        if match:
            url = f"https://www.linkedin.com/jobs/view/{match[1]}"
            postings.setdefault(url, {**job, "url": url})
    return list(postings.values())


async def linkedin_alerts():
    """Return recent alert candidates and scan counts. Never fetch a posting URL."""
    token = await _get_access_token()
    if not token:
        return [], {"error": "Connect or reconnect Gmail in Settings to scan LinkedIn alerts."}
    postings = []
    report = {"emails": 0, "unreadable_emails": 0}
    async with httpx.AsyncClient(timeout=15, headers={"Authorization": f"Bearer {token}"}) as client:
        base = f"{GMAIL_API_BASE}/users/me/messages"
        response = await client.get(base, params={"q": QUERY, "maxResults": MAX_MESSAGES})
        response.raise_for_status()
        page = response.json()
        if page.get("nextPageToken"):
            report["note"] = f"Scanned the latest {MAX_MESSAGES} LinkedIn alerts."
        for row in page.get("messages", []):
            message_id = quote(row["id"], safe="")
            response = await client.get(f"{base}/{message_id}", params={"format": "raw"})
            if response.status_code == 404:
                continue
            response.raise_for_status()
            report["emails"] += 1
            try:
                postings.extend(alert_postings(response.json().get("raw")))
            except (ValueError, LookupError):
                report["unreadable_emails"] += 1
    return postings, report
