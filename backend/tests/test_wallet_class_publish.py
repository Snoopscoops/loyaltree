"""Google Wallet write recovery with a local fake transport, never Google."""
import json
import unittest
import httpx
from backend.wallet_class_publish import CLASS_URL, upsert_loyalty_class

CLASS={'id':'issuer.test-card','issuerName':'Test Cafe','programName':'New Design'}

class WalletClassPublishTests(unittest.TestCase):
    def publish(self, handler):
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            return upsert_loyalty_class(client,CLASS,'test-token')

    def test_first_create_timeout_after_commit_recovers_the_same_class(self):
        stored,methods={},[]
        def handler(request):
            methods.append(request.method)
            if request.method=='POST':
                stored.update(json.loads(request.content))
                raise httpx.ReadTimeout('',request=request)
            if request.method=='GET':return httpx.Response(200,json=stored)
            if not stored:return httpx.Response(404,json={'error':'not found'})
            stored.update(json.loads(request.content));return httpx.Response(200,json=stored)
        response,result=self.publish(handler)
        self.assertEqual(response.status_code,200)
        self.assertEqual(result['id'],CLASS['id'])
        self.assertEqual(methods,['PUT','POST','GET','PUT'])
        self.assertEqual(stored,CLASS)

    def test_create_timeout_before_commit_retries_only_the_same_id(self):
        ids,methods=[],[]
        def handler(request):
            methods.append(request.method)
            if request.method=='PUT' or request.method=='GET':return httpx.Response(404,json={})
            payload=json.loads(request.content);ids.append(payload['id'])
            if len(ids)==1:raise httpx.ReadTimeout('',request=request)
            return httpx.Response(201,json=payload)
        response,_=self.publish(handler)
        self.assertEqual(response.status_code,201)
        self.assertEqual(ids,[CLASS['id'],CLASS['id']])
        self.assertEqual(methods,['PUT','POST','GET','PUT','POST'])

    def test_update_timeout_does_not_accept_an_old_design_as_success(self):
        stored={**CLASS,'programName':'Old Design'};puts=0
        def handler(request):
            nonlocal puts
            if request.method=='GET':return httpx.Response(200,json=stored)
            self.assertEqual(request.method,'PUT');puts+=1
            if puts==1:raise httpx.ReadTimeout('',request=request)
            stored.update(json.loads(request.content));return httpx.Response(200,json=stored)
        response,_=self.publish(handler)
        self.assertEqual(response.status_code,200)
        self.assertEqual(stored['programName'],'New Design')
        self.assertEqual(puts,2)

    def test_concurrent_create_conflict_updates_instead_of_duplicating(self):
        methods=[]
        def handler(request):
            methods.append(request.method)
            status=[404,409,200][len(methods)-1]
            return httpx.Response(status,json=CLASS)
        response,_=self.publish(handler)
        self.assertEqual(response.status_code,200)
        self.assertEqual(methods,['PUT','POST','PUT'])

    def test_recovery_is_bounded_when_google_keeps_timing_out(self):
        methods=[]
        def handler(request):
            methods.append(request.method)
            if request.method=='GET':return httpx.Response(200,json=CLASS)
            raise httpx.ReadTimeout('',request=request)
        with self.assertRaises(httpx.ReadTimeout):self.publish(handler)
        self.assertEqual(methods,['PUT','GET','PUT'])

    def test_verification_timeout_still_uses_safe_bounded_put(self):
        puts=0
        def handler(request):
            nonlocal puts
            if request.method=='GET':raise httpx.ReadTimeout('',request=request)
            puts+=1
            if puts==1:raise httpx.ReadTimeout('',request=request)
            return httpx.Response(200,json=CLASS)
        response,_=self.publish(handler)
        self.assertEqual(response.status_code,200)
        self.assertEqual(puts,2)

    def test_validation_failure_is_not_retried(self):
        methods=[]
        def handler(request):
            methods.append(request.method)
            return httpx.Response(400,json={'error':{'message':'Invalid design'}})
        response,result=self.publish(handler)
        self.assertEqual(response.status_code,400)
        self.assertEqual(methods,['PUT'])
        self.assertEqual(result['error']['message'],'Invalid design')

    def test_transient_google_503_can_recover(self):
        methods=[]
        def handler(request):
            methods.append(request.method)
            return httpx.Response(503 if len(methods)==1 else 200,json=CLASS)
        response,_=self.publish(handler)
        self.assertEqual(response.status_code,200)
        self.assertEqual(methods,['PUT','GET','PUT'])

    def test_shared_transport_still_does_not_retry_arbitrary_writes(self):
        from backend.shared_http import SharedHTTP
        import asyncio
        from unittest.mock import AsyncMock
        pool=SharedHTTP();pool.client=AsyncMock()
        pool.client.send.side_effect=httpx.ReadTimeout('')
        with self.assertRaises(httpx.ReadTimeout):
            asyncio.run(pool._send(httpx.Request('POST','https://example.invalid/payment')))
        self.assertEqual(pool.client.send.await_count,1)
