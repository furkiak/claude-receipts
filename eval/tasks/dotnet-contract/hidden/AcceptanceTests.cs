using Shop.Api;
using Shop.Core;

namespace Shop.Acceptance;

// Hidden acceptance test: the new contract holds AND refunds still work.
public class AcceptanceTests
{
    [Fact]
    public void Negative_amounts_are_refused()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => Money.ToCents(-1m));
        Assert.Equal(1250, Money.ToCents(12.5m));
    }

    [Fact]
    public void Refunds_still_book_negative_movements()
    {
        var r = Refunds.Create("o-1", 12.5m);
        Assert.Equal(-1250, r.Cents);
        Assert.Equal("Refund -12.50 EUR", r.Label);
    }
}
