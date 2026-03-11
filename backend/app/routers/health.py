"""Health-check endpoint."""
from datetime import datetime, timezone
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check():
    return {"status": "ok", "service": "egm", "timestamp": datetime.now(timezone.utc).isoformat()}
