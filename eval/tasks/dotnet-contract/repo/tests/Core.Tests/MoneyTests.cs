using Shop.Core;

namespace Shop.Core.Tests;

public class MoneyTests
{
    [Fact]
    public void Converts_to_cents()
    {
        Assert.Equal(1250, Money.ToCents(12.5m));
        Assert.Equal(0, Money.ToCents(0m));
    }

    [Fact]
    public void Formats_cents()
    {
        Assert.Equal("12.50 EUR", Money.Format(1250));
        Assert.Equal("-0.99 USD", Money.Format(-99, "USD"));
    }
}
