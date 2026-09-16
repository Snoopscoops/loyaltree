#!/usr/bin/env python3
"""Small staging load test for Loyalty Tree POS Companion.

Default mode only hits the database/provider-free /health route, so it is safe
for a first concurrency check. Use --lookup only on a staging/test business with
an activated device token and a test customer QR/public id.
"""
import argparse
import concurrent.futures
import json
import statistics
import time
import urllib.request
import urllib.error


def call(base, token=None, scan=None, timeout=15):
    if scan:
        url = base.rstrip('/') + '/api/v1/pos-companion/customer/lookup'
        body = json.dumps({'scan_value': scan}).encode()
        headers = {'Content-Type':'application/json','Accept':'application/json','X-LT-Device-Token':token or ''}
        req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    else:
        url = base.rstrip('/') + '/api/v1/pos-companion/health'
        req = urllib.request.Request(url, headers={'Accept':'application/json'}, method='GET')
    started=time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read()
            code=r.status
    except urllib.error.HTTPError as e:
        e.read(); code=e.code
    except Exception:
        code=0
    return code, (time.perf_counter()-started)*1000


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--base', required=True, help='e.g. https://staging.example.com')
    p.add_argument('--concurrency', type=int, default=5)
    p.add_argument('--requests', type=int, default=50)
    p.add_argument('--lookup', action='store_true', help='Use real customer lookup instead of /health')
    p.add_argument('--token', default='')
    p.add_argument('--scan', default='')
    args=p.parse_args()
    if args.lookup and (not args.token or not args.scan):
        p.error('--lookup requires --token and --scan')
    fn=lambda: call(args.base, args.token if args.lookup else None, args.scan if args.lookup else None)
    t0=time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,args.concurrency)) as ex:
        results=list(ex.map(lambda _: fn(), range(max(1,args.requests))))
    elapsed=time.perf_counter()-t0
    lat=[ms for _,ms in results]
    ok=sum(1 for code,_ in results if 200 <= code < 300)
    lat_sorted=sorted(lat)
    p95=lat_sorted[min(len(lat_sorted)-1, max(0,int(len(lat_sorted)*0.95)-1))]
    print(f'requests={len(results)} concurrency={args.concurrency} ok={ok} failed={len(results)-ok}')
    print(f'elapsed={elapsed:.2f}s throughput={len(results)/elapsed:.2f} req/s')
    print(f'latency_ms mean={statistics.mean(lat):.1f} median={statistics.median(lat):.1f} p95={p95:.1f} max={max(lat):.1f}')
    codes={}
    for code,_ in results: codes[code]=codes.get(code,0)+1
    print('status_codes=' + json.dumps(codes, sort_keys=True))

if __name__=='__main__': main()
