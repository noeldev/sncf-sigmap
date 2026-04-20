using System;
using System.IO;
using System.Text.Encodings.Web;
using System.Text.Json;

/// <summary>
/// Build-wide constants shared across processing classes.
/// </summary>
internal static class Constants
{
    /// <summary>
    /// Side length of each spatial tile in decimal degrees (0.5° × 0.5°).
    /// Must match the value used by the JavaScript tile loader (config.js TILE_DEG).
    /// </summary>
    internal const double TileDeg = 0.5;

    /// <summary>
    /// JSON serialisation options used for all output files.
    /// Compact (no indentation) to minimise file size.
    /// UnsafeRelaxedJsonEscaping keeps accented characters (é, à, ô…) as-is
    /// instead of escaping them as \uXXXX — improves readability and diff quality.
    /// </summary>
    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented  = false,
        Encoder        = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Standard SNCF open data file names published on data.sncf.com.</summary>
    internal const string DefaultSignalGeojson = "signalisation-permanente.geojson";
    internal const string DefaultBlockGeojson  = "mode-de-cantonnement-des-lignes.geojson";
    internal const string DefaultGeometryGeojson = "formes-des-lignes-du-rfn.geojson";

    /// <summary>
    /// Default config file path, resolved relative to the executable directory
    /// (AppContext.BaseDirectory) so it is found after MSBuild copies it to bin\.
    /// </summary>
    internal static string DefaultConfigPath =>
        Path.Combine(AppContext.BaseDirectory, "tilebuilder.config.json");
}
