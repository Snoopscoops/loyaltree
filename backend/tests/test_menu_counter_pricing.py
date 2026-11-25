"""Exercise the production pricing functions without starting the application."""
import ast
import math
import uuid
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import BaseModel, Field


@pytest.fixture
def price():
    source = (Path(__file__).resolve().parents[1] / 'main.py').read_text()
    names = {'OrderAheadCartItemInput', '_oa_decimal', '_oa_money_float',
             '_oa_price_cart', '_menu_normalize_counter_items', '_menu_price_counter_items'}
    nodes = [n for n in ast.parse(source).body if getattr(n, 'name', '') in names]
    catalog = {'items': [{'public_id': 'latte', 'is_active': True,
                          'name': 'Latte', 'base_price': 100,
                          'modifier_group_public_ids': ['size'],
                          'unavailable_branch_public_ids': ['closed']}],
               'modifier_groups': [{'public_id': 'size', 'is_active': True,
                                    'is_required': True, 'selection_type': 'single',
                                    'options': [{'public_id': 'large', 'is_active': True,
                                                 'name': 'Large', 'price_delta': 25}]}]}
    scope = dict(Decimal=Decimal, ROUND_HALF_UP=ROUND_HALF_UP, defaultdict=defaultdict,
                 HTTPException=HTTPException, BaseModel=BaseModel, Field=Field,
                 uuid=uuid, math=math, _OA_MONEY=Decimal('0.01'),
                 _oa_menu_snapshot=lambda _: catalog)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'main.py', 'exec'), scope)
    return scope['_menu_price_counter_items']


def line(**changes):
    return dict({'item_id': 'latte', 'quantity': 2,
                 'options': [{'public_id': 'large', 'price_delta': -999}],
                 'line_total': 1, 'name': 'Fake'}, **changes)


def test_catalog_price_and_unique_line_ids(price):
    lines, subtotal = price({}, 'open', [line(), line()])
    assert subtotal == 500
    assert lines[0]['unit_price'] == 125
    assert lines[0]['line_total'] == 250
    assert lines[0]['item_name'] == 'Latte'
    assert lines[0]['options'][0]['price_delta'] == 25
    assert lines[0]['line_id'] != lines[1]['line_id']


@pytest.mark.parametrize('cart', [[], [line(quantity=0)], [line(quantity=True)],
    [line(quantity=21)], [line(item_id='missing')], [line(options=[])],
    [line(options=[{'public_id': 'unknown'}])],
    [line(options=[{'public_id': 'large'}, {'public_id': 'large'}])],
    [line()] * 41])
def test_invalid_cart_rejected(price, cart):
    with pytest.raises(HTTPException) as error:
        price({}, 'open', cart)
    assert error.value.status_code == 400


def test_unavailable_branch_rejected(price):
    with pytest.raises(HTTPException) as error:
        price({}, 'closed', [line()])
    assert error.value.status_code == 400
