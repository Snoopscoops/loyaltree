"""Coupon boundaries and server access rules, without live services."""
import ast
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import re
import unittest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from backend.trial_coupons import billing_hold, coupon_available, coupon_code, register_trial_routes, subscription_access_expiry

class CouponTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(id=1,code='HALLOWEEN7',title='Halloween Special',trial_days=7,starts_on='2026-10-15',ends_on='2026-11-15',is_active=True,country_code='PH')

    def test_philippine_redemption_boundaries(self):
        for timestamp,allowed in [('2026-10-14T15:59:59+00:00',False),('2026-10-14T16:00:00+00:00',True),('2026-11-15T15:59:59+00:00',True),('2026-11-15T16:00:00+00:00',False)]:
            with self.subTest(timestamp=timestamp):
                if allowed: coupon_available(self.row,now=datetime.fromisoformat(timestamp))
                else:
                    with self.assertRaises(HTTPException):coupon_available(self.row,now=datetime.fromisoformat(timestamp))

    def test_disabled_country_and_reserved_email(self):
        now=datetime(2026,10,20,tzinfo=timezone.utc)
        for row,country,email in [({**self.row,'is_active':False},'PH',''),(self.row,'US',''),({**self.row,'eligible_email':'owner@example.com'},'PH','other@example.com')]:
            with self.assertRaises(HTTPException):coupon_available(row,country,email,now)
        coupon_available({**self.row,'eligible_email':'OWNER@example.com'},'PH',' owner@example.com ',now)

    def test_code_normalization(self):
        self.assertEqual(coupon_code(' halloween7 '),'HALLOWEEN7')
        for code in ['', 'a', 'bad code', 'x'*65]:
            with self.assertRaises(HTTPException):coupon_code(code)

    def test_paid_hold_only_after_fourteen_full_days(self):
        expiry=datetime(2026,10,1,tzinfo=timezone.utc)
        row={'subscription_expires_at':expiry.isoformat(),'last_paid_at':'2026-09-01'}
        self.assertFalse(billing_hold(row,expiry+timedelta(days=14)))
        self.assertTrue(billing_hold(row,expiry+timedelta(days=14,seconds=1)))
        self.assertFalse(billing_hold({**row,'subscription_expires_at':'2026-11-01'},expiry+timedelta(days=15)))
        self.assertFalse(billing_hold({},expiry))

    def test_trial_ends_exactly_without_paid_grace(self):
        expiry=datetime(2026,10,22,10,30,tzinfo=timezone.utc)
        row={'subscription_expires_at':'2026-10-22','trial_ends_at':expiry.isoformat()}
        self.assertFalse(billing_hold(row,expiry))
        self.assertTrue(billing_hold(row,expiry+timedelta(seconds=1)))
        self.assertFalse(billing_hold({**row,'last_paid_at':'2026-10-22','subscription_expires_at':'2027-01-22'},expiry+timedelta(seconds=1)))

    def test_referral_extension_is_preserved_during_trial(self):
        row={'trial_ends_at':'2026-10-22T10:30:00Z','subscription_expires_at':'2026-11-21'}
        self.assertEqual(subscription_access_expiry(row),'2026-11-21')
        self.assertFalse(billing_hold(row,datetime(2026,10,23,tzinfo=timezone.utc)))
        self.assertFalse(billing_hold(row,datetime(2026,11,20,tzinfo=timezone.utc)))
        self.assertTrue(billing_hold(row,datetime(2026,11,22,tzinfo=timezone.utc)))

    def test_signed_agreement_hash_includes_coupon_and_duration(self):
        import hashlib
        source=Path(__file__).resolve().parents[1]/'main.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='build_signup_agreement_document')
        env=dict(Optional=__import__('typing').Optional,HTTPException=HTTPException,hashlib=hashlib,
                 SUBSCRIPTION_PLANS={'starter':{'label':'Starter'}},normalize_country_code=lambda x:x,
                 self_serve_billing_cycle=lambda cycle,region:cycle,
                 pricing_region_config=lambda region:{'currency':'PHP','symbol':'₱','country_name':'Philippines'},
                 get_price_for_plan=lambda *a:1050,billing_period_label=lambda x:x,billing_cycle_label=lambda x:x,
                 SETUP_KIT_PRICE_PER_BRANCH=150,_signup_agreement_sections=lambda:[],_signup_dpa_sections=lambda:[],
                 _copy_legal_sections=lambda x:[],_LEGAL_CONTENT={'documents':{'business-agreement':{'plans':[]},'terms':{'title':'Terms','sections':[]},'privacy':{'title':'Privacy','sections':[]}},'versions':{'terms':'v1','privacy':'v1'}})
        for key in ('BUSINESS_AGREEMENT_VERSION','TERMS_VERSION','PRIVACY_VERSION','DPA_VERSION','LEGAL_PRESENTATION_VERSION','LOYALTYTREE_LEGAL_NAME','LOYALTYTREE_LEGAL_LOCATION','LOYALTYTREE_LEGAL_PHONE','LOYALTYTREE_LEGAL_EMAIL'):env[key]='test'
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),env)
        args=dict(name='Test Cafe',email='test@example.invalid',phone=None,address=None,contact_person=None,plan='starter',branch_count=1,billing_cycle='3_months',setup_kit_requested=False)
        paid=env['build_signup_agreement_document'](**args)
        trial=env['build_signup_agreement_document'](**args,trial_coupon=self.row)
        longer=env['build_signup_agreement_document'](**args,trial_coupon={**self.row,'trial_days':14})
        self.assertNotEqual(paid['agreement_sha256'],trial['agreement_sha256'])
        self.assertNotEqual(trial['agreement_sha256'],longer['agreement_sha256'])
        self.assertIn('HALLOWEEN7',trial['snapshot'])
        self.assertIn('7 days of free business access',trial['snapshot'])

    def test_middleware_blocks_existing_sessions_and_preserves_billing(self):
        source=Path(__file__).resolve().parents[1]/'main.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='overdue_business_guard');node.decorator_list=[]
        row={'subscription_expires_at':'2020-01-01','last_paid_at':'2019-01-01'}
        env=dict(Request=Request,HTTPException=HTTPException,re=re,billing_hold=billing_hold,JSONResponse=JSONResponse,business_for_access_check=lambda slug:row,get_admin_token=lambda:'admin')
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),env)
        async def next_call(req):return JSONResponse({'ok':True})
        def request(path,method='GET',headers=[]):return Request({'type':'http','method':method,'path':path,'headers':headers,'query_string':b''})
        for suffix in ('/customers','/staff/verify-pin','/stamp','/analytics'):
            result=asyncio.run(env['overdue_business_guard'](request('/api/v1/business/biz'+suffix,'POST' if suffix!='/customers' else 'GET'),next_call));self.assertEqual(result.status_code,402)
        for path in ('/api/v1/business/biz/subscription','/api/v1/business/biz/subscription/checkout','/api/v1/admin/trial-coupons'):
            self.assertEqual(asyncio.run(env['overdue_business_guard'](request(path),next_call)).status_code,200)
        self.assertEqual(asyncio.run(env['overdue_business_guard'](request('/api/v1/business/biz/customers',headers=[(b'authorization',b'Bearer admin')]),next_call)).status_code,200)

class FakeDB:
    def __init__(self):self.rows=[];self.used=0
    def table(self,table):
        db=self
        class Query:
            def __init__(self):self.filters={};self.payload=None;self.updating=False
            def select(self,*a,**kw):return self
            def eq(self,key,value):self.filters[key]=value;return self
            def range(self,*a):return self
            def limit(self,*a):return self
            def order(self,*a,**kw):return self
            def insert(self,payload):self.payload=payload;return self
            def update(self,payload):self.payload=payload;self.updating=True;return self
            def execute(self):
                if table=='business_trial_redemptions':return SimpleNamespace(data=[],count=db.used)
                if self.payload:
                    if self.updating:
                        matches=[r for r in db.rows if all(r.get(k)==v for k,v in self.filters.items())]
                        for row in matches:row.update(self.payload)
                        return SimpleNamespace(data=matches)
                    db.rows.append({'id':len(db.rows)+1,**self.payload});return SimpleNamespace(data=[db.rows[-1]])
                return SimpleNamespace(data=[r for r in db.rows if all(r.get(k)==v for k,v in self.filters.items())])
        return Query()

class CouponRouteTests(unittest.TestCase):
    def setUp(self):
        self.db=FakeDB();self.app=FastAPI()
        def admin(request:Request):
            if request.headers.get('authorization')!='Bearer admin':raise HTTPException(401,'Admin required')
        register_trial_routes(self.app,self.db,admin)
        self.client=TestClient(self.app)
        self.payload=dict(code='PRIVATE14',title='Private trial',trial_days=14,starts_on='2020-01-01',ends_on='2099-01-01',is_active=True,is_public=False,show_popup=False,country_code='PH',max_redemptions=1)
    def test_admin_required_and_private_codes_not_advertised(self):
        self.assertEqual(self.client.post('/api/v1/admin/trial-coupons',json=self.payload).status_code,401)
        self.assertEqual(self.client.post('/api/v1/admin/trial-coupons',json=self.payload,headers={'Authorization':'Bearer admin'}).status_code,200)
        self.assertEqual(self.client.get('/api/v1/public/trial-promotions').json(),[])
        self.assertEqual(self.client.get('/api/v1/admin/trial-coupons',headers={'Authorization':'Bearer admin'}).json()[0]['code'],'PRIVATE14')
        result=self.client.post('/api/v1/public/trial-coupons/preview',json={'code':'private14','country_code':'PH'})
        self.assertEqual(result.status_code,200);self.assertEqual(result.json()['trial_days'],14)
        self.db.used=1
        self.assertEqual(self.client.post('/api/v1/public/trial-coupons/preview',json={'code':'PRIVATE14'}).status_code,400)
    def test_bad_dates_and_public_reserved_coupon_rejected(self):
        for changes in ({'ends_on':'2019-01-01'},{'eligible_email':'owner@example.com','is_public':True},{'show_popup':True}):
            self.assertEqual(self.client.post('/api/v1/admin/trial-coupons',json={**self.payload,**changes},headers={'Authorization':'Bearer admin'}).status_code,400)
    def test_disable_stops_new_redemptions(self):
        self.client.post('/api/v1/admin/trial-coupons',json=self.payload,headers={'Authorization':'Bearer admin'})
        self.assertEqual(self.client.put('/api/v1/admin/trial-coupons/1',json={**self.payload,'is_active':False},headers={'Authorization':'Bearer admin'}).status_code,200)
        self.assertEqual(self.client.post('/api/v1/public/trial-coupons/preview',json={'code':'PRIVATE14'}).status_code,400)
