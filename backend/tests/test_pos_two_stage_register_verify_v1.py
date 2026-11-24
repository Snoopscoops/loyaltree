"""Owner-only verification contracts; provider and RPC mocked, not a live DB test."""
import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import hashlib
import pytest
from test_pos_two_stage_activation_v1 import Query, HTTPException

SOURCE=Path(__file__).resolve().parents[1]/'main.py'
NAMES={'_pos_owner_pending_register_context','_pos_owner_pending_evidence','get_pending_pos_register_evidence','verify_pending_pos_register','_pos_pending_pairing_outlet','_pos_device_register_id','_pos_register_id','_pos_parse_timestamp','_pos_secret_hash','_storehub_is_placeholder_location_id','_pos_public_device','_pos_pairing_pending','_pos_device_seen_register_ids'}
nodes=[n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.FunctionDef) and n.name in NAMES]
assert len(nodes)==len(NAMES)
for n in nodes: n.decorator_list=[]
CODE=compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),str(SOURCE),'exec')

class DB:
    def __init__(self, rows): self.rows=rows;self.calls=[];self.error=None
    def table(self,name): return Query(self,name)
    def rpc(self,name,args):
        self.calls.append((name,deepcopy(args)))
        def execute():
            if self.error: raise self.error
            assert name=='pos_verify_pending_storehub_register'
            device=self.rows['pos_devices'][0]
            assert args['p_expected_token_hash']==device['device_token_hash']
            device['metadata'].update(pairing_verification='verified',external_terminal_id=args['p_register_id'])
            return SimpleNamespace(data=deepcopy(device))
        return SimpleNamespace(execute=execute)

def fixture():
    now=datetime.now(timezone.utc)
    d={'id':'device','business_id':1,'branch_id':2,'integration_id':'i','mapping_id':'m','provider':'storehub','status':'active','device_token_hash':'token','metadata':{'pairing_verification':'pending','pending_pairing_outlet_id':'outlet','pending_pairing_started_at':(now-timedelta(minutes=20)).isoformat()}}
    i={'id':'i','business_id':1,'provider':'storehub','status':'connected','credentials_ciphertext':'encrypted','config':{'storehub_outlets':[{'id':'outlet'}]}}
    m={'id':'m','business_id':1,'branch_id':2,'integration_id':'i','external_branch_id':'outlet','is_active':True}
    b={'id':2,'business_id':1,'is_active':True}
    db=DB({'pos_devices':[d],'branches':[b]})
    receipt={'external_transaction_id':'tx','provider_receipt_number':'receipt','terminal_id':'reg','transacted_at_utc':(now-timedelta(minutes=5)).isoformat()}
    evidence=[receipt]; reads=[]; invalidations=[]; duplicates=[]
    def peek(*args): reads.append(args);return {'transactions':deepcopy(evidence)}
    def auth(pid,authorization):
        if authorization!='owner': raise HTTPException(403,'owner required')
        return {'id':1}
    def register_available(*args):
        if duplicates: raise HTTPException(409,'duplicate')
    e=dict(HTTPException=HTTPException,Header=lambda **kw:None,Optional=Optional,POSPendingRegisterVerify=object,
        datetime=datetime,timedelta=timedelta,timezone=timezone,hashlib=hashlib,supabase=db,_require_pos_pro_business=auth,
        _get_pos_integration=lambda *a:i,_companion_mock_mapping=lambda *a:m,_pos_schema_error=lambda exc:exc,
        _pos_pending_register_peek=peek,_pos_require_register_guard=lambda:None,_pos_assert_register_available=register_available,
        _pos_device_cache_invalidate=lambda id:invalidations.append(id))
    exec(CODE,e)
    def verify(auth='owner',**kw):
        req=SimpleNamespace(**{'external_transaction_id':'tx','receipt_number':'receipt','external_terminal_id':'reg','physical_receipt_confirmed':True,**kw})
        return e['verify_pending_pos_register']('biz','device',req,auth)
    return SimpleNamespace(e=e,db=db,d=d,i=i,m=m,b=b,receipt=receipt,evidence=evidence,reads=reads,invalidations=invalidations,duplicates=duplicates,verify=verify)

def test_fresh_evidence_and_atomic_rpc():
    f=fixture(); evidence=f.e['get_pending_pos_register_evidence']('biz','device','owner')
    assert evidence['transactions']==f.evidence and evidence['loyalty_actions_allowed'] is False and not f.db.calls
    out=f.verify(); assert len(f.reads)==2 and out['pairing_status']=='verified' and out['device']['external_terminal_id']=='reg'
    assert 'device_token_hash' not in out['device'] and f.invalidations==['device']
    name,args=f.db.calls[0];assert name=='pos_verify_pending_storehub_register' and args['p_credentials_digest']==hashlib.sha256(b'encrypted').hexdigest() and args['p_outlet_id']=='outlet'
    with pytest.raises(HTTPException): f.verify()

@pytest.mark.parametrize('kwargs',[{'auth':'manager'},{'physical_receipt_confirmed':False},{'external_transaction_id':'other'},{'receipt_number':'wrong'},{'external_terminal_id':'wrong'}])
def test_wrong_identity_or_no_confirmation_never_binds(kwargs):
    f=fixture()
    with pytest.raises(HTTPException): f.verify(**kwargs)
    assert not f.db.calls and f.d['metadata']['pairing_verification']=='pending'

@pytest.mark.parametrize('key,change',[('d',{'revoked_at':'now'}),('d',{'status':'disabled'}),('m',{'is_active':False}),('m',{'external_branch_id':'other'}),('i',{'credentials_ciphertext':None}),('i',{'status':'disconnected'}),('b',{'is_active':False})])
def test_changed_scope_never_binds(key,change):
    f=fixture();getattr(f,key).update(change)
    with pytest.raises(HTTPException): f.verify()
    assert not f.db.calls

@pytest.mark.parametrize('change',[{'provider_receipt_number':''},{'transacted_at_utc':'2020-01-01T00:00:00Z'},{'transacted_at_utc':'invalid'}])
def test_nonreceipt_or_pre_activation_evidence_rejected(change):
    f=fixture();f.receipt.update(change)
    with pytest.raises(HTTPException): f.verify()
    assert not f.db.calls

def test_ambiguous_provider_id_rejected():
    f=fixture();f.evidence.append({**f.receipt,'terminal_id':'other'})
    with pytest.raises(HTTPException): f.verify()
    assert not f.db.calls

def test_duplicate_rejected():
    f=fixture();f.duplicates.append('reg')
    with pytest.raises(HTTPException): f.verify()
    assert not f.db.calls

def test_denied_provider_read_stays_pending():
    f=fixture();f.e['_pos_pending_register_peek']=lambda *a: (_ for _ in ()).throw(HTTPException(403,'denied'))
    with pytest.raises(HTTPException) as exc: f.verify()
    assert exc.value.status_code==403 and not f.db.calls

@pytest.mark.parametrize('error,status',[(Exception('P0001 changed'),409),(Exception('pos_devices_storehub_register_active_uidx'),409),(Exception('RPC unavailable'),503)])
def test_atomic_conflicts_fail_closed(error,status):
    f=fixture();f.db.error=error
    with pytest.raises(HTTPException) as exc: f.verify()
    assert exc.value.status_code==status and f.d['metadata']['pairing_verification']=='pending' and not f.invalidations

def test_legacy_register_editor_rejects_explicit_two_stage_marker():
    node=next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='set_pos_device_register')
    src=ast.unparse(node)
    assert "'pairing_verification' in" in src and src.index("'pairing_verification' in")<src.index("rpc('pos_assign_storehub_register'")

def test_sql_uses_existing_unique_guard_and_private_rpc():
    sql=(SOURCE.parent/'storehub_pending_pairing.sql').read_text()
    section=sql[sql.index('create or replace function public.pos_verify_pending_storehub_register'):]
    assert 'pos_storehub_register_guard_ready()' in section and 'for update' in section and 'for share' in section
    assert 'p_credentials_digest' in section and "'pairing_verification','verified'" in section
    assert 'from public,anon,authenticated' in section and 'to service_role' in section
