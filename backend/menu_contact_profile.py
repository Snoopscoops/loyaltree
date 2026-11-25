"""Private checkout contacts. Legacy card tokens can request a new email OTP,
but cannot read or write phone/address data without a fresh profile grant."""
import hashlib
import hmac
import html
import re
import secrets
import time

from fastapi import Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

class ContactCode(BaseModel):
    challenge_id: str = Field(min_length=32,max_length=32,pattern=r'^[a-f0-9]{32}$')
    code: str = Field(min_length=6,max_length=6,pattern=r'^[0-9]{6}$')

class Address(BaseModel):
    id: str = Field(min_length=1,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')
    label: str = Field(min_length=1,max_length=40)
    address: str = Field(min_length=5,max_length=500)

class ContactProfile(BaseModel):
    phone: str = Field(max_length=32)
    addresses: list[Address] = Field(default_factory=list,max_length=10)
    default_address_id: str = Field(default='',max_length=64)

def clean_phone(value):
    value = str(value or '').strip()
    if not re.fullmatch(r'\+?[0-9 ()-]{7,32}',value) or not 7 <= len(re.sub(r'\D','',value)) <= 15:
        raise HTTPException(422,'Enter a valid mobile number.')
    return value

def register_menu_contact_routes(app, *, db, business_for, send_email, read_token, sign, secret):
    def response(body):
        return JSONResponse(body,headers={'Cache-Control':'private, no-store','Pragma':'no-cache'})

    def identity(public_id, authorization, kind):
        business = business_for(public_id)
        parts = authorization.split(' ',1)
        if len(parts)!=2 or parts[0].lower()!='bearer':
            raise HTTPException(401,'Connect and verify your loyalty card.')
        claim = read_token(parts[1],kind)
        if str(claim.get('business_public_id')) != str(business['public_id']):
            raise HTTPException(401,'Reconnect your loyalty card.')
        customer_id = str(claim.get('customer_public_id') or '')
        try:
            rows = db.table('customers').select('public_id,business_id,name,email,phone,address').eq('business_id',business['id']).eq('public_id',customer_id).limit(1).execute().data or []
        except Exception:
            raise HTTPException(503,'Contact profile is temporarily unavailable.')
        customer = rows[0] if rows else {}
        email = str(customer.get('email') or '').strip().lower()
        if not customer_id or str(customer.get('public_id')) != customer_id or str(customer.get('business_id')) != str(business['id']) or not email:
            raise HTTPException(401,'Reconnect your loyalty card.')
        if not hmac.compare_digest(email,str(claim.get('email') or '').strip().lower()):
            raise HTTPException(401,'Reconnect your loyalty card.')
        return business, customer, email

    def digest(business, customer, email, challenge, code):
        return hmac.new(secret(),('\x1f'.join(['menu-contact-v1',str(business['id']),str(customer['public_id']),email,challenge,code])).encode(),hashlib.sha256).hexdigest()

    def rpc(name, business, customer, challenge, code_digest):
        try:
            return db.rpc(name,{'p_business':str(business['id']),'p_customer':str(customer['public_id']),'p_challenge':challenge,'p_digest':code_digest}).execute().data is True
        except Exception:
            raise HTTPException(503,'Secure contact saving is temporarily unavailable.')

    def saved_profile(business, customer):
        try:
            rows = db.table('menu_contact_profiles').select('phone,addresses,default_address_id').eq('business_id',str(business['id'])).eq('customer_public_id',str(customer['public_id'])).limit(1).execute().data or []
        except Exception:
            raise HTTPException(503,'Saved contact details are temporarily unavailable.')
        if rows:
            row=rows[0]
            return dict(name=str(customer.get('name') or ''),phone=row.get('phone') or '',addresses=row.get('addresses') or [],default_address_id=row.get('default_address_id') or '')
        address=str(customer.get('address') or '').strip()[:500]
        addresses=[{'id':'registered','label':'Registered address','address':address}] if address else []
        return dict(name=str(customer.get('name') or ''),phone=str(customer.get('phone') or '')[:32],addresses=addresses,default_address_id='registered' if addresses else '')

    @app.post('/api/v1/public/menu/{public_id}/card/contact/request')
    def request_contact(public_id: str, authorization: str=Header(default='')):
        business,customer,email=identity(public_id,authorization,'session')
        challenge=secrets.token_hex(16)
        code=f'{secrets.randbelow(1000000):06d}'
        if not rpc('menu_contact_issue',business,customer,challenge,digest(business,customer,email,challenge,code)):
            raise HTTPException(429,'Please wait before requesting another code.')
        try:
            sent=send_email(email,'Verify your LoyaltyTree contact details',f'<p>Your code is <strong>{html.escape(code)}</strong>. It expires in 10 minutes. Only enter this on your checkout screen.</p>')
        except Exception:
            sent=False
        if not sent:
            raise HTTPException(503,'Could not send the code. Please try again in a minute.')
        return response({'challenge_id':challenge,'expires_in':600})

    @app.post('/api/v1/public/menu/{public_id}/card/contact/verify')
    def verify_contact(public_id: str, body: ContactCode, authorization: str=Header(default='')):
        business,customer,email=identity(public_id,authorization,'session')
        if not rpc('menu_contact_verify',business,customer,body.challenge_id,digest(business,customer,email,body.challenge_id,body.code)):
            raise HTTPException(401,'Invalid or expired code. Request a new one if needed.')
        token=sign(dict(kind='contact_session',business_public_id=str(business['public_id']),customer_public_id=str(customer['public_id']),email=email,exp=int(time.time())+12*3600))
        return response({'token':token,'profile':saved_profile(business,customer)})

    @app.get('/api/v1/public/menu/{public_id}/card/contact')
    def get_contact(public_id: str, authorization: str=Header(default='')):
        business,customer,_=identity(public_id,authorization,'contact_session')
        return response(saved_profile(business,customer))

    @app.put('/api/v1/public/menu/{public_id}/card/contact')
    def put_contact(public_id: str, body: ContactProfile, authorization: str=Header(default='')):
        business,customer,_=identity(public_id,authorization,'contact_session')
        phone=clean_phone(body.phone)
        addresses=[dict(id=a.id,label=a.label.strip(),address=a.address.strip()) for a in body.addresses]
        ids={a['id'] for a in addresses}
        if len(ids)!=len(addresses) or any(not a['label'] or len(a['address'])<5 for a in addresses) or (addresses and body.default_address_id not in ids) or (not addresses and body.default_address_id):
            raise HTTPException(422,'Choose a valid default address and complete all saved addresses.')
        row=dict(business_id=str(business['id']),customer_public_id=str(customer['public_id']),phone=phone,addresses=addresses,default_address_id=body.default_address_id)
        try:
            db.table('menu_contact_profiles').upsert(row,on_conflict='business_id,customer_public_id').execute()
        except Exception:
            raise HTTPException(503,'Contact details were not saved. Please retry.')
        return response(dict(name=str(customer.get('name') or ''),phone=phone,addresses=addresses,default_address_id=body.default_address_id))
