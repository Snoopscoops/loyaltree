"""Validate generated event-pass geography without contacting Wallet or signing services."""
import ast
from datetime import datetime
import hashlib
from io import BytesIO
import json
from pathlib import Path
import unittest
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / 'main.py'


class EventPassLocationTests(unittest.TestCase):
    def build(self, event):
        source = ast.parse(SOURCE.read_text())
        fn = next(node for node in source.body if isinstance(node, ast.FunctionDef) and node.name == 'generate_event_ticket_pkpass')
        env = {'datetime':datetime,'BytesIO':BytesIO,'zipfile':zipfile,'json':json,'hashlib':hashlib,
               'APPLE_PASS_TYPE_IDENTIFIER':'pass.test.local','APPLE_TEAM_IDENTIFIER':'test-team',
               'sign_pkpass_manifest':lambda manifest:b'fixture-signature'}
        exec(compile(ast.Module(body=[fn],type_ignores=[]), str(SOURCE), 'exec'),env)
        data = env['generate_event_ticket_pkpass']({'public_id':'fixture-ticket','attendee_name':'Sample Guest'},event,{'name':'General'}, {'name':'Test Event Business'})
        with zipfile.ZipFile(BytesIO(data)) as archive:
            return json.loads(archive.read('pass.json'))

    def test_radius_is_pass_level_and_location_has_relevance_message(self):
        result = self.build({'name':'Test Event','geo_latitude':14.5,'geo_longitude':120.9,'geo_radius_meters':450,'notification_message':'Venue nearby'})
        self.assertEqual(result['maxDistance'],450)
        self.assertEqual(result['locations'],[{'latitude':14.5,'longitude':120.9,'relevantText':'Venue nearby'}])

    def test_zero_latitude_and_longitude_are_valid_locations(self):
        for latitude, longitude in [(0,120),(14,0),(0,0)]:
            result = self.build({'geo_latitude':latitude,'geo_longitude':longitude,'geo_radius_meters':200})
            self.assertEqual(result['locations'][0]['latitude'],latitude)
            self.assertEqual(result['locations'][0]['longitude'],longitude)

    def test_no_pin_does_not_add_location_relevance(self):
        for event in [{}, {'geo_latitude':None,'geo_longitude':120}]:
            result = self.build(event)
            self.assertNotIn('locations',result)
            self.assertNotIn('maxDistance',result)
