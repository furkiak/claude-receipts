using Shop.Core;

namespace Shop.Api;

public sealed record Refund(string OrderId, long Cents, string Label);

// A refund is booked as a negative movement on the order.
public static class Refunds
{
    public static Refund Create(string orderId, decimal amount)
    {
        var cents = Money.ToCents(-amount);
        return new Refund(orderId, cents, $"Refund {Money.Format(cents)}");
    }
}
