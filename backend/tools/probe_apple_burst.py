"""Isolated synthetic burst; no DB, Cloudinary upload, APNs or Google calls.

Uses the production scheduler, pass cache, artwork cache and ZIP builder.
Pass JSON and signature are fixtures, so output is not installable in Wallet.
This is a local allocation probe, not proof of production Render RSS/delivery.
"""
import asyncio
from contextlib import redirect_stdout
import ctypes
import hashlib
from io import BytesIO, StringIO
import json
import os
from pathlib import Path
import sys
import time


def rss_mb():
    if sys.platform == 'darwin':
        class Info(ctypes.Structure):
            _fields_ = [('virtual',ctypes.c_uint64),('resident',ctypes.c_uint64),('maximum',ctypes.c_uint64),
                        ('user_s',ctypes.c_uint32),('user_us',ctypes.c_uint32),('system_s',ctypes.c_uint32),
                        ('system_us',ctypes.c_uint32),('policy',ctypes.c_int32),('suspend',ctypes.c_int32)]
        libc=ctypes.CDLL(None);info=Info();count=ctypes.c_uint32(ctypes.sizeof(info)//4)
        if libc.task_info(libc.mach_task_self(),20,ctypes.byref(info),ctypes.byref(count)) == 0:
            return round(info.resident/(1024*1024),2)
        return None
    try:
        from runtime_metrics import current_rss_mb
        return current_rss_mb()
    except Exception: return None


async def probe(main):
    from PIL import Image
    images={}
    with Image.new('RGBA',(480,240),(30,100,70,255)) as logo, BytesIO() as buf:
        logo.save(buf,'PNG');images['logo']=buf.getvalue()
    with Image.effect_noise((1125,369),80) as noise, noise.convert('RGB') as hero, BytesIO() as buf:
        hero.save(buf,'PNG');images['hero']=buf.getvalue()
    downloads=[];built=[0];retries=[0];peak=[rss_mb()]
    main.APPLE_PASS_TYPE_IDENTIFIER='pass.synthetic'
    main.APPLE_TEAM_IDENTIFIER='SYNTHETIC'
    main.get_apple_pass_credentials=lambda:True
    main.lt_benefits_enabled=lambda:False
    main._apple_pass_dirty_at=lambda serial:None
    def fetch(url, *args, **kwargs):
        downloads.append(kwargs.get('profile','apple_logo_source'))
        return images['hero' if 'hero' in str(url) else 'logo']
    main._fetch_image_bytes=fetch
    def sign(data):
        built[0]+=1
        return hashlib.sha256(data).digest()
    main.sign_pkpass_manifest=sign
    main.build_apple_pass_json=lambda customer,*args:{'serialNumber':customer['public_id'],
        'backgroundColor':'rgb(18, 52, 86)','storeCard':{'primaryFields':[{'key':'points','value':customer['points_balance']}]}}
    main.memory_pressure.read=rss_mb
    main.wallet_bursts.read=rss_mb
    main._APPLE_PKPASS_CACHE.clear();main._APPLE_IMAGE_CACHE.clear()
    business=dict(id=1,public_id='synthetic-business',name='Synthetic Cafe',logo_url='https://res.cloudinary.com/test/image/upload/v1/logo.png')
    program=dict(id=1,card_type='points',primary_color='#123456',wallet_style='modern',hero_image_url='https://res.cloudinary.com/test/image/upload/v1/hero.png')
    announcement=dict(id=1,title='Synthetic announcement',message='Fixture only')
    running=[True]
    async def sample():
        while running[0]:
            rss=rss_mb()
            if rss is not None:peak[0]=max(peak[0] or rss,rss)
            main.wallet_bursts.sample()
            await asyncio.sleep(.005)
    async def phone(i):
        customer=dict(public_id=f'fixture-{i}',business_id=1,points_balance=i)
        while True:
            try:
                first=await main._prepare_apple_pkpass(customer,business,program,announcement)
                second=await main._prepare_apple_pkpass(customer,business,program,announcement)
                assert first[0] == second[0]
                return int(second[1])
            except main.HTTPException as exc:
                if exc.status_code != 503:raise
                retries[0]+=1
                await asyncio.sleep(.05)  # Accelerated fake-device retry; real clients use Retry-After.
                if retries[0]>5000:raise RuntimeError('Probe exceeded retry budget')
    baseline=rss_mb();started=time.monotonic();sampler=asyncio.create_task(sample())
    try: hits=await asyncio.gather(*(phone(i) for i in range(68)))
    finally:
        running[0]=False
        await sampler
    await asyncio.sleep(2)
    after=rss_mb();main.wallet_bursts.sample(flush=True)
    return dict(scope='Local synthetic probe; signatures, pass JSON and downloads are fixtures',
        audience_cards=130,apple_cards=68,other_cards=62,apple_fetch_requests=136,
        passes_built=built[0],duplicate_fetch_cache_hits=sum(hits),queue_full_retries=retries[0],
        branding_downloads=len(downloads),baseline_rss_mb=baseline,observed_peak_rss_mb=peak[0],
        after_idle_rss_mb=after,seconds=round(time.monotonic()-started,2),
        pass_cache=main._APPLE_PKPASS_CACHE.stats(),art_cache=main._APPLE_IMAGE_CACHE.stats(),
        caveat='Does not establish Linux allocator release, Render container memory, signing cost, or physical Wallet delivery.')


if __name__ == '__main__':
    # Remove inherited credentials before importing the app; never start its
    # lifecycle workers. Block unexpected provider calls in this fresh process.
    for key in list(os.environ):
        if key.startswith(('SUPABASE_','APPLE_PASS_','APPLE_TEAM_','GOOGLE_WALLET_','CLOUDINARY_')):
            os.environ.pop(key)
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
    import httpx
    def deny(*args,**kwargs):raise RuntimeError('Network calls are forbidden in this probe')
    httpx.Client.request=deny
    httpx.AsyncClient.request=deny
    with redirect_stdout(StringIO()):
        import main
        result=asyncio.run(probe(main))
    print(json.dumps(result,indent=2))
