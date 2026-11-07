"""Signup link that carries a business referral code onto Apple and Google passes."""
import re
from urllib.parse import quote


def clean_referral_code(code: str) -> str:
    return re.sub(r'[^A-Z0-9_-]', '', str(code or '').strip().upper())


def referral_signup_url(site: str, code: str, source: str) -> str:
    """The page that already fills the code. Source stays in from, not ref."""
    cleaned = clean_referral_code(code)
    if not cleaned:
        return ''
    root = (site or 'https://theloyaltytree.com').rstrip('/')
    origin = re.sub(r'[^a-z0-9_]', '', str(source or 'wallet').lower()) or 'wallet'
    return f'{root}/signup?ref={quote(cleaned)}&from={quote(origin)}'


def referral_pass_line(code: str) -> str:
    cleaned = clean_referral_code(code)
    if not cleaned:
        return 'Integrate your business with LoyaltyTree?'
    return f'Integrate your business with LoyaltyTree? Code {cleaned}'
