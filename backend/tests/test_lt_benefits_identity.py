"""Email identity integration tests use only isolated, synthetic local data."""
import os
import ast
from pathlib import Path
import subprocess
import unittest
from typing import Literal, Optional

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, Field
from lt_benefits import normalize_email


class EmailIdentitySQLTests(unittest.TestCase):
    def test_signup_requires_email_and_only_new_gender_options_before_database_access(self):
        source = Path(__file__).resolve().parents[1] / 'main.py'
        tree = ast.parse(source.read_text())
        model = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'CustomerSignup')
        route = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'customer_signup')
        route.decorator_list = []
        scope = dict(BaseModel=BaseModel, Field=Field, Optional=Optional, Literal=Literal, BackgroundTasks=BackgroundTasks,
                     Header=Header, HTTPException=HTTPException, normalize_lt_email=normalize_email,
                     lt_benefits_public_launch_enabled=lambda: True)
        exec(compile(ast.Module(body=[model, route], type_ignores=[]), str(source), 'exec'), scope)
        app = FastAPI()
        app.post('/join/{business_public_id}')(scope['customer_signup'])
        client = TestClient(app)
        body = dict(name='Synthetic Member', phone='09171234567')
        for email in (None, '', 'not-an-email'):
            request = dict(body)
            if email is not None:
                request['email'] = email
            self.assertEqual(client.post('/join/synthetic', json=request).status_code, 422)
        self.assertEqual(client.post('/join/synthetic', json={**body, 'email':'one@example.invalid', 'gender':'lgbtq'}).status_code, 422)
        for gender in ('male', 'female', 'rather_not_say'):
            response = client.post('/join/synthetic', json={**body, 'email':' ONE@EXAMPLE.INVALID ', 'gender':gender})
            self.assertEqual(response.status_code, 400)  # Next, independent consent guard; no DB or email calls.
            self.assertIn('Consent', response.json()['detail'])
        scope['lt_benefits_public_launch_enabled'] = lambda: False
        for email in (None, '', '   '):
            response = client.post('/join/synthetic', json={**body,'email':email})
            self.assertEqual(response.status_code,400)  # Optional prelaunch; reaches existing consent guard.
            self.assertIn('Consent',response.json()['detail'])

    def test_verified_email_merge_on_real_postgres_engine(self):
        module = os.getenv('LT_BENEFITS_PGLITE', '/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js')
        node = os.getenv('LT_BENEFITS_NODE', '/usr/local/bin/node')
        if not Path(module).is_file() or not Path(node).is_file():
            self.skipTest('Isolated PGlite runtime unavailable')
        tests = Path(__file__).resolve().parent
        result = subprocess.run([node, str(tests / 'test_lt_benefits_identity.mjs'), module, str(tests.parent)],
                                capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, (result.stdout + result.stderr)[-10000:])
        self.assertIn('Email identity SQL passed', result.stdout)


if __name__ == '__main__':
    unittest.main()
