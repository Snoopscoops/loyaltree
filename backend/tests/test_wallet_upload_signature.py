"""Exercise the real upload-signing endpoint without importing integrations."""
import ast
import asyncio
import hashlib
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import Mock

from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from backend import wallet_cloudinary as wallet_artwork


SOURCE = Path(os.getenv('LT_WALLET_MAIN', str(Path(__file__).resolve().parents[1] / 'main.py')))
NODES = [node for node in ast.parse(SOURCE.read_text()).body
         if isinstance(node, ast.AsyncFunctionDef) and node.name == 'get_cloudinary_signature']
for node in NODES: node.decorator_list = []
CODE = compile(ast.Module(body=NODES, type_ignores=[]), str(SOURCE), 'exec')
STAMP = 1700000000
SECRET = 'DO_NOT_RETURN_SIGNING_SECRET'


def fixture():
    def owner(public_id, authorization):
        if authorization != 'Bearer signed-cafe-owner':
            raise HTTPException(401, 'Signed owner required')
        if public_id != 'cafe':
            raise HTTPException(403, 'Wrong business')
        return {'business_public_id': 'cafe'}
    env = dict(Optional=Optional, Header=Header, HTTPException=HTTPException, hashlib=hashlib,
        datetime=SimpleNamespace(utcnow=lambda: SimpleNamespace(timestamp=lambda: STAMP)),
        CLOUDINARY_API_KEY='PUBLIC_TEST_API_KEY', CLOUDINARY_API_SECRET=SECRET,
        CLOUDINARY_CLOUD_NAME='test-account', CLOUDINARY_UPLOAD_PRESET='SignedPreset',
        wallet_artwork=wallet_artwork, require_owner_session=Mock(side_effect=owner),
        safe_get_business=Mock(return_value={'id': 1, 'public_id': 'cafe'}))
    exec(CODE, env)
    return env


def signature_for(params):
    encoded = '&'.join(f'{key}={value}' for key, value in sorted(params.items()))
    return hashlib.sha1((encoded + SECRET).encode()).hexdigest()


class WalletUploadSignatureTests(unittest.TestCase):
    def setUp(self): self.env = fixture()

    def call(self, public_id='cafe', **kwargs):
        return asyncio.run(self.env['get_cloudinary_signature'](public_id, **kwargs))

    def test_legacy_no_role_preserves_existing_folders_fields_and_signature_without_new_auth(self):
        purposes = {None: 'vehicles', 'branding': 'branding', 'contract': 'contracts',
                    'agent_kyc': 'agent-kyc', 'reservation': 'reservation-receipts',
                    'order_ahead_menu': 'order-ahead-menu', 'legacy-purpose': 'vehicles'}
        for purpose, prefix in purposes.items():
            with self.subTest(purpose=purpose):
                result = self.call(purpose=purpose)
                params = {'folder': f'{prefix}/cafe', 'timestamp': STAMP, 'upload_preset': 'SignedPreset'}
                self.assertEqual(result['signature'], signature_for(params))
                self.assertEqual(set(result), {'folder', 'timestamp', 'upload_preset', 'signature', 'api_key', 'cloud_name'})
                self.assertNotIn('eager', result)
                self.assertEqual(result['folder'], params['folder'])
        self.env['require_owner_session'].assert_not_called()
        self.assertNotIn(SECRET, repr(result))

    def test_all_new_roles_require_signed_owner_and_sign_only_fixed_eager_profiles(self):
        for role in ('logo', 'hero', 'progress_icon'):
            with self.subTest(role=role):
                self.env['require_owner_session'].reset_mock()
                result = self.call(purpose='branding', asset_role=role, authorization='Bearer signed-cafe-owner')
                self.env['require_owner_session'].assert_called_once_with('cafe', 'Bearer signed-cafe-owner')
                eager = '|'.join(wallet_artwork.profile_transforms()[name] for name in wallet_artwork.profiles_for_role(role))
                self.assertEqual(result['eager'], eager)
                params = {'folder': 'branding/cafe', 'timestamp': STAMP, 'upload_preset': 'SignedPreset', 'eager': eager}
                self.assertEqual(result['signature'], signature_for(params))
                # Eager is authenticated along with the established folder/preset.
                self.assertNotEqual(result['signature'], signature_for({key: value for key, value in params.items() if key != 'eager'}))
                self.assertTrue(all(transform.endswith('f_png') for transform in eager.split('|')))
                self.assertNotIn('file', result); self.assertNotIn('overwrite', result)
                self.assertNotIn(SECRET, repr(result)); self.assertNotIn('api_secret', result)

    def test_missing_or_wrong_owner_cannot_get_new_role_signature_or_lookup_business(self):
        for slug, authorization, expected in (('cafe', '', 401), ('cafe', 'Bearer staff-pin', 401),
                                               ('other-cafe', 'Bearer signed-cafe-owner', 403)):
            self.env['safe_get_business'].reset_mock()
            with self.subTest(slug=slug, authorization=authorization):
                with self.assertRaises(HTTPException) as failure:
                    self.call(slug, purpose='branding', asset_role='logo', authorization=authorization)
                self.assertEqual(failure.exception.status_code, expected)
                self.env['safe_get_business'].assert_not_called()

    def test_invalid_role_or_nonbranding_purpose_returns_422_before_database_lookup(self):
        invalid = [('branding', ''), ('branding', 'portrait'), ('branding', 'Logo'), ('branding', 'hero|l_fetch:external'),
                   (None, 'logo'), ('contract', 'logo'), ('agent_kyc', 'hero'), ('order_ahead_menu', 'progress_icon')]
        for purpose, role in invalid:
            self.env['safe_get_business'].reset_mock()
            with self.subTest(purpose=purpose, role=role):
                with self.assertRaises(HTTPException) as failure:
                    self.call(purpose=purpose, asset_role=role, authorization='Bearer signed-cafe-owner')
                self.assertEqual(failure.exception.status_code, 422)
                self.env['safe_get_business'].assert_not_called()

    def test_role_authorization_uses_requested_public_slug_and_preserves_not_found(self):
        self.env['safe_get_business'].return_value = None
        with self.assertRaises(HTTPException) as failure:
            self.call(purpose='branding', asset_role='hero', authorization='Bearer signed-cafe-owner')
        self.assertEqual(failure.exception.status_code, 404)
        self.env['require_owner_session'].assert_called_once_with('cafe', 'Bearer signed-cafe-owner')
        self.env['safe_get_business'].assert_called_once_with('cafe')

    def test_unconfigured_signing_never_returns_partial_credentials(self):
        for missing in ('CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'):
            env = fixture(); env[missing] = ''
            with self.subTest(missing=missing):
                with self.assertRaises(HTTPException) as failure:
                    asyncio.run(env['get_cloudinary_signature']('cafe', purpose='branding', asset_role='logo', authorization='Bearer signed-cafe-owner'))
                self.assertEqual(failure.exception.status_code, 503)
                self.assertNotIn(SECRET, str(failure.exception.detail))

    def test_http_query_cannot_override_signed_eager_folder_preset_or_signature(self):
        app = FastAPI()
        app.post('/api/v1/business/{public_id}/cloudinary-signature')(self.env['get_cloudinary_signature'])
        with TestClient(app) as client:
            response = client.post('/api/v1/business/cafe/cloudinary-signature',
                params={'purpose': 'branding', 'asset_role': 'logo', 'eager': 'l_fetch:external',
                        'folder': 'branding/other-cafe', 'upload_preset': 'OtherPreset', 'signature': 'forged'},
                headers={'Authorization': 'Bearer signed-cafe-owner'})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertEqual(result['folder'], 'branding/cafe')
            self.assertEqual(result['upload_preset'], 'SignedPreset')
            self.assertNotIn('l_fetch:', result['eager'])
            self.assertNotEqual(result['signature'], 'forged')
            self.assertNotIn(SECRET, response.text)
            denied = client.post('/api/v1/business/other-cafe/cloudinary-signature',
                params={'purpose': 'branding', 'asset_role': 'logo'}, headers={'Authorization': 'Bearer signed-cafe-owner'})
            self.assertEqual(denied.status_code, 403)


if __name__ == '__main__': unittest.main()
