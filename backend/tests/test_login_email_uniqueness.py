"""Apply the real migration in isolated PostgreSQL, never production."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class LoginConstraintTests(unittest.TestCase):
    def test_case_insensitive_constraint_and_duplicate_preflight_preserve_accounts(self):
        module=Path(os.getenv('LT_BENEFITS_PGLITE','/private/tmp/lt-benefits-pg/node_modules/@electric-sql/pglite/dist/index.js'))
        node=Path(os.getenv('LT_BENEFITS_NODE','/usr/local/bin/node'))
        if not module.is_file() or not node.is_file():self.skipTest('Optional isolated PGlite unavailable')
        migration=Path(__file__).resolve().parents[1]/'login_email_uniqueness.sql'
        script="""
import {PGlite} from MODULE;
import fs from 'node:fs';
import assert from 'node:assert/strict';
const schema='CREATE TABLE businesses(id int primary key,email text); CREATE TABLE staff(id int,business_id int,email text); CREATE TABLE cl_agents(id int,business_id int,email text);';
const sql=fs.readFileSync(MIGRATION,'utf8');
const db=new PGlite();await db.exec(schema);await db.exec(sql);
await db.exec("INSERT INTO businesses VALUES(1,'Owner@Example.invalid')");
await assert.rejects(db.exec("INSERT INTO businesses VALUES(2,' owner@example.invalid ')"),e=>e.code==='23505');
assert.equal((await db.query('SELECT count(*)::int n FROM businesses')).rows[0].n,1);
await db.exec("INSERT INTO staff VALUES(1,1,'staff@example.invalid'),(2,2,'staff@example.invalid')");
await assert.rejects(db.exec("INSERT INTO staff VALUES(3,1,' STAFF@example.invalid ')"),e=>e.code==='23505');
await db.close();
const existing=new PGlite();await existing.exec(schema);
await existing.exec("INSERT INTO businesses VALUES(1,'same@example.invalid'),(2,' SAME@example.invalid ')");
await assert.rejects(existing.exec(sql),/owner review/);
await existing.exec('ROLLBACK');
assert.equal((await existing.query('SELECT count(*)::int n FROM businesses')).rows[0].n,2);
await existing.close();console.log('constraints and duplicate preservation passed');
""".replace('MODULE',repr(module.as_uri())).replace('MIGRATION',repr(str(migration)))
        with tempfile.TemporaryDirectory(prefix='lt-login-constraint-') as temp:
            path=Path(temp)/'check.mjs';path.write_text(script)
            result=subprocess.run([str(node),str(path)],capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)


if __name__ == '__main__':unittest.main()
