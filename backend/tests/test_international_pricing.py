"""Actual pricing definitions isolated from startup; no live DB/provider calls."""
import ast
import asyncio
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Optional
import unittest
from unittest.mock import MagicMock
from fastapi import Request, Query

SOURCE=Path(__file__).resolve().parents[1]/'main.py'
TREE=ast.parse(SOURCE.read_text())
ASSIGNMENTS={'SUBSCRIPTION_PLANS','INTERNATIONAL_PLAN_PRICES','MARKET_CURRENCIES',
             'PRICING_REGIONS','SUPPORTED_PRICING_COUNTRIES','COUNTRY_ALIASES',
             'DEFAULT_FX_TO_PHP','BILLING_CYCLE_CONFIG','ANNUAL_BILLABLE_MONTHS','PH_BILLING_MONTHLY_DISCOUNTS'}
FUNCTIONS={'normalize_country_code','pricing_region_config','business_pricing_region',
           'business_currency','business_currency_symbol','subscription_currency','price_tiers_for_region',
           'branch_price_bracket','normalize_billing_cycle','self_serve_billing_cycle','get_price_for_plan',
           'billing_monthly_discounts','prepaid_subscription_price',
           'business_custom_monthly_price','billing_branch_count','get_price_for_business',
           'get_plan_features','subscription_plans_payload','public_pricing_context'}

def namespace():
    env=dict(Optional=Optional,Request=Request,Query=Query,re=re,asyncio=asyncio,
             print=lambda *a,**k:None)
    nodes=[]
    for n in TREE.body:
        if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ASSIGNMENTS for t in n.targets):
            nodes.append(n)
        elif isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name in FUNCTIONS:
            n.decorator_list=[]
            nodes.append(n)
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(SOURCE),'exec'),env)
    return env


class InternationalPricingTests(unittest.TestCase):
    def setUp(self):
        self.env=namespace()

    def test_every_international_region_has_identical_usd_prices(self):
        for country in ('US','SG','GB','HK','NZ','MY','AE','AU','INT','CA','DE','JP'):
            with self.subTest(country=country):
                config=self.env['pricing_region_config'](country)
                self.assertEqual(config['currency'],'USD')
                for plan,price in [('starter',15),('growth',39),('pro',69)]:
                    self.assertEqual(self.env['get_price_for_plan'](plan,1,'monthly',country),price)
                    self.assertEqual(self.env['get_price_for_plan'](plan,1,'annual',country),price*10)
                    self.assertEqual(self.env['get_price_for_plan'](plan,1,'3_months',country),price*3)
                    self.assertEqual(self.env['get_price_for_plan'](plan,1,'6_months',country),price*6)

    def test_ph_monthly_and_prepaid_prices_match_the_confirmed_discounts(self):
        self.assertEqual(self.env['pricing_region_config']('PH')['currency'],'PHP')
        for plan, totals in [('starter', [350, 975, 1800, 3000]),
                             ('growth', [550, 1575, 3000, 5400]),
                             ('pro', [750, 2175, 4200, 7800])]:
            for cycle, total in zip(('monthly', '3_months', '6_months', 'annual'), totals):
                with self.subTest(plan=plan, cycle=cycle):
                    self.assertEqual(self.env['get_price_for_plan'](plan,1,cycle,'PH'),total)
        self.assertEqual(self.env['self_serve_billing_cycle']('monthly','PH'),'monthly')
        self.assertEqual(self.env['self_serve_billing_cycle']('monthly','SG'),'monthly')

    def test_public_payload_and_branch_packages_use_the_same_discounted_totals(self):
        payload = self.env['subscription_plans_payload']('PH')
        for plan, data in payload.items():
            self.assertEqual(data['billing_discounts'], {'monthly':0,'3_months':25,'6_months':50,'annual':100})
            self.assertEqual(data['annual_savings_months'], 0)
            for cycle in ('3_months', '6_months', 'annual'):
                self.assertEqual(data['price_'+cycle], self.env['get_price_for_plan'](plan,1,cycle,'PH'))
                for branches in (1,2,3,5):
                    self.assertEqual(data['price_tiers_'+cycle][str(branches)],
                                     self.env['get_price_for_plan'](plan,branches,cycle,'PH'))
        self.assertEqual(self.env['get_price_for_plan']('starter',2,'3_months','PH'),2025)
        self.assertEqual(self.env['get_price_for_plan']('starter',6,'6_months','PH'),11400)

    def test_custom_ph_quote_retains_its_existing_terms(self):
        business={'plan':'growth','country_code':'PH','custom_monthly_price':777}
        for cycle, multiplier in [('monthly',1),('3_months',3),('6_months',6),('annual',10)]:
            self.assertEqual(self.env['get_price_for_business'](business,cycle),777*multiplier)

    def test_standard_billing_is_usd_without_reinterpreting_sales_or_custom_quotes(self):
        business={'country_code':'SG','display_currency':'SGD','plan':'growth'}
        self.assertEqual(self.env['subscription_currency'](business),'USD')
        self.assertEqual(self.env['business_currency'](business),'SGD')
        self.assertEqual(self.env['business_currency_symbol'](business),'S$')
        self.assertEqual(self.env['get_price_for_business'](business),39)
        business['custom_monthly_price']=80
        self.assertEqual(self.env['subscription_currency'](business),'SGD')
        self.assertEqual(self.env['get_price_for_business'](business),80)
        self.assertEqual(self.env['get_price_for_business'](business,'annual'),800)

    def test_branch_packages_and_public_plan_payload(self):
        for plan in ('starter','growth','pro'):
            for branches in (1,2,3,4,5,6,10):
                self.assertEqual(self.env['get_price_for_plan'](plan,branches,'annual','AU'),
                                 self.env['get_price_for_plan'](plan,branches,'annual','US'))
        payload=self.env['subscription_plans_payload']('NZ')
        self.assertEqual(payload['growth']['price_month'],39)
        self.assertEqual(payload['growth']['price_annual'],390)
        # Preserve market-specific features and PH-only fulfilment boundaries.
        self.assertFalse(payload['growth']['gift_cards'])
        self.assertTrue(self.env['get_plan_features']('pro','AE')['geofence_notifications'])

    def test_geo_unlisted_country_uses_international_not_ph(self):
        self.env['_analytics_header_geo']=lambda _: {'country_code':'CA'}
        self.env['_analytics_geo_for_ip']=MagicMock()
        req=SimpleNamespace(headers={})
        result=asyncio.run(self.env['public_pricing_context'](req,country='PH'))
        self.assertEqual(result['currency'],'USD')
        self.assertEqual(result['country_code'],'INT')
        self.assertFalse(result['setup_kit_available'])
        self.assertEqual(result['plans']['starter']['price_month'],15)
        self.env['_analytics_geo_for_ip'].assert_not_called()

    def test_aliases_and_unknown_location_reference_fallback(self):
        self.assertEqual(self.env['normalize_country_code']('UAE'),'AE')
        self.assertEqual(self.env['normalize_country_code']('USA'),'US')
        self.assertEqual(self.env['normalize_country_code']('PHL'),'PH')
        self.assertEqual(self.env['normalize_country_code'](None),'PH')
        self.assertEqual(self.env['normalize_country_code']('XX'),'PH')
        self.assertEqual(self.env['normalize_country_code']('Canada'),'PH')
        self.assertEqual(self.env['normalize_country_code']('CA'),'INT')

if __name__=='__main__':
    unittest.main()
