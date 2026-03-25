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
    public static void LineCode(
        SortedDictionary<string, int> signalCodes,
        Dictionary<string, string> blockTypes)
    {
        var signalSet = new HashSet<string>(signalCodes.Keys,  StringComparer.Ordinal);
        var blockTypeSet = new HashSet<string>(blockTypes.Keys, StringComparer.Ordinal);

        var onlyInSignals  = new SortedSet<string>(signalSet.Except(blockTypeSet),  StringComparer.Ordinal);
        var onlyInBlocks   = new SortedSet<string>(blockTypeSet.Except(signalSet),  StringComparer.Ordinal);
        var inBoth         = signalSet.Count - onlyInSignals.Count;

        Console.WriteLine("[DEBUG] code_ligne cross-check:");
        Console.WriteLine($"  Signal dataset : {signalSet.Count} distinct lines");
        Console.WriteLine($"  Block dataset  : {blockTypeSet.Count} distinct lines");
        Console.WriteLine($"  In both        : {inBoth}");

        if (onlyInSignals.Count > 0)
        {
            Console.WriteLine($"  In signals only  : {onlyInSignals.Count}");
            foreach (var code in onlyInSignals)
            {
                Console.WriteLine($"    {code}  ({signalCodes[code]} signals)");
            }
        }

        if (onlyInBlocks.Count > 0)
        {
            Console.WriteLine($"  In blocks only: {onlyInBlocks.Count}");
            foreach (var type in onlyInBlocks)
            {
                Console.WriteLine($"    {type}  {blockTypes[type]}");
            }
        }

        Console.WriteLine();
    }
}

#endif
