using Shop.Api;

namespace Shop.Api.Tests;

public class RefundTests
{
    [Fact]
    public void A_refund_is_a_negative_movement()
    {
        var r = Refunds.Create("o-1", 12.5m);
        Assert.Equal(-1250, r.Cents);
        Assert.Equal("Refund -12.50 EUR", r.Label);
    }
}
