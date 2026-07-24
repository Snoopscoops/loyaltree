import os
import uuid
import base64
import json
from datetime import datetime, timedelta
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client
import qrcode
from qrcode.image.svg import SvgImage
from io import BytesIO

# ─── Environment ────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
BASE_URL = os.getenv("BASE_URL", "https://loyaltree-btw1.onrender.com")
GOOGLE_WALLET_ISSUER_ID = os.getenv("GOOGLE_WALLET_ISSUER_ID", "")
GOOGLE_WALLET_CLASS_SUFFIX = os.getenv("GOOGLE_WALLET_CLASS_SUFFIX", "")

# ✅ ROBUST: Clear error if env vars missing
if not SUPABASE_URL:
    raise RuntimeError(
        "❌ SUPABASE_URL environment variable is not set!\n"
        "Set it in your Render dashboard: Environment → Add Environment Variable\n"
        "Value: https://xmzrzrslggrbyojkojsy.supabase.co"
    )
if not SUPABASE_KEY:
    raise RuntimeError(
        "❌ SUPABASE_KEY environment variable is not set!\n"
        "Set it in your Render dashboard: Environment → Add Environment Variable"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ─── Pydantic Models ──────────────────────────────────────────────────────────
class BusinessCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    password: str

class StaffInvite(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    role: str = "cashier"

class LoyaltyConfig(BaseModel):
    stamp_goal: int = Field(default=8, ge=3, le=20)
    reward_name: str = "Free Service"
    primary_color: str = "#3b82f6"
    reward_expiry_days: int = Field(default=30, ge=1)

class CustomerSignup(BaseModel):
    name: str
    phone: str

class StampRequest(BaseModel):
    customer_public_id: str
    staff_pin: str

class GoLiveResponse(BaseModel):
    message: str

# ─── Helpers ─────────────────────────────────────────────────────────────────
def generate_public_id() -> str:
    return uuid.uuid4().hex

def get_business(public_id: str):
    res = supabase.table("businesses").select("*").eq("public_id", public_id).single().execute()
    return res.data

def get_customer(public_id: str):
    res = supabase.table("customers").select("*").eq("public_id", public_id).single().execute()
    return res.data

def get_business_by_id(business_id: int):
    res = supabase.table("businesses").select("*").eq("id", business_id).single().execute()
    return res.data

def generate_qr_svg(data: str) -> str:
    qr = qrcode.make(data, image_factory=SvgImage)
    buffer = BytesIO()
    qr.save(buffer)
    return buffer.getvalue().decode("utf-8")

# ─── FastAPI App ─────────────────────────────────────────────────────────────
app = FastAPI(title="LoyaltyTree API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://loyaltree-btw1.onrender.com",
        "http://localhost:3000",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/business/{public_id}")
async def get_business_api(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return business

@app.get("/api/v1/business/{public_id}/customers")
async def get_customers(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    res = supabase.table("customers").select("*").eq("business_id", business["id"]).execute()
    return res.data or []

@app.get("/api/v1/business/{public_id}/staff")
async def get_staff(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    res = supabase.table("staff").select("*").eq("business_id", business["id"]).execute()
    return res.data or []

@app.get("/api/v1/business/{public_id}/stats")
async def get_stats(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    customers_res = supabase.table("customers").select("*").eq("business_id", business["id"]).execute()
    customers = customers_res.data or []
    total_stamps = sum(c.get("stamp_count", 0) for c in customers)
    return {
        "total_customers": len(customers),
        "total_stamps": total_stamps,
        "unlocked_rewards": sum(1 for c in customers if c.get("reward_unlocked")),
    }

@app.get("/api/v1/business/{public_id}/loyalty-config")
async def get_loyalty_config(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    res = supabase.table("loyalty_configs").select("*").eq("business_id", business["id"]).single().execute()
    return res.data or {}

@app.post("/api/v1/business/{public_id}/loyalty-config")
async def save_loyalty_config(public_id: str, config: LoyaltyConfig):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    data = {
        "business_id": business["id"],
        "stamp_goal": config.stamp_goal,
        "reward_name": config.reward_name,
        "primary_color": config.primary_color,
        "reward_expiry_days": config.reward_expiry_days,
        "updated_at": datetime.utcnow().isoformat(),
    }
    existing = supabase.table("loyalty_configs").select("id").eq("business_id", business["id"]).execute()
    if existing.data:
        supabase.table("loyalty_configs").update(data).eq("business_id", business["id"]).execute()
    else:
        data["created_at"] = datetime.utcnow().isoformat()
        supabase.table("loyalty_configs").insert(data).execute()
    return {"message": "Configuration saved"}

@app.post("/api/v1/business/{public_id}/staff/invite")
async def invite_staff(public_id: str, invite: StaffInvite):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    staff_data = {
        "business_id": business["id"],
        "public_id": generate_public_id(),
        "name": invite.name,
        "email": invite.email,
        "phone": invite.phone,
        "role": invite.role,
        "pin": "0000",
        "is_active": True,
        "created_at": datetime.utcnow().isoformat(),
    }
    supabase.table("staff").insert(staff_data).execute()
    return {"message": "Staff invited", "pin": "0000"}

@app.post("/api/v1/business/{public_id}/go-live")
async def go_live(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    supabase.table("businesses").update({
        "status": "ACTIVE",
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", business["id"]).execute()
    return {"message": "Business is now live!"}

@app.get("/api/v1/business/{public_id}/qr-code")
async def get_qr_code(public_id: str):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    join_url = f"{BASE_URL}/join/{public_id}"
    svg = generate_qr_svg(join_url)
    return JSONResponse({
        "svg": svg,
        "join_url": join_url,
        "business_name": business["name"],
    })

@app.post("/api/v1/business/{public_id}/stamp")
async def add_stamp(public_id: str, req: StampRequest):
    business = get_business(public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = get_customer(req.customer_public_id)
    if not customer or customer["business_id"] != business["id"]:
        raise HTTPException(status_code=404, detail="Customer not found")

    staff_res = supabase.table("staff").select("*").eq("business_id", business["id"]).eq("pin", req.staff_pin).execute()
    if not staff_res.data:
        raise HTTPException(status_code=403, detail="Invalid staff PIN")

    config_res = supabase.table("loyalty_configs").select("*").eq("business_id", business["id"]).single().execute()
    config = config_res.data or {"stamp_goal": 8}
    goal = config.get("stamp_goal", 8)

    new_count = customer.get("stamp_count", 0) + 1
    reward_unlocked = new_count >= goal

    supabase.table("customers").update({
        "stamp_count": new_count,
        "reward_unlocked": reward_unlocked,
        "updated_at": datetime.utcnow().isoformat(),
    }).eq("id", customer["id"]).execute()

    return {
        "message": "Stamp added!",
        "stamp_count": new_count,
        "reward_unlocked": reward_unlocked,
    }

# ═════════════════════════════════════════════════════════════════════════════
# CUSTOMER JOIN PAGE
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/join/{business_public_id}", response_class=HTMLResponse)
async def customer_join_page(business_public_id: str):
    business = get_business(business_public_id)
    if not business:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not found</h1>
            <p>This link is invalid.</p>
        </div>
        """)

    # ✅ FIXED: Case-insensitive status check for enum "ACTIVE"
    if business["status"].upper() != "ACTIVE":
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not active</h1>
            <p>This business is not accepting new members yet.</p>
        </div>
        """)

    config_res = supabase.table("loyalty_configs").select("*").eq("business_id", business["id"]).single().execute()
    config = config_res.data or {}
    primary_color = config.get("primary_color", "#3b82f6")
    reward_name = config.get("reward_name", "Free Service")
    stamp_goal = config.get("stamp_goal", 8)

    return HTMLResponse(f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Join {business["name"]} Rewards</title>
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, {primary_color} 0%, #1e293b 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }}
            .card {{
                background: white;
                border-radius: 24px;
                padding: 32px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }}
            .logo {{
                width: 80px;
                height: 80px;
                border-radius: 20px;
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 20px;
                font-size: 36px;
            }}
            h1 {{ font-size: 24px; color: #1e293b; margin-bottom: 8px; }}
            .subtitle {{ color: #64748b; margin-bottom: 24px; font-size: 14px; }}
            .reward-preview {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 24px;
            }}
            .reward-preview h3 {{ color: {primary_color}; font-size: 16px; margin-bottom: 4px; }}
            .reward-preview p {{ color: #64748b; font-size: 13px; }}
            input {{
                width: 100%;
                padding: 14px 16px;
                border: 2px solid #e2e8f0;
                border-radius: 12px;
                font-size: 16px;
                margin-bottom: 12px;
                outline: none;
            }}
            input:focus {{ border-color: {primary_color}; }}
            button {{
                width: 100%;
                padding: 16px;
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                color: white;
                border: none;
                border-radius: 12px;
                font-size: 16px;
                font-weight: 700;
                cursor: pointer;
                margin-top: 8px;
            }}
            .success-qr {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin: 16px 0;
            }}
            .success-qr img {{
                width: 160px;
                height: 160px;
                border-radius: 12px;
            }}
            .member-id {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
            }}
            .member-id p {{ margin: 0; font-weight: 600; color: #1e293b; }}
            .member-id code {{
                display: block;
                margin-top: 8px;
                font-family: monospace;
                font-size: 14px;
                color: #64748b;
                word-break: break-all;
            }}
            .wallet-btn {{
                display: block;
                width: 100%;
                padding: 14px;
                background: #1a73e8;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-weight: 600;
                margin-bottom: 12px;
                text-align: center;
            }}
            .share-btn {{
                width: 100%;
                padding: 14px;
                background: #f0fdf4;
                color: #0d9488;
                border: 1px solid #a7f3d0;
                border-radius: 10px;
                font-weight: 600;
                cursor: pointer;
            }}
        </style>
    </head>
    <body>
        <div class="card" id="card">
            <div class="logo">🌳</div>
            <h1>{business["name"]}</h1>
            <p class="subtitle">Join our loyalty program</p>

            <div class="reward-preview">
                <h3>🎁 {reward_name}</h3>
                <p>Collect {stamp_goal} stamps to unlock your reward</p>
            </div>

            <form id="signupForm">
                <input type="text" id="name" placeholder="Your name" required>
                <input type="tel" id="phone" placeholder="Phone number" required>
                <button type="submit">Join & Get Your Card 🌱</button>
            </form>
        </div>

        <script>
            document.getElementById("signupForm").addEventListener("submit", async (e) => {{
                e.preventDefault();
                const name = document.getElementById("name").value;
                const phone = document.getElementById("phone").value;

                try {{
                    const res = await fetch("{BASE_URL}/api/v1/join/{business_public_id}", {{
                        method: "POST",
                        headers: {{"Content-Type": "application/json"}},
                        body: JSON.stringify({{name, phone}})
                    }});
                    const data = await res.json();

                    if (res.ok) {{
                        const walletUrl = `{BASE_URL}/wallet/${{data.public_id}}`;

                        document.getElementById("card").innerHTML = `
                            <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
                            <h1>Welcome, ${{data.name}}!</h1>
                            <p style="color: #64748b; margin-bottom: 24px;">Your loyalty card is ready</p>

                            <div class="success-qr">
                                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${{data.public_id}}" alt="Your QR Code"/>
                                <p style="font-size: 12px; color: #94a3b8; margin-top: 8px;">Scan at checkout</p>
                            </div>

                            <div class="member-id">
                                <p>Your Member ID</p>
                                <code>${{data.public_id}}</code>
                            </div>

                            <a href="https://pay.google.com/gp/v/save/${{data.public_id}}" class="wallet-btn">
                                🎫 Add to Google Wallet
                            </a>

                            <button onclick="navigator.share({{title: 'My Loyalty Card', text: 'My card for ${business["name"]}', url: '${walletUrl}'}})" class="share-btn">
                                🔗 Share Card
                            </button>

                            <p style="font-size: 12px; color: #94a3b8; margin-top: 16px;">
                                Show this QR to your cashier on every visit to earn stamps.
                            </p>
                        `;
                    }} else {{
                        alert(data.detail || "Signup failed");
                    }}
                }} catch (err) {{
                    alert("Network error. Please try again.");
                }}
            }});
        </script>
    </body>
    </html>
    """)

@app.post("/api/v1/join/{business_public_id}")
async def customer_signup(business_public_id: str, signup: CustomerSignup):
    business = get_business(business_public_id)
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    # ✅ FIXED: Case-insensitive status check for enum "ACTIVE"
    if business["status"].upper() != "ACTIVE":
        raise HTTPException(status_code=400, detail="Business not active")

    customer_public_id = generate_public_id()
    customer_data = {
        "business_id": business["id"],
        "public_id": customer_public_id,
        "name": signup.name,
        "phone": signup.phone,
        "stamp_count": 0,
        "reward_unlocked": False,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    supabase.table("customers").insert(customer_data).execute()

    return {
        "public_id": customer_public_id,
        "name": signup.name,
        "message": "Welcome to the loyalty program!",
    }

# ═════════════════════════════════════════════════════════════════════════════
# WALLET PAGE
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/wallet/{customer_public_id}", response_class=HTMLResponse)
async def customer_wallet_page(customer_public_id: str):
    customer = get_customer(customer_public_id)
    if not customer:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Card not found</h1>
            <p>This loyalty card does not exist.</p>
        </div>
        """)

    business = get_business_by_id(customer["business_id"])
    if not business:
        return HTMLResponse("""
        <div style="text-align:center;padding:40px;font-family:sans-serif;">
            <h1>Business not found</h1>
        </div>
        """)

    config_res = supabase.table("loyalty_configs").select("*").eq("business_id", business["id"]).single().execute()
    config = config_res.data or {}
    primary_color = config.get("primary_color", "#3b82f6")
    stamp_goal = config.get("stamp_goal", 8)
    reward_name = config.get("reward_name", "Free Service")

    stamps = customer.get("stamp_count", 0) % stamp_goal
    filled = stamps

    stars_html = ""
    for i in range(stamp_goal):
        if i < filled:
            stars_html += f'<span style="width:32px;height:32px;border-radius:16px;background:{primary_color};color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">★</span>'
        else:
            stars_html += f'<span style="width:32px;height:32px;border-radius:16px;background:rgba(255,255,255,0.25);color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;margin:3px;">★</span>'

    return HTMLResponse(f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>My {business["name"]} Card</title>
        <style>
            * {{ box-sizing: border-box; margin: 0; padding: 0; }}
            body {{
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                background: linear-gradient(135deg, {primary_color} 0%, #1e293b 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
            }}
            .card {{
                background: white;
                border-radius: 24px;
                padding: 32px;
                max-width: 400px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }}
            .loyalty-card {{
                background: linear-gradient(135deg, {primary_color} 0%, #14b8a6 100%);
                border-radius: 16px;
                padding: 24px;
                color: white;
                margin-bottom: 20px;
            }}
            .loyalty-card h2 {{ font-size: 20px; margin-bottom: 4px; }}
            .loyalty-card h3 {{ font-size: 16px; opacity: 0.9; margin-bottom: 8px; }}
            .loyalty-card .id {{ font-size: 12px; opacity: 0.7; font-family: monospace; }}
            .stars {{ margin: 16px 0; }}
            .stamp-count {{ font-size: 14px; margin-top: 8px; opacity: 0.9; }}
            .qr-section {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 16px;
            }}
            .qr-section img {{
                width: 160px;
                height: 160px;
                border-radius: 12px;
            }}
            .qr-section p {{ font-size: 12px; color: #94a3b8; margin-top: 8px; }}
            .wallet-btn {{
                display: block;
                width: 100%;
                padding: 14px;
                background: #1a73e8;
                color: white;
                text-decoration: none;
                border-radius: 10px;
                font-weight: 600;
                margin-bottom: 12px;
                text-align: center;
            }}
            .share-btn {{
                width: 100%;
                padding: 14px;
                background: #f0fdf4;
                color: #0d9488;
                border: 1px solid #a7f3d0;
                border-radius: 10px;
                font-weight: 600;
                cursor: pointer;
            }}
            .reward-badge {{
                display: inline-block;
                padding: 6px 14px;
                background: #fef3c7;
                color: #92400e;
                border-radius: 20px;
                font-size: 13px;
                font-weight: 600;
                margin-top: 12px;
            }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="loyalty-card">
                <h2>{business["name"]}</h2>
                <h3>{customer["name"]}</h3>
                <p class="id">ID: {customer["public_id"][:12]}...</p>
                <div class="stars">{stars_html}</div>
                <p class="stamp-count">{stamps} / {stamp_goal} stamps</p>
                {f'<span class="reward-badge">🎁 {reward_name} Ready!</span>' if customer.get("reward_unlocked") else ''}
            </div>

            <div class="qr-section">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data={customer["public_id"]}" alt="Your QR Code"/>
                <p>Scan at checkout to earn stamps</p>
            </div>

            <a href="https://pay.google.com/gp/v/save/{customer["public_id"]}" class="wallet-btn">
                🎫 Add to Google Wallet
            </a>

            <button onclick="navigator.share({{title: 'My Loyalty Card', text: 'My card for {business["name"]}', url: window.location.href}})" class="share-btn">
                🔗 Share Card
            </button>
        </div>
    </body>
    </html>
    """)

# ═════════════════════════════════════════════════════════════════════════════
# GOOGLE WALLET PASS
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/customer/{customer_public_id}/wallet-pass")
async def get_wallet_pass(customer_public_id: str):
    customer = get_customer(customer_public_id)
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = get_business_by_id(customer["business_id"])
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    config_res = supabase.table("loyalty_configs").select("*").eq("business_id", business["id"]).single().execute()
    config = config_res.data or {}

    pass_object = {
        "issuers": [{
            "issuerId": GOOGLE_WALLET_ISSUER_ID,
            "classSuffix": GOOGLE_WALLET_CLASS_SUFFIX,
        }],
        "loyaltyObjects": [{
            "id": f"{GOOGLE_WALLET_ISSUER_ID}.{customer_public_id}",
            "classId": f"{GOOGLE_WALLET_ISSUER_ID}.{GOOGLE_WALLET_CLASS_SUFFIX}",
            "state": "active",
            "barcode": {
                "type": "QR_CODE",
                "value": customer_public_id,
                "alternateText": customer["name"],
            },
            "accountId": customer_public_id,
            "accountName": customer["name"],
            "loyaltyPoints": {
                "label": "Stamps",
                "balance": {
                    "int": str(customer.get("stamp_count", 0)),
                }
            },
            "textModulesData": [
                {"header": "Business", "body": business["name"]},
                {"header": "Reward", "body": config.get("reward_name", "Free Service")},
            ],
        }]
    }

    return JSONResponse(pass_object)

# ═════════════════════════════════════════════════════════════════════════════
# HEALTH CHECK
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

# ═════════════════════════════════════════════════════════════════════════════
# ROOT
# ═════════════════════════════════════════════════════════════════════════════

@app.get("/")
async def root():
    return {"message": "LoyaltyTree API is running", "base_url": BASE_URL}
