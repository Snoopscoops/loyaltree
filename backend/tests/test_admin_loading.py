"""Admin load regressions: fixed query fan-out, paging and a responsive loop."""
import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import sys
import threading
from typing import Optional
import unittest

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from admin_metrics import business_metrics


class Query:
    def __init__(self, db, table):
        self.db, self.table_name = db, table
        self.ids, self.span = [], (0, 499)
        self.columns = ''
    def select(self, columns, **kwargs): self.columns=columns; return self
    def in_(self, column, ids): self.ids=ids; return self
    def gte(self, *args): return self
    def order(self, *args, **kwargs): return self
    def range(self, first, last): self.span=(first,last); return self
    def execute(self):
        self.db.calls.append((self.table_name,self.columns,self.span))
        rows=[row for row in self.db.rows.get(self.table_name,[]) if row.get('business_id') in self.ids]
        return SimpleNamespace(data=rows[self.span[0]:self.span[1]+1])


class Database:
    def __init__(self, rows): self.rows,self.calls=rows,[]
    def table(self, table): return Query(self,table)


class AdminMetricsTests(unittest.TestCase):
    def test_sixty_businesses_use_five_queries_instead_of_per_business_reads(self):
        db=Database({'customers':[{'id':n,'business_id':n} for n in range(1,61)]})
        result=business_metrics(db,list(range(1,61)),'since',lambda _: 'stamp',lambda *a,**k:None)
        self.assertEqual(len(db.calls),5)
        self.assertTrue(all(item['customer_count']==1 for item in result.values()))
        self.assertTrue(all('email' not in cols and 'phone' not in cols for _,cols,_ in db.calls))

    def test_paging_and_mixed_card_activity_preserve_balances_and_session_semantics(self):
        db=Database({
            'loyalty_programs':[{'id':1,'business_id':1,'card_type':'hybrid'}, {'id':2,'business_id':2,'card_type':'multipass'}],
            'customers':[{'id':n,'business_id':1,'points_balance':2} for n in range(7)]+[{'id':8,'business_id':2,'multipass_sessions_remaining':4}],
            'points_events':[{'id':n,'business_id':1} for n in range(8)],
            'multipass_events':[{'id':1,'business_id':2,'action':'issued'}, {'id':2,'business_id':2,'action':'used'}],
            'branches':[{'id':1,'business_id':2},{'id':2,'business_id':2}],
        })
        result=business_metrics(db,[1,2],'since',lambda p:'points' if p.get('card_type')=='hybrid' else p.get('card_type','stamp'),lambda *a,**k:None,page_size=3)
        self.assertEqual(result[1]['customer_count'],7)
        self.assertEqual(result[1]['points_balance_outstanding'],14)
        self.assertEqual(result[1]['activity_30d'],8)
        self.assertEqual(result[2]['sessions_outstanding'],4)
        self.assertEqual(result[2]['activity_30d'],1)
        self.assertEqual(result[2]['branch_count'],2)


class AdminResponsivenessTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_authenticated_admin_read_does_not_block_health_or_bypass_auth(self):
        tree=ast.parse((Path(__file__).resolve().parents[1]/'main.py').read_text())
        nodes=[node for node in tree.body if getattr(node,'name',None) in ('require_admin','admin_list_businesses')]
        for node in nodes: node.decorator_list=[]
        entered,release=threading.Event(),threading.Event()
        class SlowQuery:
            def select(self,*a,**k):return self
            def order(self,*a,**k):return self
            def execute(self):
                entered.set()
                release.wait(2)
                return SimpleNamespace(data=[])
        db=SimpleNamespace(table=lambda _:SlowQuery())
        from datetime import datetime,timedelta
        env=dict(Optional=Optional,Depends=Depends,Request=Request,HTTPException=HTTPException,
                 get_admin_token=lambda:'fixture',supabase=db,datetime=datetime,timedelta=timedelta,
                 effective_loyalty_type=lambda p:'stamp',log_event=lambda *a,**k:None)
        exec(compile(ast.fix_missing_locations(ast.Module(body=nodes,type_ignores=[])),'admin-load','exec'),env)
        app=FastAPI()
        app.get('/admin/businesses')(env['admin_list_businesses'])
        @app.get('/health')
        async def health(): return {'status':'ok'}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            self.assertEqual((await client.get('/admin/businesses')).status_code,401)
            self.assertFalse(entered.is_set())
            work=asyncio.create_task(client.get('/admin/businesses',headers={'Authorization':'Bearer fixture'}))
            try:
                self.assertTrue(await asyncio.to_thread(entered.wait,1))
                self.assertEqual((await asyncio.wait_for(client.get('/health'),.5)).json(),{'status':'ok'})
            finally:
                release.set()
            self.assertEqual((await work).json(),[])


if __name__=='__main__':unittest.main()
