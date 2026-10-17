"""Event notification route/provider regression tests; all delivery is mocked."""
import ast
from datetime import datetime
import html as html_lib
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import MagicMock
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'


class Query:
    def __init__(self, db, table):
        self.db, self.table_name, self.update_data = db, table, None
    def select(self, *args, **kwargs): return self
    def eq(self, *args, **kwargs): return self
    def limit(self, *args, **kwargs): return self
    def update(self, data): self.update_data = data; return self
    def execute(self):
        if self.update_data is not None:
            self.db.updates.append(self.update_data)
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=self.db.events if self.table_name == 'events' else self.db.tickets)


class EventNotificationTests(unittest.TestCase):
    def setUp(self):
        self.db = SimpleNamespace(events=[{'id':7,'name':'Test <Event>'}], tickets=[
            {'public_id':'ticket-1','attendee_email':'first@example.invalid'},
            {'public_id':'ticket-2','attendee_email':'second@example.invalid'},
            {'public_id':'ticket-3','attendee_email':''}], updates=[])
        self.db.table = lambda name: Query(self.db, name)
        self.send = MagicMock(return_value=True)
        self.log = MagicMock()
        self.app = FastAPI()
        def require_owner(public_id, authorization):
            if authorization != 'Bearer test-owner': raise HTTPException(status_code=401, detail='Owner session required')
            return {'id':1,'name':'Test <Business>'}
        self.env = dict(Optional=Optional,datetime=datetime,html_lib=html_lib,app=self.app,
                        Header=Header,HTTPException=HTTPException,_require_event_owner=require_owner,
                        supabase=self.db,send_email=self.send,log_event=self.log,friendly_db_error=lambda exc:'Upstream failure')
        names = {'send_event_ticket_email','send_event_notification'}
        functions = [node for node in ast.parse(SOURCE.read_text()).body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(functions),2, 'The actual sender and route must both exist')
        exec(compile(ast.Module(body=functions,type_ignores=[]), str(SOURCE), 'exec'), self.env)
        self.client = TestClient(self.app)

    def notify(self, message='Gates open soon'):
        return self.client.post('/api/v1/business/test-business/events/test-event/notify',
                                headers={'Authorization':'Bearer test-owner'},json={'message':message})

    def test_success_uses_real_event_message_and_records_provider_acceptance(self):
        response = self.notify('Welcome <guests>\nGates open soon')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['emailed'],2)
        self.assertEqual(response.json()['email_failed'],0)
        self.assertEqual(response.json()['email_skipped'],1)
        recipient, subject, body = self.send.call_args.args
        self.assertEqual(subject,'Event update: Test <Event>')
        self.assertIn('Welcome &lt;guests&gt;\nGates open soon',body)
        self.assertIn('Test &lt;Business&gt;',body)
        self.assertNotIn('<guests>',body)
        self.assertEqual(self.db.updates[0]['last_notification'],'Welcome <guests>\nGates open soon')
        self.assertEqual(self.log.call_args.kwargs['delivered'],2)
        self.assertNotIn('example.invalid',str(self.log.call_args))
        self.assertNotIn('Welcome',str(self.log.call_args))

    def test_false_provider_result_is_a_failure_not_a_success(self):
        self.send.side_effect = [True,False]
        result = self.notify().json()
        self.assertEqual((result['emailed'],result['email_failed'],result['email_skipped']),(1,1,1))
        self.assertEqual(self.log.call_args.args,('event_notification','warning'))

    def test_provider_exception_does_not_abort_remaining_recipients(self):
        self.send.side_effect = [TimeoutError('mail outage'),True]
        response = self.notify()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['emailed'],1)
        self.assertEqual(response.json()['email_failed'],1)
        self.assertEqual(self.send.call_count,2)

    def test_no_email_skips_provider(self):
        self.db.tickets = [{'public_id':'ticket-1','attendee_email':'  '}]
        result = self.notify().json()
        self.assertEqual((result['emailed'],result['email_failed'],result['email_skipped']),(0,0,1))
        self.send.assert_not_called()

    def test_empty_message_and_missing_event_do_not_send(self):
        self.assertEqual(self.notify('   ').status_code,400)
        self.db.events=[]
        self.assertEqual(self.notify().status_code,404)
        self.send.assert_not_called()
        self.assertEqual(self.db.updates,[])

    def test_owner_session_is_required(self):
        response=self.client.post('/api/v1/business/test-business/events/test-event/notify',json={'message':'test'})
        self.assertEqual(response.status_code,401)
        self.send.assert_not_called()

    def test_ticket_confirmation_sender_is_available_and_returns_provider_result(self):
        self.send.return_value=False
        result=self.env['send_event_ticket_email']({'attendee_email':'test@example.invalid','public_id':'ticket-1'},
            {'name':'Test Event','venue':'Test venue'}, {'name':'Test Business'})
        self.assertFalse(result)
        self.assertIn('Your event ticket: Test Event',self.send.call_args.args[1])
        self.assertIn('ticket-1',self.send.call_args.args[2])
