using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;

/// <summary>
/// Reads signalisation-permanente.geojson and groups Point features into
/// spatial tiles (one per 0.5°×0.5° cell), collecting filter value counts
/// and a deduplicated networkId spatial index.
/// </summary>
static class SignalReader
{
    public static SignalData Read(string geojsonPath)
    {
        Console.WriteLine("Reading signal GeoJSON…");

        var root = JsonNode.Parse(File.ReadAllText(geojsonPath, Encoding.UTF8))!;
        var features = root["features"]!.AsArray();
        var total = features.Count;

        Console.WriteLine($"  {total:N0} features found.");

        var tiles = new Dictionary<string, List<Signal>>();
        var signalTypeCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var lineCodeCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);

        // tileKey → HashSet<networkId> — HashSet deduplicates signals that share
        // an idreseau across multiple tronçons (SNCF data quality issue).
        var tileNetworkIds = new Dictionary<string, HashSet<string>>();

        var skipped = 0;

        for (var i = 0; i < total; i++)
        {
            var feature = features[i]!;
            var geom = feature["geometry"];

            if (geom == null || geom["type"]?.GetValue<string>() != "Point")
            {
                skipped++;
                continue;
            }

            var coords = geom["coordinates"]!.AsArray();
            var lng = coords[0]!.GetValue<double>();
            var lat = coords[1]!.GetValue<double>();
            var tileKey = _TileKey(lat, lng);
            var props = feature["properties"]!;
            var signalType = props["type_if"]?.GetValue<string>() ?? "";
            var lineCode = props["code_ligne"]?.ToString() ?? "";
            var networkId = props["idreseau"]?.ToString() ?? "";

            // ---- Filter value counts ----
            if (signalType != "")
                signalTypeCounts[signalType] = signalTypeCounts.GetValueOrDefault(signalType, 0) + 1;

            if (lineCode != "")
                lineCodeCounts[lineCode] = lineCodeCounts.GetValueOrDefault(lineCode, 0) + 1;

            // ---- NetworkId spatial index ----
            // tileKey → HashSet silently ignores duplicate idreseau values.
            if (networkId != "")
            {
                if (!tileNetworkIds.TryGetValue(tileKey, out var ids))
                {
                    ids = [];
                    tileNetworkIds[tileKey] = ids;
                }

                ids.Add(networkId);
            }

            // ---- Tile grouping ----
            var signal = new Signal(
                lat: Math.Round(lat, 7),
                lng: Math.Round(lng, 7),
                type_if: signalType,
                code_ligne: lineCode,
                nom_voie: props["nom_voie"]?.GetValue<string>() ?? "",
                sens: props["sens"]?.GetValue<string>() ?? "",
                position: props["position"]?.GetValue<string>() ?? "",
                pk: props["pk"]?.GetValue<string>() ?? "",
                idreseau: networkId,
                code_voie: props["code_voie"]?.GetValue<string>() ?? ""
            );

            if (!tiles.TryGetValue(tileKey, out var tileList))
            {
                tileList = [];
                tiles[tileKey] = tileList;
            }

            tileList.Add(signal);

            if ((i + 1) % 20000 == 0)
                Console.WriteLine($"  Indexed {i + 1:N0} / {total:N0}…");
        }

        Console.WriteLine($"  {skipped} non-Point features skipped.");
        Console.WriteLine($"  {tiles.Count} tiles grouped.");
        Console.WriteLine();

        // Convert HashSet → List for JSON serialization and the SignalData contract.
        var tileNetworkIdsList = tileNetworkIds
            .ToDictionary(kv => kv.Key, kv => kv.Value.ToList());

        return new SignalData(tiles, signalTypeCounts, lineCodeCounts, tileNetworkIdsList);
    }

    private static string _TileKey(double lat, double lng)
    {
        var tx = (int)Math.Floor(lng / Constants.TileDeg);
        var ty = (int)Math.Floor(lat / Constants.TileDeg);
        return $"{tx}:{ty}";
    }
}
