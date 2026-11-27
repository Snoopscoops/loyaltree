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


def test_staff_booking_roles_are_scoped_and_configuration_stays_owner_only():
    from types import SimpleNamespace
    bid = 7
    a = '11111111-1111-4111-8111-111111111111'
    b = '22222222-2222-4222-8222-222222222222'
    calls = []
    rows = {
        'branches': [{'id': 10, 'public_id': 'north', 'name': 'North', 'business_id': bid, 'is_active': True},
                     {'id': 20, 'public_id': 'south', 'name': 'South', 'business_id': bid, 'is_active': True}],
        'lt_bookings': [{'id': a, 'business_id': bid, 'branch_id': 10, 'customer_name': 'Test North', 'phone': 'test-only', 'note': 'private', 'price_centavos': 500},
                        {'id': b, 'business_id': bid, 'branch_id': 20, 'customer_name': 'Test South'}],
    }
    class Table:
        def __init__(self, name): self.name=name; self.filters={}; self.fields='*'
        def select(self, fields): self.fields=fields; return self
        def eq(self,key,value): self.filters[key]=value; return self
        def gte(self,*args): return self
        def lt(self,*args): return self
        def order(self,*args,**kw): return self
        def limit(self,*args): return self
        def execute(self):
            calls.append((self.name,self.fields,self.filters.copy()))
            data=[r for r in rows.get(self.name,[]) if all(r.get(k)==v for k,v in self.filters.items())]
            return SimpleNamespace(data=[{k:v for k,v in r.items() if self.fields=='*' or k in self.fields.split(',')} for r in data])
    def operator(slug, authorization, *, allow):
        role, _, locked=authorization.partition(':')
        if role not in allow: raise HTTPException(403,'Role denied')
        if role=='cashier' and not locked: raise HTTPException(403,'Assign a branch')
        return {'id':bid},{'role':role,'branch':locked,'all_branches':role in ('manager','owner') and not locked}
    def owner_only(slug, authorization):
        if authorization!='owner:': raise HTTPException(403,'Owner required')
    def rpc(name, params):
        calls.append((name,params))
        return SimpleNamespace(execute=lambda:SimpleNamespace(data={'status':params['p_status']}))
    app=FastAPI()
    register_native_booking_routes(app,db=SimpleNamespace(table=Table,rpc=rpc),get_business=lambda slug:{'id':bid},require_owner=owner_only,booking_operator=operator)
    client=TestClient(app)
    url='/api/v1/business/demo/native-bookings'
    def headers(role): return {'Authorization':role}
    r=client.get(url,headers=headers('cashier:north'))
    assert r.status_code==200,r.text
    body=r.json()
    assert body['branch']=='north' and [p['public_id'] for p in body['branches']]==['north']
    assert [r['id'] for r in body['bookings']]==[a] and not body['can_update']
    assert not {'phone','note','price_centavos'} & body['bookings'][0].keys()
    assert body['settings']=={} and body['resources']==[]
    assert client.get(url+'?branch_id=south',headers=headers('cashier:north')).status_code==403
    assert client.get(url,headers=headers('cashier:')).status_code==403
    assert client.get(url+'?branch_id=south',headers=headers('manager:north')).status_code==403
    r=client.get(url+'?branch_id=south',headers=headers('manager:'))
    assert r.status_code==200 and r.json()['can_update'] and r.json()['bookings'][0]['id']==b
    assert client.post(url+'/'+a+'/status',headers=headers('cashier:north'),json={'status':'confirmed'}).status_code==403
    assert client.post(url+'/'+b+'/status',headers=headers('manager:north'),json={'status':'confirmed'}).status_code==404
    assert not any(c[0]=='lt_booking_transition' for c in calls)
    assert client.post(url+'/'+a+'/status',headers=headers('manager:north'),json={'status':'confirmed'}).status_code==200
    assert calls[-1][0]=='lt_booking_transition' and calls[-1][1]['p_business']==bid
    assert client.put(url+'/settings?branch_id=north',headers=headers('manager:north'),json={}).status_code==403
    assert client.put(url+'/settings?branch_id=north',headers=headers('cashier:north'),json={}).status_code==403
    assert client.post(url+'/resources?branch_id=north',headers=headers('manager:north'),json={'kind':'table','name':'T1','capacity':4,'duration_minutes':90}).status_code==403
