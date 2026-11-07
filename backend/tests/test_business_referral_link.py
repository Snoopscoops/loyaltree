"""The wallet link must carry the business code, not a source name, into signup."""
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import business_referral_link


class BusinessReferralLinkTests(unittest.TestCase):
    def test_signup_link_uses_the_business_code(self):
        url = business_referral_link.referral_signup_url('https://theloyaltytree.com/', 'jus-a1b2', 'wallet_apple')
        self.assertEqual(url, 'https://theloyaltytree.com/signup?ref=JUS-A1B2&from=wallet_apple')

    def test_blank_code_does_not_invent_a_link(self):
        self.assertEqual(business_referral_link.referral_signup_url('https://theloyaltytree.com', '', 'wallet_google'), '')

    def test_pass_text_shows_the_code(self):
        self.assertEqual(
            business_referral_link.referral_pass_line('jus-a1b2'),
            'Integrate your business with LoyaltyTree? Code JUS-A1B2',
        )
        self.assertEqual(
            business_referral_link.referral_pass_line(''),
            'Integrate your business with LoyaltyTree?',
        )


if __name__ == '__main__':
    unittest.main()
