"""Manual preview for India leadership discovery."""

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.accounts.context import current_account, owner_account_id
from backend.scraper.india_discovery import preview_boards
from backend.accounts.settings import put_setting
from backend.models.db import get_db
from backend.scraper.india_sweep import WATCHLIST_KEY, employer_adapter, employer_boards, india_sweep
from sqlalchemy.orm import Session

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
async def start_sweep(include_remote: bool = False):
    require_owner()
    if not india_sweep.trigger(include_remote=include_remote):
        raise HTTPException(409, "A sweep is running or no sources are configured.")
    return india_sweep.status()


def require_owner():
    owner = owner_account_id()
    if owner is None or current_account.get() != owner:
        raise HTTPException(403, "This search is configured for the dashboard owner.")


class WatchlistRequest(BaseModel):
    boards: list[str] = Field(max_length=500)


@router.get("/watchlist")
def watchlist():
    require_owner()
    return {"boards": employer_boards()}


@router.put("/watchlist")
def save_watchlist(payload: WatchlistRequest, db: Session = Depends(get_db)):
    require_owner()
    boards = list(dict.fromkeys(url.strip().rstrip("/") for url in payload.boards if url.strip()))
    for index, url in enumerate(boards, start=1):
        try:
            employer_adapter(url)
        except ValueError as error:
            raise HTTPException(422, f"Line {index}: use a supported employer board homepage.") from error
    put_setting(db, WATCHLIST_KEY, json.dumps(boards))
    db.commit()
    return {"boards": boards}
