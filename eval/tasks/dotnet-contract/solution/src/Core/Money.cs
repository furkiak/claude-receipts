using System.Globalization;

namespace Shop.Core;

// Money helpers shared by every project.
public static class Money
{
    public static long ToCents(decimal amount) =>
        amount < 0 ? throw new ArgumentOutOfRangeException(nameof(amount), amount, "Amounts must not be negative.") : (long)Math.Round(amount * 100m);

    public static string Format(long cents, string currency = "EUR")
    {
        var sign = cents < 0 ? "-" : "";
        return $"{sign}{(Math.Abs(cents) / 100m).ToString("0.00", CultureInfo.InvariantCulture)} {currency}";
    }
}
