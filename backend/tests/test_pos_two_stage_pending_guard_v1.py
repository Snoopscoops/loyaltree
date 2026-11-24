"""Isolated AST tests of stage 1. No live database/provider calls."""
import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import pytest

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
TREE = ast.parse(SOURCE.read_text())
NAMES = {'_pos_device_register_id', '_pos_pairing_pending', '_pos_require_pairing_verified', '_require_pos_device', '_pos_public_device', '_pos_device_seen_register_ids', '_pos_pending_register_peek', '_storehub_register_id', '_storehub_recent_rows', '_storehub_transaction_event_time', '_pos_parse_timestamp', '_companion_money_value', '_companion_normalize_provider_transaction', '_storehub_is_placeholder_location_id', 'pos_companion_connectivity'}
nodes = [n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name in NAMES]
assert len(nodes) == len(NAMES)
for n in nodes: n.decorator_list = []
CODE = compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(SOURCE),'exec')
class HTTPException(Exception):
    def __init__(self,status_code,detail):
        self.status_code=status_code; self.detail=detail
        super().__init__(detail)

class DB:
    def __init__(self, row): self.row=row; self.reads=0
    def table(self,name): assert name=='pos_devices'; self.filters={}; return self
    def select(self,*a): return self
    def eq(self,k,v): self.filters[k]=v; return self
    def limit(self,*a): return self
    def execute(self):
        self.reads+=1
        return SimpleNamespace(data=[deepcopy(self.row)] if self.row and all(self.row.get(k)==v for k,v in self.filters.items()) else [])

def device(marker='pending', register=None, provider='storehub'):
    return {'id':'d','business_id':1,'integration_id':'i','branch_id':2,'mapping_id':'m','provider':provider,'device_token_hash':'token','status':'active','metadata':{**({'pairing_verification':marker} if marker!='legacy' else {}), **({'external_terminal_id':register} if register else {})}}

def env(row, cache=None):
    db=DB(row)
    e=dict(HTTPException=HTTPException,Header=lambda **kw:None,Optional=Optional,datetime=datetime,timedelta=timedelta,timezone=timezone,
           Decimal=Decimal,ROUND_HALF_UP=ROUND_HALF_UP,supabase=db,_pos_secret_hash=lambda s:s,_pos_device_cache_get=lambda t:deepcopy(cache),
           _pos_device_cache_put=lambda *a:None,_pos_business_by_id=lambda i:{'id':i}, billing_hold=lambda b:False,
           _pos_device_heartbeat_due=lambda i:False,_pos_schema_error=lambda e:e,
           _ph_time_text=lambda v:str(v))
    exec(CODE,e)
    return e,db

@pytest.mark.parametrize('marker,register', [('pending',None),('pending','x'),('verified',None),('unexpected','x'),(None,'x')])
def test_pending_fails_closed_even_if_cached_legacy(marker,register):
    e,db=env(device(marker,register),device('legacy','old'))
    with pytest.raises(HTTPException) as exc: e['_require_pos_device']('token')
    assert exc.value.status_code==409 and db.reads==1

@pytest.mark.parametrize('marker,register,provider',[('legacy',None,'storehub'),('legacy','r','storehub'),('verified','r','storehub'),('pending',None,'loyverse')])
def test_legacy_and_verified_not_changed(marker,register,provider):
    e,_=env(device(marker,register,provider))
    assert e['_require_pos_device']('token')['id']=='d'

def test_diagnostics_can_authenticate_pending_without_enabling_actions():
    e,_=env(device())
    d=e['_require_pos_device']('token',allow_pending=True)
    public=e['_pos_public_device'](d)
    assert public['pairing_status']=='pending_verification' and public['loyalty_actions_allowed'] is False
    assert 'device_token_hash' not in public

@pytest.mark.parametrize('change',[{'status':'revoked'},{'device_token_hash':'new-token'}])
def test_rotated_or_revoked_token_rejected_even_with_cache(change):
    cached=device('legacy','old'); e,_=env({**cached,**change},cached)
    with pytest.raises(HTTPException) as exc: e['_require_pos_device']('token',allow_pending=True)
    assert exc.value.status_code==401

# Ensure only explicitly reviewed diagnostics can opt out of the default gate.
def test_only_diagnostic_endpoints_allow_pending():
    found=set(); callers=set()
    for node in TREE.body:
        if not isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)): continue
        for call in ast.walk(node):
            if isinstance(call,ast.Call) and isinstance(call.func,ast.Name) and call.func.id=='_require_pos_device':
                callers.add(node.name)
                if call.keywords:
                    assert len(call.keywords)==1 and call.keywords[0].arg=='allow_pending' and call.keywords[0].value.value is True
                    found.add(node.name)
    assert found=={'pos_companion_device_config','companion_pos_peek','pos_companion_connectivity'}
    assert {'pos_companion_points_reserve','companion_redemption_reserve','companion_session_match','companion_session_poll','pos_companion_offline_sales_sync','pos_companion_coupon_commit','pos_companion_benefit_commit','companion_session_test_sale','companion_angkan_reserve'} <= callers

def peek_fixture(mapping_change=None,integration_change=None,rows=None,error=None):
    d=device();e,db=env(d)
    mapping={'id':'m','is_active':True,'business_id':1,'integration_id':'i','branch_id':2,'external_branch_id':'real-outlet'}
    integration={'id':'i','business_id':1,'provider':'storehub','credentials_ciphertext':'encrypted','config':{'storehub_outlets':[{'id':'real-outlet'}]}}
    calls=[]
    e['_companion_mock_mapping']=lambda d:{**mapping,**(mapping_change or {})}
    def fetch(i,**kwargs):
        calls.append(kwargs)
        if error: raise error
        return {},rows or [],{}
    e['_storehub_fetch_recent_transaction_rows']=fetch
    return e,d,{**integration,**(integration_change or {})},calls,db

def sale(id,outlet='real-outlet',register='r',**kw):
    return {'refId':id,'storeId':outlet,'registerId':register,'total':10,'transactionTime':(datetime.now(timezone.utc)-timedelta(minutes=5)).isoformat(),**kw}

def test_peek_returns_only_actual_recent_sale_registers_without_bridge_writes():
    e,d,i,calls,db=peek_fixture(rows=[sale('one',register='r1'),sale('two',register='r2'),sale('foreign',outlet='different',register='r3'),sale('no-register',register=''),sale('void',register='r4',isCancelled=True),sale('cancelled',register='r5',transactionType='cancel'),sale('old',register='r6',transactionTime='2023-01-01T00:00:00Z')])
    result=e['_pos_pending_register_peek'](d,i,10)
    assert result['seen_register_ids']==['r1','r2']
    assert {row['external_transaction_id'] for row in result['transactions']}=={'one','two'}
    assert result['external_terminal_id'] is None and result['loyalty_actions_allowed'] is False
    assert db.reads==0 and calls[0]['persist_paging_hint'] is False and calls[0]['external_branch_id']=='real-outlet'

@pytest.mark.parametrize('change',[{'is_active':False},{'business_id':99},{'branch_id':99},{'integration_id':'other'},{'external_branch_id':'test-foo'},{'external_branch_id':'unknown'}])
def test_peek_rejects_invalid_mapping_before_provider_read(change):
    e,d,i,calls,_=peek_fixture(mapping_change=change)
    with pytest.raises(HTTPException) as exc: e['_pos_pending_register_peek'](d,i,10)
    assert exc.value.status_code==409 and calls==[]

@pytest.mark.parametrize('change',[{'business_id':99},{'id':'other'},{'credentials_ciphertext':None},{'provider':'loyverse'}])
def test_peek_rejects_wrong_integration(change):
    e,d,i,calls,_=peek_fixture(integration_change=change)
    with pytest.raises(HTTPException) as exc: e['_pos_pending_register_peek'](d,i,10)
    assert exc.value.status_code==409 and calls==[]

def test_provider_denial_is_not_treated_as_verification():
    e,d,i,calls,_=peek_fixture(error=HTTPException(403,'denied'))
    with pytest.raises(HTTPException) as exc: e['_pos_pending_register_peek'](d,i,10)
    assert exc.value.status_code==403

@pytest.mark.parametrize('integration,probe,expected', [(None,True,False), ({'id':'i','credentials_ciphertext':'encrypted'},True,True), ({'id':'i','credentials_ciphertext':'encrypted'},False,False)])
def test_pending_connectivity_never_enables_queue_or_updates_integration(integration,probe,expected):
    e,db=env(device())
    e['_get_pos_integration']=lambda *a:integration
    calls=[]
    e['_storehub_get']=lambda *a:calls.append(a)
    result=e['pos_companion_connectivity'](probe,'token')
    assert result['state']=='pending_verification' and result['provider_online'] is expected
    assert result['offline_policy']['earning_can_queue'] is False
    assert result['loyalty_actions_allowed'] is False and bool(calls) is expected
