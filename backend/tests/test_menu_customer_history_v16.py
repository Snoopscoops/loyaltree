"""Owner-v16: order histories are scoped and spending is conservative."""
import os
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.menu_card_link import sign, read_token
from backend.menu_customer_history import register_customer_order_history_routes, paid_spend

class Query:
    def __init__(self, name, tables, calls): self.name=name;self.tables=tables;self.calls=calls;self.filters=[];self.lo=0;self.hi=199
    def select(self,*_):return self
    def eq(self,key,value):self.filters.append((key,value));return self
    def order(self,*_,**__):return self
    def range(self,lo,hi): self.lo=lo;self.hi=hi;return self
    def execute(self):
        self.calls.append((self.name, self.filters[:]))
        rows=[r for r in self.tables[self.name] if all(r.get(key)==value for key,value in self.filters)]
        return SimpleNamespace(data=rows[self.lo:self.hi+1])
class DB:
    def __init__(self,orders): self.tables={'menu_counter_orders':orders};self.calls=[]
    def table(self,name):return Query(name,self.tables,self.calls)

def setup():
    os.environ['LT_BENEFITS_AUTH_SECRET']='test-only-32-plus-bytes-secret-1234567'
    base={'business_id':10,'member_customer_public_id':'alice','status':'completed','payment_status':'paid','payment_method':'cash','created_at':'2026-11-22T13:00:00Z'}
    orders=[dict(base,order_number='A',total=150),dict(base,order_number='B',total=250,payment_status='unpaid'),
            dict(base,order_number='C',total=400,payment_status='paid_test',payment_method='qrph'),
            dict(base,order_number='D',total=100,status='cancelled'),
            dict(base,order_number='E',total=80,member_customer_public_id='bob'),
            dict(base,order_number='F',total=20,business_id=20)]
    db=DB(orders);app=FastAPI(); business={'id':10,'public_id':'jus','status':'ACTIVE'}
    customers={'alice':{'id':1,'public_id':'alice','business_id':10},'bob':{'id':2,'public_id':'bob','business_id':10},'other':{'id':3,'public_id':'other','business_id':20}}
    def operator(public_id, authorization,**_):
        from fastapi import HTTPException
        if authorization!='Bearer owner-secret':raise HTTPException(403,'Not owner')
        return business,{'role':'owner'}
    register_customer_order_history_routes(app, db=db, get_business=lambda public_id:business if public_id=='jus' else None,
        get_customer=lambda cid:customers.get(cid),operator=operator,read_card_token=read_token)
    def auth(customer):
        return {'Authorization':'Bearer '+sign({'kind':'session','business_public_id':'jus','customer_public_id':customer,'exp':9999999999})}
    return TestClient(app),db,auth

def test_card_only_sees_its_orders_and_valid_paid_spending():
    client,db,auth=setup();url='/api/v1/public/menu/jus/card/orders'
    assert client.get(url).status_code==401
    response=client.get(url,headers=auth('alice'))
    assert response.status_code==200
    body=response.json()
    assert [o['order_number'] for o in body['orders']]==['A','B','C','D']
    assert body['summary']=={'total_orders':4,'completed_paid_orders':1,'total_spent':150.0,'complete':True,'scope':'Linked digital-menu orders only'}
    assert response.headers['cache-control']=='private, no-store'
    assert all(('business_id',10) in f and ('member_customer_public_id','alice') in f for _,f in db.calls)
    assert client.get(url,headers=auth('other')).status_code==404

def test_owner_only_and_customer_separation():
    client,db,auth=setup();base='/api/v1/business/jus/customers'
    assert client.get(base+'/alice/menu-order-history').status_code in (401,403)
    response=client.get(base+'/bob/menu-order-history',headers={'Authorization':'Bearer owner-secret'})
    assert response.status_code==200 and response.json()['summary']['total_spent']==80
    assert client.get(base+'/other/menu-order-history',headers={'Authorization':'Bearer owner-secret'}).status_code==404

def test_unknown_and_test_payment_do_not_become_sales():
    assert paid_spend({'status':'completed','payment_status':'paid','payment_method':'','total':100})==0
    assert paid_spend({'status':'completed','payment_status':'paid_test','payment_method':'qrph','total':100})==0
    assert paid_spend({'status':'completed','payment_status':'paid','payment_method':'cash','total':'NaN'})==0
