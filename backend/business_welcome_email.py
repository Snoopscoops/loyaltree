"""Short owner setup guide for successful self-service business registrations."""
from datetime import datetime, timezone
from html import escape
from urllib.parse import quote
from zoneinfo import ZoneInfo


def trial_end_label(value):
    try:
        end = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        return end.astimezone(ZoneInfo('Asia/Manila')).strftime('%b %d, %Y at %I:%M %p') + ' (Philippine time)'
    except (TypeError, ValueError):
        return 'the end date shown in More → Billing'


def build_business_getting_started_email(*, business_name, contact_person, email,
                                         site_url, support_email, trial=None):
    site = site_url.rstrip('/')
    login_url = escape(f'{site}/login?onboarding=1', quote=True)
    guide_url = escape(f'{site}/how-it-works/businesses', quote=True)
    support = escape(support_email)
    support_url = escape('mailto:' + quote(support_email, safe='@'), quote=True)
    name = escape(contact_person.strip() if contact_person and contact_person.strip() else business_name)
    business = escape(business_name)
    address = escape(email)
    if trial:
        days = int(trial.get('trial_days') or 7)
        end = escape(trial_end_label(trial.get('trial_ends_at')))
        status = (f'<p>Your <strong>{days}-day free trial is active</strong> until {end}. '
                  'You can start setting up now. Open <strong>More → Billing</strong> '
                  'before your trial ends to continue with a paid subscription.</p>')
        cta_url, cta_label = login_url, 'Start setting up'
        steps_intro = 'Start with these five steps:'
    else:
        status = ('<p>Your registration is complete. First, finish <strong>Pay &amp; Activate</strong> '
                  'in the signup page you already opened. After payment is confirmed, '
                  'you can sign in and start setting up your business.</p>')
        cta_url, cta_label = guide_url, 'Read the setup guide'
        steps_intro = 'After activation, follow these five steps:'
    subject = 'Welcome to LoyaltyTree — your quick start guide'
    body = f'''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">
<div style="max-width:600px;margin:0 auto;background:#ffffff;padding:28px">
<p style="font-weight:bold;color:#166534">LoyaltyTree</p>
<h1 style="font-size:24px;line-height:1.3">Welcome, {name}!</h1>
<p>Here’s a short guide to getting <strong>{business}</strong> ready.</p>
{status}
<p><strong>{steps_intro}</strong></p>
<ol style="padding-left:22px">
<li><a href="{login_url}">Sign in</a> with <strong>{address}</strong> and the password you chose during signup.</li>
<li>Follow the <strong>Setup Guide</strong> to choose your card type, set rewards, and design your card.</li>
<li><strong>Create your cashier</strong>. Manage team access, PINs, and branch assignments under <strong>Operate → Team</strong>.</li>
<li>Select your loyalty card and <strong>share its join QR</strong> at your counter or online. Customers scan it to join and save their card to Apple Wallet or Google Wallet.</li>
<li><strong>Test with your team</strong>: join as a customer, then scan the customer’s card to record a stamp, points, visit, or session for your chosen card.</li>
</ol>
<p>You can reopen the walkthrough under <strong>More → Setup Guide</strong>.</p>
<p><a href="{cta_url}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">{cta_label}</a></p>
<p><a href="{guide_url}">View the business setup guide</a></p>
<p>Need help? Reply to this email or contact <a href="{support_url}">{support}</a>.</p>
<p style="color:#64748b;font-size:13px">Sent after your business registration with LoyaltyTree.</p>
</div></body></html>'''
    return subject, body
