// TileBuilder — Program.cs
// Splits signalisation-permanente.geojson into small gzip-compressed
// spatial tile files, and generates a values index for filter pre-population.
//
// HOW TO RUN IN VISUAL STUDIO 2022:
//   1. Open tools/TileBuilder/TileBuilder.csproj
//   2. Project → Properties → Debug → Open debug launch profiles UI
//   3. Command line arguments:
//        "C:\path\to\signalisation-permanente.geojson"  "C:\path\to\sncf-sigmap\data\tiles"
//   4. Ctrl+F5
//
// OUTPUT:
//   <output-dir>\manifest.json   — tile index (tile key → signal count)
//   <output-dir>\index.json      — distinct values for all filter fields
//   <output-dir>\5_10.json.gz    — one tile file per 0.5°×0.5° cell

using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

const double TILE_DEG = 0.5;

// ---- Arguments ----
if (args.Length < 2)
{
    Console.Error.WriteLine("Usage: TileBuilder <geojson-path> <output-dir>");
    Environment.Exit(1);
}

string geojsonPath = args[0];
string outputDir = args[1];

Console.WriteLine($"Input  : {geojsonPath}");
Console.WriteLine($"Output : {outputDir}");
Console.WriteLine();

if (!File.Exists(geojsonPath))
{
    Console.Error.WriteLine($"[Error] File not found: {geojsonPath}");
    Environment.Exit(1);
}

Directory.CreateDirectory(outputDir);

// ---- Parse GeoJSON ----
Console.WriteLine("Reading GeoJSON…");
string raw = File.ReadAllText(geojsonPath, Encoding.UTF8);
var root = JsonNode.Parse(raw)!;
var features = root["features"]!.AsArray();
int total = features.Count;
Console.WriteLine($"  {total:N0} features found.");

// ---- Group into tiles + collect distinct filter values ----
var tiles = new Dictionary<string, List<Signal>>();
int skipped = 0;

// Dictionaries to count occurrences of each distinct filter value
var typeIfCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);
var codeLigneCounts = new SortedDictionary<string, int>(StringComparer.Ordinal);

for (int i = 0; i < total; i++)
{
    var feature = features[i]!;
    var geom = feature["geometry"];

    if (geom == null || geom["type"]?.GetValue<string>() != "Point")
    {
        skipped++;
        continue;
    }

    var coords = geom["coordinates"]!.AsArray();
    double lng = coords[0]!.GetValue<double>();
    double lat = coords[1]!.GetValue<double>();

    int tx = (int)Math.Floor(lng / TILE_DEG);
    int ty = (int)Math.Floor(lat / TILE_DEG);
    string key = $"{tx}:{ty}";

    var props = feature["properties"]!;

    string typeIf = props["type_if"]?.GetValue<string>() ?? "";
    string codeLigne = props["code_ligne"]?.ToString() ?? "";

    var signal = new Signal
    {
        lat = Math.Round(lat, 7),
        lng = Math.Round(lng, 7),
        type_if = typeIf,
        code_ligne = codeLigne,
        nom_voie = props["nom_voie"]?.GetValue<string>() ?? "",
        sens = props["sens"]?.GetValue<string>() ?? "",
        position = props["position"]?.GetValue<string>() ?? "",
        pk = props["pk"]?.GetValue<string>() ?? "",
        idreseau = props["idreseau"]?.ToString() ?? "",
        code_voie = props["code_voie"]?.GetValue<string>() ?? "",
    };

    if (!tiles.ContainsKey(key)) tiles[key] = [];
    tiles[key].Add(signal);

    // Count distinct values (skip empty)
    if (typeIf != "") typeIfCounts[typeIf] = typeIfCounts.GetValueOrDefault(typeIf, 0) + 1;
    if (codeLigne != "") codeLigneCounts[codeLigne] = codeLigneCounts.GetValueOrDefault(codeLigne, 0) + 1;

    if ((i + 1) % 20000 == 0)
        Console.WriteLine($"  Indexed {i + 1:N0} / {total:N0}…");
}

Console.WriteLine($"  {skipped} non-Point features skipped.");
Console.WriteLine($"  {tiles.Count} tiles to write.");
Console.WriteLine();

// ---- Write tile files ----
var jsonOpts = new JsonSerializerOptions { WriteIndented = false };
var manifest = new Dictionary<string, int>();
int written = 0;

foreach (var (key, signals) in tiles)
{
    string fileName = Path.Combine(outputDir, $"{key.Replace(':', '_')}.json.gz");
    byte[] json = JsonSerializer.SerializeToUtf8Bytes(signals, jsonOpts);

    using var fs = File.Create(fileName);
    using var gz = new GZipStream(fs, CompressionLevel.Optimal);
    gz.Write(json, 0, json.Length);

    manifest[key] = signals.Count;
    written++;

    if (written % 100 == 0)
        Console.WriteLine($"  {written}/{tiles.Count} tiles written…");
}

// ---- Write manifest.json ----
string manifestPath = Path.Combine(outputDir, "manifest.json");
File.WriteAllText(
    manifestPath,
    JsonSerializer.Serialize(new { tile_deg = TILE_DEG, tiles = manifest }, jsonOpts),
    Encoding.UTF8);

// ---- Write index.json ----
// Contains per-value signal counts for TYPE IF and CODE LIGNE.
// Format: { "type_if": { "CARRE": 16571, "Z": 7930, ... }, "code_ligne": { ... } }
// Loaded once at startup; JS reads these as global totals for the filter panels.
string indexPath = Path.Combine(outputDir, "index.json");
var index = new
{
    type_if = typeIfCounts,
    code_ligne = codeLigneCounts,
};
File.WriteAllText(
    indexPath,
    JsonSerializer.Serialize(index, jsonOpts),
    Encoding.UTF8);

// ---- Summary ----
int totalSignals = 0;
long totalBytes = 0;
foreach (var v in manifest.Values) totalSignals += v;
foreach (var f in Directory.GetFiles(outputDir, "*.json.gz"))
    totalBytes += new FileInfo(f).Length;

Console.WriteLine();
Console.WriteLine("Done.");
Console.WriteLine($"  Tiles written   : {written}");
Console.WriteLine($"  Total signals   : {totalSignals:N0}");
Console.WriteLine($"  Total size      : {totalBytes / 1024.0 / 1024.0:F1} MB (gzip-compressed)");
Console.WriteLine($"  Average tile    : {(written > 0 ? totalBytes / written : 0):N0} bytes");
Console.WriteLine($"  Distinct TYPE IF: {typeIfCounts.Count}");
Console.WriteLine($"  Distinct LIGNE  : {codeLigneCounts.Count}");
Console.WriteLine($"  Manifest        : {manifestPath}");
Console.WriteLine($"  Index           : {indexPath}");

// ---- Signal record ----
record Signal
{
    public double lat { get; init; }
    public double lng { get; init; }
    public string type_if { get; init; } = "";
    public string code_ligne { get; init; } = "";
    public string nom_voie { get; init; } = "";
    public string sens { get; init; } = "";
    public string position { get; init; } = "";
    public string pk { get; init; } = "";
    public string idreseau { get; init; } = "";
    public string code_voie { get; init; } = "";
}
