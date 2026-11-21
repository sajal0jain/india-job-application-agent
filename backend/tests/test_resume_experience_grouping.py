"""Grouped presentation preserves independent roles in the browser and Word exports."""

from copy import deepcopy
from io import BytesIO

from bs4 import BeautifulSoup
from docx import Document
import pytest

from backend.api.routes_resumes import TEMPLATES_DIR, _build_docx, _render_html


EXPERIENCE = [
    {"company": "Sample Employer", "title": "Director of Data Science", "date": "May 2026 – Present", "location": "Gurugram"},
    {"company": " sample  employer ", "title": "Senior Manager", "dates": "Feb 2022 – May 2026", "bullets": ["Built sample data products"]},
    {"company": "Sample Employer", "title": "Manager", "date": "Jul 2019 – Jan 2022"},
    {"company": "Another Employer", "title": "Analyst", "date": "Jan 2017 – Jun 2019"},
    {"company": "Sample Employer", "title": "Associate", "date": "2015 – 2016"},
]


@pytest.mark.parametrize("template", sorted(path.parent.name for path in TEMPLATES_DIR.glob("*/template.html.j2")))
def test_grouped_html_preserves_roles_and_employment_order(template):
    resume = {"experience": deepcopy(EXPERIENCE), "group_experience": True}
    text = BeautifulSoup(_render_html(resume, template, "a4"), "html.parser").get_text(" ", strip=True)
    assert text.casefold().count("sample employer") == 2
    assert "sample  employer" not in text
    titles = ("Director of Data Science", "Senior Manager", "Jul 2019 – Jan 2022", "Analyst", "Associate")
    positions = [text.index(title) for title in titles]
    assert positions == sorted(positions)
    for value in ("Gurugram", "May 2026 – Present", "Feb 2022 – May 2026", "Built sample data products"):
        assert value in text
    assert resume["experience"] == EXPERIENCE

    ungrouped = BeautifulSoup(_render_html({"experience": EXPERIENCE}, template, "a4"), "html.parser").get_text(" ", strip=True)
    assert "sample  employer" in ungrouped


def test_grouped_docx_employer_headings_and_roles():
    resume = {"experience": EXPERIENCE, "group_experience": True}
    doc = Document(BytesIO(_build_docx(resume, "a4")))
    paragraphs = [p.text for p in doc.paragraphs]
    assert paragraphs.count("Sample Employer") == 1
    assert "Associate at Sample Employer\t2015 – 2016" in paragraphs
    assert "Director of Data Science\tMay 2026 – Present" in paragraphs
    assert "Senior Manager\tFeb 2022 – May 2026" in paragraphs
    assert "Manager\tJul 2019 – Jan 2022" in paragraphs
    assert "Built sample data products" in paragraphs
