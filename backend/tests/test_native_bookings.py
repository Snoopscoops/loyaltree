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
