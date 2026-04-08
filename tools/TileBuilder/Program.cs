// TileBuilder — Program.cs
// Splits signalisation-permanente.geojson into small gzip-compressed
// spatial tile files, and generates a values index for filter pre-population.
//
// USAGE:
//   TileBuilder [options]
//
//   Options:
//     -s, --source  <dir>   Source directory containing SNCF GeoJSON files
//                           (default: current directory)
//     -o, --output  <dir>   Output directory  (default: current directory)
//     -n, --no-tiles        Skip tile generation; write index.json and
//                           manifest.json only
//     -h, --help            Show this help
//
// HOW TO RUN IN VISUAL STUDIO 2022:
//   1. Open tools/TileBuilder/TileBuilder.csproj
//   2. Project → Properties → Debug → Open debug launch profiles UI
//   3. Command line arguments — examples:
//        Full build:
//          -s "C:\path\to\sncf-data" -o "C:\path\to\sncf-sigmap\data\tiles"
//        Index + manifest only:
//          -n -s "C:\path\to\sncf-data" -o "C:\path\to\tiles"
//   4. Ctrl+F5

using System;
using System.IO;
using System.Linq;

// ---- Parse CLI ----

var opts = CliOptions.Parse(args);
if (opts is null)
{
    CliOptions.PrintUsage();
    Environment.Exit(1);
}

// ---- Load config ----

var config = ConfigLoader.Load();

var signalFile = Path.Combine(opts.SourceDir, config.SignalGeojson);
var blockFile = Path.Combine(opts.SourceDir, config.BlockGeojson);
Console.WriteLine($"Source dir     : {opts.SourceDir}");
Console.WriteLine($"Output dir     : {opts.OutputDir}");
Console.WriteLine($"No-tiles mode  : {opts.NoTiles}");
Console.WriteLine();

if (!File.Exists(signalFile))
{
    Console.Error.WriteLine($"[Error] File not found: {signalFile}");
    Environment.Exit(1);
}
Directory.CreateDirectory(opts.OutputDir);

// ---- Read + group signals ----

var signalData = SignalReader.Read(signalFile);

// ---- Write tile files + manifest ----

var manifest = TileWriter.WriteTiles(opts.OutputDir, signalData.Tiles, opts.NoTiles);
TileWriter.WriteManifest(opts.OutputDir, manifest);

// ---- Process block system ----

var blockResult = File.Exists(blockFile)
    ? BlockProcessor.Process(blockFile, config.Acronyms)
    : BlockProcessor.Empty;

// ---- Debug: cross-check code_ligne between datasets ----

#if DEBUG
CrossCheck.LineCode(signalData.LineCodeCounts, blockResult.Lines);
#endif

// ---- Write index ----

IndexWriter.Write(opts.OutputDir, signalData, blockResult);

// ---- Summary ----

var totalSignals = manifest.Values.Sum();
var tileBytes = opts.NoTiles
    ? 0
    : Directory.GetFiles(opts.OutputDir, "*.json.gz").Sum(f => new FileInfo(f).Length);

Console.WriteLine($"  Tiles written    : {(opts.NoTiles ? "—" : manifest.Count.ToString())}");
Console.WriteLine($"  Total signals    : {totalSignals:N0}");

if (!opts.NoTiles)
{
    Console.WriteLine($"  Total tile size  : {tileBytes / 1024.0 / 1024.0:F1} MB (gzip-compressed)");
}

Console.WriteLine($"  Distinct Signals : {signalData.SignalTypeCounts.Count}");
Console.WriteLine($"  Distinct Lines   : {signalData.LineCodeCounts.Count}");
Console.WriteLine($"  Block segments   : {blockResult.Segments.Count}");

Console.WriteLine($"  Manifest         : {Path.Combine(opts.OutputDir, "manifest.json")}");
Console.WriteLine($"  Index            : {Path.Combine(opts.OutputDir, "index.json")}");

if (!opts.NoTiles)
    Console.WriteLine($"  Tiles directory  : {Path.Combine(opts.OutputDir, "tiles")}");

Console.WriteLine("Done.");
