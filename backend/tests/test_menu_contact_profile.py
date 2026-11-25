"""Contact profile isolation, fresh verification and persistence (no production DB)."""
import os
import re
import time
import unittest
from types import SimpleNamespace
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
os.environ.setdefault('STAFF_SESSION_SECRET','test-secret-for-menu-card-link-0123456789')
from backend.menu_card_link import sign,read_token,_secret
from backend.menu_contact_profile import register_menu_contact_routes

class Query:
    def __init__(self,db,table):
        self.db,self.table,self.filters,self.row=db,table,[],None
    def select(self,*args):return self
    def eq(self,k,v):self.filters.append((k,v));return self
    def limit(self,*args):return self
    def upsert(self,row,**kwargs):self.row=row;return self
    def execute(self):
        if self.row is not None:
            self.db.profiles[(self.row['business_id'],self.row['customer_public_id'])]=self.row
        rows=self.db.customers if self.table=='customers' else list(self.db.profiles.values())
        return SimpleNamespace(data=[r for r in rows if all(r.get(k)==v for k,v in self.filters)])

class DB:
    def __init__(self):
        self.customers=[dict(business_id=1,public_id='member-a',name='Test Member',email='member@example.test',phone='09171234567',address='Test registered address'),
                        dict(business_id=2,public_id='member-b',name='Other Member',email='other@example.test',phone='09179999999',address='Other address')]
        self.profiles={}
        self.challenges={}
    def table(self,name):return Query(self,name)
    def rpc(self,name,p):
        key=(p['p_business'],p['p_customer'])
        if name=='menu_contact_issue':
            if key in self.challenges:return SimpleNamespace(execute=lambda:SimpleNamespace(data=False))
            self.challenges[key]=dict(p,attempts=0,consumed=False)
            success=True
        else:
            c=self.challenges.get(key,{})
            success=False
            if c and c['p_challenge']==p['p_challenge'] and not c['consumed'] and c['attempts']<5:
                c['attempts']+=1
                success=c['p_digest']==p['p_digest']
                c['consumed']=success or c['attempts']>=5
        return SimpleNamespace(execute=lambda:SimpleNamespace(data=success))

class ContactTests(unittest.TestCase):
    def setUp(self):
        self.db=DB()
        self.mail=[]
        app=FastAPI()
        def business(pid):
            if pid not in ('shop-a','shop-b'):raise HTTPException(404)
            return {'public_id':pid,'id':1 if pid=='shop-a' else 2}
        register_menu_contact_routes(app,db=self.db,business_for=business,send_email=lambda *args:self.mail.append(args) or True,read_token=read_token,sign=sign,secret=_secret)
        self.client=TestClient(app)
        self.path='/api/v1/public/menu/shop-a/card/contact'
        self.legacy=self.token('session')
    def token(self,kind,**kw):
        return {'Authorization':'Bearer '+sign(dict(kind=kind,business_public_id='shop-a',customer_public_id='member-a',email='member@example.test',exp=int(time.time())+600,**kw))}
    def unlock(self):
        request=self.client.post(self.path+'/request',headers=self.legacy)
        self.assertEqual(request.status_code,200)
        self.assertEqual(request.headers['cache-control'],'private, no-store')
        self.assertEqual(self.mail[-1][0],'member@example.test')
        code=re.search(r'<strong>([0-9]{6})</strong>',self.mail[-1][2]).group(1)
        challenge=request.json()['challenge_id']
        self.assertNotIn(code, self.db.challenges[('1','member-a')]['p_digest'])
        body={'challenge_id':challenge,'code':code}
        result=self.client.post(self.path+'/verify',headers=self.legacy,json=body)
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.post(self.path+'/verify',headers=self.legacy,json=body).status_code,401)
        return {'Authorization':'Bearer '+result.json()['token']},result.json()['profile']
    def test_legacy_cannot_read_or_save_contacts(self):
        self.assertEqual(self.client.get(self.path,headers=self.legacy).status_code,401)
        self.assertEqual(self.client.put(self.path,headers=self.legacy,json={'phone':'09171234567'}).status_code,401)
        self.assertEqual(self.db.profiles,{})
    def test_verified_profile_loads_register_and_saves_without_mutating_customer(self):
        headers,profile=self.unlock()
        self.assertEqual(profile['phone'],'09171234567')
        self.assertEqual(profile['addresses'][0]['address'],'Test registered address')
        body={'phone':'09178888888','addresses':[{'id':'office','label':'Office','address':'New office address'}],'default_address_id':'office'}
        result=self.client.put(self.path,headers=headers,json=body)
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.get(self.path,headers=headers).json()['phone'],body['phone'])
        self.assertEqual(self.client.get(self.path,headers=headers).json()['addresses'],body['addresses'])
        self.assertEqual(self.db.customers[0]['phone'],'09171234567')
        self.assertEqual(self.client.get(self.path.replace('shop-a','shop-b'),headers=headers).status_code,401)
    def test_bad_phone_and_default_rejected(self):
        headers,_=self.unlock()
        self.assertEqual(self.client.put(self.path,headers=headers,json={'phone':'nope'}).status_code,422)
        self.assertEqual(self.client.put(self.path,headers=headers,json={'phone':'09171234567','addresses':[{'id':'office','label':'Office','address':'Office address'}],'default_address_id':'missing'}).status_code,422)
        self.assertEqual(self.db.profiles,{})
    def test_attempt_limit_and_throttle(self):
        challenge=self.client.post(self.path+'/request',headers=self.legacy).json()['challenge_id']
        self.assertEqual(self.client.post(self.path+'/request',headers=self.legacy).status_code,429)
        real=re.search(r'<strong>([0-9]{6})</strong>',self.mail[-1][2]).group(1)
        wrong='000000' if real!='000000' else '111111'
        for _ in range(5):
            self.assertEqual(self.client.post(self.path+'/verify',headers=self.legacy,json={'challenge_id':challenge,'code':wrong}).status_code,401)
        self.assertEqual(self.client.post(self.path+'/verify',headers=self.legacy,json={'challenge_id':challenge,'code':real}).status_code,401)
