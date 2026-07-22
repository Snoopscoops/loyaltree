
# ============================================================
# QR CODE GENERATION SYSTEM - LoyaltyPass
# ============================================================
# File: qr_system.py
# Generates unique QR codes for each business
# Customers scan → join loyalty program → add to wallet
# ============================================================

from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
import qrcode
import qrcode.image.svg
from io import BytesIO
import base64
import secrets
from datetime import datetime

# Assuming these models exist from the backend (imported or redefined)
# Business, Customer, LoyaltyProgram from main.py

# ============================================================
# QR CODE GENERATION
# ============================================================

def generate_business_qr_code(business_public_id: str, base_url: str) -> dict:
    """
    Generates a QR code for a business.
    When scanned, it opens the customer signup page.
    """

    # The URL that the QR code will open
    signup_url = f"{base_url}/join/{business_public_id}"

    # Generate QR code
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # High error correction (30%)
        box_size=10,
        border=4,
    )
    qr.add_data(signup_url)
    qr.make(fit=True)

    # Create SVG image (scalable, works on any device)
    factory = qrcode.image.svg.SvgImage
    img = qr.make_image(image_factory=factory)

    # Convert to base64 for embedding in web pages
    buffer = BytesIO()
    img.save(buffer)
    svg_base64 = base64.b64encode(buffer.getvalue()).decode()

    # Also generate PNG for print materials
    img_png = qr.make_image(fill_color="#1e293b", back_color="white")
    buffer_png = BytesIO()
    img_png.save(buffer_png, format='PNG')
    png_base64 = base64.b64encode(buffer_png.getvalue()).decode()

    return {
        "business_public_id": business_public_id,
        "signup_url": signup_url,
        "qr_svg_base64": f"data:image/svg+xml;base64,{svg_base64}",
        "qr_png_base64": f"data:image/png;base64,{png_base64}",
        "generated_at": datetime.utcnow().isoformat()
    }

# ============================================================
# API ENDPOINTS FOR QR CODE
# ============================================================

@app.get("/api/v1/business/{public_id}/qr-code")
def get_business_qr_code(
    public_id: str, 
    format: str = "svg",  # svg or png
    db: Session = Depends(get_db)
):
    """
    Owner dashboard: Get QR code for printing (table tent, receipt, window)
    """
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    if business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    # In production, base_url comes from environment variable
    base_url = "https://loyaltypass.io"

    qr_data = generate_business_qr_code(public_id, base_url)

    return {
        "qr_code": qr_data["qr_svg_base64"] if format == "svg" else qr_data["qr_png_base64"],
        "signup_url": qr_data["signup_url"],
        "print_instructions": {
            "recommended_size": "3x3 inches minimum for scanning",
            "placement": "Counter, receipt, table tent, window sticker",
            "call_to_action": "Scan to join our rewards program!"
        }
    }

# ============================================================
# CUSTOMER SIGNUP PAGE (What the QR opens)
# ============================================================

@app.get("/join/{business_public_id}")
def customer_signup_page(business_public_id: str, db: Session = Depends(get_db)):
    """
    This is the landing page customers see after scanning QR.
    Returns HTML that works on any phone browser.
    """

    business = db.query(Business).filter(Business.public_id == business_public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=404, detail="Business not found or inactive")

    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()

    # Return simple HTML page (in production, this is a React/Vue app)
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Join {business.name} Rewards</title>
        <style>
            body {{
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                margin: 0; padding: 20px;
                background: linear-gradient(135deg, {program.primary_color if program else '#3b82f6'} 0%, #1e293b 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }}
            .card {{
                background: white;
                border-radius: 20px;
                padding: 40px 30px;
                max-width: 380px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
            }}
            .logo {{
                width: 80px; height: 80px;
                background: {program.primary_color if program else '#3b82f6'};
                border-radius: 20px;
                margin: 0 auto 20px;
                display: flex; align-items: center; justify-content: center;
                color: white; font-size: 32px;
            }}
            h1 {{ margin: 0 0 8px 0; font-size: 24px; color: #1e293b; }}
            .subtitle {{ color: #64748b; margin-bottom: 30px; font-size: 15px; }}
            .reward-preview {{
                background: #f8fafc;
                border-radius: 12px;
                padding: 16px;
                margin-bottom: 24px;
                border: 2px dashed #e2e8f0;
            }}
            .reward-preview .emoji {{ font-size: 32px; margin-bottom: 8px; }}
            .reward-preview .text {{ font-weight: 600; color: #1e293b; }}
            .reward-preview .sub {{ font-size: 13px; color: #64748b; margin-top: 4px; }}
            input {{
                width: 100%; padding: 14px; margin-bottom: 12px;
                border: 2px solid #e2e8f0; border-radius: 10px;
                font-size: 16px; box-sizing: border-box;
            }}
            input:focus {{ outline: none; border-color: {program.primary_color if program else '#3b82f6'}; }}
            button {{
                width: 100%; padding: 16px;
                background: {program.primary_color if program else '#3b82f6'};
                color: white; border: none; border-radius: 10px;
                font-size: 16px; font-weight: 600; cursor: pointer;
            }}
            .terms {{ font-size: 11px; color: #94a3b8; margin-top: 16px; }}
        </style>
    </head>
    <body>
        <div class="card">
            <div class="logo">⭐</div>
            <h1>{business.name}</h1>
            <p class="subtitle">Join our rewards program</p>

            <div class="reward-preview">
                <div class="emoji">🎁</div>
                <div class="text">{program.reward_name if program else 'Free Reward'}</div>
                <div class="sub">After {program.stamp_goal if program else '8'} visits</div>
            </div>

            <form id="signupForm">
                <input type="text" id="name" placeholder="Your Name" required>
                <input type="tel" id="phone" placeholder="Phone Number" required>
                <input type="email" id="email" placeholder="Email (optional)">
                <button type="submit">Join & Add to Wallet</button>
            </form>

            <p class="terms">
                By joining, you agree to receive push notifications and SMS.<br>
                Unsubscribe anytime.
            </p>
        </div>

        <script>
            document.getElementById('signupForm').addEventListener('submit', async (e) => {{
                e.preventDefault();

                const response = await fetch('/api/v1/business/{business_public_id}/customers', {{
                    method: 'POST',
                    headers: {{'Content-Type': 'application/json'}},
                    body: JSON.stringify({{
                        name: document.getElementById('name').value,
                        phone: document.getElementById('phone').value,
                        email: document.getElementById('email').value || null
                    }})
                }});

                const data = await response.json();

                if (response.ok) {{
                    // Show "Add to Wallet" buttons
                    document.querySelector('.card').innerHTML = `
                        <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
                        <h1>Welcome, ${{data.name}}!</h1>
                        <p style="color: #64748b; margin-bottom: 24px;">Your loyalty card is ready</p>

                        <a href="/api/v1/business/{business_public_id}/wallet-pass/${{data.public_id}}/apple" 
                           style="display: block; background: #000; color: white; padding: 14px; border-radius: 10px; text-decoration: none; margin-bottom: 12px; font-weight: 600;">
                            🍎 Add to Apple Wallet
                        </a>

                        <a href="/api/v1/business/{business_public_id}/wallet-pass/${{data.public_id}}/google"
                           style="display: block; background: #4285f4; color: white; padding: 14px; border-radius: 10px; text-decoration: none; font-weight: 600;">
                            🤖 Add to Google Wallet
                        </a>

                        <p style="font-size: 12px; color: #94a3b8; margin-top: 16px;">
                            Show this card to your cashier on every visit to earn stamps.
                        </p>
                    `;
                }} else {{
                    alert('Error: ' + data.detail);
                }}
            }});
        </script>
    </body>
    </html>
    """

    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=html_content)

# ============================================================
# WALLET PASS GENERATION (Apple & Google)
# ============================================================

@app.get("/api/v1/business/{public_id}/wallet-pass/{customer_public_id}/apple")
def generate_apple_wallet_pass(public_id: str, customer_public_id: str, db: Session = Depends(get_db)):
    """
    Generates and serves a .pkpass file for Apple Wallet
    """
    business = db.query(Business).filter(Business.public_id == public_id).first()
    customer = db.query(Customer).filter(Customer.public_id == customer_public_id).first()

    if not business or not customer:
        raise HTTPException(status_code=404, detail="Not found")

    program = business.loyalty_program

    # In production: use passkit-generator or similar library
    # This returns a .pkpass file that iPhone opens directly in Wallet app

    # For now, return instructions
    return {
        "message": "Apple Wallet pass generation",
        "business": business.name,
        "customer": customer.name,
        "pass_type": "storeCard",
        "web_service_url": f"https://api.yourapp.com/api/v1/business/{public_id}/wallet-updates",
        "authentication_token": customer.pass_serial_number,
        "note": "In production, this endpoint returns a binary .pkpass file"
    }

@app.get("/api/v1/business/{public_id}/wallet-pass/{customer_public_id}/google")
def generate_google_wallet_pass(public_id: str, customer_public_id: str, db: Session = Depends(get_db)):
    """
    Generates and serves a Google Wallet pass
    """
    business = db.query(Business).filter(Business.public_id == public_id).first()
    customer = db.query(Customer).filter(Customer.public_id == customer_public_id).first()

    if not business or not customer:
        raise HTTPException(status_code=404, detail="Not found")

    # In production: use Google Wallet API to create pass object
    return {
        "message": "Google Wallet pass generation",
        "business": business.name,
        "customer": customer.name,
        "issuer_id": business.loyalty_program.google_issuer_id if business.loyalty_program else None,
        "class_id": business.loyalty_program.google_class_id if business.loyalty_program else None,
        "note": "In production, this redirects to Google Wallet save link"
    }

# ============================================================
# WALLET PASS UPDATE ENDPOINT (Apple/Google call this)
# ============================================================

@app.post("/api/v1/business/{public_id}/wallet-updates")
def wallet_pass_update_webhook(public_id: str, request: dict, db: Session = Depends(get_db)):
    """
    Apple/Google Wallet apps call this endpoint periodically to check for updates.
    When a stamp is added, we push an update here.
    """
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    # Apple sends: {"pushToken": "...", "passTypeIdentifier": "...", "serialNumbers": [...]}
    # Google sends similar payload

    # Return list of updated pass serial numbers
    # Wallet app will then request new pass data

    return {"serialNumbers": []}  # Empty = no updates
