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


def extract_alert(text):
    message = Parser(policy=policy.default).parsestr(text)
    body = message.get_body(preferencelist=("html", "plain"))
    if message.keys() and body is not None:
        text = body.get_content()
        if not isinstance(text, str):
            return []
    soup = BeautifulSoup(text, "html.parser")
    links = [(a["href"], a.get_text(" ", strip=True)) for a in soup.find_all("a", href=True)]
    for line in soup.get_text().splitlines():
        for match in URL.finditer(line):
            links.append((match.group().rstrip(".,)>"), line[:match.start()].strip(" -|:")))
    candidates = {}
    for url, title in links:
        label = portal(url)
        if label and url not in candidates:
            candidates[url] = {"url": url, "title": title[:350], "portal": label}
    return list(candidates.values())[:30]
