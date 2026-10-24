"""Password compatibility, bounded work, atomic reset and session revocation."""
import ast
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import password_security as passwords

SOURCE = BACKEND / 'main.py'
NODES = {node.name: node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}


def definitions(names, env):
    nodes = [deepcopy(NODES[name]) for name in names]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), 'exec'), env)
    return env


class MemoryDB:
    def __init__(self, *businesses, staff=()):
        self.businesses = deepcopy(list(businesses))
        self.staff = deepcopy(list(staff))
        self.updates = []
        self.reads = []
        self.rpc_calls = []
        self.before_update = None

    def table(self, name):
        db = self

        class Query:
            def __init__(self):
                self.filters, self.changes = [], None
                self.max_rows = 100

            def select(self, *args): return self
            def limit(self, count): self.max_rows = count; return self
            def eq(self, key, value): self.filters.append((key, value)); return self
            def ilike(self, key, value): self.filters.append((key, value.replace('\\', ''))); return self
            def update(self, value): self.changes = value; return self
            def execute(self):
                if self.changes is None: db.reads.append((name, deepcopy(self.filters), threading.get_ident()))
                table = db.businesses if name == 'businesses' else db.staff if name == 'staff' else []
                if self.changes and db.before_update:
                    callback, db.before_update = db.before_update, None
                    callback()
                rows = [row for row in table if all(row.get(key) == value for key, value in self.filters)][:self.max_rows]
                if self.changes:
                    db.updates.append((deepcopy(self.filters), deepcopy(self.changes)))
                    for row in rows: row.update(self.changes)
                return SimpleNamespace(data=deepcopy(rows))
        return Query()

    def rpc(self, name, params):
        self.rpc_calls.append((name, deepcopy(params)))
        db = self

        class Query:
            def execute(self):
                rows = [row for row in db.businesses if row['public_id'] == params['p_public_id']
                        and row.get('password_reset_token_hash') == params['p_token_hash']
                        and row.get('password_reset_expires_at', '') > datetime.utcnow().isoformat()]
                for row in rows:
                    row.update(password_hash=params['p_password_hash'],
                               auth_version=row.get('auth_version', 0) + 1,
                               password_reset_token_hash=None, password_reset_expires_at=None)
                return SimpleNamespace(data=[{'auth_version': row['auth_version']} for row in rows])
        return Query()


def business(**changes):
    return {'id': 7, 'public_id': 'demo', 'name': 'Demo', 'email': 'demo@example.invalid',
            'status': 'ACTIVE', 'auth_version': 0,
            'password_hash': hashlib.sha256(b'correct password').hexdigest(), **changes}


class PasswordTests(unittest.TestCase):
    def test_salted_hashes_verify_and_each_password_has_a_different_salt(self):
        first = passwords.hash_owner_password_sync('a Unicode password 🪴')
        second = passwords.hash_owner_password_sync('a Unicode password 🪴')
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith('pbkdf2_sha256$600000$'))
        self.assertTrue(passwords.verify_owner_password('a Unicode password 🪴', first))
        self.assertFalse(passwords.verify_owner_password('wrong password', first))
        self.assertFalse(passwords.owner_password_needs_upgrade(first))

    def test_legacy_plaintext_and_sha256_survive_without_accepting_hash_as_password(self):
        value = ' correct password '
        digest = hashlib.sha256(value.encode()).hexdigest()
        self.assertTrue(passwords.verify_owner_password(value, value))
        self.assertTrue(passwords.verify_owner_password(value, digest))
        self.assertFalse(passwords.verify_owner_password(digest, digest))
        self.assertFalse(passwords.verify_owner_password(value.strip(), value))
        self.assertTrue(passwords.owner_password_needs_upgrade(digest))
        self.assertTrue(passwords.owner_password_needs_upgrade(value))

    def test_malformed_or_excessively_expensive_envelopes_fail_without_hashing(self):
        values = ['pbkdf2_sha256$999999999$bad$bad', 'pbkdf2_sha256$600000$bad$bad',
                  'pbkdf2_sha256$invalid', '', None]
        with patch.object(passwords.hashlib, 'pbkdf2_hmac') as derive:
            for value in values:
                self.assertFalse(passwords.verify_owner_password(str(value), value))
            derive.assert_not_called()

    def test_legacy_migration_is_conditional_and_preserves_version(self):
        db = MemoryDB(business())
        updated = passwords.migrate_owner_password(db, db.businesses[0], 'correct password')
        self.assertTrue(updated['password_hash'].startswith('pbkdf2_sha256$'))
        self.assertEqual(updated['auth_version'], 0)
        self.assertIn(('password_hash', hashlib.sha256(b'correct password').hexdigest()), db.updates[0][0])

    def test_migration_never_overwrites_password_reset_that_wins_the_race(self):
        db = MemoryDB(business())
        candidate = deepcopy(db.businesses[0])
        db.before_update = lambda: db.businesses[0].update(password_hash='a concurrent reset', auth_version=1)
        with self.assertRaises(passwords.OwnerCredentialsChanged):
            passwords.migrate_owner_password(db, candidate, 'correct password')
        self.assertEqual(db.businesses[0]['password_hash'], 'a concurrent reset')

    def test_async_hash_runs_outside_event_loop(self):
        async def scenario():
            started, finish = threading.Event(), threading.Event()
            loop_thread = threading.get_ident()

            def derive(*args):
                self.assertNotEqual(threading.get_ident(), loop_thread)
                started.set()
                self.assertTrue(finish.wait(2))
                return b'x' * 32

            with patch.object(passwords.hashlib, 'pbkdf2_hmac', side_effect=derive):
                task = asyncio.create_task(passwords.hash_owner_password('correct password'))
                try:
                    await asyncio.to_thread(started.wait, 1)
                    await asyncio.sleep(0)
                    self.assertFalse(task.done())
                finally:
                    finish.set()
                    await task
        asyncio.run(scenario())

    def test_busy_hash_budget_is_bounded_and_retryable(self):
        self.assertTrue(passwords._HASH_SLOTS.acquire(False))
        self.assertTrue(passwords._HASH_SLOTS.acquire(False))
        try:
            with self.assertRaises(HTTPException) as caught:
                asyncio.run(passwords.hash_owner_password('correct password'))
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(caught.exception.headers, {'Retry-After': '1'})
        finally:
            passwords._HASH_SLOTS.release(); passwords._HASH_SLOTS.release()


class OwnerSessionTests(unittest.TestCase):
    def claims(self, **changes):
        return {'role': 'owner', 'business_public_id': 'demo', 'business_id': 7, **changes}

    def test_existing_tokens_without_version_keep_working_before_reset(self):
        row = passwords.validate_business_auth_version(MemoryDB(business()), self.claims())
        self.assertEqual(row['id'], 7)

    def test_old_tokens_fail_immediately_after_reset_and_new_tokens_work(self):
        db = MemoryDB(business(auth_version=1))
        for claims in (self.claims(), self.claims(auth_version=0)):
            with self.assertRaises(HTTPException) as caught:
                passwords.validate_business_auth_version(db, claims)
            self.assertEqual(caught.exception.status_code, 401)
        self.assertEqual(passwords.validate_business_auth_version(db, self.claims(auth_version=1))['id'], 7)

    def test_roles_business_and_version_types_are_not_interchangeable(self):
        for claims in (self.claims(role='billing'), self.claims(role='cashier'), self.claims(auth_version=True),
                       self.claims(auth_version='0'), self.claims(business_id=99)):
            with self.subTest(claims=claims), self.assertRaises(HTTPException):
                passwords.validate_business_auth_version(MemoryDB(business()), claims)
        with self.assertRaises(HTTPException):
            passwords.validate_business_auth_version(None, self.claims(), business(public_id='other'))

    def test_missing_or_unavailable_account_fails_closed(self):
        with self.assertRaises(HTTPException) as caught:
            passwords.validate_business_auth_version(None, self.claims())
        self.assertEqual(caught.exception.status_code, 503)
        with self.assertRaises(HTTPException) as caught:
            passwords.validate_business_auth_version(MemoryDB(), self.claims())
        self.assertEqual(caught.exception.status_code, 401)

    def test_session_issuance_and_both_owner_guards_carry_revoke_version(self):
        env = definitions(('create_owner_session_token', 'validate_owner_auth_version', 'require_owner_session', 'get_staff_session_claims'),
                          {'datetime': datetime, 'timedelta': timedelta, 'HTTPException': HTTPException,
                           'STAFF_SESSION_SECRET': 'test secret used only by this test', 'OWNER_SESSION_TTL_HOURS': 12,
                           'owner_password_security': passwords, 'supabase': MemoryDB(business())})
        import jwt
        env['verify_staff_session_token'] = lambda token: jwt.decode(token, env['STAFF_SESSION_SECRET'], algorithms=['HS256'])
        token = env['create_owner_session_token'](business())
        self.assertEqual(env['require_owner_session']('demo', f'Bearer {token}')['auth_version'], 0)
        self.assertEqual(env['get_staff_session_claims']('demo', f'Bearer {token}')['role'], 'owner')
        env['supabase'].businesses[0]['auth_version'] = 1
        for guard in ('require_owner_session', 'get_staff_session_claims'):
            with self.assertRaises(HTTPException) as caught: env[guard]('demo', f'Bearer {token}')
            self.assertEqual(caught.exception.status_code, 401)
        env['verify_staff_session_token'] = lambda token: self.claims(role='billing')
        with self.assertRaises(HTTPException) as caught: env['get_staff_session_claims']('demo', 'Bearer billing-token')
        self.assertEqual(caught.exception.status_code, 403)

    def test_request_cache_reads_once_off_loop_and_never_crosses_requests(self):
        async def scenario():
            db, claims = MemoryDB(business()), self.claims()
            loop_thread = threading.get_ident()
            async with passwords.owner_auth_request(db, claims):
                self.assertEqual(passwords.validate_business_auth_version(db, claims)['auth_version'], 0)
                self.assertEqual(passwords.validate_business_auth_version(db, claims)['auth_version'], 0)
                self.assertEqual(len(db.reads), 1)
                self.assertNotEqual(db.reads[0][2], loop_thread)
            db.businesses[0]['auth_version'] = 1
            async with passwords.owner_auth_request(db, claims):
                with self.assertRaises(HTTPException) as caught:
                    passwords.validate_business_auth_version(db, claims)
                self.assertEqual(caught.exception.status_code, 401)
            self.assertEqual(len(db.reads), 2)
            self.assertIsNone(passwords._REQUEST_ACCOUNT.get())
        asyncio.run(scenario())

    def test_request_context_isolation_and_errors_fail_only_protected_guards(self):
        async def scenario():
            async def check(version):
                claims = self.claims(auth_version=version)
                async with passwords.owner_auth_request(MemoryDB(business(auth_version=version)), claims):
                    await asyncio.sleep(0)
                    self.assertEqual(passwords.validate_business_auth_version(None, claims)['auth_version'], version)
            await asyncio.gather(check(1), check(2))
            async with passwords.owner_auth_request(None, self.claims()):
                # Opening a public route with an irrelevant bearer header is OK.
                await asyncio.sleep(0)
                with self.assertRaises(HTTPException) as caught:
                    passwords.validate_business_auth_version(None, self.claims())
                self.assertEqual(caught.exception.status_code, 503)
            self.assertIsNone(passwords._REQUEST_ACCOUNT.get())
        asyncio.run(scenario())

    def test_middleware_prefetches_only_signed_owner_or_billing_sessions(self):
        async def scenario():
            db = MemoryDB(business())
            env = definitions(('prefetch_owner_auth_version',), {
                'Request': object, 'supabase': db, 'owner_password_security': passwords,
                'verify_staff_session_token': lambda token: self.claims(role=token),
            })
            async def next_request(request):
                return 'ok'
            for role in ('cashier', 'manager'):
                request = SimpleNamespace(headers={'authorization': f'Bearer {role}'})
                self.assertEqual(await env['prefetch_owner_auth_version'](request, next_request), 'ok')
            self.assertFalse(db.reads)
            for role in ('owner', 'billing'):
                request = SimpleNamespace(headers={'authorization': f'Bearer {role}'})
                self.assertEqual(await env['prefetch_owner_auth_version'](request, next_request), 'ok')
            self.assertEqual(len(db.reads), 2)
            self.assertIsNone(passwords._REQUEST_ACCOUNT.get())
        asyncio.run(scenario())


class ResetTests(unittest.TestCase):
    def env(self, db):
        return definitions(('confirm_business_password_reset',), {
            'PasswordResetConfirm': object, 'HTTPException': HTTPException, 'asyncio': asyncio,
            'datetime': datetime, 'supabase': db, 'owner_password_security': passwords,
            '_password_reset_token_hash': lambda value: hashlib.sha256(value.encode()).hexdigest(),
            '_password_reset_parse_ts': lambda value: datetime.fromisoformat(value) if value else None,
            '_password_reset_audit': Mock(),
        })

    def test_reset_consumes_token_once_and_revokes_existing_owner_sessions(self):
        token = 'a reset token that is only a test'
        db = MemoryDB(business(password_reset_token_hash=hashlib.sha256(token.encode()).hexdigest(),
                               password_reset_expires_at=(datetime.utcnow() + timedelta(hours=1)).isoformat()))
        env = self.env(db)
        req = SimpleNamespace(token=token, new_password='new owner password')
        result = asyncio.run(env['confirm_business_password_reset'](req))
        self.assertTrue(result['success'])
        self.assertEqual(db.businesses[0]['auth_version'], 1)
        self.assertTrue(passwords.verify_owner_password('new owner password', db.businesses[0]['password_hash']))
        self.assertIsNone(db.businesses[0]['password_reset_token_hash'])
        self.assertEqual(db.rpc_calls[0][0], 'reset_owner_password')
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(env['confirm_business_password_reset'](req))
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(db.businesses[0]['auth_version'], 1)

    def test_atomic_reset_no_matching_token_is_never_reported_successful(self):
        db = MemoryDB(business(password_reset_token_hash='test-hash',
                               password_reset_expires_at=(datetime.utcnow() + timedelta(hours=1)).isoformat()))
        env = self.env(db)
        env['_password_reset_token_hash'] = lambda value: 'test-hash'
        db.rpc = lambda *args: SimpleNamespace(execute=lambda: SimpleNamespace(data=[]))
        with self.assertRaises(HTTPException) as caught:
            asyncio.run(env['confirm_business_password_reset'](SimpleNamespace(token='token', new_password='new password')))
        self.assertEqual(caught.exception.status_code, 400)

    def test_sql_reset_is_service_only_and_increments_in_same_update(self):
        sql = (BACKEND / 'owner_password_security.sql').read_text()
        self.assertIn('ALTER COLUMN password_hash TYPE text', sql)
        self.assertIn('auth_version = b.auth_version + 1', sql)
        self.assertIn('b.password_reset_token_hash = p_token_hash', sql)
        self.assertIn('b.password_reset_expires_at::timestamptz > now()', sql)
        self.assertIn('FROM PUBLIC, anon, authenticated', sql)
        self.assertIn('TO service_role', sql)


class LoginMigrationTests(unittest.TestCase):
    def env(self, db):
        return definitions(('_login_lookup_one', 'login'), {
            'LoginRequest': object, 'Request': object, 'HTTPException': HTTPException,
            'asyncio': asyncio, 'owner_password_security': passwords, 'supabase': db,
            '_check_auth_bruteforce': lambda *args: None, 'get_admin_token': lambda: None,
            'SUPER_ADMIN_EMAIL': '', 'SUPER_ADMIN_PASSWORD': '',
            'hash_password': lambda value: hashlib.sha256(value.encode()).hexdigest(),
            '_clear_auth_failures': Mock(), '_record_auth_failure': Mock(),
            'billing_hold': lambda value: False,
            'create_owner_session_token': lambda value: f"version-{value.get('auth_version', 0)}",
            'print': lambda *args: None,
        })

    def run_login(self, env, password='correct password'):
        return asyncio.run(env['login'](SimpleNamespace(email='demo@example.invalid', password=password), object()))

    def test_legacy_plaintext_and_sha_owners_upgrade_once_and_keep_working(self):
        for stored in ('correct password', hashlib.sha256(b'correct password').hexdigest()):
            with self.subTest(stored_kind='sha' if len(stored) == 64 else 'plaintext'):
                db = MemoryDB(business(password_hash=stored))
                env = self.env(db)
                self.assertEqual(self.run_login(env)['role'], 'owner')
                self.assertTrue(db.businesses[0]['password_hash'].startswith('pbkdf2_sha256$600000$'))
                self.assertEqual(self.run_login(env)['token'], 'version-0')
                self.assertEqual(len(db.updates), 1)

    def test_mixed_legacy_and_new_duplicate_rows_select_only_matching_credentials(self):
        secure_hash = passwords.hash_owner_password_sync('correct password')
        db = MemoryDB(business(id=99, public_id='other', password_hash='another password'),
                      business(password_hash=secure_hash))
        env = self.env(db)
        self.assertEqual(self.run_login(env)['business_slug'], 'demo')
        self.assertFalse(db.updates)
        duplicate = business(id=8, public_id='duplicate', password_hash=secure_hash)
        db.businesses.append(duplicate)
        with self.assertRaises(HTTPException) as caught: self.run_login(env)
        self.assertEqual(caught.exception.status_code, 409)
        env['_record_auth_failure'].assert_not_called()
        self.assertFalse(db.updates)

    def test_busy_login_retries_without_counting_as_a_wrong_password(self):
        env = self.env(MemoryDB(business()))
        passwords._HASH_SLOTS.acquire(); passwords._HASH_SLOTS.acquire()
        try:
            with self.assertRaises(HTTPException) as caught: self.run_login(env)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(caught.exception.headers, {'Retry-After': '1'})
            env['_record_auth_failure'].assert_not_called()
        finally:
            passwords._HASH_SLOTS.release(); passwords._HASH_SLOTS.release()


class CurrentUserTests(unittest.TestCase):
    def env(self, db):
        return definitions(('verify_staff_session_token', 'validate_owner_auth_version', 'get_current_user'), {
            'Request': object, 'HTTPException': HTTPException, 'asyncio': asyncio,
            'owner_password_security': passwords, 'supabase': db,
            'get_admin_token': lambda: None, 'STAFF_SESSION_SECRET': 'test secret only used in this test',
        })

    def signed(self, **changes):
        import jwt
        return jwt.encode({'business_public_id': 'demo', 'business_id': 7, 'role': 'owner',
                           'exp': datetime.utcnow() + timedelta(hours=1), **changes},
                          'test secret only used in this test', algorithm='HS256')

    def current(self, env, token):
        return asyncio.run(env['get_current_user'](SimpleNamespace(headers={'authorization': f'Bearer {token}'})))

    def test_predictable_tokens_and_billing_only_sessions_are_rejected(self):
        env = self.env(MemoryDB(business()))
        for token in ('owner-token-demo', 'staff-token-demo', self.signed(role='billing')):
            with self.subTest(token_kind=token.split('-')[0]), self.assertRaises(HTTPException) as caught:
                self.current(env, token)
            self.assertEqual(caught.exception.status_code, 401)

    def test_signed_owner_session_resolves_account_and_reset_revokes_it(self):
        db = MemoryDB(business())
        env = self.env(db)
        token = self.signed()
        self.assertEqual(self.current(env, token)['role'], 'owner')
        db.businesses[0]['auth_version'] = 1
        with self.assertRaises(HTTPException) as caught: self.current(env, token)
        self.assertEqual(caught.exception.status_code, 401)

    def test_staff_session_checks_current_role_and_active_account(self):
        db = MemoryDB(business(), staff=[{'id': 11, 'business_id': 7, 'role': 'cashier',
                                          'name': 'Test cashier', 'is_active': True}])
        env = self.env(db)
        token = self.signed(role='cashier', staff_id=11)
        self.assertEqual(self.current(env, token)['role'], 'cashier')
        db.staff[0]['is_active'] = False
        with self.assertRaises(HTTPException): self.current(env, token)
        db.staff[0]['is_active'] = True
        db.staff[0]['role'] = 'manager'
        with self.assertRaises(HTTPException): self.current(env, token)
        db.businesses[0]['status'] = 'DISABLED'
        with self.assertRaises(HTTPException) as caught: self.current(env, token)
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == '__main__':
    unittest.main()
