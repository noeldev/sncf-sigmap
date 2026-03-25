using System.Collections.Generic;


/// <summary>
/// Grouped signal data produced by <see cref="SignalReader.Read"/>.
/// </summary>
record SignalData(
    Dictionary<string, List<Signal>> Tiles,
    SortedDictionary<string, int> SignalTypeCounts,
    SortedDictionary<string, int> LineCodeCounts);
