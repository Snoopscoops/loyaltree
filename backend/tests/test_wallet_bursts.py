import unittest
from unittest.mock import Mock
from backend.wallet_bursts import WalletBursts


class BurstTests(unittest.TestCase):
    def test_one_summary_per_business_retains_peak_and_counts_then_resets(self):
        now=[0];rss=[240];emit=Mock()
        bursts=WalletBursts(lambda:rss[0], lambda:now[0], emit)
        bursts.record('cafe', 'passes_built')
        rss[0]=310;bursts.sample()
        rss[0]=250;bursts.record('cafe', 'cache_hits')
        bursts.record('other', 'passes_built')
        now[0]=29;bursts.sample();emit.assert_not_called()
        now[0]=31;bursts.sample()
        self.assertEqual(emit.call_count,2)
        first=emit.call_args_list[0]
        self.assertEqual(first.args,('wallet_burst_summary',))
        self.assertEqual(first.kwargs,dict(business_slug='cafe',passes_built=1,cache_hits=1,failed=0,peak_rss_mb=310))
        self.assertFalse(bursts.rows)
        bursts.sample();self.assertEqual(emit.call_count,2)


if __name__ == '__main__': unittest.main()
