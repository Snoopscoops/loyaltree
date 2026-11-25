"""Inventory permission regression tests; no production data is touched."""
import unittest
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.menu_daily_inventory import register_menu_inventory_routes


class Query:
    def select(self, *args): return self
    def eq(self, *args): return self
    def execute(self):
        return SimpleNamespace(data=[
            dict(branch_public_id='main', item_public_id='latte', variant_key='*',
                 initial_servings=10, reserved=2, consumed=1),
            dict(branch_public_id='other', item_public_id='latte', variant_key='*',
                 initial_servings=20, reserved=0, consumed=0),
        ])


class DB:
    def __init__(self): self.calls = []
    def table(self, name): return Query()
    def rpc(self, name, params):
        self.calls.append((name, params))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=dict(initial_servings=10)))


class ManagerStockTests(unittest.TestCase):
    def setUp(self):
        self.db = DB()
        self.scope = dict(role='manager', branch='main')
        snapshot = dict(branches=[dict(public_id='main', name='Main'), dict(public_id='other', name='Other')],
                        items=[dict(public_id='latte', name='Latte')], modifier_groups=[])
        app = FastAPI()
        register_menu_inventory_routes(app, db=self.db,
            operator=lambda *_: (dict(id=1, status='ACTIVE'), self.scope),
            menu_snapshot=lambda _: snapshot)
        self.client = TestClient(app)
        self.path = '/api/v1/business/test/menu-inventory'

    def update(self, branch):
        return self.client.put(self.path, json=dict(branch_public_id=branch,
            item_public_id='latte', variant_key='*', initial_servings=10, repeat_daily=False))

    def test_manager_reads_only_assigned_branch(self):
        response = self.client.get(self.path)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([b['public_id'] for b in response.json()['branches']], ['main'])
        self.assertEqual([r['branch_public_id'] for r in response.json()['rows']], ['main'])

    def test_manager_can_adjust_own_branch(self):
        self.assertEqual(self.update('main').status_code, 200)
        self.assertEqual(self.db.calls[-1][1]['p_branch'], 'main')

    def test_manager_cannot_adjust_other_branch(self):
        self.assertEqual(self.update('other').status_code, 403)
        self.assertEqual(self.db.calls, [])

    def test_unassigned_manager_cannot_read_or_write(self):
        self.scope['branch'] = ''
        self.assertEqual(self.client.get(self.path).status_code, 403)
        self.assertEqual(self.update('main').status_code, 403)
        self.assertEqual(self.db.calls, [])

    def test_owner_can_manage_all_branches(self):
        self.scope = dict(role='owner', branch='')
        self.assertEqual(len(self.client.get(self.path).json()['branches']), 2)
        self.assertEqual(self.update('other').status_code, 200)

    def test_existing_assigned_cashier_api_access_remains_scoped(self):
        self.scope = dict(role='cashier', branch='main')
        self.assertEqual(self.update('main').status_code, 200)
        self.assertEqual(self.update('other').status_code, 403)
