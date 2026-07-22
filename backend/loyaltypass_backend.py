
# ============================================================
# LOYALTYPASS PLATFORM - CORE BACKEND
# ============================================================
# File: main.py
# Stack: FastAPI + SQLAlchemy + PostgreSQL + Pydantic
# ============================================================

from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, ForeignKey, Enum, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta
from enum import Enum as PyEnum
from typing import Optional, List
import uuid
import hashlib
import secrets

# ============================================================
# DATABASE SETUP
# ============================================================

Base = declarative_base()
engine = create_engine("postgresql://user:pass@localhost/loyaltypass", echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ============================================================
# ENUMS
# ============================================================

class BusinessStatus(str, PyEnum):
    CREATED = "created"
    PENDING_REVIEW = "pending_review"
    VERIFIED = "verified"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    CANCELLED = "cancelled"

class StaffRole(str, PyEnum):
    OWNER = "owner"
    MANAGER = "manager"
    CASHIER = "cashier"

class StampStatus(str, PyEnum):
    PENDING = "pending"           # Added to cart, not paid yet
    CONFIRMED = "confirmed"       # Paid, locked
    VOIDED = "voided"             # Refunded/reversed within 24h

class RewardStatus(str, PyEnum):
    LOCKED = "locked"
    UNLOCKED = "unlocked"
    REDEEMED = "redeemed"
    EXPIRED = "expired"

# ============================================================
# DATABASE MODELS
# ============================================================

class Business(Base):
    __tablename__ = "businesses"

    id = Column(Integer, primary_key=True, index=True)
    public_id = Column(String(32), unique=True, index=True, default=lambda: secrets.token_hex(16))
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    phone = Column(String(50))

    # Business info
    business_type = Column(String(50))  # salon, spa, fitness, auto, dental, etc.
    tax_id = Column(String(50))
    address = Column(Text)
    city = Column(String(100))
    state = Column(String(50))
    zip_code = Column(String(20))
    country = Column(String(50), default="US")

    # Verification & status
    status = Column(Enum(BusinessStatus), default=BusinessStatus.CREATED)
    verified_at = Column(DateTime)
    verification_documents = Column(JSON, default=dict)  # {id_front_url, id_back_url, business_license_url}

    # Plan & billing
    plan = Column(String(20), default="starter")  # starter, growth, pro, enterprise
    billing_starts_at = Column(DateTime)
    payment_method_id = Column(String(100))  # Stripe payment method ID

    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    suspended_at = Column(DateTime)
    suspended_reason = Column(Text)

    # Relationships
    loyalty_program = relationship("LoyaltyProgram", back_populates="business", uselist=False)
    staff = relationship("Staff", back_populates="business")
    customers = relationship("Customer", back_populates="business")
    stamps = relationship("Stamp", back_populates="business")
    audit_logs = relationship("AuditLog", back_populates="business")

class LoyaltyProgram(Base):
    __tablename__ = "loyalty_programs"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"), unique=True)

    # Program rules
    stamp_goal = Column(Integer, default=8)  # e.g., 8 stamps = 1 reward
    reward_name = Column(String(255), default="Free Service")
    reward_description = Column(Text)
    reward_value_cents = Column(Integer, default=0)  # Monetary value for analytics

    # Expiry rules
    stamp_expiry_days = Column(Integer, default=0)  # 0 = never expires
    reward_expiry_days = Column(Integer, default=30)

    # Branding
    logo_url = Column(String(500))
    primary_color = Column(String(7), default="#3b82f6")
    secondary_color = Column(String(7), default="#1e293b")
    pass_template = Column(String(50), default="default")

    # Push notification settings
    push_enabled = Column(Boolean, default=True)
    milestone_push = Column(Boolean, default=True)  # "3 more visits!"
    reward_unlocked_push = Column(Boolean, default=True)
    geofence_push = Column(Boolean, default=False)
    winback_push = Column(Boolean, default=True)
    winback_days = Column(Integer, default=30)

    # Wallet pass IDs
    apple_pass_type_id = Column(String(100))
    google_issuer_id = Column(String(100))
    google_class_id = Column(String(100))

    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    business = relationship("Business", back_populates="loyalty_program")

class Staff(Base):
    __tablename__ = "staff"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))
    public_id = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))

    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False)
    phone = Column(String(50))
    role = Column(Enum(StaffRole), default=StaffRole.CASHIER)

    # Security
    pin_hash = Column(String(255))  # For stamp authorization
    invite_code = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))
    invite_used = Column(Boolean, default=False)

    # Device tracking
    device_id = Column(String(255))
    last_login_at = Column(DateTime)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    business = relationship("Business", back_populates="staff")
    stamps_issued = relationship("Stamp", back_populates="issued_by_staff")

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))
    public_id = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))

    # Minimal data - privacy first
    name = Column(String(255))
    phone = Column(String(50), index=True)
    email = Column(String(255))
    birthday = Column(DateTime)

    # Wallet pass tracking
    apple_device_token = Column(String(255))
    google_device_token = Column(String(255))
    pass_serial_number = Column(String(100), unique=True)
    pass_installed_at = Column(DateTime)

    # Engagement
    total_stamps = Column(Integer, default=0)
    total_rewards_earned = Column(Integer, default=0)
    total_rewards_redeemed = Column(Integer, default=0)
    last_visit_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    business = relationship("Business", back_populates="customers")
    stamps = relationship("Stamp", back_populates="customer")
    rewards = relationship("Reward", back_populates="customer")

class Stamp(Base):
    __tablename__ = "stamps"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))

    business_id = Column(Integer, ForeignKey("businesses.id"))
    customer_id = Column(Integer, ForeignKey("customers.id"))
    staff_id = Column(Integer, ForeignKey("staff.id"))

    # Stamp details
    stamp_number = Column(Integer)  # 1st, 2nd, 3rd stamp for this customer
    status = Column(Enum(StampStatus), default=StampStatus.PENDING)

    # Payment linkage (CRITICAL for fraud protection)
    transaction_id = Column(String(255))  # POS transaction ID or payment reference
    transaction_amount_cents = Column(Integer)
    payment_method = Column(String(50))  # cash, card, etc.

    # Void protection
    can_void_until = Column(DateTime)  # 24h window
    voided_at = Column(DateTime)
    voided_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    void_reason = Column(Text)

    # Location
    device_gps_lat = Column(String(20))
    device_gps_lng = Column(String(20))

    created_at = Column(DateTime, default=datetime.utcnow)

    business = relationship("Business", back_populates="stamps")
    customer = relationship("Customer", back_populates="stamps")
    issued_by_staff = relationship("Staff", foreign_keys=[staff_id], back_populates="stamps_issued")

class Reward(Base):
    __tablename__ = "rewards"

    id = Column(Integer, primary_key=True)
    public_id = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))

    business_id = Column(Integer, ForeignKey("businesses.id"))
    customer_id = Column(Integer, ForeignKey("customers.id"))

    # Which stamps unlocked this
    unlocked_by_stamp_ids = Column(JSON)  # List of stamp IDs

    status = Column(Enum(RewardStatus), default=RewardStatus.LOCKED)

    # Redemption
    redeemed_at = Column(DateTime)
    redeemed_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    redemption_transaction_id = Column(String(255))

    # Expiry
    expires_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer", back_populates="rewards")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))

    action = Column(String(50))  # stamp_added, stamp_voided, reward_redeemed, etc.
    entity_type = Column(String(50))  # stamp, reward, customer, staff
    entity_id = Column(Integer)

    performed_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    details = Column(JSON)

    ip_address = Column(String(50))
    user_agent = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)

    business = relationship("Business", back_populates="audit_logs")

# ============================================================
# PYDANTIC SCHEMAS
# ============================================================

class BusinessSignupRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8)
    phone: Optional[str] = None
    business_type: str
    plan: str = "starter"

class BusinessResponse(BaseModel):
    public_id: str
    name: str
    email: str
    status: BusinessStatus
    plan: str
    created_at: datetime

    class Config:
        from_attributes = True

class LoyaltyProgramConfigRequest(BaseModel):
    stamp_goal: int = Field(..., ge=3, le=20)
    reward_name: str = Field(..., min_length=1, max_length=255)
    reward_description: Optional[str] = None
    reward_value_cents: Optional[int] = Field(None, ge=0)
    stamp_expiry_days: int = Field(0, ge=0)
    reward_expiry_days: int = Field(30, ge=1)
    primary_color: str = "#3b82f6"
    secondary_color: str = "#1e293b"
    milestone_push: bool = True
    reward_unlocked_push: bool = True

class StaffInviteRequest(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    role: StaffRole = StaffRole.CASHIER

class StaffResponse(BaseModel):
    public_id: str
    name: str
    email: str
    role: StaffRole
    invite_code: str
    is_active: bool

    class Config:
        from_attributes = True

class CustomerSignupRequest(BaseModel):
    name: str
    phone: str
    email: Optional[str] = None
    birthday: Optional[str] = None  # YYYY-MM-DD

class CustomerResponse(BaseModel):
    public_id: str
    name: str
    phone: str
    total_stamps: int
    total_rewards_earned: int
    total_rewards_redeemed: int
    last_visit_at: Optional[datetime]

    class Config:
        from_attributes = True

class StampRequest(BaseModel):
    customer_public_id: str
    transaction_id: str
    transaction_amount_cents: int
    payment_method: str = "cash"
    staff_pin: str  # Cashier enters their PIN to authorize

class StampResponse(BaseModel):
    stamp_public_id: str
    stamp_number: int
    status: StampStatus
    customer_name: str
    total_stamps_now: int
    stamps_until_reward: int
    reward_unlocked: bool

    class Config:
        from_attributes = True

class VoidStampRequest(BaseModel):
    stamp_public_id: str
    reason: str = Field(..., min_length=5)
    manager_pin: str  # Requires manager role to void

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(title="LoyaltyPass Platform API", version="1.0.0")
security = HTTPBearer()

# ============================================================
# AUTH HELPERS
# ============================================================

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hash: str) -> bool:
    return hash_password(password) == hash

def create_access_token(business_id: int) -> str:
    # In production: use JWT with expiration
    return secrets.token_urlsafe(32)

def get_current_business(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    # Simplified: in production, decode JWT and verify
    token = credentials.credentials
    # Mock: find business by token lookup
    business = db.query(Business).filter(Business.status == BusinessStatus.ACTIVE).first()
    if not business:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return business

# ============================================================
# API ENDPOINTS
# ============================================================

@app.post("/api/v1/business/signup", response_model=BusinessResponse, status_code=status.HTTP_201_CREATED)
def business_signup(request: BusinessSignupRequest, db: Session = Depends(get_db)):
    """Step 1: Business creates account"""

    # Check email exists
    if db.query(Business).filter(Business.email == request.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    business = Business(
        name=request.name,
        email=request.email,
        password_hash=hash_password(request.password),
        phone=request.phone,
        business_type=request.business_type,
        plan=request.plan,
        status=BusinessStatus.CREATED
    )
    db.add(business)
    db.commit()
    db.refresh(business)

    return business

@app.post("/api/v1/business/{public_id}/verify")
def submit_verification(public_id: str, documents: dict, db: Session = Depends(get_db)):
    """Step 2: Business submits verification docs"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    business.verification_documents = documents
    business.status = BusinessStatus.PENDING_REVIEW
    db.commit()

    # In production: trigger admin review workflow
    return {"status": "pending_review", "message": "Documents submitted. Review within 24-48 hours."}

@app.post("/api/v1/business/{public_id}/loyalty-program")
def configure_loyalty_program(
    public_id: str,
    config: LoyaltyProgramConfigRequest,
    db: Session = Depends(get_db)
):
    """Step 3: Configure loyalty program rules"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.VERIFIED:
        raise HTTPException(status_code=400, detail="Business not verified")

    # Create or update program
    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()
    if not program:
        program = LoyaltyProgram(business_id=business.id)
        db.add(program)

    for field, value in config.dict().items():
        setattr(program, field, value)

    program.is_active = True
    db.commit()
    db.refresh(program)

    return {
        "program_id": program.id,
        "stamp_goal": program.stamp_goal,
        "reward_name": program.reward_name,
        "status": "configured"
    }

@app.post("/api/v1/business/{public_id}/staff/invite", response_model=StaffResponse)
def invite_staff(public_id: str, request: StaffInviteRequest, db: Session = Depends(get_db)):
    """Step 4: Invite staff/cashiers"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = Staff(
        business_id=business.id,
        name=request.name,
        email=request.email,
        phone=request.phone,
        role=request.role,
        pin_hash=hash_password("0000")  # Default PIN, staff changes on first login
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)

    # In production: send SMS/email with invite code and app download link

    return staff

@app.post("/api/v1/business/{public_id}/go-live")
def go_live(public_id: str, db: Session = Depends(get_db)):
    """Step 5: Activate program - now customers can join"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()
    if not program or not program.is_active:
        raise HTTPException(status_code=400, detail="Loyalty program not configured")

    # Check if at least one staff exists
    staff_count = db.query(Staff).filter(Staff.business_id == business.id, Staff.is_active == True).count()
    if staff_count == 0:
        raise HTTPException(status_code=400, detail="Add at least one staff member first")

    business.status = BusinessStatus.ACTIVE
    business.billing_starts_at = datetime.utcnow()
    db.commit()

    # In production: generate Apple/Google Wallet pass templates

    return {
        "status": "active",
        "message": "Program is live!",
        "signup_qr_url": f"/api/v1/business/{public_id}/qr-signup",
        "wallet_pass_url": f"/api/v1/business/{public_id}/wallet-pass"
    }

# ============================================================
# CUSTOMER ENDPOINTS
# ============================================================

@app.post("/api/v1/business/{public_id}/customers", response_model=CustomerResponse)
def create_customer(public_id: str, request: CustomerSignupRequest, db: Session = Depends(get_db)):
    """Customer joins loyalty program (in-store or online)"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    # Check if customer already exists by phone
    existing = db.query(Customer).filter(
        Customer.business_id == business.id,
        Customer.phone == request.phone
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Customer already enrolled")

    customer = Customer(
        business_id=business.id,
        name=request.name,
        phone=request.phone,
        email=request.email,
        pass_serial_number=secrets.token_hex(16)
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)

    return customer

@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}")
def get_customer_card(public_id: str, customer_public_id: str, db: Session = Depends(get_db)):
    """Get customer loyalty card data (for wallet display)"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = db.query(Customer).filter(
        Customer.business_id == business.id,
        Customer.public_id == customer_public_id
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Count confirmed stamps
    confirmed_stamps = db.query(Stamp).filter(
        Stamp.customer_id == customer.id,
        Stamp.status == StampStatus.CONFIRMED
    ).count()

    program = business.loyalty_program
    stamps_until_reward = program.stamp_goal - (confirmed_stamps % program.stamp_goal)

    # Check for unlocked rewards
    unlocked_rewards = db.query(Reward).filter(
        Reward.customer_id == customer.id,
        Reward.status == RewardStatus.UNLOCKED
    ).all()

    return {
        "customer": {
            "name": customer.name,
            "phone": customer.phone,
            "member_since": customer.created_at
        },
        "program": {
            "business_name": business.name,
            "stamp_goal": program.stamp_goal,
            "reward_name": program.reward_name,
            "primary_color": program.primary_color
        },
        "stamps": {
            "total_confirmed": confirmed_stamps,
            "current_progress": confirmed_stamps % program.stamp_goal,
            "stamps_until_reward": stamps_until_reward,
            "reward_unlocked": len(unlocked_rewards) > 0
        },
        "unlocked_rewards": [
            {"public_id": r.public_id, "expires_at": r.expires_at} for r in unlocked_rewards
        ]
    }

# ============================================================
# STAMP ENGINE (THE CORE)
# ============================================================

@app.post("/api/v1/business/{public_id}/stamps", response_model=StampResponse)
def add_stamp(public_id: str, request: StampRequest, db: Session = Depends(get_db)):
    """
    Cashier scans customer QR, enters transaction details, adds stamp.
    CRITICAL: Stamp is CONFIRMED only if payment is recorded.
    """

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    # Verify cashier PIN
    staff = db.query(Staff).filter(
        Staff.business_id == business.id,
        Staff.pin_hash == hash_password(request.staff_pin),
        Staff.is_active == True
    ).first()

    if not staff:
        raise HTTPException(status_code=401, detail="Invalid staff PIN")

    # Find customer
    customer = db.query(Customer).filter(
        Customer.business_id == business.id,
        Customer.public_id == request.customer_public_id
    ).first()

    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Count existing confirmed stamps
    existing_stamps = db.query(Stamp).filter(
        Stamp.customer_id == customer.id,
        Stamp.status == StampStatus.CONFIRMED
    ).count()

    stamp_number = existing_stamps + 1
    program = business.loyalty_program

    # Create stamp
    stamp = Stamp(
        business_id=business.id,
        customer_id=customer.id,
        staff_id=staff.id,
        stamp_number=stamp_number,
        status=StampStatus.CONFIRMED,  # Directly confirmed because transaction_id is required
        transaction_id=request.transaction_id,
        transaction_amount_cents=request.transaction_amount_cents,
        payment_method=request.payment_method,
        can_void_until=datetime.utcnow() + timedelta(hours=24)
    )
    db.add(stamp)

    # Update customer stats
    customer.total_stamps += 1
    customer.last_visit_at = datetime.utcnow()

    # Check if reward unlocked
    reward_unlocked = False
    stamps_in_current_cycle = stamp_number % program.stamp_goal

    if stamps_in_current_cycle == 0:
        # Reward unlocked!
        reward = Reward(
            business_id=business.id,
            customer_id=customer.id,
            unlocked_by_stamp_ids=[stamp.id],
            status=RewardStatus.UNLOCKED,
            expires_at=datetime.utcnow() + timedelta(days=program.reward_expiry_days)
        )
        db.add(reward)
        customer.total_rewards_earned += 1
        reward_unlocked = True

        # In production: send push notification "Reward unlocked!"

    # Audit log
    audit = AuditLog(
        business_id=business.id,
        action="stamp_added",
        entity_type="stamp",
        performed_by_staff_id=staff.id,
        details={
            "stamp_number": stamp_number,
            "transaction_id": request.transaction_id,
            "amount_cents": request.transaction_amount_cents
        }
    )
    db.add(audit)

    db.commit()
    db.refresh(stamp)

    return StampResponse(
        stamp_public_id=stamp.public_id,
        stamp_number=stamp_number,
        status=stamp.status,
        customer_name=customer.name,
        total_stamps_now=customer.total_stamps,
        stamps_until_reward=program.stamp_goal - (stamp_number % program.stamp_goal) if not reward_unlocked else program.stamp_goal,
        reward_unlocked=reward_unlocked
    )

@app.post("/api/v1/business/{public_id}/stamps/void")
def void_stamp(public_id: str, request: VoidStampRequest, db: Session = Depends(get_db)):
    """
    Manager voids a stamp within 24h window.
    Requires manager PIN. Reverses reward if it was unlocked.
    """

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    # Verify manager PIN
    manager = db.query(Staff).filter(
        Staff.business_id == business.id,
        Staff.pin_hash == hash_password(request.manager_pin),
        Staff.role.in_([StaffRole.MANAGER, StaffRole.OWNER]),
        Staff.is_active == True
    ).first()

    if not manager:
        raise HTTPException(status_code=403, detail="Manager authorization required")

    stamp = db.query(Stamp).filter(
        Stamp.business_id == business.id,
        Stamp.public_id == request.stamp_public_id
    ).first()

    if not stamp:
        raise HTTPException(status_code=404, detail="Stamp not found")

    if stamp.status != StampStatus.CONFIRMED:
        raise HTTPException(status_code=400, detail="Stamp already voided or pending")

    if datetime.utcnow() > stamp.can_void_until:
        raise HTTPException(status_code=400, detail="Void window expired (24h)")

    # Void the stamp
    stamp.status = StampStatus.VOIDED
    stamp.voided_at = datetime.utcnow()
    stamp.voided_by_staff_id = manager.id
    stamp.void_reason = request.reason

    # Reverse customer stats
    customer = stamp.customer
    customer.total_stamps -= 1

    # If this stamp unlocked a reward, reverse it
    reward = db.query(Reward).filter(
        Reward.customer_id == customer.id,
        Reward.status == RewardStatus.UNLOCKED
    ).order_by(Reward.created_at.desc()).first()

    if reward and stamp.id in (reward.unlocked_by_stamp_ids or []):
        reward.status = RewardStatus.LOCKED  # Or delete it
        customer.total_rewards_earned -= 1

    # Audit log
    audit = AuditLog(
        business_id=business.id,
        action="stamp_voided",
        entity_type="stamp",
        entity_id=stamp.id,
        performed_by_staff_id=manager.id,
        details={"reason": request.reason, "original_transaction": stamp.transaction_id}
    )
    db.add(audit)

    db.commit()

    return {"status": "voided", "stamp_public_id": stamp.public_id}

# ============================================================
# REDEMPTION
# ============================================================

@app.post("/api/v1/business/{public_id}/rewards/{reward_public_id}/redeem")
def redeem_reward(public_id: str, reward_public_id: str, staff_pin: str, transaction_id: str, db: Session = Depends(get_db)):
    """Cashier redeems an unlocked reward at checkout"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = db.query(Staff).filter(
        Staff.business_id == business.id,
        Staff.pin_hash == hash_password(staff_pin),
        Staff.is_active == True
    ).first()

    if not staff:
        raise HTTPException(status_code=401, detail="Invalid PIN")

    reward = db.query(Reward).filter(
        Reward.business_id == business.id,
        Reward.public_id == reward_public_id
    ).first()

    if not reward or reward.status != RewardStatus.UNLOCKED:
        raise HTTPException(status_code=400, detail="Reward not available")

    if reward.expires_at and datetime.utcnow() > reward.expires_at:
        reward.status = RewardStatus.EXPIRED
        db.commit()
        raise HTTPException(status_code=400, detail="Reward expired")

    reward.status = RewardStatus.REDEEMED
    reward.redeemed_at = datetime.utcnow()
    reward.redeemed_by_staff_id = staff.id
    reward.redemption_transaction_id = transaction_id

    reward.customer.total_rewards_redeemed += 1

    db.commit()

    return {
        "status": "redeemed",
        "reward_public_id": reward.public_id,
        "redeemed_at": reward.redeemed_at,
        "customer_name": reward.customer.name
    }

# ============================================================
# FRAUD DETECTION (Owner Dashboard Alert)
# ============================================================

@app.get("/api/v1/business/{public_id}/fraud-alerts")
def get_fraud_alerts(public_id: str, db: Session = Depends(get_db)):
    """Owner dashboard: suspicious activity flags"""

    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    alerts = []

    # Alert 1: Unusual stamp velocity (>10 stamps by same cashier in 1 hour)
    one_hour_ago = datetime.utcnow() - timedelta(hours=1)
    suspicious_cashiers = db.query(Stamp.staff_id).filter(
        Stamp.business_id == business.id,
        Stamp.created_at >= one_hour_ago
    ).group_by(Stamp.staff_id).having(db.func.count() > 10).all()

    for (staff_id,) in suspicious_cashiers:
        staff = db.query(Staff).filter(Staff.id == staff_id).first()
        alerts.append({
            "type": "high_velocity",
            "severity": "high",
            "message": f"Staff {staff.name} issued >10 stamps in 1 hour",
            "staff_id": staff.public_id
        })

    # Alert 2: After-hours activity
    business_hours_start = 8  # 8 AM
    business_hours_end = 20   # 8 PM
    current_hour = datetime.utcnow().hour

    if current_hour < business_hours_start or current_hour > business_hours_end:
        after_hours_stamps = db.query(Stamp).filter(
            Stamp.business_id == business.id,
            Stamp.created_at >= datetime.utcnow() - timedelta(hours=1)
        ).count()

        if after_hours_stamps > 0:
            alerts.append({
                "type": "after_hours",
                "severity": "medium",
                "message": f"{after_hours_stamps} stamps issued outside business hours",
                "count": after_hours_stamps
            })

    # Alert 3: Same customer scanned >3x same day
    today = datetime.utcnow().date()
    repeat_customers = db.query(Stamp.customer_id).filter(
        Stamp.business_id == business.id,
        db.func.date(Stamp.created_at) == today
    ).group_by(Stamp.customer_id).having(db.func.count() > 3).all()

    for (customer_id,) in repeat_customers:
        customer = db.query(Customer).filter(Customer.id == customer_id).first()
        alerts.append({
            "type": "repeat_customer",
            "severity": "low",
            "message": f"Customer {customer.name} scanned {customer.total_stamps} times today",
            "customer_id": customer.public_id
        })

    # Alert 4: Stamps without transaction IDs
    missing_tx = db.query(Stamp).filter(
        Stamp.business_id == business.id,
        Stamp.status == StampStatus.CONFIRMED,
        Stamp.transaction_id.is_(None)
    ).count()

    if missing_tx > 0:
        alerts.append({
            "type": "missing_transaction",
            "severity": "high",
            "message": f"{missing_tx} confirmed stamps have no linked transaction",
            "count": missing_tx
        })

    return {"alerts": alerts, "total": len(alerts), "generated_at": datetime.utcnow()}

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    # Create tables
    Base.metadata.create_all(bind=engine)
    uvicorn.run(app, host="0.0.0.0", port=8000)
