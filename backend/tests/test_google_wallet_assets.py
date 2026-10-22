import unittest
import httpx
from backend import google_wallet_assets as assets
from backend.wallet_class_publish import upsert_loyalty_class


class PublicImageTests(unittest.TestCase):
    def setUp(self): assets._VALID.clear()

    def test_render_or_private_image_rejected_before_google_publish(self):
        for url in ('http://res.cloudinary.com/test/image/upload/logo.png',
                    'https://go.theloyaltytree.com/wallet-logo.png',
                    'https://res.cloudinary.com/test/image/authenticated/logo.png'):
            calls=[]
            with httpx.Client(transport=httpx.MockTransport(lambda request:calls.append(request))) as client:
                with self.assertRaises(ValueError):
                    upsert_loyalty_class(client, {'id':'test.card','programLogo':{'sourceUri':{'uri':url}}}, 'secret')
            self.assertFalse(calls)

    def test_broken_cloudinary_asset_prevents_publish_and_never_receives_google_token(self):
        calls=[]
        def handle(request):
            calls.append(request)
            self.assertNotIn('authorization',request.headers)
            return httpx.Response(404)
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            with self.assertRaises(ValueError):
                upsert_loyalty_class(client, {'id':'test.card','heroImage':{'sourceUri':{'uri':'https://res.cloudinary.com/test/image/upload/banner.png'}}}, 'secret')
        self.assertEqual([r.method for r in calls],['HEAD'])

    def test_generated_branding_uploads_once_and_uses_public_immutable_png(self):
        existing=set(); calls=[]
        def handle(request):
            calls.append(request)
            if request.method=='HEAD':
                self.assertNotIn('authorization',request.headers)
                return httpx.Response(200 if str(request.url) in existing else 404,headers={'Content-Type':'image/png'})
            self.assertEqual(request.url.host,'api.cloudinary.com')
            import hashlib
            public_id='wallet-public-v1/'+hashlib.sha256(b'\x89PNG\r\n\x1a\nfixture').hexdigest()
            url=f'https://res.cloudinary.com/test/image/upload/{public_id}.png'
            existing.add(url)
            return httpx.Response(200,json={'secure_url':url})
        with httpx.Client(transport=httpx.MockTransport(handle)) as client:
            kw=dict(cloud='test',api_key='key',api_secret='secret')
            url=assets.publish_png(client,b'\x89PNG\r\n\x1a\nfixture',**kw)
            self.assertEqual(assets.publish_png(client,b'\x89PNG\r\n\x1a\nfixture',**kw),url)
        self.assertEqual([r.method for r in calls],['HEAD','POST','HEAD'])


if __name__ == '__main__': unittest.main()
