"""No live accounts, providers or database mutations."""
import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
import sys
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1] if Path(__file__).parent.name=='tests' else Path(__file__).parent))
from storehub_redemption_codes import (RedemptionCodeError, build_options, quote, note_codes, receipt_matches, money, public_code, cancelled_receipts)

NOW=datetime(2026,10,15,6,0,tzinfo=timezone.utc)
def code(**changes):
    return {'id':'code-1','code':'LT-ABC123ABC123','kind':'points','name':'50 points',
        'gross_amount':'500.00','discount_amount':'50.00','expected_total':'450.00','currency':'PHP',
        'external_branch_id':'outlet','external_terminal_id':'register',
        'scanned_at':(NOW-timedelta(minutes=2)).isoformat(), 'confirmed_at':NOW.isoformat(),
        'expires_at':(NOW+timedelta(hours=24)).isoformat(),'receipt_reference':'', **changes}
def sale(**changes):
    return {'external_transaction_id':'tx-1','external_receipt_number':'INV-000012345',
        'external_branch_id':'outlet','external_terminal_id':'register','transaction_type':'sale',
        'net_amount':'450.00','gross_amount':'450.00','transacted_at':NOW.isoformat(),'currency':'PHP',
        'raw_payload':{'discount':50,'items':[{'notes':'LT-ABC123ABC123'}]},**changes}

class PricingTests(unittest.TestCase):
    def test_points_choices_are_owner_configured_affordable_and_increment_checked(self):
        programs=[{'membership_customer_public_id':'member','points_enabled':True,'points_balance':90}]
        options=build_options(programs,{'enabled':True,'options':[20,50,100],'min_points':30,'increment_points':10,'value_per_point':1})
        self.assertEqual([row['points'] for row in options],[50])
        self.assertEqual(quote(options[0],500)['expected_total'],'450.00')
    def test_disabled_points_and_unavailable_benefits_are_not_choices(self):
        options=build_options([{'membership_customer_public_id':'member','points_enabled':True,'points_balance':500,
            'benefits':[{'id':'b','available':False}]}],{'enabled':False,'options':[50]})
        self.assertEqual(options,[])
    def test_programs_and_customer_memberships_are_not_merged(self):
        options=build_options([{'membership_customer_public_id':name,'redeemables':[{'public_id':'reward','name':'Coffee'}]}
            for name in ('member','employee')],{})
        self.assertEqual(len({row['id'] for row in options}),2)
    def test_percentage_coupon_uses_final_bill_and_cent_rounding(self):
        result=quote({'kind':'coupon','value_mode':'percentage','value':'12.5'},'100.25')
        self.assertEqual(result['discount_amount'],'12.53');self.assertEqual(result['expected_total'],'87.72')
    def test_fixed_coupon_is_capped_at_bill(self):
        self.assertEqual(quote({'kind':'coupon','value_mode':'fixed','value':100},50)['expected_total'],'0.00')
    def test_points_cannot_exceed_bill_or_owner_percent_limit(self):
        for gross,maximum in [(20,100),(100,25)]:
            with self.subTest(gross=gross),self.assertRaises(RedemptionCodeError):
                quote({'kind':'points','value_mode':'fixed','value':50,'max_percent':maximum},gross)
    def test_free_item_requires_real_price_included_in_bill(self):
        option={'kind':'coupon','value_mode':'item','value':0}
        for value in (None,0,201):
            with self.subTest(value=value),self.assertRaises(RedemptionCodeError):quote(option,200,value)
        self.assertEqual(quote(option,200,75)['expected_total'],'125.00')
    def test_custom_non_cash_benefit_shows_instruction_without_inventing_price(self):
        result=quote({'kind':'benefit','value_mode':'benefit','name':'Lounge access','value':0},200)
        self.assertEqual(result['discount_amount'],'0.00');self.assertIn('Lounge access',result['instruction'])
    def test_minimum_purchase_and_invalid_config_are_rejected(self):
        for option,gross in [({'kind':'coupon','value_mode':'fixed','value':10,'min_purchase_amount':100},50),
            ({'kind':'benefit','value_mode':'percentage','value':101},200),
            ({'kind':'benefit','value_mode':'fixed','value':0},200)]:
            with self.subTest(option=option),self.assertRaises(RedemptionCodeError):quote(option,gross)
    def test_money_rejects_invalid_infinite_negative_and_huge_values(self):
        for amount in ('NaN','Infinity','-1','1000000001','nonsense'):
            with self.subTest(amount=amount),self.assertRaises(RedemptionCodeError):money(amount)
    def test_employee_and_coupon_types_are_present(self):
        options=build_options([{'membership_customer_public_id':'employee','benefits':[{'id':'daily','name':'Meal',
            'available':True,'benefit_type':'fixed_discount','value':50}],
            'redeemables':[{'public_id':'birthday','name':'Birthday','reward_type':'percentage_discount','reward_value':10}]}],{})
        self.assertEqual({option['kind'] for option in options},{'coupon','benefit'})

class ReceiptTests(unittest.TestCase):
    def test_item_notes_support_code_without_receipt_input(self):
        self.assertEqual(len(receipt_matches(code(),[sale()])),1)
    def test_full_receipt_supports_provider_without_notes(self):
        self.assertEqual(len(receipt_matches(code(receipt_reference='INV-000012345'),[sale(raw_payload={'discount':50})])),1)
    def test_blank_receipt_and_no_note_remain_pending(self):
        self.assertEqual(receipt_matches(code(),[sale(raw_payload={'discount':50})]),[])
    def test_mismatched_code_and_multiple_codes_fail_closed(self):
        for notes in ('LT-111111111111','LT-ABC123ABC123 LT-111111111111'):
            with self.subTest(notes=notes):
                self.assertEqual(receipt_matches(code(receipt_reference='INV-000012345'),[sale(raw_payload={'discount':50,'notes':notes})]),[])
    def test_customer_name_is_not_treated_as_note_evidence(self):
        self.assertEqual(note_codes({'customerName':'LT-ABC123ABC123'}),set())
    def test_codes_are_case_normalized_and_note_depth_is_bounded(self):
        self.assertEqual(note_codes({'items':[{'notes':'Reference lt-abc123abc123.'}]}),{'LT-ABC123ABC123'})
        self.assertEqual(note_codes({'notes':'XLT-ABC123ABC1239Y'}),set())
    def test_discount_must_exist_and_cover_the_displayed_amount(self):
        for raw in ({},{'discount':49},{'discount':'NaN'}):
            with self.subTest(raw=raw): self.assertEqual(receipt_matches(code(receipt_reference='INV-000012345'),[sale(raw_payload=raw)]),[])
    def test_exact_total_currency_register_and_branch_are_required(self):
        for patch in ({'net_amount':451},{'currency':'USD'},{'external_terminal_id':'other'}, {'external_branch_id':'other'}):
            with self.subTest(patch=patch):self.assertEqual(receipt_matches(code(),[sale(**patch)]),[])
    def test_void_and_refund_copies_invalidate_sale(self):
        for patch in ({'transaction_type':'void'},{'status':'voided'},{'transaction_type':'refund'}, {'raw_payload':{'isCancelled':True}}):
            with self.subTest(patch=patch):self.assertEqual(receipt_matches(code(),[sale(),sale(**patch)]),[])
    def test_conflicting_provider_copies_never_choose_one(self):
        self.assertEqual(receipt_matches(code(),[sale(),sale(net_amount=100)]),[])
    def test_two_candidates_remain_two_for_review(self):
        self.assertEqual(len(receipt_matches(code(),[sale(),sale(external_transaction_id='tx-2')])),2)
    def test_receipt_is_exact_and_confirmation_required(self):
        self.assertEqual(receipt_matches(code(receipt_reference='12345'),[sale()]),[])
        self.assertEqual(receipt_matches(code(confirmed_at=None),[sale()]),[])
    def test_time_padding_is_bounded_and_historical_receipts_are_supported(self):
        self.assertEqual(receipt_matches(code(),[sale(transacted_at=(NOW-timedelta(hours=1)).isoformat())]),[])
        self.assertEqual(receipt_matches(code(),[sale(transacted_at=(NOW+timedelta(hours=1)).isoformat())]),[])
        self.assertEqual(len(receipt_matches(code(receipt_reference='INV-000012345'),[sale(transacted_at=(NOW+timedelta(hours=1)).isoformat())])),1)
    def test_nonstacking_coupon_rejects_additional_pos_discounts(self):
        c=code(kind='coupon',receipt_reference='INV-000012345',payload={'stacking_allowed':False})
        self.assertEqual(receipt_matches(c,[sale(raw_payload={'discount':60})]),[])
        self.assertEqual(len(receipt_matches(c,[sale(raw_payload={'discount':50})])),1)
    def test_a_previously_verified_receipt_can_be_voided_without_repeated_notes(self):
        c=code(matched_transaction_id='db-tx',external_transaction_id='tx-1')
        self.assertEqual(len(cancelled_receipts(c,[sale(raw_payload={'isCancelled':True})])),1)
    def test_campaign_coupons_keep_their_existing_branch_rule_flow(self):
        options=build_options([{'membership_customer_public_id':'member','redeemables':[{'public_id':'campaign',
            'source':'campaign','name':'Branch promotion'}]}],{})
        self.assertEqual(options,[])
    def test_birthday_id_verification_requirement_is_preserved(self):
        option=build_options([{'membership_customer_public_id':'member','redeemables':[{'public_id':'birthday',
            'birthday_verification_required':True}]}],{})[0]
        self.assertTrue(option['birthday_verification_required'])
    def test_public_code_does_not_expose_credentials_or_membership_ids(self):
        value=public_code({**code(), 'payload':{'secret':'private'},'customer_id':99,'lease_token':'secret'})
        self.assertNotIn('payload',value);self.assertNotIn('customer_id',value);self.assertNotIn('lease_token',value)

if __name__=='__main__':unittest.main()
