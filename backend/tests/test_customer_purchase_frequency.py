from backend.menu_customer_pulse_v192 import purchase_frequency


def test_purchase_frequency_groups_addons_and_excludes_unconfirmed_payments():
    def row(order_id, buyer, total, **changes):
        return dict({
            'public_id': order_id, 'member_customer_public_id': buyer,
            'branch_public_id': 'main', 'status': 'completed',
            'payment_status': 'paid', 'payment_method': 'cash', 'total': total,
        }, **changes)

    result = purchase_frequency([
        row('root', 'a', 100),
        row('child', 'a', 50, parent_order_public_id='root'),
        row('second', 'a', 150),
        row('third', 'b', 200),
        row('test', 'b', 500, payment_status='paid_test', payment_method='qrph'),
        row('unpaid', 'b', 500, payment_status='unpaid'),
        row('cancelled', 'b', 500, status='cancelled'),
        row('unverified', 'b', 500, payment_method='card'),
        row('guest', '', 500),
    ])
    assert result['linked_buyers'] == 2
    assert result['repeat_buyers'] == 1
    assert result['single_bill_buyers'] == 1
    assert result['repeat_buyer_percent'] == 50
    assert result['average_bills_per_buyer'] == 1.5
    assert result['average_cash_spend_per_buyer'] == 250


def test_empty_purchase_frequency_does_not_invent_averages():
    result = purchase_frequency([])
    assert result['linked_buyers'] == 0
    assert result['repeat_buyer_percent'] is None
    assert result['average_cash_spend_per_buyer'] is None
