"""Bounded recovery for publishing one deterministic Google LoyaltyClass.

Google insert accepts a unique caller-selected ID, and update targets that ID:
https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/insert
https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update
This recovery is limited to these class operations, never arbitrary HTTP writes.
"""
import httpx

CLASS_URL = 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass'


def parse_google_response(response):
    try:
        return response.json()
    except ValueError:
        return {'raw_response': response.text[:2000]}


def upsert_loyalty_class(client, loyalty_class, access_token):
    target_url = f"{CLASS_URL}/{loyalty_class['id']}"
    headers = {'Authorization': f'Bearer {access_token}'}

    def write_current_design():
        response = client.put(target_url, headers=headers, json=loyalty_class)
        if response.status_code == 404:
            response = client.post(CLASS_URL, headers=headers, json=loyalty_class)
            if response.status_code == 409:
                # A concurrent publish or delayed insert created this exact ID.
                response = client.put(target_url, headers=headers, json=loyalty_class)
        return response

    for attempt in range(2):
        try:
            response = write_current_design()
            if attempt or response.status_code < 500:
                return response, parse_google_response(response)
        except httpx.TransportError:
            if attempt:
                raise
        # An insert/update may have committed even though its response was lost.
        # Check the exact ID; never allocate a new class or assume that an old
        # class already contains the latest editor settings.
        try:
            existing = client.get(target_url, headers=headers,
                                  timeout=httpx.Timeout(8.0, connect=5.0, pool=5.0))
            if existing.status_code not in (200, 404) and existing.status_code < 500:
                return existing, parse_google_response(existing)
        except httpx.TransportError:
            # Verification can also time out. A final PUT to the same ID is
            # safe; if still absent, its create fallback uses that same ID.
            pass
        # The next bounded round reapplies the current payload using PUT.
    raise RuntimeError('Google Wallet class recovery did not return a result')
