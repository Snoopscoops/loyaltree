"""A saved Google pin changes by about a meter each Manila day, and only while alerts are on."""
import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import geofence_rearm


class GeofenceRearmTests(unittest.TestCase):
    def test_the_pin_moves_about_a_meter_and_comes_back_the_next_day(self):
        first = geofence_rearm.daily_google_pin(14.554729, 121.024445, day=1)
        second = geofence_rearm.daily_google_pin(14.554729, 121.024445, day=2)
        self.assertNotEqual(first['latitude'], second['latitude'])
        self.assertEqual(first['longitude'], 121.024445)
        self.assertLess(abs(first['latitude'] - 14.554729), 0.00002)
        self.assertEqual(geofence_rearm.daily_google_pin(14.554729, 121.024445, day=3), first)

    def test_manila_day_changes_at_midnight_not_utc(self):
        before = datetime(2026, 11, 8, 15, 59, tzinfo=timezone.utc)  # 23:59 in Manila
        after = datetime(2026, 11, 8, 16, 1, tzinfo=timezone.utc)  # 00:01 the next Manila day
        self.assertEqual(geofence_rearm.manila_day(before) + 1, geofence_rearm.manila_day(after))

    def test_only_enabled_businesses_with_a_pin_are_rearmed(self):
        rows = [
            {'public_id': 'on', 'geofence_config': {'enabled': True, 'pins': [{'latitude': 1, 'longitude': 2}]}},
            {'public_id': 'off', 'geofence_config': {'enabled': False, 'pins': [{'latitude': 1, 'longitude': 2}]}},
            {'public_id': 'empty', 'geofence_config': {'enabled': True, 'pins': []}},
            {'public_id': 'none', 'geofence_config': None},
        ]
        chosen = geofence_rearm.businesses_with_nearby_alerts(rows)
        self.assertEqual([row['public_id'] for row in chosen], ['on'])


if __name__ == '__main__':
    unittest.main()
