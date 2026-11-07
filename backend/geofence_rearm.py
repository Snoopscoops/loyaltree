"""Let Google Wallet consider a saved pin new again on a later day.

Google does not promise a nearby alert on every visit. The same coordinates
often fire once and then stay quiet, even on another day. Shifting the pin by
about one meter each Manila day gives Google a new location without moving the
store. This does not send a message to the customer.
"""
from datetime import datetime, timedelta, timezone

MANILA = timezone(timedelta(hours=8))
# About 1.2 meters of latitude. Small enough to stay on the shop.
_SHIFT = 0.000011


def manila_day(now=None):
    current = now or datetime.now(MANILA)
    if current.tzinfo is None:
        current = current.replace(tzinfo=MANILA)
    return current.astimezone(MANILA).toordinal()


def daily_google_pin(latitude, longitude, day=None):
    shift = _SHIFT if int(day if day is not None else manila_day()) % 2 else -_SHIFT
    latitude = float(latitude) + shift
    if latitude > 90:
        latitude = 90 - abs(shift)
    elif latitude < -90:
        latitude = -90 + abs(shift)
    return {'latitude': round(latitude, 6), 'longitude': round(float(longitude), 6)}


def businesses_with_nearby_alerts(rows):
    chosen = []
    for row in rows or []:
        config = row.get('geofence_config') if isinstance(row, dict) else None
        if isinstance(config, dict) and config.get('enabled') and config.get('pins'):
            chosen.append(row)
    return chosen
