"""Evidence-only drafting and deterministic ranking for the India application queue."""

import hashlib
import io
import json
import re
from html import escape
from urllib.parse import parse_qsl, urlsplit

import pdfplumber

from backend.scraper.india_discovery import location_match, role_level

CONTACT = {"Name": "Full name", "Email": "Email", "Phone": "Phone", "Location": "Location"}
CV_SECTIONS = ("Summary", "Experience", "Skills", "Education", "Certifications")
FACT_SECTIONS = (*CONTACT, *CV_SECTIONS, "Screening")
STOP = set("a an and are as at be by for from in is of on or that the to using with you your".split())
RUBRIC = {"role": 20, "location": 20, "requirements": 60}
ATS_HOSTS = {"job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"}
FIELDS = set(CONTACT.values())


def fingerprint(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def words(value):
    return {term.rstrip(".-") for term in re.findall(r"[a-z0-9][a-z0-9+#.-]*", value.casefold())} - STOP


def requirements_from_posting(text, supplied=None):
    if supplied is not None:
        candidates = supplied.get("requirements", [])
        if not isinstance(candidates, list):
            raise ValueError("The provider did not return a requirements list.")
        # Exact quotations are the only model output retained.
        excerpts = [line.strip() for line in candidates[:24]
                    if isinstance(line, str) and 8 <= len(line.strip()) <= 360 and line.strip() in text]
    else:
        excerpts = [line.strip(" \t•-*") for line in re.split(r"\n|(?<=[.!?])\s+", text)
                    if 8 <= len(line.strip()) <= 360]
    return list(dict.fromkeys(excerpts))[:12]


def evidence_match(facts, title, posting_location, is_remote, requirements):
    content = [fact for fact in facts if fact["section"] in CV_SECTIONS]

    def evidence_for(requirement):
        terms = words(requirement)
        for fact in content:
            overlap = terms & words(fact["text"])
            # Lexical evidence is a lead for review. Each result shows the exact source fact.
            if terms and len(overlap) >= min(2, len(terms)) and len(overlap) / len(terms) >= 0.5:
                return fact["id"]
        return None

    evidence = [{"requirement": requirement, "fact_id": evidence_for(requirement)}
                for requirement in requirements]
    level = role_level(title)
    decision, reason, _ = location_match({"location": posting_location, "arrangement": "remote" if is_remote else None})
    matched = sum(item["fact_id"] is not None for item in evidence)
    points = {
        "role": RUBRIC["role"] if level else 0,
        "location": RUBRIC["location"] if decision == "match" else 0,
        "requirements": round(RUBRIC["requirements"] * matched / len(evidence)) if evidence else 0,
    }
    fact_ids = {item["fact_id"] for item in evidence if item["fact_id"]}
    # Prefer source-supported facts within their section and keep their original order.
    selected = sorted(content, key=lambda f: (f["id"] not in fact_ids, CV_SECTIONS.index(f["section"])))[:12]
    return {
        "score": sum(points.values()), "points": points, "max_points": RUBRIC,
        "position": level, "location": decision, "location_reason": reason,
        "evidence": evidence, "selected": [f["id"] for f in selected],
    }


def application_target(url):
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme != "https" or parts.netloc not in ATS_HOSTS:
        return None
    if any(not key.startswith("utm_") and key not in {"source", "ref", "gh_src", "lever-source"}
           for key, _ in parse_qsl(parts.query, keep_blank_values=True)):
        return None
    if parts.fragment or not re.fullmatch(r"/[A-Za-z0-9_-]+/(?:jobs/)?[A-Za-z0-9_-]+(?:/application|/apply)?/?", parts.path):
        return None
    return {"origin": f"https://{parts.netloc}", "path": re.sub(r"/(?:application|apply)$", "", parts.path.rstrip("/"))}


def resume_html(facts, selection):
    by_id = {fact["id"]: fact for fact in facts}
    selected = [by_id[fact_id] for fact_id in selection]
    contacts = {f["section"]: f["text"] for f in facts if f["section"] in CONTACT}
    if not contacts.get("Name") or not (contacts.get("Email") or contacts.get("Phone")):
        raise ValueError("Verify your name and an email or phone before exporting.")
    if len(selected) < 6:
        raise ValueError("Verify at least six substantive CV facts for a two-page resume.")
    section_order = sorted(selected, key=lambda f: CV_SECTIONS.index(f["section"]))
    split = (len(section_order) + 1) // 2
    expected = []

    def page(items, first):
        name = contacts["Name"]
        header = f"<h1>{escape(name)}</h1>"
        expected.append(name)
        if first:
            details = [contacts[key] for key in ("Email", "Phone", "Location") if key in contacts]
            header += "<p>" + escape(" | ".join(details)) + "</p>"
            expected.extend(details)
        for section in CV_SECTIONS:
            entries = [f["text"] for f in items if f["section"] == section]
            if entries:
                header += f"<h2>{section}</h2>" + "".join(f"<p>{escape(entry)}</p>" for entry in entries)
                expected.extend(entries)
        return f"<main>{header}</main>"

    first = page(section_order[:split], True)
    second = page(section_order[split:], False)
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><title>Resume</title><style>'
        '@page{size:A4;margin:19mm}body{font:11pt Arial,sans-serif;color:#111}'
        'main+main{break-before:page}h1{font-size:22pt;margin:0 0 9pt}'
        'h2{font-size:12pt;margin:15pt 0 5pt;break-after:avoid}'
        'p{margin:0 0 8pt;line-height:1.34;break-inside:avoid;overflow-wrap:anywhere}'
        '</style>' + first + second + '</html>', expected,
    )


def validate_pdf(data, expected):
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if len(pdf.pages) != 2:
            raise ValueError("The selected facts do not fit exactly two pages.")
        text = " ".join(page.extract_text() or "" for page in pdf.pages)
    text = " ".join(text.split())
    offset = 0
    for fact in expected:
        fact = " ".join(fact.split())
        start = text.find(fact, offset)
        if start < 0:
            raise ValueError("The PDF text check failed. Verify fact text or shorten the selection.")
        offset = start + len(fact)
