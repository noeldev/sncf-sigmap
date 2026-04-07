using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

/// <summary>
/// Loads tilebuilder.config.json from the executable directory.
/// The file is copied there automatically by MSBuild (CopyToOutputDirectory
/// in TileBuilder.csproj). Its absence is a fatal error since it contains
/// data required for the build (SNCF file names, acronym table).
/// </summary>
static class ConfigLoader
{
    private static readonly JsonSerializerOptions _readOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>
    /// Load the config file from the executable directory.
    /// Exits with an error when the file is absent or cannot be parsed.
    /// </summary>
    public static BuildConfig Load()
    {
        var path = Constants.DefaultConfigPath;

        if (!File.Exists(path))
        {
            Console.Error.WriteLine($"[Error] Config file not found: {path}");
            Console.Error.WriteLine("  Ensure tilebuilder.config.json is present alongside the executable.");
            Console.Error.WriteLine("  Check that CopyToOutputDirectory is set to PreserveNewest in TileBuilder.csproj.");
            Environment.Exit(1);
        }

        try
        {
            using var stream = File.OpenRead(path);
            var config = JsonSerializer.Deserialize<BuildConfig>(stream, _readOpts);
            if (config is null)
            {
                Console.Error.WriteLine($"[Error] Config file is empty or invalid: {path}");
                Environment.Exit(1);
            }
            Console.WriteLine($"Config         : {path}");
            Console.WriteLine($"Acronyms       : {config.Acronyms.Length}");
            Console.WriteLine($"Signal GeoJSON : {config.SignalGeojson}");
            Console.WriteLine($"Block GeoJSON  : {config.BlockGeojson}");
            return config;
        }
        catch (JsonException ex)
        {
            Console.Error.WriteLine($"[Error] Failed to parse config file: {path}");
            Console.Error.WriteLine($"  {ex.Message}");
            Environment.Exit(1);
            return null!;   // unreachable
        }
    }
}
