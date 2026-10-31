"""Hidden acceptance test: the new contract holds AND refunds still work."""
import pytest

from billing.refund import refund
from shop.money import to_cents


def test_negative_amounts_are_refused():
    with pytest.raises(ValueError):
        to_cents(-1)
    assert to_cents(12.5) == 1250


def test_refunds_still_book_negative_movements():
    r = refund("o-1", 12.5)
    assert r["cents"] == -1250
    assert r["label"] == "Refund -12.50 EUR"
