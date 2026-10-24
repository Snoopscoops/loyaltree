import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
import sys
from unittest.mock import MagicMock
import httpx
from fastapi import HTTPException
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import password_security

class FakeDB:
    def __init__(self,business=None,fail=False):
        self.business,self.fail=business,fail
    def table(self,table):
        db=self
        class Query:
            def __getattr__(self,name):
                return lambda *a,**k:self
            def execute(self):
                if table=='businesses' and db.fail:
                    raise httpx.DecodingError('Error -3 while decompressing data: incorrect header check')
                return SimpleNamespace(data=[{'email':'test@example.invalid',**db.business}] if table=='businesses' and db.business else [])
        return Query()

class LoginOutageTests(unittest.TestCase):
    def login(self,db,password):
        source=Path(__file__).with_name('main.py')
        if not source.exists(): source=Path(__file__).resolve().parents[1]/'main.py'
        nodes=ast.parse(source.read_text()).body
        helper=next(n for n in nodes if isinstance(n,ast.FunctionDef) and n.name=='_login_lookup_one')
        node=next(n for n in nodes if isinstance(n,ast.AsyncFunctionDef) and n.name=='login')
        node.decorator_list=[]
        fail=MagicMock()
        env=dict(LoginRequest=object,Request=object,HTTPException=HTTPException,supabase=db,
                 asyncio=asyncio,owner_password_security=SimpleNamespace(
                     verify_owner_password=password_security.verify_owner_password,
                     migrate_owner_password=lambda db,business,password:business,
                     PasswordWorkBusy=password_security.PasswordWorkBusy,
                     OwnerCredentialsChanged=password_security.OwnerCredentialsChanged),
                 _check_auth_bruteforce=lambda *a:None,get_admin_token=lambda:None,
                 SUPER_ADMIN_EMAIL='',SUPER_ADMIN_PASSWORD='',hash_password=lambda x:'hash:'+x,
                 _clear_auth_failures=lambda *a:None,_record_auth_failure=fail,
                 billing_hold=lambda b:False,create_owner_session_token=lambda b:'test-session',print=lambda *a:None)
        exec(compile(ast.Module(body=[helper,node],type_ignores=[]),str(source),'exec'),env)
        return env['login'],fail,SimpleNamespace(email='test@example.invalid',password=password)

    def test_database_failure_returns_503_without_penalizing_password(self):
        fn,record,req=self.login(FakeDB(fail=True),'correct')
        with self.assertRaises(HTTPException) as caught:asyncio.run(fn(req,object()))
        self.assertEqual(caught.exception.status_code,503)
        self.assertIsInstance(caught.exception.__cause__,httpx.DecodingError)
        record.assert_not_called()

    def test_correct_credentials_still_sign_in(self):
        fn,record,req=self.login(FakeDB({'public_id':'biz','name':'Test','status':'ACTIVE','password_hash':'hash:correct'}),'correct')
        result=asyncio.run(fn(req,object()))
        self.assertEqual(result['role'],'owner')
        self.assertTrue(result['success'])
        record.assert_not_called()

    def test_wrong_password_still_returns_401(self):
        fn,record,req=self.login(FakeDB({'status':'ACTIVE','password_hash':'hash:correct'}),'wrong')
        with self.assertRaises(HTTPException) as caught:asyncio.run(fn(req,object()))
        self.assertEqual(caught.exception.status_code,401)
        record.assert_called_once()
