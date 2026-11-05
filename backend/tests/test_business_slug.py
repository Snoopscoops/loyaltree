"""New businesses get a short join slug. Saved slugs are not rewritten."""
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import business_slug


class ScriptedRandom:
    def __init__(self, values):
        self.values = list(values)

    def randbelow(self, limit):
        if not self.values:
            raise AssertionError("scripted random ran out")
        return self.values.pop(0) % limit


class ShortBusinessSlugTests(unittest.TestCase):
    def test_new_slug_fits_under_a_40_character_join_url(self):
        names = ["Jus Beverage", "A", "", "Khai + Coffee", "Jüs Café", "WolfCars Philippines"]
        for name in names:
            slug = business_slug.short_business_slug(name, set())
            url = business_slug.join_url_for_slug(slug)
            self.assertLess(len(url), 40, url)
            self.assertLessEqual(len(slug), business_slug.MAX_NEW_SLUG_LENGTH)
            self.assertRegex(slug, r"^[a-z0-9]+$")
            self.assertTrue(url.startswith("https://theloyaltytree.com/join/"))

    def test_jus_style_prefix_and_digits(self):
        slug = business_slug.short_business_slug("Jus Beverage", set(), ScriptedRandom([5479]))
        self.assertEqual(slug, "jus5479")
        self.assertEqual(len(business_slug.join_url_for_slug(slug)), 39)

    def test_collisions_try_the_next_suffix(self):
        taken = {"jus5479", "jus5480"}
        slug = business_slug.short_business_slug("Jus Beverage", taken, ScriptedRandom([5479, 5480, 5481]))
        self.assertEqual(slug, "jus5481")
        self.assertNotIn(slug, taken)

    def test_many_new_slugs_stay_unique(self):
        used = set()

        def taken(candidate):
            return candidate in used

        class Counting:
            def randbelow(self, limit):
                value = len(used) % limit
                return value

        for _ in range(50):
            slug = business_slug.short_business_slug("Cafe", taken, Counting())
            self.assertNotIn(slug, used)
            used.add(slug)
        self.assertEqual(len(used), 50)

    def test_existing_long_slug_still_resolves_and_is_not_rewritten(self):
        stored = {
            "jus-beverage-manufacturing-5479": "jus-beverage-manufacturing-5479",
        }
        before = dict(stored)
        self.assertEqual(
            business_slug.resolve_stored_public_id("jus-beverage-manufacturing-5479", stored),
            "jus-beverage-manufacturing-5479",
        )
        self.assertEqual(
            business_slug.resolve_stored_public_id("jus-beverage-manufacturing-5479__p__program", stored),
            "jus-beverage-manufacturing-5479",
        )
        fresh = business_slug.short_business_slug("Jus Beverage", stored, ScriptedRandom([5479]))
        self.assertEqual(fresh, "jus5479")
        self.assertNotIn(fresh, stored)
        self.assertEqual(stored, before)
        self.assertIsNone(business_slug.resolve_stored_public_id("missing-shop", stored))


if __name__ == "__main__":
    unittest.main()
