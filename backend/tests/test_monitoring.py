import asyncio
import contextlib
import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
import monitoring as m
from shared_http import SharedHTTP


class MonitoringTests(unittest.TestCase):
    def setUp(self):
        m.monitor.reset()
        m.monitor.loop = None
        self.app = FastAPI()
        @self.app.get('/api/v1/business/{slug}/stats')
        async def fail(slug):
            raise httpx.ReadError('[Errno 11] Resource temporarily unavailable')
        @self.app.get('/handled')
        async def handled():
            try:
                raise httpx.ConnectError('connection failed')
            except Exception as exc:
                raise HTTPException(503, 'unavailable') from exc
        @self.app.get('/response')
        async def response():
            from fastapi.responses import Response
            return Response(status_code=502)
        @self.app.middleware('http')
        async def forward(request, call_next):
            return await call_next(request)
        m.install_monitoring(self.app)
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def test_error_once_template_trace_and_request_id(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            response = self.client.get('/api/v1/business/shop/stats?token=private')
        self.assertEqual(response.status_code, 500)
        events = [json.loads(x) for x in out.getvalue().splitlines()]
        errors = [x for x in events if x['event'] == 'error']
        self.assertEqual(len(errors), 1)
        error = errors[0]
        self.assertEqual(error['endpoint'], '/api/v1/business/{slug}/stats')
        self.assertEqual(error['business_slug'], 'shop')
        self.assertEqual(error['error_type'], 'ReadError')
        trace = next(x for x in events if x['event'] == 'error_traceback')
        self.assertEqual(trace['request_id'], error['request_id'])
        self.assertEqual(response.headers['x-request-id'], error['request_id'])
        self.assertNotIn('private', out.getvalue())
        self.assertIn('fail', trace['traceback'])

    def test_handled_and_plain_5xx(self):
        for path, code, kind in [('/handled',503,'ConnectError'),('/response',502,'HTTP5xx')]:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                r = self.client.get(path)
            errors = [json.loads(x) for x in out.getvalue().splitlines() if json.loads(x)['event'] == 'error']
            self.assertEqual(r.status_code, code)
            self.assertEqual(len(errors), 1)
            self.assertEqual(errors[0]['error_type'], kind)

    def test_report_disabled_wrong_and_valid_token(self):
        rows = [dict(id=1,ts='2026-10-13T00:00:00Z',event='hourly_summary',payload={
            'requests':8,'status_2xx':6,'status_4xx':1,'status_5xx':1,
            'endpoint_counts':{'/stats':8},'business_counts':{'shop':8}}),
            dict(id=2,ts='2026-10-13T00:01:00Z',event='error',endpoint='/stats',business_slug='shop',status=500,payload={'error':'failed','error_type':'ReadError'}),
            dict(id=3,ts='2026-10-13T00:02:00Z',event='push',payload={'business_name':'Shop','title':'Hello','message':'Offer','targets':3,'google_ok':1,'apple_ok':2})]
        def resp(data):
            return httpx.Response(200,json=data,request=httpx.Request('GET','https://example.com'))
        with patch.dict(os.environ, {'MONITOR_TOKEN':''}):
            self.assertEqual(self.client.get('/api/v1/admin/health-report').status_code,401)
        with patch.dict(os.environ, {'MONITOR_TOKEN':'test-secret'}), patch.object(m.shared_http,'request',AsyncMock(side_effect=[resp(rows),resp([])])) as call:
            self.assertEqual(self.client.get('/api/v1/admin/health-report',headers={'Authorization':'Bearer wrong'}).status_code,401)
            r = self.client.get('/api/v1/admin/health-report?hours=24',headers={'Authorization':'Bearer test-secret'})
            self.assertEqual(r.status_code,200,r.text)
            data=r.json()
            self.assertEqual(data['totals']['status_5xx'],1)
            self.assertEqual(data['errors'][0]['error'],'failed')
            self.assertEqual(data['pushes'][0]['title'],'Hello')
            self.assertEqual(data['top_businesses'][0],['shop',8])
            self.assertEqual(call.await_count,2)
            self.assertEqual(self.client.get('/api/v1/admin/health-report?hours=0',headers={'Authorization':'Bearer test-secret'}).status_code,422)

    def test_privacy_and_summary_reset(self):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            m.log_event('push', title='Email x@example.com call +63 939 799 2144', token='secret', google_ok=2, apple_ok=1)
            m.monitor.record_request('/stats','shop',500)
            summary=m.monitor.summary()
            empty=m.monitor.summary()
        self.assertNotIn('x@example.com',out.getvalue())
        self.assertNotIn('939',out.getvalue())
        self.assertEqual(summary['pushes'],1)
        self.assertEqual(summary['google_pushes'],2)
        self.assertEqual(empty['requests'],0)

    def test_fallback_and_auth_preserved(self):
        @m.resilient_read('stats')
        async def stats(public_id):
            try:
                raise httpx.ReadTimeout('timeout')
            except Exception as exc:
                raise HTTPException(500,'failed') from exc
        with contextlib.redirect_stdout(io.StringIO()):
            result = asyncio.run(stats('shop'))
            self.assertTrue(result['partial'])
            self.assertIsNone(result['total_customers'])
            self.assertFalse(result['customer_count_available'])
            self.assertFalse(result['activity_available'])
            self.assertFalse(result['rewards_available'])
        @m.resilient_read('stats')
        def auth(public_id):
            raise HTTPException(401,'unauthorized')
        with self.assertRaises(HTTPException):
            auth('shop')


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_reads_only(self):
        http=SharedHTTP()
        request=httpx.Request('GET','https://example.com')
        success=httpx.Response(200,json=[],request=request)
        http.client=AsyncMock()
        http.client.send.side_effect=[httpx.ReadError('retry'),success]
        self.assertEqual((await http._send(request)).status_code,200)
        self.assertEqual(http.client.send.await_count,2)
        http.client.send.reset_mock()
        http.client.send.side_effect=httpx.ReadError('write')
        with self.assertRaises(httpx.ReadError):
            await http._send(httpx.Request('POST','https://example.com'))
        self.assertEqual(http.client.send.await_count,1)

    async def test_lifecycle_and_sync_bridge(self):
        http=SharedHTTP()
        await http.start()
        async def handle(request):
            return httpx.Response(200,json={'ok':True})
        async def replace():
            await http.client.aclose()
            http.client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(replace(),http.loop))
        r=await asyncio.to_thread(http.send,httpx.Request('GET','https://example.com'))
        self.assertTrue(r.json()['ok'])
        await http.stop()
        self.assertIsNone(http.client)

if __name__ == '__main__':
    unittest.main()

class SDKBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_supabase_uses_shared_pool(self):
        from shared_http import shared_http, create_pooled_supabase
        import jwt
        await shared_http.start()
        seen=[]
        async def handle(request):
            seen.append(request)
            return httpx.Response(200,json=[{'id':7}])
        async def replace():
            await shared_http.client.aclose()
            shared_http.client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        try:
            await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(replace(),shared_http.loop))
            key=jwt.encode({'role':'service_role'},'testing-only-signing-key-32-bytes-long',algorithm='HS256')
            db=create_pooled_supabase('https://example.supabase.co',key)
            result=await asyncio.to_thread(lambda: db.table('customers').select('id').execute())
            self.assertEqual(result.data,[{'id':7}])
            self.assertEqual(seen[0].url.path,'/rest/v1/customers')
            self.assertEqual(seen[0].headers['apikey'],key)
        finally:
            await shared_http.stop()


class AppleRevisionTests(unittest.TestCase):
    def test_durable_revision_and_push_order(self):
        import ast
        from datetime import datetime, timedelta
        from unittest.mock import MagicMock
        source=Path(__file__).resolve().parents[1]/'main.py'
        tree=ast.parse(source.read_text())
        names={'_mark_apple_pass_dirty','_apple_pass_dirty_at','_send_apple_wallet_pushes'}
        nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
        db=MagicMock()
        q=db.table.return_value
        q.select.return_value.eq.return_value.execute.return_value.data=[{'pass_updated_at':'2026-10-13T01:02:03.456789'}]
        events=[]
        env=dict(datetime=datetime,timedelta=timedelta,supabase=db,_APPLE_PASS_DIRTY_AT={},
                 _APPLE_PASS_DIRTY_TTL_SECONDS=21600,_parse_ts=lambda x: datetime.fromisoformat(x),
                 APPLE_PASS_TYPE_IDENTIFIER='pass.example',get_apple_push_cert_files=lambda:('cert','key'),
                 log_event=lambda *a,**k: None,print=lambda *a,**k: None,
                 _record_apple_delivery=lambda n,ok:events.append(('counts',n,ok)))
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),'exec'),env)
        env['_mark_apple_pass_dirty'](['member'])
        self.assertIn('pass_updated_at',q.update.call_args.args[0])
        env['_APPLE_PASS_DIRTY_AT'].clear()
        self.assertEqual(env['_apple_pass_dirty_at']('member').microsecond,456789)
        env['_mark_apple_pass_dirty']=lambda serials:events.append(('revision',serials))
        q.select.return_value.in_.return_value.execute.return_value.data=[{'serial_number':'member'}]
        client=MagicMock()
        client.__enter__.return_value=client
        client.post.side_effect=lambda *a,**k:(events.append(('apns',)),httpx.Response(200))[1]
        env['pooled_client']=lambda **kw:client
        self.assertEqual(env['_send_apple_wallet_pushes'](['device','device']),1)
        self.assertEqual(events[0],('revision',['member']))
        self.assertEqual(events[1],('apns',))
        self.assertEqual(events[2],('counts',1,1))
        events.clear()
        env['_mark_apple_pass_dirty']=MagicMock(side_effect=RuntimeError('revision storage unavailable'))
        self.assertEqual(env['_send_apple_wallet_pushes'](['device']),0)
        self.assertNotIn(('apns',),events)

class PersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_persistence_never_escapes_or_recurses(self):
        local=m.Monitor()
        with patch.object(m.shared_http,'request',AsyncMock(side_effect=httpx.ConnectError('offline'))) as call:
            with contextlib.redirect_stdout(io.StringIO()) as out:
                await local.start()
                event=local.emit('error','error',status=500,error='failed',endpoint='/stats')
                self.assertEqual(event['status'],500)
                await asyncio.wait_for(local.queue.join(),1)
                # An emit schedules its bounded queue insertion on the loop.
                await asyncio.sleep(0)
                await asyncio.wait_for(local.queue.join(),1)
                self.assertEqual(local.pending,0)
                await local.stop()
            self.assertIn('event_persist_failed',out.getvalue())
            self.assertGreaterEqual(call.await_count,1)


class PassContentTests(unittest.TestCase):
    def test_revision_changes_signed_pass_bytes_with_stable_serial(self):
        import ast, hashlib, zipfile
        from typing import Optional
        source=Path(__file__).resolve().parents[1]/'main.py'
        node=next(n for n in ast.parse(source.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='build_gift_card_pkpass_bytes')
        revision=['2026-10-13T00:00:00.001']
        env=dict(Optional=Optional,APPLE_PASS_TYPE_IDENTIFIER='pass.example',APPLE_TEAM_IDENTIFIER='team',
                 get_apple_pass_credentials=lambda:True,
                 build_gift_card_apple_pass_json=lambda *a:{'serialNumber':'gift-test'},
                 _apple_pass_dirty_at=lambda serial:revision[0],
                 _gift_apple_brand_assets=lambda b:{'icon.png':b'test'},
                 sign_pkpass_manifest=lambda manifest:hashlib.sha256(manifest).digest(),
                 BytesIO=io.BytesIO,json=json,hashlib=hashlib,zipfile=zipfile)
        exec(compile(ast.Module(body=[node],type_ignores=[]),str(source),'exec'),env)
        before=env['build_gift_card_pkpass_bytes']({}, {})
        revision[0]='2026-10-13T00:00:00.002'
        after=env['build_gift_card_pkpass_bytes']({}, {})
        self.assertNotEqual(before,after)
        for data in (before,after):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.assertEqual(json.loads(archive.read('pass.json'))['serialNumber'],'gift-test')
