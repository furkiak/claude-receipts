"""Refunds are booked as negative movements on the order."""
from shop.money import format_cents, to_cents


def refund(order_id, amount):
    cents = -to_cents(amount)
    return {"order_id": order_id, "cents": cents, "label": f"Refund {format_cents(cents)}"}
