"""Regression for compressed Supabase responses through the sync/async bridge."""
import asyncio
import gzip
import json
import sys
import unittest
import zlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import httpx
from shared_http import shared_http,create_pooled_supabase,pooled_client
import jwt


class CompressedHTTPTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        await shared_http.start()

    async def asyncTearDown(self):
        await shared_http.stop()

    async def configure(self,encoding):
        payload=json.dumps([{'id':1,'public_id':'test-business'}]).encode()
        compressed=gzip.compress(payload) if encoding=='gzip' else zlib.compress(payload)
        async def handle(request):
            return httpx.Response(200,headers={
                'Content-Type':'application/json','Content-Encoding':encoding,
                'Content-Length':str(len(compressed)),
                'Content-Range':'0-0/1'},content=compressed)
        async def replace():
            await shared_http.client.aclose()
            shared_http.client=httpx.AsyncClient(transport=httpx.MockTransport(handle))
        await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(replace(),shared_http.loop))
        return payload

    async def test_gzip_and_deflate_decode_once_through_sync_bridge(self):
        for encoding in ('gzip','deflate'):
            with self.subTest(encoding=encoding):
                payload=await self.configure(encoding)
                r=await asyncio.to_thread(lambda:pooled_client().get('https://example.com/data'))
                self.assertEqual(r.content,payload)
                self.assertEqual(r.json()[0]['id'],1)
                self.assertNotIn('content-encoding',r.headers)
                self.assertEqual(int(r.headers['content-length']),len(payload))
                self.assertEqual(r.headers['content-range'],'0-0/1')

    async def test_real_supabase_compressed_customer_and_login_lookups(self):
        await self.configure('gzip')
        key=jwt.encode({'role':'service_role'},'test-signing-key-only-at-least-32-bytes',algorithm='HS256')
        db=create_pooled_supabase('https://example.supabase.co',key)
        for table in ('businesses','staff','customers'):
            result=await asyncio.to_thread(lambda:db.table(table).select('id,public_id').execute())
            self.assertEqual(result.data[0]['public_id'],'test-business')

if __name__=='__main__':
    unittest.main()
