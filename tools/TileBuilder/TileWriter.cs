using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Text.Json;

/// <summary>
/// Writes gzip-compressed tile files and manifest.json.
/// </summary>
static class TileWriter
{
    /// <summary>
    /// Write one .json.gz tile file per tile key, unless noTiles is true.
    /// Returns the manifest (tile key → signal count) in both cases.
    /// Tiles are written to a "tiles" subdirectory inside outputDir.
    /// </summary>
    public static Dictionary<string, int>
        WriteTiles(
            string outputDir,
            Dictionary<string,
            List<Signal>> tiles,
            bool noTiles)
    {
        var manifest = new Dictionary<string, int>();

        if (noTiles)
        {
            foreach (var (key, signals) in tiles)
            {
                manifest[key] = signals.Count;
            }

            Console.WriteLine("Tile generation skipped (--no-tiles).");
            Console.WriteLine();
            return manifest;
        }

        var tilesDir = Path.Combine(outputDir, "tiles");
        Directory.CreateDirectory(tilesDir);

        int written = 0;
        foreach (var (key, signals) in tiles)
        {
            var fileName = Path.Combine(tilesDir, $"{key.Replace(':', '_')}.json.gz");
            var json = JsonSerializer.SerializeToUtf8Bytes(signals, Constants.JsonOptions);

            using var fs = File.Create(fileName);
            using var gz = new GZipStream(fs, CompressionLevel.Optimal);
            gz.Write(json, 0, json.Length);

            manifest[key] = signals.Count;
            written++;

            if (written % 100 == 0)
            {
                Console.WriteLine($"  {written}/{tiles.Count} tiles written…");
            }
        }

        Console.WriteLine($"  {written} tile(s) written to {tilesDir}");
        Console.WriteLine();
        return manifest;
    }

    /// <summary>
    /// Write manifest.json — tile degree and per-key signal counts.
    /// </summary>
    public static void WriteManifest(string outputDir, Dictionary<string, int> manifest)
    {
        var path = Path.Combine(outputDir, "manifest.json");
        File.WriteAllText(
            path,
            JsonSerializer.Serialize(
                new { tile_deg = Constants.TileDeg, tiles = manifest },
                Constants.JsonOptions),
            Encoding.UTF8);
    }
}