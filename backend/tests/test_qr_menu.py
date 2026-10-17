"""QR Menu publication/access boundaries with isolated catalog and database doubles."""
import ast
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import MagicMock
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from backend.qr_menu import public_catalog, register_qr_menu_routes, safe_image


class Database:
    def __init__(self):
        self.state = []
        self.fail = False
        self.writes = []
        self.branches = [{'public_id':'branch-1','name':'Main','is_active':True}, {'public_id':'branch-2','name':'Second','is_active':True}]
    def table(self, name): return Query(self, name)


class Query:
    def __init__(self, db, name): self.db,self.name,self.write=db,name,None
    def select(self, *args, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def order(self, *args, **kwargs): return self
    def upsert(self, row, **kwargs): self.write=row; return self
    def execute(self):
        if self.db.fail: raise RuntimeError('missing table')
        if self.write is not None:
            self.db.writes.append((self.name,self.write))
            self.db.state=[self.write]
        return SimpleNamespace(data=self.db.branches if self.name=='branches' else self.db.state)


def catalog():
    return dict(categories=[{'public_id':'coffee','name':'Coffee'},{'public_id':'hidden','name':'Hidden','is_active':False}],
        items=[{'id':1,'public_id':'latte','business_id':7,'name':'Latte','base_price':120,'category_public_id':'coffee',
                'modifier_group_public_ids':['size','inactive'],'unavailable_branch_public_ids':['branch-2','foreign-branch'],'private_note':'secret'},
               {'public_id':'draft','is_active':False}, {'public_id':'hidden-category','category_public_id':'hidden'},
               {'public_id':'sold','name':'Croissant','is_available':False,'modifier_group_public_ids':[]}],
        modifier_groups=[{'id':3,'public_id':'size','name':'Size','options':[{'id':4,'public_id':'large','name':'Large','price_delta':25},{'public_id':'hidden-option','is_active':False}]},
                         {'public_id':'inactive','is_active':False,'options':[{'public_id':'private-option'}]}],
        branches=[{'id':1,'public_id':'branch-1','name':'Main','is_active':True}, {'id':2,'public_id':'branch-2','name':'Second','is_active':True}, {'public_id':'closed','is_active':False}])


class QRMenuTests(unittest.TestCase):
    def setUp(self):
        self.db=Database()
        self.business={'id':7,'public_id':'test-cafe','name':'Test Cafe','plan':'growth','status':'active','order_ahead_enabled':False}
        self.menu=catalog()
        self.snapshot=MagicMock(side_effect=lambda business:self.menu)
        def owner(public_id, authorization):
            if authorization!='Bearer owner-session': raise HTTPException(401,'Owner session required')
        self.app=FastAPI()
        register_qr_menu_routes(self.app,db=self.db,get_business=lambda value:self.business if value=='test-cafe' else None,
            require_owner=owner,has_feature=lambda business,feature:business.get('plan') in ('growth','pro'),
            on_hold=lambda business:business.get('held',False),menu_snapshot=self.snapshot,
            branding=lambda business:{'currency':'PHP','design':{'primary_color':'#235447','private_setting':'secret'}},
            frontend_url='https://menu.example.invalid')
        self.client=TestClient(self.app)
        self.base='/api/v1/business/test-cafe/qr-menu'
        self.headers={'Authorization':'Bearer owner-session'}
    def publish(self, value=True): return self.client.put(self.base,headers=self.headers,json={'is_published':value})
    def public(self, query=''): return self.client.get('/api/v1/public/menu/test-cafe'+query)

    def test_default_is_private_and_only_owner_can_preview_draft(self):
        self.assertFalse(self.client.get(self.base,headers=self.headers).json()['is_published'])
        self.assertEqual(self.public().status_code,404)
        self.assertEqual(self.client.get(self.base+'/preview').status_code,401)
        preview=self.client.get(self.base+'/preview',headers=self.headers)
        self.assertEqual(preview.status_code,200)
        self.assertEqual(preview.headers['cache-control'],'no-store')
        self.assertEqual(len(preview.json()['items']),2)
        self.assertEqual(self.db.writes,[])

    def test_growth_can_publish_without_enabling_ordering_or_collecting_identity(self):
        response=self.publish()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['public_url'],'https://menu.example.invalid/menu/test-cafe')
        result=self.public()
        self.assertEqual(result.status_code,200)
        self.assertFalse(self.business['order_ahead_enabled'])
        self.assertEqual(result.headers['cache-control'],'no-store')
        self.assertEqual({table for table,row in self.db.writes},{'qr_menu_settings'})
        self.assertNotIn('customer',str(result.json()).lower())

    def test_unpublish_and_republish_keep_link_and_catalog(self):
        first=self.publish().json()['public_url']
        self.assertEqual(self.publish(False).status_code,200)
        self.assertEqual(self.public().status_code,404)
        self.business['name']='Renamed Cafe'
        self.assertEqual(self.publish().json()['public_url'],first)
        self.assertEqual(self.public().json()['business']['name'],'Renamed Cafe')
        self.assertEqual(len(self.public().json()['items']),2)

    def test_starter_and_unknown_plans_cannot_publish_even_if_order_ahead_is_enabled(self):
        self.business['order_ahead_enabled']=True
        for plan in ('starter','unknown',''):
            self.business['plan']=plan
            self.assertEqual(self.publish().status_code,403)
            self.assertEqual(self.public().status_code,404)
        self.assertEqual(self.db.writes,[])

    def test_downgrade_hold_and_inactive_business_remove_public_access(self):
        self.publish()
        for changes in ({'plan':'starter'},{'held':True},{'status':'suspended'}):
            initial=self.business.copy();self.business.update(changes)
            self.assertEqual(self.public().status_code,404)
            self.business.clear();self.business.update(initial)
        self.business['plan']='pro'
        self.assertEqual(self.public().status_code,200)

    def test_branch_must_be_active_and_belong_to_the_menu(self):
        self.publish()
        self.assertEqual(self.public('?branch=branch-2').json()['selected_branch'],'branch-2')
        for branch in ('foreign-branch','closed'):
            self.assertEqual(self.public('?branch='+branch).status_code,404)
        self.assertEqual(self.client.get(self.base+'/preview?branch=foreign',headers=self.headers).status_code,404)

    def test_empty_menu_cannot_publish_and_non_boolean_flag_is_rejected(self):
        self.menu['items']=[]
        self.assertEqual(self.publish().status_code,400)
        self.assertEqual(self.client.put(self.base,headers=self.headers,json={'is_published':'true'}).status_code,422)
        self.assertEqual(self.db.writes,[])

    def test_owner_authentication_and_business_scope_are_required(self):
        self.assertEqual(self.client.get(self.base).status_code,401)
        self.assertEqual(self.client.put(self.base,json={'is_published':True}).status_code,401)
        self.assertEqual(self.client.get('/api/v1/business/other/qr-menu',headers=self.headers).status_code,404)
        self.assertEqual(self.public().status_code,404)

    def test_missing_migration_and_catalog_outage_fail_closed(self):
        self.db.fail=True
        self.assertEqual(self.public().status_code,503)
        self.assertNotIn('qr_menu.sql',self.public().text)
        self.assertIn('qr_menu.sql',self.client.get(self.base,headers=self.headers).text)
        self.db.fail=False;self.publish();self.snapshot.side_effect=RuntimeError('upstream read error')
        self.assertEqual(self.public().status_code,503)

    def test_public_projection_hides_internal_ids_inactive_content_and_foreign_branches(self):
        result=public_catalog(catalog())
        self.assertEqual([i['public_id'] for i in result['items']],['latte','sold'])
        self.assertEqual(result['items'][0]['unavailable_branch_public_ids'],['branch-2'])
        self.assertEqual([g['public_id'] for g in result['items'][0]['modifier_groups']],['size'])
        self.assertEqual(len(result['items'][0]['modifier_groups'][0]['options']),1)
        self.assertFalse(result['items'][1]['is_available'])
        for word in ('business_id','private_note','hidden-option','closed','foreign-branch',"'id':"):
            self.assertNotIn(word,str(result))

    def test_image_urls_cannot_use_script_or_embedded_credentials(self):
        for url in ('javascript:alert(1)','data:text/html,bad','https://user:password@example.invalid/image','https://:password@example.invalid/image','https://['):
            self.assertEqual(safe_image(url),'')
        self.assertEqual(safe_image('https://example.invalid/image.jpg'),'https://example.invalid/image.jpg')


class SharedCatalogAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source=ast.parse((Path(__file__).resolve().parents[1]/'main.py').read_text())
    def gate(self,business):
        node=next(n for n in self.source.body if isinstance(n,ast.FunctionDef) and n.name=='_oa_require_owner_business')
        env=dict(HTTPException=HTTPException,require_owner_session=MagicMock(),safe_get_business=lambda slug:business,
                 business_has_plan_feature=lambda row,feature:row.get('plan') in ('growth','pro'),
                 billing_hold=lambda row:row.get('held',False))
        exec(compile(ast.Module(body=[node],type_ignores=[]),'gate','exec'),env)
        return env['_oa_require_owner_business']
    def test_only_catalog_access_is_unlocked_for_growth_pro(self):
        for plan in ('growth','pro'):
            business={'id':1,'plan':plan,'status':'active','order_ahead_enabled':False}
            gate=self.gate(business)
            self.assertEqual(gate('test','Bearer token',catalog=True),business)
            with self.assertRaises(HTTPException) as result:gate('test','Bearer token')
            self.assertEqual(result.exception.status_code,403)
    def test_qr_catalog_access_requires_active_subscription(self):
        for changes in ({'status':'suspended'},{'held':True}):
            business={'id':1,'plan':'growth','status':'active',**changes}
            with self.assertRaises(HTTPException):self.gate(business)('test','Bearer token',catalog=True)
    def test_existing_admin_enabled_order_ahead_access_remains(self):
        business={'id':1,'plan':'starter','order_ahead_enabled':True}
        self.assertEqual(self.gate(business)('test','Bearer token'),business)
        business['order_ahead_enabled']=False
        with self.assertRaises(HTTPException):self.gate(business)('test','Bearer token',catalog=True)
    def test_central_plan_configuration_includes_qr_menu_without_unlocking_starter(self):
        node=next(n for n in self.source.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SUBSCRIPTION_PLANS' for t in n.targets))
        plans=ast.literal_eval(node.value)
        self.assertFalse(plans['starter']['qr_menu'])
        self.assertTrue(plans['growth']['qr_menu'])
        self.assertTrue(plans['pro']['qr_menu'])
