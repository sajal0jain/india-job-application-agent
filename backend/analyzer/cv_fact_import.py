"""Extract reviewable fact candidates from Word CVs without a model."""

import re
from io import BytesIO
from zipfile import BadZipFile, ZipFile

from lxml import etree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
MAX_CV_BYTES = 5_000_000
MAX_XML_BYTES = 8_000_000
EMAIL = re.compile(r"[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"(?<!\w)\+\d[\d ()-]{7,18}\d(?!\w)")
HEADINGS = {
    "summary": "Summary", "profile": "Summary", "professional summary": "Summary",
    "experience": "Experience", "work experience": "Experience", "employment history": "Experience",
    "professional experience": "Experience", "work experience/internships": "Experience",
    "education": "Education", "academics": "Education", "academic qualifications": "Education",
    "skills": "Skills", "technical skills": "Skills", "technical skills and relevant coursework": "Skills",
    "certifications": "Certifications", "online certifications": "Certifications",
    "curricular and extra curricular activities": "", "positions of responsibility": "",
    "references": "", "interests": "",
}


def _paragraph_text(paragraph):
    pieces = []
    for child in paragraph.iter(W + "t", W + "tab", W + "br"):
        if next(child.iterancestors(W + "p"), None) is not paragraph:
            continue
        pieces.append(child.text or "" if child.tag == W + "t" else "\t")
    return "".join(pieces).strip()


def _entries(body):
    for paragraph in body.iter(W + "p"):
        cell = next(paragraph.iterancestors(W + "tc"), None)
        row = cell.getparent() if cell is not None else None
        cells = row.findall(W + "tc") if row is not None else []
        if len(cells) > 1 and all(len(item.findall(W + "p")) == 1 for item in cells):
            paragraphs = [item.find(W + "p") for item in cells]
            if paragraphs[0] is paragraph:
                yield "  |  ".join(filter(None, map(_paragraph_text, paragraphs)))
        else:
            yield _paragraph_text(paragraph)


def extract_cv_facts(content, filename):
    try:
        with ZipFile(BytesIO(content)) as archive:
            entry = archive.getinfo("word/document.xml")
            if entry.file_size > MAX_XML_BYTES:
                raise ValueError("The Word document is too large to read.")
            xml = archive.read(entry)
        root = etree.fromstring(xml, parser=etree.XMLParser(resolve_entities=False, no_network=True))
        body = root.find(W + "body")
        if body is None:
            raise ValueError("The Word document has no readable body.")
    except (BadZipFile, KeyError, RuntimeError, NotImplementedError, etree.XMLSyntaxError) as error:
        raise ValueError("Upload a readable .docx file.") from error

    filename = filename.replace("\\", "/").rsplit("/", 1)[-1][:160]
    facts, seen = [], set()
    section, employer = "Summary", ""
    skipped_long = 0

    def add(kind, claim, index):
        nonlocal skipped_long
        key = (kind, " ".join(claim.casefold().split()))
        if key in seen or not claim:
            return
        if len(claim) > 360:
            skipped_long += 1
            return
        seen.add(key)
        facts.append({"section": kind, "text": claim, "source": f"{filename} · entry {index}"})

    for index, raw in enumerate(_entries(body), 1):
        text = " ".join(raw.split()).strip("• ").strip()
        if not text:
            continue
        heading = text.rstrip(":").casefold()
        if heading in HEADINGS:
            section, employer = HEADINGS[heading], ""
            continue
        label, separator, value = text.partition(" | ")
        if separator and label.casefold() in HEADINGS and HEADINGS[label.casefold()]:
            add(HEADINGS[label.casefold()], value, index)
            continue
        if section == "Summary":
            emails = EMAIL.findall(text)
            phones = PHONE.findall(text)
            for email in emails:
                add("Email", email, index)
            for phone in phones:
                add("Phone", phone, index)
            if emails or phones:
                continue
        if not section or len(text.split()) < 3 or heading in {"some key projects", "languages/tools"}:
            continue
        columns = re.split(r"\s*\|\s*|\t+| {3,}", raw)
        if section == "Experience" and len(columns) == 3 and re.search(r"\b(?:19|20)\d{2}\b", columns[-1]):
            employer = columns[1].strip()
            add(section, " · ".join(columns), index)
        elif not text.casefold().startswith("degree/examination"):
            if section == "Summary" and len(text) > 360:
                for sentence in re.split(r"(?<=[.!?])\s+", text):
                    add(section, sentence, index)
            else:
                claim = f"{employer} · {text}" if employer else text
                add(section, claim, index)
    return {"facts": facts[:80], "omitted": max(0, len(facts) - 80) + skipped_long}
