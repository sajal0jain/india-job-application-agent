"""Manual preview for India leadership discovery."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.scraper.india_discovery import preview_boards

router = APIRouter(prefix="/india-discovery", tags=["searches"])


class DiscoveryRequest(BaseModel):
    boards: list[str] = Field(min_length=1, max_length=3)
    level: Literal["All", "Director", "Manager"] = "All"


@router.post("/preview")
async def preview(data: DiscoveryRequest):
    urls = list(dict.fromkeys(url.strip().rstrip("/") for url in data.boards))
    try:
        return await preview_boards(urls, data.level)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
