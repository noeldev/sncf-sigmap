using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;

/// <summary>
/// Reads mode-de-cantonnement-des-lignes.geojson and produces three index tables:
///   Lignes   — code_ligne → lib_ligne
///   Cantons  — ordered list of abbreviated canton mode labels
///   Segments — compact [code_ligne, pkd_m, pkf_m, canton_idx] arrays
///
/// Canton mode labels are abbreviated by scanning each label character by
/// character and replacing every occurrence of a known expanded form with
/// its acronym. Unrecognised text passes through verbatim. Compound labels
/// are handled transparently:
///   "European train control system 2/Transmission voie-machine 300"
///     → "ETCS 2/TVM 300"
/// The acronym table is loaded from tilebuilder.config.json at startup.
/// </summary>
static class CantonProcessor
{
    /// <summary>Empty result returned when no cantonment file is provided.</summary>
    public static readonly CantonResult Empty = new([], [], []);

    public static CantonResult Process(string path, AcronymEntry[] acronyms)
    {
        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"[Warning] Cantonment file not found: {path} — skipping.");
            return Empty;
        }

        Console.WriteLine("Reading cantonment GeoJSON…");
        var root = JsonNode.Parse(File.ReadAllText(path, Encoding.UTF8))!;
        var features = root["features"]!.AsArray();

        Console.WriteLine($"  {features.Count:N0} cantonment features found.");

        var lignes = new Dictionary<string, string>(StringComparer.Ordinal);
        var cantons = new List<string>();
        var segments = new List<object[]>();
        var labelToIdx = new Dictionary<string, int>(StringComparer.Ordinal);
        int skipped = 0;

        foreach (var feat in features)
        {
            var props = feat!["properties"]!;
            var codeLigne = props["code_ligne"]?.GetValue<string>() ?? "";
            var libLigne = props["lib_ligne"]?.GetValue<string>()
                           ?? props["ligne_libelle"]?.GetValue<string>()
                           ?? "";
            var libelle = props["libelle"]?.GetValue<string>() ?? "";
            var pkdStr = props["pkd"]?.GetValue<string>() ?? "";
            var pkfStr = props["pkf"]?.GetValue<string>() ?? "";

            if (codeLigne == "" || libelle == "")
            {
                skipped++;
                continue;
            }

            if (libLigne != "" && !lignes.ContainsKey(codeLigne))
            {
                lignes[codeLigne] = libLigne;
            }

            var label = Abbreviate(libelle, acronyms);

            if (!labelToIdx.TryGetValue(label, out int cIdx))
            {
                cIdx = cantons.Count;
                labelToIdx[label] = cIdx;
                cantons.Add(label);
            }

            var pkdM = ParsePkAsMeters(pkdStr);
            var pkfM = ParsePkAsMeters(pkfStr);

            if (pkdM == int.MinValue || pkfM == int.MinValue || pkdM >= pkfM)
            {
                skipped++;
                continue;
            }

            segments.Add([codeLigne, pkdM, pkfM, cIdx]);
        }

        Console.WriteLine($"  {skipped} segments skipped (missing/invalid data).");
        Console.WriteLine($"  {segments.Count:N0} canton segments stored.");
        Console.WriteLine($"  {lignes.Count:N0} distinct lines.");
        Console.WriteLine($"  {cantons.Count:N0} distinct canton modes:");
        foreach (string c in cantons) Console.WriteLine($"    {c}");
        Console.WriteLine();

        return new CantonResult(lignes, cantons, segments);
    }

    /// <summary>
    /// Scan <paramref name="label"/> character by character, replacing every
    /// occurrence of a known expanded form with its acronym.
    ///
    /// At each position the entries of <paramref name="acronyms"/> are tested
    /// in order; the first match wins (more specific entries must come first).
    /// When a match is found the acronym is appended and the position advances
    /// by the length of the expanded form. When no entry matches, the character
    /// is copied verbatim and the position advances by one.
    /// </summary>
    private static string Abbreviate(string label, AcronymEntry[] acronyms)
    {
        var sb = new StringBuilder(label.Length);
        int pos = 0;
        while (pos < label.Length)
        {
            var matched = false;
            foreach (AcronymEntry entry in acronyms)
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
    /// The separator (+ or -) determines the sign of the metre offset.
    /// Returns int.MinValue when the string is null, empty, or unrecognised.
    /// </summary>
    private static int ParsePkAsMeters(string pk)
    {
        if (string.IsNullOrWhiteSpace(pk)) return int.MinValue;
        var sep = pk.IndexOfAny(['+', '-']);
        if (sep <= 0) return int.MinValue;
        if (!int.TryParse(pk[..sep].Trim(), out int km)) return int.MinValue;
        if (!int.TryParse(pk[(sep + 1)..].Trim(), out int m)) return int.MinValue;
        return pk[sep] == '-' ? km * 1000 - m : km * 1000 + m;
    }
}
