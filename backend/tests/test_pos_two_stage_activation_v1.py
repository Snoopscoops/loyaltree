"""Stage 2 application contracts. RPC is mocked; SQL requires separate PostgreSQL integration testing."""
import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import hashlib
import secrets
import pytest

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
NAMES = {'create_pos_device_activation_code','_pos_pending_pairing_outlet','_pos_require_pending_pairing_rpc',
         '_pos_pending_activation_mapping','_pos_activation_row','_pos_parse_timestamp','_pos_secret_hash',
         '_pos_register_id','_pos_storehub_register_required','_storehub_is_placeholder_location_id',
         '_pos_companion_preview_payload','activate_pos_companion_device','_pos_activate_pending_device',
         '_pos_public_device','_pos_pairing_pending','_pos_device_register_id','_pos_device_seen_register_ids'}
nodes = [n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.FunctionDef) and n.name in NAMES]
assert len(nodes)==len(NAMES)
for n in nodes: n.decorator_list=[]
CODE=compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(SOURCE),'exec')

class HTTPException(Exception):
    def __init__(self,status_code,detail): self.status_code=status_code;self.detail=detail;super().__init__(detail)

class Query:
    def __init__(self,db,name): self.db=db;self.name=name;self.filters=[];self.payload=None
    def select(self,*a): return self
    def eq(self,k,v): self.filters.append((k,v));return self
    def order(self,*a): return self
    def limit(self,*a): return self
    def insert(self,payload): self.payload=deepcopy(payload);return self
    def execute(self):
        if self.payload is not None:
            assert self.name=='pos_device_activation_codes'
            row={'id':'code-id',**self.payload};self.db.rows[self.name].append(row)
            return SimpleNamespace(data=[deepcopy(row)])
        return SimpleNamespace(data=[deepcopy(row) for row in self.db.rows[self.name] if all(str(row.get(k))==str(v) for k,v in self.filters)])

class DB:
    def __init__(self,rows): self.rows=rows;self.ready=True;self.calls=[];self.result_change={};self.rpc_error=None
    def table(self,name): return Query(self,name)
    def rpc(self,name,args):
        self.calls.append((name,deepcopy(args)))
        def execute():
            if name=='pos_pending_pairing_ready': return SimpleNamespace(data=self.ready)
            assert name=='pos_activate_pending_companion'
            if self.rpc_error: raise self.rpc_error
            code=self.rows['pos_device_activation_codes'][0]
            assert code['used_count']==0 and code['code_hash']==args['p_code_hash']
            code['used_count']=1
            device={'id':'device-id','provider':'storehub','business_id':1,'branch_id':2,'integration_id':'i','mapping_id':'m',
                    'status':'active','device_token_hash':args['p_device_token_hash'],'metadata':{'pairing_verification':'pending'}}
            return SimpleNamespace(data={**device,**self.result_change})
        return SimpleNamespace(execute=execute)

def fixture():
    business={'id':1,'public_id':'angkan-c5a1','name':'ANGKAN','plan':'pro'}
    branch={'id':2,'public_id':'gateway','business_id':1,'name':'Gateway','is_active':True}
    integration={'id':'i','business_id':1,'provider':'storehub','status':'connected','mode':'test','credentials_ciphertext':'saved',
                 'config':{'storehub_outlets':[{'id':'real','name':'Gateway'}],'storehub_relink_pending':True}}
    mapping={'id':'m','business_id':1,'integration_id':'i','branch_id':2,'external_branch_id':'real','is_active':True}
    db=DB({'branches':[branch],'pos_branch_mappings':[mapping],'pos_device_activation_codes':[]})
    e=dict(HTTPException=HTTPException,Header=lambda **kw:None,Optional=Optional,datetime=datetime,timedelta=timedelta,timezone=timezone,
           secrets=secrets,hashlib=hashlib,POSDeviceActivationCodeCreate=object,POSCompanionActivateRequest=object,supabase=db,
           _require_pos_pro_business=lambda *a:business,_pos_business_by_id=lambda *a:business,
           _get_pos_integration=lambda *a:integration,safe_get_branch=lambda *a:branch,business_has_plan_feature=lambda *a:True,
           _validate_manager_activation_scope=lambda *a:None,_pos_schema_error=lambda exc:exc,POS_DEVICE_PROFILES=[],
           _require_storehub_relink_pairing_ready=lambda *a: (_ for _ in ()).throw(HTTPException(422,'transaction access denied')),
           _pos_loyalty_contract=lambda b:{},_pos_redemption_config=lambda i:{'enabled':True,'options':[100]})
    exec(CODE,e)
    def issue(**kw):
        req=SimpleNamespace(**{'provider':'storehub','pending_verification':True,'external_terminal_id':None,'branch_public_id':'gateway',
                               'external_branch_id':'real','external_branch_name':None,'device_name':'New POS','expires_in_minutes':60,'max_uses':5,**kw})
        return e['create_pos_device_activation_code']('angkan-c5a1',req,'owner')
    def activate(code,**kw):
        req=SimpleNamespace(**{'activation_code':code,'branch_public_id':'gateway','external_branch_id':'real','external_terminal_id':None,
                               'hardware_model':'sunmi_t2','scanner_method':'hardware','checkout_mode':'floating','overlay_enabled':False,'app_version':'test',**kw})
        return e['activate_pos_companion_device'](req)
    return e,db,integration,mapping,branch,issue,activate

def test_pending_issue_and_activation_without_transactions_or_register():
    e,db,_,_,_,issue,activate=fixture();result=issue();code=result['activation_code']
    assert result['max_uses']==1 and result['register_required'] is False
    assert e['_pos_parse_timestamp'](result['expires_at'])<=datetime.now(timezone.utc)+timedelta(minutes=15)
    row=db.rows['pos_device_activation_codes'][0]
    assert row['metadata']['pending_mapping_id']=='m' and row['metadata']['pending_pairing'] is True
    preview=e['_pos_companion_preview_payload'](e['_pos_activation_row'](code))
    assert preview['register_required'] is False and preview['pairing_status']=='pending_verification'
    out=activate(code)
    assert out['pairing_status']=='pending_verification' and out['loyalty_actions_allowed'] is False
    assert out['redemption_config']['enabled'] is False and out['redemption_config']['options']==[]
    assert 'device_token_hash' not in out['device'] and out['device']['external_terminal_id'] is None
    assert db.calls[-1][0]=='pos_activate_pending_companion'
    assert row['used_count']==1 and e['_pos_activation_row'](code) is None
    with pytest.raises(HTTPException) as x: activate(code)
    assert x.value.status_code==401

@pytest.mark.parametrize('change',[{'provider':'loyverse'},{'external_terminal_id':'invented'},{'pending_verification':False}])
def test_no_implicit_bypass_or_non_storehub_pending(change):
    _,db,_,_,_,issue,_=fixture()
    with pytest.raises(HTTPException): issue(**change)
    assert not db.rows['pos_device_activation_codes']

@pytest.mark.parametrize('change',[{'credentials_ciphertext':None},{'status':'disconnected'},{'config':{'storehub_outlets':[]}},{'config':{'storehub_outlets':[{'id':'other'}]}}])
def test_unlinked_or_unknown_outlet_rejected(change):
    _,db,i,_,_,issue,_=fixture();i.update(change)
    with pytest.raises(HTTPException) as x: issue()
    assert x.value.status_code==409 and not db.rows['pos_device_activation_codes']

def test_rpc_migration_missing_fails_closed():
    _,db,_,_,_,issue,_=fixture();db.ready=False
    with pytest.raises(HTTPException) as x: issue()
    assert x.value.status_code==503 and not db.rows['pos_device_activation_codes']

@pytest.mark.parametrize('change',[{'is_active':False},{'external_branch_id':'different'},{'integration_id':'different'},{'business_id':99},{'branch_id':99}])
def test_changed_mapping_invalidates_code_before_device_creation(change):
    _,db,_,m,_,issue,activate=fixture();code=issue()['activation_code'];m.update(change)
    with pytest.raises(HTTPException): activate(code)
    assert all(name!='pos_activate_pending_companion' for name,_ in db.calls)
    assert db.rows['pos_device_activation_codes'][0]['used_count']==0

@pytest.mark.parametrize('change',[{'external_branch_id':'wrong'},{'external_terminal_id':'fake'}])
def test_client_cannot_change_outlet_or_set_register(change):
    _,db,_,_,_,issue,activate=fixture();code=issue()['activation_code']
    with pytest.raises(HTTPException): activate(code,**change)
    assert all(name!='pos_activate_pending_companion' for name,_ in db.calls)

@pytest.mark.parametrize('change',[{'revoked_at':'now'},{'expires_at':'2000-01-01T00:00:00+00:00'},{'used_count':1}])
def test_expired_revoked_consumed_code_rejected(change):
    _,db,_,_,_,issue,activate=fixture();code=issue()['activation_code'];db.rows['pos_device_activation_codes'][0].update(change)
    with pytest.raises(HTTPException) as x: activate(code)
    assert x.value.status_code==401

def test_atomic_rpc_error_never_returns_token():
    _,db,_,_,_,issue,activate=fixture();code=issue()['activation_code'];db.rpc_error=Exception('P0001 already consumed')
    with pytest.raises(HTTPException) as x: activate(code)
    assert x.value.status_code==409

@pytest.mark.parametrize('change',[{'metadata':{}},{'metadata':{'pairing_verification':'verified','external_terminal_id':'r'}},{'mapping_id':'other'}])
def test_unexpected_rpc_result_never_returns_token(change):
    _,db,_,_,_,issue,activate=fixture();code=issue()['activation_code'];db.result_change=change
    with pytest.raises(HTTPException) as x: activate(code)
    assert x.value.status_code==503
