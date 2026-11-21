"""Extract posting links from user-provided job alerts without visiting them."""

import re
from email import policy
from email.parser import Parser
from urllib.parse import urlsplit

from bs4 import BeautifulSoup

PORTALS = {
    "linkedin.com": ("LinkedIn", re.compile(r"^/(?:comm/)?jobs/view/[^/]+/?$")),
    "naukri.com": ("Naukri", re.compile(r"^/job-listings-[^/]+/?$")),
    "foundit.in": ("Foundit", re.compile(r"^/(?:job|seeker/job-details)/[^/]+/?$")),
    "instahyre.com": ("Instahyre", re.compile(r"^/job-[^/]+/?$")),
}
URL = re.compile(r'https://[^\s<>"\]]+')


def portal(url):
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    if parsed.scheme != "https" or not parsed.hostname or parsed.netloc != parsed.hostname:
        return None
    for domain, (label, pattern) in PORTALS.items():
        if parsed.hostname in {domain, f"www.{domain}", f"in.{domain}"} and pattern.fullmatch(parsed.path):
            return label
    return None


def employer_link(url):
    if len(url) > 2000 or not URL.fullmatch(url):
        return False
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    return bool(
        parsed.scheme == "https" and parsed.netloc == parsed.hostname
        and re.fullmatch(r"(?:[a-z0-9-]+\.)+[a-z]{2,}", parsed.hostname or "")
        and parsed.path.strip("/")
    )


def extract_alert(text):
    direct = text.strip()
    if employer_link(direct):
        label = portal(direct)
        if label:
            return [{"url": direct, "title": "", "portal": label}]
        return [{"url": direct, "title": "", "portal": "Employer website", "direct_employer": True}]
    message = Parser(policy=policy.default).parsestr(text)
    body = message.get_body(preferencelist=("html", "plain"))
    if body is not None and any(name in message for name in
                                ("From", "Subject", "MIME-Version", "Content-Type")):
        text = body.get_content()
        if not isinstance(text, str):
            return []
    links = []
    if "<" in text:
        soup = BeautifulSoup(text, "html.parser")
        links = [(a["href"], a.get_text(" ", strip=True)) for a in soup.find_all("a", href=True)]
        text = soup.get_text()
    for line in text.splitlines():
        for match in URL.finditer(line):
            links.append((match.group().rstrip(".,)>"), line[:match.start()].strip(" -|:")))
    candidates = {}
    for url, title in links:
        label = portal(url)
        if label and url not in candidates:
            candidates[url] = {"url": url, "title": title[:350], "portal": label}
    return list(candidates.values())[:30]
