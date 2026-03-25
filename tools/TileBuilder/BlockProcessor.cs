using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;

/// <summary>
/// Reads mode-de-cantonnement-des-lignes.geojson and produces three index tables:
///   line_codes  — line_code → line_name
///   block_types — ordered list of abbreviated block type labels
///   segments    — compact [line_code, start_m, end_m, block_idx] arrays
///
/// Block type labels are abbreviated by scanning every occurrence of a known
/// expanded form with its acronym. Unrecognized text passes through verbatim.
/// The acronym table is loaded from tilebuilder.config.json at startup.
/// </summary>
static class BlockProcessor
{
    /// <summary>Empty result returned when no cantonment file is provided.</summary>
    public static readonly BlockResult Empty = new([], [], []);

    public static BlockResult Process(string path, AcronymEntry[] acronyms)
    {
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"[Warning] Block system file not found: {path} — skipping.");
            return Empty;
        }

        Console.WriteLine("Reading block system GeoJSON…");
        var root = JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8))!;
        var features = root["features"]!.AsArray();

        Console.WriteLine($"  {features.Count:N0} block system features found.");

        var lines = new Dictionary<string, string>(StringComparer.Ordinal);
        var blockTypes = new List<string>();
        var segments = new List<object[]>();
        var blockLabelToIdx = new Dictionary<string, int>(StringComparer.Ordinal);
        int skipped = 0;

        foreach (var feat in features)
        {
            var props = feat!["properties"]!;
            var lineCode = props["code_ligne"]?.GetValue<string>() ?? "";
            var lineName = props["lib_ligne"]?.GetValue<string>()
                           ?? props["ligne_libelle"]?.GetValue<string>()
                           ?? "";
            var typeName = props["libelle"]?.GetValue<string>() ?? "";
            var startStr = props["pkd"]?.GetValue<string>() ?? "";
            var endStr = props["pkf"]?.GetValue<string>() ?? "";

            if (lineCode == "" || typeName == "")
            {
                skipped++;
                continue;
            }

            if (lineName != "" && !lines.ContainsKey(lineCode))
            {
                lines[lineCode] = lineName;
            }

            var label = Abbreviate(typeName, acronyms);

            if (!blockLabelToIdx.TryGetValue(label, out int index))
            {
                index = blockTypes.Count;
                blockLabelToIdx[label] = index;
                blockTypes.Add(label);
            }

            var startM = ParsePkAsMeters(startStr);
            var endM = ParsePkAsMeters(endStr);

            if (startM == int.MinValue || endM == int.MinValue || startM >= endM)
            {
                skipped++;
                continue;
            }

            segments.Add([lineCode, startM, endM, index]);
        }

        Console.WriteLine($"  {skipped} segments skipped (missing/invalid data).");
        Console.WriteLine($"  {segments.Count:N0} block system segments stored.");
        Console.WriteLine($"  {lines.Count:N0} distinct lines.");
        Console.WriteLine($"  {blockTypes.Count:N0} distinct block types:");

        foreach (var type in blockTypes)
        {
            Console.WriteLine($"    {type}");
        }
        
        Console.WriteLine();

        return new BlockResult(lines, blockTypes, segments);
    }

    /// <summary>
    /// Scan <paramref name="label"/> character by character, replacing every
    /// occurrence of a known expanded form with its acronym.
    /// More specific entries must come first.
    /// </summary>
    private static string Abbreviate(string label, AcronymEntry[] acronyms)
    {
        var sb = new StringBuilder(label.Length);
        int pos = 0;
        while (pos < label.Length)
        {
            var matched = false;
            foreach (var entry in acronyms)
            {
                if (label.AsSpan(pos).StartsWith(entry.Expanded.AsSpan(), StringComparison.Ordinal))
                {
                    sb.Append(entry.Acronym);
                    pos += entry.Expanded.Length;
                    matched = true;
                    break;
                }
            }
            if (!matched)
            {
                sb.Append(label[pos]);
                pos++;
            }
        }
        return sb.ToString();
    }

    /// <summary>
    /// Parse a SNCF PK string into integer metres.
    /// Handles both formats used in SNCF datasets:
    ///   "069+350" →  69350  (standard positive PK)
    ///   "000-195" →   -195  (negative PK near line origin, pk 0+000)
    /// The separator (+ or -) determines the sign of the meter offset.
    /// Returns int.MinValue when the string is null, empty, or unrecognized.
    /// </summary>
    private static int ParsePkAsMeters(string pk)
    {
        if (string.IsNullOrWhiteSpace(pk)) return int.MinValue;
        var m = System.Text.RegularExpressions.Regex.Match(pk, @"^(\d+)([+-])(\d+)$");
        if (!m.Success) return int.MinValue;
        return int.TryParse(m.Groups[2].Value + m.Groups[1].Value + m.Groups[3].Value, out int result)
            ? result : int.MinValue;
    }
}
