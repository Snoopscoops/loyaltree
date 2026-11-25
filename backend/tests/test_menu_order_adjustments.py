from decimal import Decimal

import pytest

from backend.menu_order_adjustments import AdjustmentRejected, canonical_items_total


def line(line_id="a" * 32, **fields):
    return {
        "line_id": line_id,
        "item_id": "latte",
        "quantity": 3,
        "unit_price": 10.25,
        "line_total": 30.75,
        "options": [{"public_id": "large"}],
        **fields,
    }


def test_prices_are_exact_and_line_ids_are_per_line():
    assert canonical_items_total([line(), line("b" * 32)]) == Decimal("61.50")


@pytest.mark.parametrize("items", [
    [], [line(), line()], [line("")], [line(item_id="")],
    [line(quantity=True)], [line(quantity=21)], [line(unit_price="NaN")],
    [line(unit_price="Infinity")], [line(line_total=30.751)], [line(line_total=1)],
    [line(options=[{"public_id": "large"}, {"public_id": "large"}])],
    [line(options=[{"public_id": ""}])],
])
def test_invalid_pricing_or_line_shapes_fail_closed(items):
    with pytest.raises(AdjustmentRejected):
        canonical_items_total(items)
