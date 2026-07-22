# ============================================================
# LOYALTYTREE BACKEND - main.py
# ============================================================
# FastAPI + SQLAlchemy + SQLite (for quick start)
# Switch to PostgreSQL later by changing DATABASE_URL
# ============================================================

from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, ForeignKey, Enum, Text, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime, timedelta
from enum import Enum as PyEnum
from typing import Optional, List
import secrets
import qrcode
import qrcode.image.svg
from io import BytesIO
import base64
import os

# ============================================================
# DATABASE SETUP (SQLite for quick start)
# ============================================================

# For PostgreSQL later, change this to:
# DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./loyaltree.db")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./loyaltree.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
    echo=False
)

Base = declarative_base()
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
    PENDING = "pending"
    CONFIRMED = "confirmed"
    VOIDED = "voided"

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
    business_type = Column(String(50))
    status = Column(Enum(BusinessStatus), default=BusinessStatus.CREATED)
    plan = Column(String(20), default="starter")
    created_at = Column(DateTime, default=datetime.utcnow)

    loyalty_program = relationship("LoyaltyProgram", back_populates="business", uselist=False)
    staff = relationship("Staff", back_populates="business")
    customers = relationship("Customer", back_populates="business")
    stamps = relationship("Stamp", back_populates="business")

class LoyaltyProgram(Base):
    __tablename__ = "loyalty_programs"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"), unique=True)
    stamp_goal = Column(Integer, default=8)
    reward_name = Column(String(255), default="Free Service")
    reward_description = Column(Text)
    reward_value_cents = Column(Integer, default=0)
    stamp_expiry_days = Column(Integer, default=0)
    reward_expiry_days = Column(Integer, default=30)
    logo_url = Column(String(500))
    primary_color = Column(String(7), default="#3b82f6")
    secondary_color = Column(String(7), default="#1e293b")
    push_enabled = Column(Boolean, default=True)
    milestone_push = Column(Boolean, default=True)
    reward_unlocked_push = Column(Boolean, default=True)
    geofence_push = Column(Boolean, default=False)
    winback_push = Column(Boolean, default=True)
    winback_days = Column(Integer, default=30)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

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
    pin_hash = Column(String(255))
    invite_code = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))
    invite_used = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    business = relationship("Business", back_populates="staff")
    stamps_issued = relationship("Stamp", foreign_keys="Stamp.staff_id", back_populates="issued_by_staff")

class Customer(Base):
    __tablename__ = "customers"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))
    public_id = Column(String(32), unique=True, default=lambda: secrets.token_hex(16))
    name = Column(String(255))
    phone = Column(String(50), index=True)
    email = Column(String(255))
    birthday = Column(DateTime)
    pass_serial_number = Column(String(100), unique=True)
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
    stamp_number = Column(Integer)
    status = Column(Enum(StampStatus), default=StampStatus.CONFIRMED)
    transaction_id = Column(String(255))
    transaction_amount_cents = Column(Integer)
    payment_method = Column(String(50))
    can_void_until = Column(DateTime)
    voided_at = Column(DateTime)
    voided_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    void_reason = Column(Text)
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
    unlocked_by_stamp_ids = Column(JSON)
    status = Column(Enum(RewardStatus), default=RewardStatus.LOCKED)
    redeemed_at = Column(DateTime)
    redeemed_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    redemption_transaction_id = Column(String(255))
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer", back_populates="rewards")

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))
    action = Column(String(50))
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    performed_by_staff_id = Column(Integer, ForeignKey("staff.id"))
    details = Column(JSON)
    created_at = Column(DateTime, default=datetime.utcnow)

# ============================================================
# CREATE TABLES
# ============================================================

Base.metadata.create_all(bind=engine)

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
    birthday: Optional[str] = None

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
    staff_pin: str

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
    manager_pin: str

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(title="LoyaltyTree API", version="1.0.0")

# CORS - Update this with your actual Vercel URL after deploy
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://loyaltree-five.vercel.app",
        "https://loyaltree.vercel.app",
        "https://loyaltree-git-main.vercel.app",
        "http://localhost:3000",
        "*"  # Remove this in production, use specific origins
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# AUTH HELPERS
# ============================================================

def hash_password(password: str) -> str:
    import hashlib
    return hashlib.sha256(password.encode()).hexdigest()

def verify_password(password: str, hash: str) -> bool:
    return hash_password(password) == hash

# ============================================================
# API ENDPOINTS
# ============================================================

# ============================================================
# AUTH ENDPOINTS
# ============================================================

class LoginRequest(BaseModel):
    email: str
    password: str

@app.post("/api/v1/auth/login")
def login(request: LoginRequest, db: Session = Depends(get_db)):
    # Check business owner
    business = db.query(Business).filter(Business.email == request.email).first()
    if business and verify_password(request.password, business.password_hash):
        return {
            "token": secrets.token_hex(32),
            "role": "owner",
            "business_id": business.id,
            "business_name": business.name,
            "business_slug": business.public_id,
            "email": business.email
        }

    # Check staff
    staff = db.query(Staff).filter(Staff.email == request.email).first()
    if staff and verify_password(request.password, staff.pin_hash):
        business = db.query(Business).filter(Business.id == staff.business_id).first()
        return {
            "token": secrets.token_hex(32),
            "role": staff.role.value,
            "business_id": business.id,
            "business_name": business.name,
            "business_slug": business.public_id,
            "email": staff.email
        }

    raise HTTPException(status_code=401, detail="Invalid email or password")

@app.get("/")
def root():
    return {"message": "LoyaltyTree API is running", "version": "1.0.0"}

@app.get("/health")
def health_check():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post("/api/v1/business/signup", response_model=BusinessResponse, status_code=status.HTTP_201_CREATED)
def business_signup(request: BusinessSignupRequest, db: Session = Depends(get_db)):
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
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    business.status = BusinessStatus.PENDING_REVIEW
    db.commit()
    return {"status": "pending_review", "message": "Documents submitted. Review within 24-48 hours."}

@app.post("/api/v1/business/{public_id}/loyalty-program")
def configure_loyalty_program(public_id: str, config: LoyaltyProgramConfigRequest, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.VERIFIED:
        raise HTTPException(status_code=400, detail="Business not verified")

    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()
    if not program:
        program = LoyaltyProgram(business_id=business.id)
        db.add(program)

    for field, value in config.dict().items():
        setattr(program, field, value)

    program.is_active = True
    db.commit()
    db.refresh(program)

    return {"program_id": program.id, "stamp_goal": program.stamp_goal, "reward_name": program.reward_name, "status": "configured"}

@app.post("/api/v1/business/{public_id}/staff/invite", response_model=StaffResponse)
def invite_staff(public_id: str, request: StaffInviteRequest, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = Staff(
        business_id=business.id,
        name=request.name,
        email=request.email,
        phone=request.phone,
        role=request.role,
        pin_hash=hash_password("0000")
    )
    db.add(staff)
    db.commit()
    db.refresh(staff)
    return staff

@app.post("/api/v1/business/{public_id}/go-live")
def go_live(public_id: str, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()
    if not program or not program.is_active:
        raise HTTPException(status_code=400, detail="Loyalty program not configured")

    staff_count = db.query(Staff).filter(Staff.business_id == business.id, Staff.is_active == True).count()
    if staff_count == 0:
        raise HTTPException(status_code=400, detail="Add at least one staff member first")

    business.status = BusinessStatus.ACTIVE
    db.commit()

    return {
        "status": "active",
        "message": "Program is live!",
        "signup_qr_url": f"/api/v1/business/{public_id}/qr-code",
        "wallet_pass_url": f"/api/v1/business/{public_id}/wallet-pass"
    }

@app.post("/api/v1/business/{public_id}/customers", response_model=CustomerResponse)
def create_customer(public_id: str, request: CustomerSignupRequest, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    existing = db.query(Customer).filter(Customer.business_id == business.id, Customer.phone == request.phone).first()
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

@app.get("/api/v1/business/{public_id}/customers")
def list_customers(public_id: str, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customers = db.query(Customer).filter(Customer.business_id == business.id).all()
    program = business.loyalty_program

    result = []
    for c in customers:
        confirmed_stamps = db.query(Stamp).filter(Stamp.customer_id == c.id, Stamp.status == StampStatus.CONFIRMED).count()
        unlocked_rewards = db.query(Reward).filter(Reward.customer_id == c.id, Reward.status == RewardStatus.UNLOCKED).count()
        result.append({
            "id": c.id,
            "public_id": c.public_id,
            "name": c.name,
            "phone": c.phone,
            "stamp_count": confirmed_stamps,
            "reward_threshold": program.stamp_goal if program else 8,
            "reward_unlocked": unlocked_rewards > 0,
            "created_at": c.created_at
        })
    return result

@app.get("/api/v1/business/{public_id}/staff")
def list_staff(public_id: str, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    staff = db.query(Staff).filter(Staff.business_id == business.id).all()
    return [{"id": s.id, "public_id": s.public_id, "name": s.name, "email": s.email, "role": s.role.value, "is_active": s.is_active} for s in staff]

@app.get("/api/v1/business/{public_id}/stats")
def get_business_stats(public_id: str, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    total_customers = db.query(Customer).filter(Customer.business_id == business.id).count()
    active_cards = total_customers  # All enrolled customers have active cards
    stamps_issued = db.query(Stamp).filter(Stamp.business_id == business.id, Stamp.status == StampStatus.CONFIRMED).count()
    rewards_redeemed = db.query(Reward).filter(Reward.business_id == business.id, Reward.status == RewardStatus.REDEEMED).count()

    return {
        "total_customers": total_customers,
        "active_cards": active_cards,
        "stamps_issued": stamps_issued,
        "rewards_redeemed": rewards_redeemed
    }

@app.get("/api/v1/admin/businesses")
def list_all_businesses(db: Session = Depends(get_db)):
    businesses = db.query(Business).all()
    result = []
    for b in businesses:
        customer_count = db.query(Customer).filter(Customer.business_id == b.id).count()
        result.append({
            "id": b.id,
            "name": b.name,
            "status": b.status.value,
            "plan": b.plan,
            "customer_count": customer_count
        })
    return result

@app.get("/api/v1/admin/stats")
def get_admin_stats(db: Session = Depends(get_db)):
    total_businesses = db.query(Business).count()
    total_customers = db.query(Customer).count()
    total_stamps = db.query(Stamp).filter(Stamp.status == StampStatus.CONFIRMED).count()

    return {
        "total_businesses": total_businesses,
        "total_customers": total_customers,
        "total_stamps": total_stamps,
        "revenue": 0  # Placeholder - implement billing later
    }

@app.get("/api/v1/customer/{customer_public_id}/profile")
def get_customer_profile(customer_public_id: str, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.public_id == customer_public_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = customer.business
    program = business.loyalty_program if business else None
    confirmed_stamps = db.query(Stamp).filter(Stamp.customer_id == customer.id, Stamp.status == StampStatus.CONFIRMED).count()
    unlocked_rewards = db.query(Reward).filter(Reward.customer_id == customer.id, Reward.status == RewardStatus.UNLOCKED).count()

    return {
        "id": customer.id,
        "public_id": customer.public_id,
        "name": customer.name,
        "phone": customer.phone,
        "stamp_count": confirmed_stamps,
        "reward_threshold": program.stamp_goal if program else 8,
        "reward_unlocked": unlocked_rewards > 0
    }

@app.post("/api/v1/stamp/add")
def add_stamp_api(request: dict, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == request.get("customer_id")).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    business = customer.business
    program = business.loyalty_program if business else None

    existing_stamps = db.query(Stamp).filter(Stamp.customer_id == customer.id, Stamp.status == StampStatus.CONFIRMED).count()
    stamp_number = existing_stamps + 1

    stamp = Stamp(
        business_id=business.id,
        customer_id=customer.id,
        stamp_number=stamp_number,
        status=StampStatus.CONFIRMED,
        transaction_id=request.get("transaction_id", ""),
        transaction_amount_cents=int(request.get("amount", 0) * 100),
        can_void_until=datetime.utcnow() + timedelta(hours=24)
    )
    db.add(stamp)
    customer.total_stamps += 1
    customer.last_visit_at = datetime.utcnow()

    reward_unlocked = False
    if program and stamp_number % program.stamp_goal == 0:
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

    db.commit()

    return {
        "stamp_public_id": stamp.public_id,
        "stamps_current": customer.total_stamps,
        "stamps_needed": program.stamp_goal if program else 8,
        "reward_unlocked": reward_unlocked
    }

@app.post("/api/v1/reward/redeem")
def redeem_reward_api(request: dict, db: Session = Depends(get_db)):
    customer = db.query(Customer).filter(Customer.id == request.get("customer_id")).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    reward = db.query(Reward).filter(
        Reward.customer_id == customer.id,
        Reward.status == RewardStatus.UNLOCKED
    ).first()

    if not reward:
        raise HTTPException(status_code=400, detail="No unlocked reward found")

    reward.status = RewardStatus.REDEEMED
    reward.redeemed_at = datetime.utcnow()
    customer.total_rewards_redeemed += 1
    db.commit()

    return {
        "stamps_remaining": customer.total_stamps,
        "reward_redeemed": True
    }

@app.post("/api/v1/customer/join")
def customer_join(request: dict, db: Session = Depends(get_db)):
    business_slug = request.get("business_slug")
    business = db.query(Business).filter(Business.public_id == business_slug).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    existing = db.query(Customer).filter(Customer.business_id == business.id, Customer.phone == request.get("phone")).first()
    if existing:
        raise HTTPException(status_code=400, detail="Customer already enrolled")

    customer = Customer(
        business_id=business.id,
        name=request.get("name"),
        phone=request.get("phone"),
        email=request.get("email"),
        pass_serial_number=secrets.token_hex(16)
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)

    return {
        "public_id": customer.public_id,
        "name": customer.name,
        "phone": customer.phone
    }

@app.get("/api/v1/business/{public_id}/customers/{customer_public_id}")
def get_customer_card(public_id: str, customer_public_id: str, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    customer = db.query(Customer).filter(Customer.business_id == business.id, Customer.public_id == customer_public_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    confirmed_stamps = db.query(Stamp).filter(Stamp.customer_id == customer.id, Stamp.status == StampStatus.CONFIRMED).count()
    program = business.loyalty_program
    stamps_until_reward = program.stamp_goal - (confirmed_stamps % program.stamp_goal) if program else 8

    unlocked_rewards = db.query(Reward).filter(Reward.customer_id == customer.id, Reward.status == RewardStatus.UNLOCKED).all()

    return {
        "customer": {"name": customer.name, "phone": customer.phone, "member_since": customer.created_at},
        "program": {"business_name": business.name, "stamp_goal": program.stamp_goal if program else 8, "reward_name": program.reward_name if program else "Free Service", "primary_color": program.primary_color if program else "#3b82f6"},
        "stamps": {"total_confirmed": confirmed_stamps, "current_progress": confirmed_stamps % (program.stamp_goal if program else 8), "stamps_until_reward": stamps_until_reward, "reward_unlocked": len(unlocked_rewards) > 0},
        "unlocked_rewards": [{"public_id": r.public_id, "expires_at": r.expires_at} for r in unlocked_rewards]
    }

@app.post("/api/v1/business/{public_id}/stamps", response_model=StampResponse)
def add_stamp(public_id: str, request: StampRequest, db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    staff = db.query(Staff).filter(Staff.business_id == business.id, Staff.pin_hash == hash_password(request.staff_pin), Staff.is_active == True).first()
    if not staff:
        raise HTTPException(status_code=401, detail="Invalid staff PIN")

    customer = db.query(Customer).filter(Customer.business_id == business.id, Customer.public_id == request.customer_public_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    existing_stamps = db.query(Stamp).filter(Stamp.customer_id == customer.id, Stamp.status == StampStatus.CONFIRMED).count()
    stamp_number = existing_stamps + 1
    program = business.loyalty_program

    stamp = Stamp(
        business_id=business.id,
        customer_id=customer.id,
        staff_id=staff.id,
        stamp_number=stamp_number,
        status=StampStatus.CONFIRMED,
        transaction_id=request.transaction_id,
        transaction_amount_cents=request.transaction_amount_cents,
        payment_method=request.payment_method,
        can_void_until=datetime.utcnow() + timedelta(hours=24)
    )
    db.add(stamp)

    customer.total_stamps += 1
    customer.last_visit_at = datetime.utcnow()

    reward_unlocked = False
    if program and stamp_number % program.stamp_goal == 0:
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

    db.commit()
    db.refresh(stamp)

    return StampResponse(
        stamp_public_id=stamp.public_id,
        stamp_number=stamp_number,
        status=stamp.status,
        customer_name=customer.name,
        total_stamps_now=customer.total_stamps,
        stamps_until_reward=program.stamp_goal - (stamp_number % program.stamp_goal) if program and not reward_unlocked else (program.stamp_goal if program else 8),
        reward_unlocked=reward_unlocked
    )

@app.get("/api/v1/business/{public_id}/qr-code")
def get_business_qr_code(public_id: str, format: str = "svg", db: Session = Depends(get_db)):
    business = db.query(Business).filter(Business.public_id == public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Business not active")

    base_url = os.getenv("BASE_URL", "https://loyaltree-api.onrender.com")
    signup_url = f"{base_url}/join/{public_id}"

    qr = qrcode.QRCode(version=1, error_correction=qrcode.constants.ERROR_CORRECT_H, box_size=10, border=4)
    qr.add_data(signup_url)
    qr.make(fit=True)

    factory = qrcode.image.svg.SvgImage
    img = qr.make_image(image_factory=factory)
    buffer = BytesIO()
    img.save(buffer)
    svg_base64 = base64.b64encode(buffer.getvalue()).decode()

    return {
        "qr_code": f"data:image/svg+xml;base64,{svg_base64}",
        "signup_url": signup_url,
        "print_instructions": {"recommended_size": "3x3 inches", "placement": "Counter, receipt, table tent, window sticker", "call_to_action": "Scan to join our rewards program!"}
    }

@app.get("/join/{business_public_id}")
def customer_signup_page(business_public_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import HTMLResponse

    business = db.query(Business).filter(Business.public_id == business_public_id).first()
    if not business or business.status != BusinessStatus.ACTIVE:
        raise HTTPException(status_code=404, detail="Business not found or inactive")

    program = db.query(LoyaltyProgram).filter(LoyaltyProgram.business_id == business.id).first()

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Join {business.name} Rewards</title>
        <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: linear-gradient(135deg, {program.primary_color if program else '#3b82f6'} 0%, #1e293b 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
            .card {{ background: white; border-radius: 20px; padding: 40px 30px; max-width: 380px; width: 100%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; }}
            .logo {{ width: 80px; height: 80px; background: {program.primary_color if program else '#3b82f6'}; border-radius: 20px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px; }}
            h1 {{ margin: 0 0 8px 0; font-size: 24px; color: #1e293b; }}
            .subtitle {{ color: #64748b; margin-bottom: 30px; font-size: 15px; }}
            .reward-preview {{ background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 24px; border: 2px dashed #e2e8f0; }}
            .reward-preview .emoji {{ font-size: 32px; margin-bottom: 8px; }}
            .reward-preview .text {{ font-weight: 600; color: #1e293b; }}
            .reward-preview .sub {{ font-size: 13px; color: #64748b; margin-top: 4px; }}
            input {{ width: 100%; padding: 14px; margin-bottom: 12px; border: 2px solid #e2e8f0; border-radius: 10px; font-size: 16px; box-sizing: border-box; }}
            input:focus {{ outline: none; border-color: {program.primary_color if program else '#3b82f6'}; }}
            button {{ width: 100%; padding: 16px; background: {program.primary_color if program else '#3b82f6'}; color: white; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; }}
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
            <p class="terms">By joining, you agree to receive push notifications and SMS.<br>Unsubscribe anytime.</p>
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
                    document.querySelector('.card').innerHTML = `
                        <div style="font-size: 48px; margin-bottom: 16px;">🎉</div>
                        <h1>Welcome, ${{data.name}}!</h1>
                        <p style="color: #64748b; margin-bottom: 24px;">Your loyalty card is ready</p>
                        <div style="background: #f8fafc; border-radius: 12px; padding: 16px; margin-bottom: 16px;">
                            <p style="margin: 0; font-weight: 600;">Your Member ID</p>
                            <p style="margin: 4px 0 0 0; font-family: monospace; font-size: 14px; color: #64748b;">${{data.public_id}}</p>
                        </div>
                        <p style="font-size: 12px; color: #94a3b8;">Show this to your cashier on every visit to earn stamps.</p>
                    `;
                }} else {{
                    alert('Error: ' + data.detail);
                }}
            }});
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html_content)

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
