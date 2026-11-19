"""Close a business owner account from the iOS app."""
import uuid
from datetime import datetime

from fastapi import Header, HTTPException
from pydantic import BaseModel, Field


class AccountDeleteRequest(BaseModel):
    password: str = Field(min_length=1, max_length=1024)
    reason: str = Field(min_length=8, max_length=500)


def register_account_delete(app, supabase, require_owner_session, password_security, safe_get_business, send_email, admin_email, legacy_hasher):
    @app.post("/api/v1/business/{public_id}/account/delete")
    async def delete_owner_account(public_id: str, req: AccountDeleteRequest, authorization: str = Header(default="")):
        require_owner_session(public_id, authorization)
        if not supabase:
            raise HTTPException(503, "Database not connected")
        business = safe_get_business(public_id)
        if not business:
            raise HTTPException(404, "Business not found")
        stored = business.get("password_hash") or ""
        if not password_security.verify_owner_password(req.password, stored, legacy_hasher=legacy_hasher):
            raise HTTPException(401, "That password does not match.")
        reason = " ".join(req.reason.split())
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        patch = {
            "status": "DELETED",
            "email": f"deleted+{public_id}.{stamp}@deleted.loyaltree.invalid",
            "phone": None,
            "contact_person": None,
            "address": None,
            "password_hash": password_security.hash_owner_password_sync(uuid.uuid4().hex),
            "updated_at": datetime.utcnow().isoformat(),
        }
        try:
            patch["auth_version"] = int(business.get("auth_version") or 0) + 1
            supabase.table("businesses").update(patch).eq("id", business.get("id")).execute()
        except Exception:
            patch.pop("auth_version", None)
            supabase.table("businesses").update(patch).eq("id", business.get("id")).execute()
        if admin_email:
            try:
                send_email(
                    admin_email,
                    subject=f"Account deleted: {business.get('name') or public_id}",
                    html_body=(
                        f"<p>{business.get('name') or ''} ({business.get('email') or ''}) deleted the account in the app.</p>"
                        f"<p>Reason: {reason}</p>"
                    ),
                )
            except Exception:
                pass
        return {"success": True}
