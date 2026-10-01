"""
Loyalty Tree Help / FAQ analytics router.

Add this file beside main.py, then register it in main.py:

    from help_routes import help_router
    app.include_router(help_router)

Required existing environment variables:
- SUPABASE_URL
- SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY or SUPABASE_KEY
- STAFF_SESSION_SECRET
- SUPER_ADMIN_PASSWORD

Run help_question_events_migration.sql in Supabase before using these endpoints.
"""

import hashlib
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional, Literal

import jwt as pyjwt
from fastapi import APIRouter, Header, HTTPException, Request, Query
from pydantic import BaseModel, Field
from supabase import create_client

help_router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = (
    os.getenv("SUPABASE_SECRET_KEY", "").strip()
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.getenv("SUPABASE_KEY", "").strip()
)
STAFF_SESSION_SECRET = os.getenv("STAFF_SESSION_SECRET", "").strip()
SUPER_ADMIN_PASSWORD = os.getenv("SUPER_ADMIN_PASSWORD", "")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_question(value: str) -> str:
    text = str(value or "").lower().strip()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:500]


def _verify_business_session(authorization: str, business_public_id: str) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")
    if not STAFF_SESSION_SECRET:
        raise HTTPException(status_code=503, detail="STAFF_SESSION_SECRET is not configured")

    token = authorization.split(" ", 1)[1]
    try:
        claims = pyjwt.decode(token, STAFF_SESSION_SECRET, algorithms=["HS256"])
    except Exception:
        raise HTTPException(status_code=401, detail="Session expired - please log in again")

    role = str(claims.get("role") or "").lower()
    if role not in {"owner", "manager"}:
        raise HTTPException(status_code=403, detail="Owner or manager access required")
    if str(claims.get("business_public_id") or "") != str(business_public_id):
        raise HTTPException(status_code=403, detail="Session does not match this business")

    return claims


def _require_admin(request: Request) -> None:
    if not SUPER_ADMIN_PASSWORD:
        raise HTTPException(status_code=503, detail="Admin access is not configured")
    expected = "admin-token-" + hashlib.sha256(SUPER_ADMIN_PASSWORD.encode()).hexdigest()
    auth_header = request.headers.get("authorization", "")
    token = auth_header.replace("Bearer ", "").replace("bearer ", "") if auth_header else ""
    if not token or token != expected:
        raise HTTPException(status_code=401, detail="Admin authentication required")


def _business_row(public_id: str) -> Optional[dict]:
    if not supabase:
        return None
    try:
        result = (
            supabase.table("businesses")
            .select("id,public_id,name")
            .eq("public_id", public_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None
    except Exception:
        return None


class HelpQuestionEventCreate(BaseModel):
    source: Literal["typed", "faq_click"] = "typed"
    question_text: str = Field(min_length=1, max_length=1000)
    matched_article_id: Optional[str] = Field(default=None, max_length=160)
    matched_article_title: Optional[str] = Field(default=None, max_length=300)
    answered: bool = False
    current_page: Optional[str] = Field(default=None, max_length=160)


class HelpQuestionReviewUpdate(BaseModel):
    review_status: Literal["open", "reviewed", "resolved"]
    admin_note: Optional[str] = Field(default=None, max_length=2000)


@help_router.post("/api/v1/business/{business_public_id}/help/question-event")
async def record_help_question_event(
    business_public_id: str,
    payload: HelpQuestionEventCreate,
    authorization: str = Header(default=""),
):
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    claims = _verify_business_session(authorization, business_public_id)
    business = _business_row(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    raw_question = payload.question_text.strip()
    normalized = _normalize_question(raw_question)
    if not normalized:
        raise HTTPException(status_code=400, detail="Question is empty")

    row = {
        "business_id": business.get("id"),
        "user_role": str(claims.get("role") or "owner").lower(),
        "source": payload.source,
        "question_text": raw_question,
        "normalized_question": normalized,
        "matched_article_id": payload.matched_article_id or None,
        "matched_article_title": payload.matched_article_title or None,
        "answered": bool(payload.answered),
        "current_page": (payload.current_page or "").strip() or None,
        "review_status": "resolved" if payload.answered else "open",
        "created_at": _utcnow_iso(),
        "updated_at": _utcnow_iso(),
    }

    try:
        inserted = supabase.table("help_question_events").insert(row).execute().data or []
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Help analytics storage is not ready. Run help_question_events_migration.sql in Supabase.",
        ) from exc

    return {"success": True, "event": inserted[0] if inserted else row}


def _group_help_rows(rows: list[dict]) -> list[dict]:
    grouped: dict[str, dict] = {}

    for row in rows:
        key = str(row.get("normalized_question") or "").strip()
        if not key:
            continue

        bucket = grouped.get(key)
        if bucket is None:
            bucket = {
                "key": key,
                "sample_question": row.get("question_text") or key,
                "count": 0,
                "answered_count": 0,
                "unanswered_count": 0,
                "faq_click_count": 0,
                "typed_count": 0,
                "roles": set(),
                "business_ids": set(),
                "last_asked_at": row.get("created_at"),
                "matched_article_id": row.get("matched_article_id"),
                "matched_article_title": row.get("matched_article_title"),
                "review_status": "resolved",
                "admin_note": None,
            }
            grouped[key] = bucket

        bucket["count"] += 1
        if row.get("answered"):
            bucket["answered_count"] += 1
        else:
            bucket["unanswered_count"] += 1

        if row.get("source") == "faq_click":
            bucket["faq_click_count"] += 1
        else:
            bucket["typed_count"] += 1

        role = str(row.get("user_role") or "").strip()
        if role:
            bucket["roles"].add(role)

        if row.get("business_id") is not None:
            bucket["business_ids"].add(row.get("business_id"))

        created_at = row.get("created_at")
        if created_at and (not bucket["last_asked_at"] or created_at > bucket["last_asked_at"]):
            bucket["last_asked_at"] = created_at
            bucket["sample_question"] = row.get("question_text") or bucket["sample_question"]
            bucket["matched_article_id"] = row.get("matched_article_id") or bucket["matched_article_id"]
            bucket["matched_article_title"] = row.get("matched_article_title") or bucket["matched_article_title"]

        status = str(row.get("review_status") or "open")
        # Open outranks reviewed, which outranks resolved.
        status_rank = {"open": 3, "reviewed": 2, "resolved": 1}
        if status_rank.get(status, 3) > status_rank.get(bucket["review_status"], 1):
            bucket["review_status"] = status

        if row.get("admin_note"):
            bucket["admin_note"] = row.get("admin_note")

    result = []
    for bucket in grouped.values():
        bucket["roles"] = sorted(bucket["roles"])
        bucket["business_count"] = len(bucket.pop("business_ids"))
        result.append(bucket)

    result.sort(
        key=lambda item: (
            item["unanswered_count"],
            item["count"],
            item["last_asked_at"] or "",
        ),
        reverse=True,
    )
    return result


@help_router.get("/api/v1/admin/help-insights")
async def admin_help_insights(
    request: Request,
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=5000, ge=100, le=10000),
):
    _require_admin(request)
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")

    since = datetime.now(timezone.utc).timestamp() - (days * 86400)
    since_iso = datetime.fromtimestamp(since, timezone.utc).isoformat()

    try:
        rows = (
            supabase.table("help_question_events")
            .select("*")
            .gte("created_at", since_iso)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Help analytics storage is not ready. Run help_question_events_migration.sql in Supabase.",
        ) from exc

    business_ids = sorted({row.get("business_id") for row in rows if row.get("business_id") is not None})
    business_map = {}
    if business_ids:
        try:
            businesses = (
                supabase.table("businesses")
                .select("id,public_id,name")
                .in_("id", business_ids)
                .execute()
                .data
                or []
            )
            business_map = {row.get("id"): row for row in businesses}
        except Exception:
            business_map = {}

    grouped = _group_help_rows(rows)
    open_unanswered = [
        item for item in grouped
        if item["unanswered_count"] > 0 and item["review_status"] != "resolved"
    ]

    top_faq = defaultdict(lambda: {"article_id": None, "title": None, "count": 0})
    for row in rows:
        if row.get("source") != "faq_click":
            continue
        article_id = row.get("matched_article_id") or "unknown"
        bucket = top_faq[article_id]
        bucket["article_id"] = article_id
        bucket["title"] = row.get("matched_article_title") or article_id
        bucket["count"] += 1

    recent = []
    for row in rows[:100]:
        biz = business_map.get(row.get("business_id")) or {}
        recent.append({
            "public_id": row.get("public_id"),
            "question_text": row.get("question_text"),
            "normalized_question": row.get("normalized_question"),
            "answered": bool(row.get("answered")),
            "source": row.get("source"),
            "user_role": row.get("user_role"),
            "current_page": row.get("current_page"),
            "matched_article_id": row.get("matched_article_id"),
            "matched_article_title": row.get("matched_article_title"),
            "review_status": row.get("review_status"),
            "admin_note": row.get("admin_note"),
            "created_at": row.get("created_at"),
            "business_name": biz.get("name"),
            "business_public_id": biz.get("public_id"),
        })

    return {
        "days": days,
        "total_events": len(rows),
        "typed_questions": sum(1 for row in rows if row.get("source") == "typed"),
        "faq_clicks": sum(1 for row in rows if row.get("source") == "faq_click"),
        "answered_events": sum(1 for row in rows if row.get("answered")),
        "unanswered_events": sum(1 for row in rows if not row.get("answered")),
        "unique_questions": len(grouped),
        "open_unanswered_groups": len(open_unanswered),
        "top_questions": grouped[:100],
        "unanswered_questions": open_unanswered[:100],
        "top_faqs": sorted(top_faq.values(), key=lambda item: item["count"], reverse=True)[:50],
        "recent": recent,
    }


@help_router.patch("/api/v1/admin/help-question-groups")
async def admin_update_help_question_group(
    request: Request,
    normalized_question: str = Query(min_length=1, max_length=500),
    payload: HelpQuestionReviewUpdate = None,
):
    _require_admin(request)
    if not supabase:
        raise HTTPException(status_code=503, detail="Database not connected")
    if payload is None:
        raise HTTPException(status_code=400, detail="Update is required")

    key = _normalize_question(normalized_question)
    if not key:
        raise HTTPException(status_code=400, detail="Question key is empty")

    patch = {
        "review_status": payload.review_status,
        "admin_note": (payload.admin_note or "").strip() or None,
        "updated_at": _utcnow_iso(),
    }

    try:
        rows = (
            supabase.table("help_question_events")
            .update(patch)
            .eq("normalized_question", key)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not update question group: {exc}") from exc

    return {"success": True, "normalized_question": key, "updated_rows": len(rows), **patch}
