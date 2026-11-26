from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from backend.native_bookings import normalize_phone, register_native_booking_routes

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
