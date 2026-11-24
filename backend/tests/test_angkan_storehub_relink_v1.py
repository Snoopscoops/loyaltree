"""Isolated StoreHub relink regression tests: no actual provider or database access."""
import ast
import re
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import pytest

class HTTPException(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)

NAMES = {'connect_storehub_account', '_normalize_storehub_store_name',
         '_storehub_is_placeholder_location_id', '_merge_pos_config',
         '_require_storehub_relink_pairing_ready', '_pos_public_integration'}
SOURCE = Path(__file__).resolve().parents[1] / 'main.py'
NODES = [n for n in ast.parse(SOURCE.read_text()).body if isinstance(n, ast.FunctionDef) and n.name in NAMES]
assert len(NODES) == len(NAMES)
for n in NODES:
    n.decorator_list = []
CODE = compile(ast.fix_missing_locations(ast.Module(body=NODES, type_ignores=[])), str(SOURCE), 'exec')

class DB:
    def __init__(self, row):
        self.row = deepcopy(row)
        self.writes = []
        self.filters = []
    def table(self, name):
        assert name == 'pos_integrations'
        return self
    def update(self, payload):
        self.payload = payload
        return self
    def eq(self, key, value):
        self.filters.append(('eq', key, value)); return self
    def neq(self, key, value):
        self.filters.append(('neq', key, value)); return self
    def is_(self, key, value):
        assert value == 'null'
        return self.eq(key, None)
    def execute(self):
        for op, key, value in self.filters:
            if (self.row.get(key) == value) != (op == 'eq'):
                return SimpleNamespace(data=[])
        self.writes.append(deepcopy(self.payload))
        self.row.update(self.payload)
        return SimpleNamespace(data=[deepcopy(self.row)])

def fixture(*, merchant='angkan-c5a1', name='angkan', saved=None, stores=None, verified=False, race=False, deny=False, live=True):
    row = {'id':'existing-id', 'business_id':12, 'provider':'storehub',
           'status':'live' if live else 'connected', 'mode':'live' if live else 'test',
           'external_account_name':name, 'credentials_ciphertext':saved,
           'connected_at':'old', 'config':{'custom_rule':'retain','redemption_enabled':True,'setup_step':7,'real_api_tested_at':'old','live_transaction_polling':True},
           'capabilities':{'discount_write':True,'live_companion_earning':True,'open_cart_write':True}}
    db = DB(row)
    probes = []
    def probe(account, token):
        probes.append((account, token))
        if deny: raise HTTPException(422,'denied')
        if race: db.row['credentials_ciphertext'] = 'concurrently-saved'
        return {'stores': [{'id':'store-real','name':'Outlet'}] if stores is None else stores,
                'transactions_verified':verified, 'stores_read':True,
                'transaction_status':'verified' if verified else 'denied','outlet_source':'stores'}
    env = dict(HTTPException=HTTPException, Optional=Optional, re=re, datetime=datetime,
               POSStoreHubConnectRequest=object, Header=lambda **kw: '', supabase=db,
               _require_pos_pro_business=lambda *a: {'id':12,'public_id':merchant},
               _get_pos_integration=lambda *a: deepcopy(row), _pos_credentials_cipher=lambda: None,
               _storehub_discover_outlets_with_credentials=probe,
               _encrypt_pos_credentials=lambda payload: 'encrypted-test-value',
               _pos_schema_error=lambda exc: exc,
               _storehub_test_previous_credentials=lambda *a: {'previous':True},
               _decrypt_pos_credentials=lambda *a: {'store_name':'angkan','api_token':'fake'},
               _storehub_read_connection_transactions=lambda *a: (_ for _ in ()).throw(HTTPException(422,'denied')))
    env['_storehub_connection_result'] = lambda b,i,c,**kw: {'integration':env['_pos_public_integration'](i), 'check':c, **kw}
    exec(CODE,env)
    def connect(account='angkan'):
        return env['connect_storehub_account'](merchant, SimpleNamespace(store_name=account,api_token='fake-token'), 'fake-owner')
    return connect, db, probes, env

def test_same_account_relinks_without_transaction_permission():
    connect, db, probes, _ = fixture()
    result = connect('https://angkan.storehubhq.com/')
    i = result['integration']; c = i['config']
    assert i['id'] == 'existing-id' and i['mode'] == 'test' and i['status'] == 'connected'
    assert c['custom_rule'] == 'retain' and c['setup_step'] == 2
    assert c['storehub_relink_pending'] and not c['live_transaction_polling']
    assert not c['redemption_enabled'] and not c['real_api_tested'] and c['real_api_tested_at'] is None
    assert not i['capabilities']['discount_write'] and not i['capabilities']['live_companion_earning']
    assert 'credentials_ciphertext' not in i and db.row['credentials_ciphertext'] == 'encrypted-test-value'
    assert len(db.writes)==1 and probes == [('angkan','fake-token')]

@pytest.mark.parametrize('kwargs,account', [({'merchant':'other'},'angkan'), ({},'different'), ({'name':None},'angkan'), ({'saved':''},'angkan')])
def test_unsafe_identity_or_credential_state_rejected(kwargs,account):
    connect, db, probes, _ = fixture(**kwargs)
    with pytest.raises(HTTPException) as exc: connect(account)
    assert exc.value.status_code == 409 and not db.writes and not probes

@pytest.mark.parametrize('stores',[[],[{'id':'test-a'},{'id':'mock-b'},{'id':''}]])
def test_no_real_outlets_rejected(stores):
    connect,db,_,_=fixture(stores=stores)
    with pytest.raises(HTTPException): connect()
    assert not db.writes

def test_provider_denial_leaves_existing_row():
    connect,db,_,_=fixture(deny=True)
    with pytest.raises(HTTPException): connect()
    assert not db.writes and db.row['status']=='live'

def test_concurrent_credentials_not_overwritten():
    connect,db,_,_=fixture(race=True)
    with pytest.raises(HTTPException): connect()
    assert not db.writes and db.row['credentials_ciphertext']=='concurrently-saved'

def test_existing_credentials_not_replaced():
    connect,db,probes,_=fixture(saved='original')
    assert connect()['saved'] is True
    assert not db.writes and not probes

def test_verified_still_not_auto_live():
    connect,db,_,_=fixture(verified=True)
    i=connect()['integration']
    assert i['mode']=='test' and i['config']['real_api_tested'] and not i['config']['live_transaction_polling']

def test_pairing_requires_fresh_read_after_relink():
    connect,db,_,env=fixture()
    connect()
    gate=env['_require_storehub_relink_pairing_ready']
    with pytest.raises(HTTPException): gate(db.row)
    env['_storehub_read_connection_transactions']=lambda *a: []
    gate(db.row)
    gate({'config':{}})
