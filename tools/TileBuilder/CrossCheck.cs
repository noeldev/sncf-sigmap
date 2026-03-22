using System;
using System.Collections.Generic;
using System.Linq;

#if DEBUG

/// <summary>
/// DEBUG-only cross-checks between the two SNCF datasets.
/// These methods are compiled out in Release builds.
/// </summary>
static class CrossCheck
{
    /// <summary>
    /// Compare the code_ligne values found in the signal dataset against those
    /// present in the cantonment dataset, and report any discrepancies.
    ///
    /// Lines in signals but not in cantonment: normal for lines with no block
    /// system defined (yards, private sidings…) but worth reviewing.
    /// Lines in cantonment but not in signals: suggests the signal dataset
    /// covers a different perimeter than the cantonment dataset.
    /// </summary>
    public static void CodeLigne(
        SortedDictionary<string, int> signalCodes,
        Dictionary<string, string>    cantonCodes)
    {
        var signalSet = new HashSet<string>(signalCodes.Keys,  StringComparer.Ordinal);
        var cantonSet = new HashSet<string>(cantonCodes.Keys, StringComparer.Ordinal);

        var onlyInSignals  = new SortedSet<string>(signalSet.Except(cantonSet),  StringComparer.Ordinal);
        var onlyInCanton   = new SortedSet<string>(cantonSet.Except(signalSet),  StringComparer.Ordinal);
        var inBoth         = signalSet.Count - onlyInSignals.Count;

        Console.WriteLine("[DEBUG] code_ligne cross-check:");
        Console.WriteLine($"  Signal dataset   : {signalSet.Count} distinct lines");
        Console.WriteLine($"  Cantonment dataset: {cantonSet.Count} distinct lines");
        Console.WriteLine($"  In both          : {inBoth}");

        if (onlyInSignals.Count > 0)
        {
            Console.WriteLine($"  In signals only  : {onlyInSignals.Count}");
            foreach (var code in onlyInSignals)
            {
                Console.WriteLine($"    {code}  ({signalCodes[code]} signals)");
            }
        }

        if (onlyInCanton.Count > 0)
        {
            Console.WriteLine($"  In cantonment only: {onlyInCanton.Count}");
            foreach (var code in onlyInCanton)
            {
                Console.WriteLine($"    {code}  {cantonCodes[code]}");
            }
        }

        Console.WriteLine();
    }
}

#endif
