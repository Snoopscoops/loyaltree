"""Login regressions without app startup, third-party packages or live accounts."""
import ast
import asyncio
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

SOURCE=Path(__file__).with_name('main.py')
if not SOURCE.exists(): SOURCE=Path(__file__).resolve().parents[1]/'main.py'
NODES={node.name:node for node in ast.parse(SOURCE.read_text()).body
       if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef))}

class HTTPError(Exception):
    def __init__(self,status_code,detail):
        self.status_code,self.detail=status_code,detail
        super().__init__(detail)

class DB:
    def __init__(self,**tables): self.tables,self.queries=tables,[]
    def table(self,name):
        db=self
        class Query:
            def select(self,*args): return self
            def eq(self,*args): return self
            def ilike(self,*args): return self
            def limit(self,count): db.queries.append((name,count)); return self
            def maybe_single(self): raise AssertionError('Account lookup must use a list response')
            def execute(self):
                value=db.tables.get(name,[])
                if isinstance(value,Exception): raise value
                if value is None: return None
                return SimpleNamespace(data=deepcopy(value))
        return Query()

class LoginLookupTests(unittest.TestCase):
    def setUp(self):
        self.record=Mock()
        self.env=dict(LoginRequest=object,Request=object,HTTPException=HTTPError,
            _check_auth_bruteforce=lambda *args:None,get_admin_token=lambda:None,
            SUPER_ADMIN_EMAIL='admin@example.invalid',SUPER_ADMIN_PASSWORD='admin-test',
            BASE_URL='https://example.invalid',
            hash_password=lambda value:'hash:'+value,_clear_auth_failures=lambda *args:None,
            _record_auth_failure=self.record,billing_hold=lambda business:business.get('hold',False),
            create_owner_session_token=lambda business:'owner-session',
            create_staff_session_token=lambda *args:'manager-session',
            issue_partner_session=lambda partner:'partner-session',print=lambda *args:None)
        definitions=[deepcopy(NODES[name]) for name in ('_login_lookup_one','login')]
        for node in definitions: node.decorator_list=[]
        exec(compile(ast.Module(body=definitions,type_ignores=[]),str(SOURCE),'exec'),self.env)
    def run_login(self,db,password='correct',email='test@example.invalid'):
        self.env['supabase']=db
        return asyncio.run(self.env['login'](SimpleNamespace(email=email,password=password),object()))
    def assert_status(self,db,status,password='correct'):
        with self.assertRaises(HTTPError) as caught: self.run_login(db,password)
        self.assertEqual(caught.exception.status_code,status)
        return caught.exception
    @staticmethod
    def business(**changes):
        return dict(public_id='business',name='Test',status='ACTIVE',password_hash='hash:correct',**changes)
    def test_empty_result_returns_401_without_attribute_error(self):
        db=DB(); self.assert_status(db,401)
        self.record.assert_called_once()
        self.assertEqual(db.queries,[('network_partners',2),('businesses',2),('staff',2),('cl_agents',2)])
    def test_wrong_owner_password_with_no_staff_row_returns_401(self):
        self.assert_status(DB(businesses=[self.business()]),401,'wrong')
        self.record.assert_called_once()
    def test_correct_owner_can_sign_in(self):
        result=self.run_login(DB(businesses=[self.business()]))
        self.assertEqual(result['role'],'owner');self.assertEqual(result['token'],'owner-session')
        self.record.assert_not_called()
    def test_staff_can_sign_in_when_no_business_email_matches(self):
        result=self.run_login(DB(staff=[dict(public_id='staff',name='Staff',pin='correct',role='manager',
            businesses={'public_id':'business','name':'Test','status':'ACTIVE'})]))
        self.assertEqual(result['role'],'manager');self.assertEqual(result['token'],'manager-session')
        self.record.assert_not_called()
    def test_agent_can_sign_in_after_empty_owner_and_staff_results(self):
        result=self.run_login(DB(cl_agents=[dict(public_id='agent',name='Agent',password_hash='hash:correct',
            businesses={'public_id':'business','name':'Test','status':'ACTIVE'})]))
        self.assertEqual(result['role'],'agent');self.assertTrue(result['success'])
    def test_partner_login_uses_the_list_lookup(self):
        result=self.run_login(DB(network_partners=[dict(public_id='partner',name='Partner',password_hash='hash:correct',is_active=True)]))
        self.assertEqual(result['role'],'partner')
    def test_database_failure_is_still_503_without_password_penalty(self):
        failure=RuntimeError('database unavailable')
        error=self.assert_status(DB(businesses=failure),503)
        self.assertIs(error.__cause__,failure);self.record.assert_not_called()
    def test_missing_response_is_not_treated_as_an_empty_account_list(self):
        self.assert_status(DB(businesses=None),503);self.record.assert_not_called()
    def test_duplicate_email_rows_are_not_arbitrarily_authenticated(self):
        self.assert_status(DB(businesses=[self.business(),self.business()]),503)
        self.record.assert_not_called()
    def test_malformed_data_is_not_authenticated(self):
        for data in ({'public_id':'unexpected'},'unexpected',[None]):
            with self.subTest(data=data): self.assert_status(DB(businesses=data),503)
        self.record.assert_not_called()
    def test_pending_and_disabled_owners_still_receive_403(self):
        for status in ('PENDING','DISABLED'):
            business=self.business();business['status']=status
            with self.subTest(status=status): self.assert_status(DB(businesses=[business]),403)
        self.record.assert_not_called()
    def test_staff_billing_hold_still_blocks_access(self):
        self.assert_status(DB(staff=[dict(public_id='staff',pin='correct',role='cashier',
            businesses={'public_id':'business','status':'ACTIVE','hold':True})]),402)
        self.record.assert_not_called()
    def test_super_admin_still_works_without_database(self):
        self.env['get_admin_token']=lambda:'admin-session'
        result=self.run_login(None,'admin-test','admin@example.invalid')
        self.assertEqual(result['role'],'super_admin');self.record.assert_not_called()
    def test_single_lookup_returns_the_only_row(self):
        db=DB(businesses=[{'id':1}])
        self.assertEqual(self.env['_login_lookup_one'](db.table('businesses')),{'id':1})
        self.assertEqual(db.queries,[('businesses',2)])

if __name__=='__main__':unittest.main()
