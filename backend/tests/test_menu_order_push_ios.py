"""owner-v10: iOS FCM/APNs, branch mutes and registration checks."""
import json
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.menu_order_push import FcmSender, ENV_NAME, make_order_pusher, register_menu_order_push_routes, TABLE
from backend.menu_order_access import make_menu_order_operator

BUSINESS = {'id': 1, 'public_id': 'biz'}
ORDER = {'public_id': 'o1', 'order_number': '101', 'branch_public_id': 'bgc',
         'branch_name': 'BGC', 'total': 125, 'items': [{'item_name': 'Tea', 'quantity': 1}],
         'service': 'pickup', 'payment_status': 'paid_test'}
ENV = {ENV_NAME: json.dumps({'client_email': 'test@example.org', 'private_key': 'not_a_real_key'})}

class Result:
    def __init__(self, data): self.data = data

class Query:
    def __init__(self, db, name): self.db, self.name, self.filters, self.op, self.row = db, name, [], 'select', None
    def select(self, *_): return self
    def limit(self, *_): return self
    def eq(self, key, val): self.filters.append((key,val)); return self
    def upsert(self, row, on_conflict=None): self.op, self.row, self.conflict = 'upsert', row, on_conflict; return self
    def delete(self): self.op = 'delete'; return self
    def execute(self):
        rows = self.db.rows.setdefault(self.name, [])
        if self.op == 'upsert':
            old = next((row for row in rows if row.get(self.conflict)==self.row.get(self.conflict)),None)
            if old is None: rows.append(dict(self.row))
            else: old.update(self.row)
            return Result([self.row])
        if self.op == 'delete':
            self.db.rows[self.name] = [row for row in rows if not all(row.get(k)==v for k,v in self.filters)]
            return Result([])
        return Result([dict(row) for row in rows if all(row.get(k)==v for k,v in self.filters)])

class DB:
    def __init__(self, rows=None): self.rows=rows or {TABLE: []}
    def table(self, name): return Query(self,name)

class Sender:
    def __init__(self, info, project_id=None): self.sent=[]
    def send(self, token, data, *, platform='android'):
        self.sent.append((token,platform))
        return 'ok'

def test_ios_apns_payload_includes_sound_time_sensitive_and_branch_thread():
    sent=[]
    class Response:
        status_code=200
        def json(self): return {'name': 'ok'}
    def post(url, **kw): sent.append(kw['json']);return Response()
    sender=FcmSender({'client_email':'test@example.org','private_key':'unused'},post=post)
    sender.access_token=lambda force=False:'fake-access-token'
    data={'title':'New order #101 · BGC branch','branch_public_id':'bgc','note':'Pickup','total':'₱125'}
    assert sender.send('ios-token',data,platform='ios')=='ok'
    msg=sent[-1]['message']
    assert msg['token']=='ios-token'
    assert msg['apns']['headers']['apns-push-type']=='alert'
    aps=msg['apns']['payload']['aps']
    assert aps['alert']['title']==data['title']
    assert aps['sound']=='lt_new_order.caf'
    assert aps['interruption-level']=='time-sensitive'
    assert aps['thread-id']=='lt-orders-bgc'
    assert 'android' not in msg
    assert sender.send('android-token',data)=='ok'
    assert 'apns' not in sent[-1]['message']
    assert sent[-1]['message']['android']['priority']=='HIGH'

def test_ios_muted_preferences_skip_only_ios():
    rows={TABLE:[
        {'token':'a','business_id':1,'role':'owner','platform':'ios','alerts_on':True,'muted_branches':['bgc']},
        {'token':'b','business_id':1,'role':'owner','platform':'ios','alerts_on':False,'muted_branches':[]},
        {'token':'c','business_id':1,'role':'owner','platform':'ios','alerts_on':True,'muted_branches':[]},
        {'token':'d','business_id':1,'role':'owner','platform':'android','alerts_on':False,'muted_branches':['bgc']},
    ]}
    holders=[]
    def factory(info, project_id=None):
        x=Sender(info,project_id);holders.append(x);return x
    push=make_order_pusher(db=DB(rows),environ=ENV,sender_factory=factory)
    assert push(BUSINESS,ORDER)=={'sent':2,'removed':0,'skipped':False}
    assert holders[0].sent==[('c','ios'),('d','android')]
    assert push(BUSINESS,dict(ORDER,branch_public_id='qc'))['sent']==3

def test_ios_registration_stores_mutes_and_rejects_invalid_payload():
    db=DB()
    app=FastAPI()
    def claims(pid,auth):
        if auth!='Bearer owner' or pid!='biz':raise HTTPException(403,'invalid session')
        return {'business_public_id':'biz','role':'owner'}
    operator=make_menu_order_operator(db=db,get_business=lambda pid:BUSINESS if pid=='biz' else None,get_claims=claims)
    register_menu_order_push_routes(app,db=db,operator=operator,get_business=lambda pid:BUSINESS if pid=='biz' else None,environ={})
    client=TestClient(app)
    url='/api/v1/business/biz/app-devices'
    headers={'Authorization':'Bearer owner'}
    r=client.post(url,headers=headers,json={'token':'one','platform':'ios','alerts_on':False,'muted_branches':['bgc','qc']})
    assert r.status_code==200, r.text
    assert db.rows[TABLE][0]['alerts_on'] is False
    assert db.rows[TABLE][0]['muted_branches']==['bgc','qc']
    assert client.post(url,headers=headers,json={'token':'two','platform':'ios','alerts_on':'false'}).status_code==400
    assert client.post(url,headers=headers,json={'token':'two','platform':'ios','muted_branches':'bgc'}).status_code==400
    assert client.post(url,headers=headers,json={'token':'two','platform':'android'}).status_code==200
    assert 'alerts_on' not in db.rows[TABLE][1]


def test_ios_booking_alert_has_sound_and_no_customer_details():
    sent=[]
    class Response:
        status_code=200
        def json(self): return {"name":"ok"}
    def post(url, **kw): sent.append(kw["json"]); return Response()
    sender=FcmSender({"client_email":"test@example.org","private_key":"unused"},post=post)
    sender.access_token=lambda force=False:"fake-token"
    payload={"type":"new_booking","business":"biz","booking_id":"id","branch_public_id":"bgc"}
    assert sender.send("ios-token",payload,platform="ios")=="ok"
    msg=sent[0]["message"]
    assert msg["data"]==payload
    assert msg["apns"]["headers"]["apns-push-type"]=="alert"
    aps=msg["apns"]["payload"]["aps"]
    assert aps["alert"]=={"title":"New reservation","body":"Open Reservations to review the request."}
    assert aps["sound"]=="default"
    assert aps["thread-id"]=="lt-bookings-bgc"
    assert "android" not in msg
