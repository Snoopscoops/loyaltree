import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock
import httpx
from fastapi import HTTPException

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
                return SimpleNamespace(data=db.business if table=='businesses' else None)
        return Query()

class LoginOutageTests(unittest.TestCase):
    def login(self,db,password):
        source=Path(__file__).resolve().parents[1]/'main.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.AsyncFunctionDef) and n.name=='login')
        node.decorator_list=[]
        fail=MagicMock()
        env=dict(LoginRequest=object,Request=object,HTTPException=HTTPException,supabase=db,
                 _check_auth_bruteforce=lambda *a:None,get_admin_token=lambda:None,
                 SUPER_ADMIN_EMAIL='',SUPER_ADMIN_PASSWORD='',hash_password=lambda x:'hash:'+x,
                 _clear_auth_failures=lambda *a:None,_record_auth_failure=fail,
                 create_owner_session_token=lambda b:'test-session',print=lambda *a:None)
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),env)
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
