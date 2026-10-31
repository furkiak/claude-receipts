"""Money helpers shared by every package."""


def to_cents(amount):
    return round(amount * 100)


def format_cents(cents, currency="EUR"):
    sign = "-" if cents < 0 else ""
    return f"{sign}{abs(cents) / 100:.2f} {currency}"
