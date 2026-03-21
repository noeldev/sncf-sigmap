using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

/// <summary>
/// Writes index.json — filter value counts, merged line data, and cantonment tables.
///
/// Format:
///   type_if     — { label: count, … }
///   code_ligne  — { code: { count, label? }, … }
///                 Merges signal counts (from SignalData) and line display names
///                 (from CantonResult). label is absent when the line does not
///                 appear in the cantonment dataset.
///   cantons     — [ "BAL", "BAPR", … ]           canton label by index
///   canton_segs — [ ["205000", 69350, 72241, 0], … ]
///                  field order: code_ligne, pkd_m, pkf_m, canton_idx
/// </summary>
static class IndexWriter
{
    public static void Write(string outputDir, SignalData signalData, CantonResult cantonResult)
    {
        // Merge code_ligne signal counts with line display names from cantonment.
        // Lines that appear in signals but not in the cantonment dataset get no label.
        var codeLigne = signalData.CodeLigneCounts
            .ToDictionary(
                kv => kv.Key,
                kv => new LigneInfo(
                    Count: kv.Value,
                    Label: cantonResult.Lignes.TryGetValue(kv.Key, out string? label) ? label : null));

        var path = Path.Combine(outputDir, "index.json");
        File.WriteAllText(
            path,
            JsonSerializer.Serialize(new
            {
                type_if = signalData.TypeIfCounts,
                code_ligne = codeLigne,
                cantons = cantonResult.Cantons,
                canton_segs = cantonResult.Segments,
            }, Constants.JsonOptions),
            Encoding.UTF8);
    }
}
