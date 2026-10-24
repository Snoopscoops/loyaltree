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
        self.assertEqual(first.kwargs,dict(business_slug='cafe',passes_built=1,cache_hits=1,failed=0,
            peak_rss_mb=310,peak_container_memory_mb=None,min_container_headroom_mb=None,container_limit_mb=None))
        self.assertFalse(bursts.rows)
        bursts.sample();self.assertEqual(emit.call_count,2)

    def test_container_peak_is_sampled_once_for_active_bursts_and_preserved_when_unknown(self):
        emit, read = Mock(), Mock(side_effect=[
            {'container_memory_mb': 420, 'container_limit_mb': 512}, {},
            {'container_memory_mb': 388, 'container_limit_mb': 512}])
        bursts = WalletBursts(lambda: 174, emit=emit, read_container=read)
        bursts.sample()
        read.assert_not_called()
        bursts.record('cafe', 'passes_built')
        bursts.record('other', 'cache_hits')
        read.assert_not_called()
        bursts.sample()
        bursts.sample()
        bursts.sample(flush=True)
        self.assertEqual(read.call_count, 3)
        self.assertEqual(emit.call_count, 2)
        for call in emit.call_args_list:
            self.assertEqual(call.kwargs['peak_container_memory_mb'], 420)
            self.assertEqual(call.kwargs['min_container_headroom_mb'], 92)
            self.assertEqual(call.kwargs['container_limit_mb'], 512)

    def test_available_container_usage_without_a_limit_still_records_its_peak(self):
        emit = Mock()
        bursts = WalletBursts(lambda: None, emit=emit, read_container=lambda: {
            'container_memory_mb': 420, 'container_limit_mb': None})
        bursts.record('cafe', 'passes_built')
        bursts.sample(flush=True)
        self.assertEqual(emit.call_args.kwargs['peak_container_memory_mb'], 420)
        self.assertIsNone(emit.call_args.kwargs['min_container_headroom_mb'])


if __name__ == '__main__': unittest.main()
