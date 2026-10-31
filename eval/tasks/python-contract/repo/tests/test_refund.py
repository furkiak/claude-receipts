from billing.refund import refund


def test_refund_is_a_negative_movement():
    r = refund("o-1", 12.5)
    assert r["cents"] == -1250
    assert r["label"] == "Refund -12.50 EUR"
