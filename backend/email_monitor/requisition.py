"""Conservative requisition matching for application correspondence."""

import re
from urllib.parse import unquote, urlsplit

IDENTIFIER = r"(?:[A-Z]{1,8}[- ]?\d{3,}|\d{4,})"
LABEL = re.compile(
    rf"\b(?:requisition(?:\s+(?:id|number|no\.?))?|req\s*(?:id|number|no\.)|job\s+(?:id|number|no\.?))"
    rf"\s*[:#-]?\s*({IDENTIFIER})(?![\w-])", re.I
)
PATH_ID = re.compile(r"(?<![A-Z0-9])([A-Z]{1,8}-?\d{3,})$", re.I)


def normalize(value):
    return re.sub(r"[-\s]", "", value).casefold()


def email_ids(text):
    return {normalize(match[1]) for match in LABEL.finditer(text)}


def job_ids(job):
    identifiers = set()
    key = getattr(job, "posting_key", None) or ""
    for url in (getattr(job, "url", None), getattr(job, "apply_url", None)):
        try:
            path = unquote(urlsplit(url or "").path).rstrip("/")
        except ValueError:
            continue
        token = PATH_ID.search(path)
        if token:
            identifiers.add(normalize(token[1]))
    suffix = key.rsplit(":", 1)[-1]
    if re.fullmatch(IDENTIFIER, suffix, re.I):
        identifiers.add(normalize(suffix))
    return identifiers


def matching_applications(applications, identifiers):
    return [app for app in applications if app.job and identifiers & job_ids(app.job)]
