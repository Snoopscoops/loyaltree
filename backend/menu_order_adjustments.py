"""Validate the canonical prices and identities shared by cash counter orders."""

from decimal import Decimal, InvalidOperation
import re

CENT = Decimal("0.01")
MAX_TOTAL = Decimal("1000000000")
LINE_ID = re.compile(r"[0-9a-f]{32}")


class AdjustmentRejected(ValueError):
    pass


def _money(value):
    try:
        amount = Decimal(str(value))
        if amount.is_finite() and 0 <= amount <= MAX_TOTAL and amount == amount.quantize(CENT):
            return amount.quantize(CENT)
    except (InvalidOperation, ValueError, TypeError):
        pass
    raise AdjustmentRejected("Invalid stored money amount")


def canonical_items_total(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 40:
        raise AdjustmentRejected("Order must contain 1 to 40 lines")
    seen = set()
    total = Decimal("0.00")
    for line in items:
        if not isinstance(line, dict):
            raise AdjustmentRejected("Invalid order line")
        line_id = line.get("line_id")
        if not isinstance(line_id, str) or not LINE_ID.fullmatch(line_id) or line_id in seen:
            raise AdjustmentRejected("Missing or duplicate canonical order line ID")
        seen.add(line_id)
        if not isinstance(line.get("item_id"), str) or not line["item_id"]:
            raise AdjustmentRejected("Missing menu item ID")
        quantity = line.get("quantity")
        if type(quantity) is not int or not 1 <= quantity <= 20:
            raise AdjustmentRejected("Invalid quantity")
        options = line.get("options")
        if not isinstance(options, list) or any(
            not isinstance(option, dict) or not isinstance(option.get("public_id"), str) or not option["public_id"]
            for option in options
        ):
            raise AdjustmentRejected("Invalid stored options")
        if len({option["public_id"] for option in options}) != len(options):
            raise AdjustmentRejected("Duplicate stored options")
        subtotal = _money(line.get("line_total"))
        if subtotal != _money(line.get("unit_price")) * quantity:
            raise AdjustmentRejected("Stored line price mismatch")
        total += subtotal
    return _money(total)
