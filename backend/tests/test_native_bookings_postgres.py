"""Disposable local PG integration tests. Never point at production.
Uses the same temporary Unix socket as test_menu_order_adjustments_postgres.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from threading import Barrier
from uuid import uuid4
import os
import pytest

@pytest.fixture
def booking_db():
    socket=os.environ.get("LT_BATCH_A_PG_SOCKET","")
    if not socket.startswith("/tmp/lt-"):
        pytest.skip("Use a disposable /tmp/lt-* PostgreSQL Unix socket.")
    pg=pytest.importorskip("psycopg2")
    from psycopg2 import sql
    opts=dict(host=socket,port=os.environ.get("LT_BATCH_A_PG_PORT","55432"),connect_timeout=5)
    db="lt_booking_test_"+uuid4().hex
    admin=pg.connect(dbname="postgres",**opts);admin.autocommit=True
    try:
        with admin.cursor() as c: c.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db)))
        conn=pg.connect(dbname=db,**opts);conn.autocommit=True
        try:
            with conn.cursor() as c:
                c.execute("""create table businesses(id integer primary key);
                create table branches(id integer primary key,business_id integer references businesses,public_id text,name text,is_active boolean);
                insert into businesses values(1),(2);
                insert into branches values(10,1,'main','Main',true),(11,1,'second','Second',true),(20,2,'other','Other',true);
                grant select on branches to service_role;""")
                c.execute((Path(__file__).resolve().parents[1]/"lt_native_bookings_v1.sql").read_text())
                c.execute((Path(__file__).resolve().parents[1]/"lt_booking_short_references.sql").read_text())
                c.execute("insert into lt_booking_settings(branch_id,business_id,venue_enabled,table_enabled) values(10,1,true,true),(11,1,true,true),(20,2,true,true)")
                c.execute("insert into lt_booking_resources(branch_id,business_id,kind,name,capacity,duration_minutes) values(10,1,'table','T1',4,90),(10,1,'table','T2',6,90),(10,1,'venue','Exclusive',50,240),(11,1,'table','T1',4,90),(20,2,'table','Other',4,90) returning id::text")
                ids=[x[0] for x in c.fetchall()]
                c.execute("select (now() at time zone 'Asia/Manila')::date+2")
                day=c.fetchone()[0]
        finally: conn.close()
        def call(q,params=(),role="service_role"):
            with pg.connect(dbname=db,**opts) as con:
                with con.cursor() as c:
                    c.execute(sql.SQL("SET LOCAL ROLE {}").format(sql.Identifier(role)))
                    c.execute(q,params)
                    return c.fetchall() if c.description else []
        yield call,ids,day,pg
    finally:
        with admin.cursor() as c: c.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(db)))
        admin.close()

def slots(call,r,day,branch=10,business=1,guests=2):
    return [row[0] for row in call("select * from lt_booking_slots(%s,%s,%s,%s,%s)",(business,branch,r,day,guests))]

def request(call,r,start,req=None,branch=10,business=1,guests=2):
    return call("select lt_booking_request(%s,%s,%s,%s,%s,%s,%s,%s,%s)",(business,branch,r,start,guests,"Sample","639123456789","",req or str(uuid4())))[0][0]

def move(call,ref,status="confirmed",business=1):
    return call("select lt_booking_transition(%s,%s,%s)",(business,ref,status))[0][0]

def test_table_capacity_and_branch_scope(booking_db):
    call,ids,day,pg=booking_db
    assert slots(call,ids[0],day)
    assert not slots(call,ids[0],day,guests=5)
    assert not slots(call,ids[4],day,business=1,branch=20)
    assert not slots(call,ids[0],day,branch=11)
    with pytest.raises(pg.Error):
        call("select * from lt_bookings",role="anon")
    with pytest.raises(pg.Error):
        call("select * from lt_booking_slots(%s,%s,%s,%s,%s)",(1,10,ids[0],day,2),role="authenticated")

def test_request_retry_and_cross_business_status(booking_db):
    call,ids,day,pg=booking_db
    start=slots(call,ids[0],day)[0];key=str(uuid4())
    a=request(call,ids[0],start,key);b=request(call,ids[0],start,key)
    assert a==b and a["status"]=="pending"
    with pytest.raises(pg.Error):
        request(call,ids[1],start,key)
    with pytest.raises(pg.Error):
        move(call,a["reference"],business=2)
    assert move(call,a["reference"])["status"]=="confirmed"
    assert start not in slots(call,ids[0],day)
    assert start in slots(call,ids[1],day)
    assert start not in slots(call,ids[2],day)
    assert start in slots(call,ids[3],day,branch=11)
    move(call,a["reference"],"cancelled")
    assert start in slots(call,ids[0],day)

def test_concurrent_exclusive_venue_and_table_confirmations(booking_db):
    call,ids,day,pg=booking_db
    start=slots(call,ids[0],day)[0]
    a=request(call,ids[0],start)["reference"];b=request(call,ids[2],start)["reference"]
    barrier=Barrier(2)
    def confirm(ref):
        barrier.wait(timeout=5)
        try:
            return move(call,ref)["status"]
        except pg.Error as e:
            assert "unavailable" in str(e)
            return "conflict"
    with ThreadPoolExecutor(2) as pool:
        result=list(pool.map(confirm,[a,b]))
    assert sorted(result)==["confirmed","conflict"]

def test_adjacent_slots_and_pending_not_holds(booking_db):
    call,ids,day,pg=booking_db
    start=slots(call,ids[0],day)[0]
    a=request(call,ids[0],start)["reference"]
    assert start in slots(call,ids[0],day)
    move(call,a)
    assert start+timedelta(minutes=90) in slots(call,ids[0],day)
    call("update lt_booking_settings set blocked_dates=array[%s]::date[] where branch_id=10",(day,))
    assert not slots(call,ids[1],day)


def test_branch_hours_limit_arrivals_and_confirmation_rechecks(booking_db):
    call,ids,day,pg=booking_db
    original=slots(call,ids[0],day)
    call("update lt_booking_settings set opens_at='12:00',closes_at='15:00' where branch_id=10")
    limited=slots(call,ids[0],day)
    assert limited==original[4:8]
    assert slots(call,ids[1],day)==limited
    assert slots(call,ids[3],day,branch=11)==original
    booking=request(call,ids[0],limited[0])["reference"]
    call("update lt_booking_settings set opens_at='13:00' where branch_id=10")
    with pytest.raises(pg.Error,match='unavailable'):
        move(call,booking)

def test_short_reference_matches_uuid_and_is_stable(booking_db):
    from backend.native_bookings import short_booking_code
    call,ids,day,pg=booking_db
    start=slots(call,ids[0],day)[0]
    key=str(uuid4())
    first=request(call,ids[0],start,key)
    code=call("select booking_code from lt_bookings where business_id=1 and id=%s",(first["reference"],))[0][0]
    assert code==short_booking_code(first["reference"])
    assert request(call,ids[0],start,key)==first
    move(call,first["reference"])
    assert call("select status from lt_bookings where business_id=1 and booking_code=%s",(code,))==[("confirmed",)]
    assert not call("select status from lt_bookings where business_id=2 and booking_code=%s",(code,))
    with pytest.raises(pg.Error):
        call("select booking_code from lt_bookings",role="anon")
