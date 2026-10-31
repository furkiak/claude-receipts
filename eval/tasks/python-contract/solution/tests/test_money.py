from shop.money import format_cents, to_cents


def test_converts_to_cents():
    assert to_cents(12.5) == 1250
    assert to_cents(0) == 0


def test_formats_cents():
    assert format_cents(1250) == "12.50 EUR"
    assert format_cents(-99, "USD") == "-0.99 USD"


def test_negative_amounts_are_refused():
    import pytest

    with pytest.raises(ValueError):
        to_cents(-1)
