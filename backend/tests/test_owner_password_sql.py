"""Execute owner reset/revocation SQL in isolated PostgreSQL; no live DB."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from backend.password_security import hash_owner_password_sync


class OwnerPasswordSQLTests(unittest.TestCase):
    def test_real_reset_single_use_expiry_rollback_revocation_and_permissions(self):
        module = Path(os.getenv('LT_BENEFITS_PGLITE', '/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js'))
        node = Path(os.getenv('LT_BENEFITS_NODE', '/usr/local/bin/node'))
        if not module.is_file() or not node.is_file():
            self.skipTest('Optional isolated PostgreSQL engine unavailable; reset SQL requires validation')
        migration = Path(__file__).resolve().parents[1] / 'owner_password_security.sql'
        # Real generated envelopes demonstrate that the legacy varchar(64)
        # column is widened sufficiently, rather than merely storing a prefix.
        hash_one = hash_owner_password_sync('synthetic-reset-password-one')
        hash_two = hash_owner_password_sync('synthetic-reset-password-two')
        script = r'''
import {PGlite} from MODULE;
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE public.businesses(id bigint PRIMARY KEY,public_id text UNIQUE NOT NULL,
 password_hash varchar(64) NOT NULL,password_reset_token_hash text,
 password_reset_expires_at timestamptz,password_changed_at timestamptz,updated_at timestamptz);
 INSERT INTO public.businesses(id,public_id,password_hash,password_reset_token_hash,password_reset_expires_at,updated_at)
 VALUES(1,'one',repeat('a',64),'token-one',now()+interval '1 hour','2000-01-01'),
 (2,'expired','legacy-literal','token-expired',now()-interval '1 second','2000-01-01'),
 (3,'rollback',repeat('b',64),'token-rollback',now()+interval '1 hour','2000-01-01'),
 (4,'permissions',repeat('c',64),'token-permissions',now()+interval '1 hour','2000-01-01');`);
 const sql=fs.readFileSync(MIGRATION,'utf8');await db.exec(sql);await db.exec(sql);
 const row=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 const reset=async(business,token,hash)=>
  (await db.query('SELECT * FROM public.reset_owner_password($1,$2,$3)',[business,token,hash])).rows;
 const snapshot=async(id)=>(await row('SELECT to_jsonb(b) state FROM public.businesses b WHERE id=$1',[id])).state;
 const first=HASH_ONE,second=HASH_TWO;
 assert.ok(first.length>64);assert.ok(second.length>64);
 assert.equal((await row("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='password_hash'")).data_type,'text');
 const beforeOne=await snapshot(1),beforeExpired=await snapshot(2);
 assert.equal(beforeOne.password_hash,'a'.repeat(64));assert.equal(beforeOne.auth_version,0);
 assert.equal(beforeExpired.password_hash,'legacy-literal');assert.equal(beforeExpired.auth_version,0);
 // Wrong tenant/token, expired token and non-KDF writes consume nothing.
 assert.deepEqual(await reset('wrong-business','token-one',first),[]);
 assert.deepEqual(await reset('one','wrong-token',first),[]);
 assert.deepEqual(await reset('expired','token-expired',first),[]);
 assert.deepEqual(await reset('one','token-one','a'.repeat(64)),[]);
 assert.deepEqual(await snapshot(1),beforeOne);assert.deepEqual(await snapshot(2),beforeExpired);
 // One atomic reset stores the full envelope and immediately increments the
 // version used to revoke previously issued owner and billing sessions.
 const result=await reset('one','token-one',first);assert.equal(Number(result[0].auth_version),1);
 const afterOne=await snapshot(1);
 assert.equal(afterOne.password_hash,first);assert.equal(afterOne.auth_version,1);
 assert.equal(afterOne.password_reset_token_hash,null);assert.equal(afterOne.password_reset_expires_at,null);
 assert.ok(afterOne.password_changed_at);assert.notEqual(afterOne.updated_at,beforeOne.updated_at);
 assert.deepEqual(await reset('one','token-one',second),[]);assert.deepEqual(await snapshot(1),afterOne);
 // Reapplying the migration must not reset existing session versions.
 await db.exec(sql);assert.equal((await snapshot(1)).auth_version,1);
 await db.exec("UPDATE businesses SET password_reset_token_hash='token-two',password_reset_expires_at=now()+interval '1 hour' WHERE id=1");
 assert.equal(Number((await reset('one','token-two',second))[0].auth_version),2);
 assert.equal((await snapshot(1)).password_hash,second);
 // Simulate a database failure in the update: password, token, timestamps and
 // auth_version must ALL survive unchanged, allowing the original token retry.
 const beforeRollback=await snapshot(3);
 await db.exec(`CREATE FUNCTION fail_owner_reset() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF OLD.public_id='rollback' AND NEW.password_hash<>OLD.password_hash THEN
 RAISE EXCEPTION 'synthetic reset write failure';END IF;RETURN NEW;END$$;
 CREATE TRIGGER reset_failure BEFORE UPDATE ON public.businesses FOR EACH ROW EXECUTE FUNCTION fail_owner_reset();`);
 await assert.rejects(reset('rollback','token-rollback',first),/synthetic reset write failure/);
 assert.deepEqual(await snapshot(3),beforeRollback);
 await db.exec('DROP TRIGGER reset_failure ON public.businesses');
 assert.equal(Number((await reset('rollback','token-rollback',first))[0].auth_version),1);
 // Enforce actual call permissions, not only a string assertion on the file.
 const signature='public.reset_owner_password(text,text,text)';
 for(const role of ['anon','authenticated']) {
  assert.equal((await row("SELECT has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).allowed,false);
  await db.exec('SET ROLE '+role);
  await assert.rejects(reset('permissions','token-permissions',first),e=>e.code==='42501');
  await db.exec('RESET ROLE');
 }
 assert.equal((await snapshot(4)).auth_version,0);
 assert.equal((await row("SELECT has_function_privilege('service_role',$1,'EXECUTE') allowed",[signature])).allowed,true);
 await db.exec('SET ROLE service_role');
 assert.equal(Number((await reset('permissions','token-permissions',first))[0].auth_version),1);
 await db.exec('RESET ROLE');assert.equal((await snapshot(4)).password_reset_token_hash,null);
 console.log('Real isolated owner password reset SQL checks passed');
} finally {await db.close();}
'''.replace('MODULE', json.dumps(module.as_uri())).replace('MIGRATION', json.dumps(str(migration)))
        script = script.replace('HASH_ONE', json.dumps(hash_one)).replace('HASH_TWO', json.dumps(hash_two))
        with tempfile.TemporaryDirectory(prefix='lt-owner-reset-sql-') as directory:
            path = Path(directory) / 'verify.mjs'
            path.write_text(script)
            result = subprocess.run([str(node), str(path)], capture_output=True, text=True, timeout=90)
        self.assertEqual(result.returncode, 0, result.stderr[-6000:])


if __name__ == '__main__': unittest.main()
