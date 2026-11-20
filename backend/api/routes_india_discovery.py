"""Manual preview for India leadership discovery."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.accounts.context import current_account, owner_account_id
from backend.scraper.india_discovery import preview_boards
from backend.scraper.india_sweep import india_sweep

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


@router.get("/sweep")
def sweep_status():
    require_owner()
    return india_sweep.status()


@router.post("/sweep", status_code=202)
async def start_sweep():
    require_owner()
    if not india_sweep.trigger():
        raise HTTPException(409, "A sweep is running or no sources are configured.")
    return india_sweep.status()


def require_owner():
    owner = owner_account_id()
    if owner is None or current_account.get() != owner:
        raise HTTPException(403, "This search is configured for the dashboard owner.")
