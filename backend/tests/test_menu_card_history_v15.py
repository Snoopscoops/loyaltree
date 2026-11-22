"""Owner-v15 verified customer history endpoint tests (no live DB/network)."""
import importlib.util
import os
import pathlib
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient

MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / 'menu_card_link.py'
spec = importlib.util.spec_from_file_location('v15_menu_card_link', MODULE_PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Query:
    def __init__(self,rows,collector): self.rows=rows; self.filters=[]; self.collector=collector;self.limit_n=30;self.sort_field='created_at'
    def select(self,columns): self.columns=columns;return self
    def eq(self,key,value): self.filters.append((key,value));return self
    def order(self,column,desc=False): self.sort_field=column; return self
    def limit(self,n): self.limit_n=n; return self
    def execute(self):
        self.collector.append(self.filters)
        rows=[r for r in self.rows if all(r.get(k)==v for k,v in self.filters)]
        rows.sort(key=lambda row: str(row.get(self.sort_field) or ''),reverse=True)
        return SimpleNamespace(data=rows[:self.limit_n])
class DB:
    def __init__(self): self.calls=[];self.tables={
      'stamp_events':[{'id':1,'business_id':10,'customer_id':9,'created_at':'2026-11-22T01:35:45Z'}, {'id':2,'business_id':11,'customer_id':88,'created_at':'2026-11-22T01:50:00Z'}],
      'redemption_events':[],
      'menu_order_redemptions':[{'order_public_id':'order-44','business_id':10,'customer_id':9,'status':'redeemed','kind':'stamp_reward','completed_at':'2026-11-21T23:57:55Z','required_stamps':8,'points_cost':0},
          {'order_public_id':'order-45','business_id':10,'customer_id':9,'status':'pending','kind':'stamp_reward','completed_at':None,'required_stamps':8,'points_cost':0}],
      'points_events':[],
    }
    def table(self,name): return Query(self.tables[name],self.calls)

def setup(card_customer_business=10):
    os.environ['LT_BENEFITS_AUTH_SECRET']='test-only-key-material-at-least-32-chars'
    db=DB();app=FastAPI()
    b={'public_id':'jus','id':10,'name':'JUS Beverage','status':'ACTIVE'}
    c={'public_id':'member1','id':9,'business_id':card_customer_business,'stamp_count':2,'points_balance':0}
    mod.register_menu_card_routes(app,db=db,get_business=lambda id:b if id=='jus' else None,
        has_feature=lambda *_:True,on_hold=lambda *_:False,send_email=lambda *_:True,frontend_url='',
        get_customer_by_public_id=lambda id:c if id=='member1' else None,
        get_program=lambda *_:{'card_type':'stamp','stamp_goal':8,'name':'JUS Drink Card'},
        get_redeemables=lambda *_:[],uses_stamps=lambda p:p.get('card_type')=='stamp',
        uses_points=lambda p:p.get('card_type')=='points')
    signed=mod.sign({'kind':'session','business_public_id':'jus','customer_public_id':'member1','email':'j***@example.test','name':'John','exp':9999999999})
    return TestClient(app),db,{'Authorization':f'Bearer {signed}'}

def test_history_requires_connected_card_and_never_enumerates_other_members():
    client,db,auth=setup()
    url='/api/v1/public/menu/jus/card/history'
    assert client.get(url).status_code==401
    assert client.get(url,headers=auth).status_code==200
    body=client.get(url,headers=auth).json()
    assert body['card_type']=='stamp' and body['stamp_goal']==8 and body['stamp_count']==2
    assert body['card_name']=='JUS Drink Card'
    assert [row['type'] for row in body['events']]==['earned','redeemed']
    assert any(row['id'] == 'menu-redemption-order-44' for row in body['events'])
    assert all(row['id'] not in ('stamp-2','menu-redemption-order-45') for row in body['events'])
    assert all(('business_id',10) in entry and ('customer_id',9) in entry for entry in db.calls)
    assert client.get(url,headers=auth).headers['cache-control']=='private, no-store'

def test_customer_of_another_business_cannot_read_card_history():
    client,db,auth=setup(card_customer_business=11)
    assert client.get('/api/v1/public/menu/jus/card/history',headers=auth).status_code==401
    assert db.calls==[]

def test_invalid_token_fails_closed():
    client,_,_=setup()
    assert client.get('/api/v1/public/menu/jus/card/history',headers={'Authorization':'Bearer bad.token'}).status_code==401

def test_ledger_failure_is_explicit_not_fake_empty_history():
    client,db,auth=setup()
    del db.tables['stamp_events']
    response=client.get('/api/v1/public/menu/jus/card/history',headers=auth)
    assert response.status_code==503
    assert 'unavailable' in response.json()['detail']
