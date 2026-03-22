using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json.Nodes;

/// <summary>
/// Reads signalisation-permanente.geojson and groups Point features into
/// spatial tiles (one per 0.5°×0.5° cell), collecting filter value counts.
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
        var typeIfCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        var codeLigneCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
        int skipped = 0;

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
            var key = TileKey(lat, lng);
            var props = feature["properties"]!;
            var typeIf = props["type_if"]?.GetValue<string>() ?? "";
            var codeLigne = props["code_ligne"]?.ToString() ?? "";

            var signal = new Signal(
                lat: Math.Round(lat, 7),
                lng: Math.Round(lng, 7),
                type_if: typeIf,
                code_ligne: codeLigne,
                nom_voie: props["nom_voie"]?.GetValue<string>() ?? "",
                sens: props["sens"]?.GetValue<string>() ?? "",
                position: props["position"]?.GetValue<string>() ?? "",
                pk: props["pk"]?.GetValue<string>() ?? "",
                idreseau: props["idreseau"]?.ToString() ?? "",
                code_voie: props["code_voie"]?.GetValue<string>() ?? ""
            );

            if (!tiles.TryGetValue(key, out var value))
            {
                value = [];
                tiles[key] = value;
            }

            value.Add(signal);

            if (typeIf != "")
            {
                typeIfCounts[typeIf] = typeIfCounts.GetValueOrDefault(typeIf, 0) + 1;
            }
            if (codeLigne != "")
            {
                codeLigneCounts[codeLigne] = codeLigneCounts.GetValueOrDefault(codeLigne, 0) + 1;
            }
            if ((i + 1) % 20000 == 0)
            {
                Console.WriteLine($"  Indexed {i + 1:N0} / {total:N0}…");
            }
        }

        Console.WriteLine($"  {skipped} non-Point features skipped.");
        Console.WriteLine($"  {tiles.Count} tiles grouped.");
        Console.WriteLine();
        return new SignalData(tiles, typeIfCounts, codeLigneCounts);
    }

    private static string TileKey(double lat, double lng)
    {
        var tx = (int)Math.Floor(lng / Constants.TileDeg);
        var ty = (int)Math.Floor(lat / Constants.TileDeg);
        return $"{tx}:{ty}";
    }
}
