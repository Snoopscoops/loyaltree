from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from backend.native_bookings import normalize_phone, register_native_booking_routes, short_booking_code, booking_lookup

def test_phone_normalization():
    assert normalize_phone("0917 123 4567")=="639171234567"
    assert normalize_phone("+63 917 123 4567")=="639171234567"
    with pytest.raises(HTTPException): normalize_phone("not-a-number")

def test_owner_routes_require_authorization_before_db():
    app=FastAPI()
    def auth(slug,token):
        raise HTTPException(401,"Owner authentication required")
    def get_business(slug):
        raise AssertionError("unauthorized request reached business lookup")
    register_native_booking_routes(app,db=None,get_business=get_business,require_owner=auth)
    client=TestClient(app)
    assert client.get("/api/v1/business/demo/native-bookings").status_code==401
    assert client.put("/api/v1/business/demo/native-bookings/settings?branch_id=main",json={}).status_code==401
    assert client.post("/api/v1/business/demo/native-bookings/resources?branch_id=main",json={"kind":"table","name":"T1","capacity":4,"duration_minutes":90}).status_code==401
    assert client.post("/api/v1/business/demo/native-bookings/11111111-1111-4111-8111-111111111111/status",json={"status":"confirmed"}).status_code==401

def test_booking_short_reference_normalization():
    from uuid import UUID
    original="12345678-9abc-4def-8123-456789abcdef"
    code=short_booking_code(original)
    assert len(code)==12
    assert code==short_booking_code(UUID(original))
    formatted="-".join(code[i:i+4] for i in range(0,12,4)).lower()
    assert booking_lookup(formatted)==("booking_code",code)
    assert booking_lookup(" oooo illl 2345 ")==("booking_code","000011112345")
    assert booking_lookup(original)==("id",original)
    with pytest.raises(HTTPException): booking_lookup("123")
    with pytest.raises(HTTPException): booking_lookup("A"*100)

def test_public_reference_lookup_scopes_business_and_returns_only_status():
    from types import SimpleNamespace
    original="12345678-9abc-4def-8123-456789abcdef"
    code=short_booking_code(original)
    class Table:
        def select(self,fields):
            assert fields=="status"
            self.filters={}
            return self
        def eq(self,key,value):
            self.filters[key]=value
            return self
        def limit(self,n): return self
        def execute(self):
            match=self.filters.get("business_id")==1 and (self.filters.get("booking_code")==code or self.filters.get("id")==original)
            return SimpleNamespace(data=[{"status":"confirmed"}] if match else [])
    app=FastAPI()
    register_native_booking_routes(app,db=SimpleNamespace(table=lambda _:Table()),get_business=lambda slug:{"id":1 if slug=="one" else 2,"status":"ACTIVE"},require_owner=lambda *_:None)
    client=TestClient(app)
    assert client.get("/api/v1/public/bookings/one/status/"+code.lower()).json()=={"status":"confirmed"}
    assert client.get("/api/v1/public/bookings/one/status/"+original).json()=={"status":"confirmed"}
    assert client.get("/api/v1/public/bookings/two/status/"+code).status_code==404


def test_booking_request_schedules_push_only_after_success():
    from types import SimpleNamespace
    ref="12345678-9abc-4def-8123-456789abcdef"
    class DB:
        status="pending"
        def table(self, name):
            assert name=="branches"
            return self
        def select(self,*args): return self
        def eq(self,*args): return self
        def order(self,*args): return self
        def execute(self):
            return SimpleNamespace(data=[{"id":3,"public_id":"main","name":"Main"}])
        def rpc(self,name,params):
            assert name=="lt_booking_request"
            if self.status=="error":
                raise RuntimeError("unavailable")
            return SimpleNamespace(execute=lambda:SimpleNamespace(data={"reference":ref,"status":self.status}))
    db=DB()
    calls=[]
    app=FastAPI()
    register_native_booking_routes(app,db=db,get_business=lambda slug:{"id":1,"status":"ACTIVE"},require_owner=lambda *_:None,booking_push=lambda *args:calls.append(args))
    client=TestClient(app)
    payload={"resource_id":ref,"branch":"main","starts_at":"2026-12-01T10:00:00+08:00","guests":2,"name":"Test","phone":"09171234567","request_id":ref}
    response=client.post("/api/v1/public/bookings/demo/request",json=payload)
    assert response.status_code==200
    assert response.json()["booking_code"]==short_booking_code(ref)
    assert calls==[(1,"demo","main",ref)]
    db.status="confirmed"
    assert client.post("/api/v1/public/bookings/demo/request",json=payload).status_code==200
    db.status="error"
    assert client.post("/api/v1/public/bookings/demo/request",json=payload).status_code==503
    assert len(calls)==1


def test_booking_push_targets_only_owner_android_and_no_customer_details():
    from types import SimpleNamespace
    from backend.menu_order_push import make_booking_pusher, ENV_NAME
    class DB:
        def table(self,name):
            assert name=="owner_app_devices"
            self.filters={}
            return self
        def select(self,*args): return self
        def eq(self,key,value):
            self.filters[key]=value
            return self
        def limit(self,n): return self
        def execute(self):
            assert self.filters=={"business_id":1,"role":"owner","platform":"android"}
            return SimpleNamespace(data=[{"token":"owner-token","role":"owner","platform":"android"},{"token":"staff-token","role":"manager","platform":"android"},{"token":"ios-token","role":"owner","platform":"ios"}])
    calls=[]
    sender=SimpleNamespace(send=lambda token,data: calls.append((token,data)) or "ok")
    push=make_booking_pusher(db=DB(),environ={ENV_NAME:'{"client_email":"test@example.com","private_key":"fake"}'},sender_factory=lambda *args,**kwargs:sender)
    push(1,"demo","main","abc")
    assert calls==[("owner-token",{"type":"new_booking","business":"demo","booking_id":"abc","branch_public_id":"main"})]
