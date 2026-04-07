using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;

/// <summary>
/// Writes index.json — filter value counts, merged line data, block system tables,
/// and the networkId spatial index.
///
/// Keys use camelCase to match the JavaScript app field names exactly,
/// so no client-side key mapping is required. Tile files (.json.gz) are
/// unaffected and retain their original SNCF field names.
///
/// Format:
///   signalType    — { label: count, … }           all signal type codes with full-dataset counts
///   lineCode      — { code: { count, label? }, … } signal counts per line; label from block system
///                   label is absent when the line does not appear in the block system dataset
///   blockType     — [ "BAL", "BAPR", … ]           block type label by index
///   blockSegments — [ ["205000", 69350, 72241, 0], … ]
///                   field order: line_code, start_m, end_m, block_type_idx
///   networkId     — { "3:94": ["10045678", …], … }
///                   tileKey → [networkId, …] compact spatial index
/// </summary>
static class IndexWriter
{
    public static void Write(string outputDir, SignalData signalData, BlockResult blockResult)
    {
        // Merge lineCode signal counts with line display names from the block system.
        // Lines that appear in signals but not in the block system dataset get no label.
        var lineCode = signalData.LineCodeCounts
            .ToDictionary(
                kv => kv.Key,
                kv => new LineInfo(
                    Count: kv.Value,
                    Label: blockResult.Lines.TryGetValue(kv.Key, out string? label) ? label : null));

        var path = Path.Combine(outputDir, "index.json");
        File.WriteAllText(
            path,
            JsonSerializer.Serialize(new
            {
                signalType = signalData.SignalTypeCounts,
                lineCode,
                blockType = blockResult.Types,
                blockSegments = blockResult.Segments,
                networkId = signalData.TileNetworkIds,
            }, Constants.JsonOptions),
            Encoding.UTF8);
    }
}
