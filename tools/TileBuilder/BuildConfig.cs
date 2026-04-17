using System.Text.Json.Serialization;

/// <summary>
/// Deserialized content of tilebuilder.config.json.
/// All properties have sensible defaults so the config file can omit any field.
///
/// Uses non-positional record form (property initialisers) so that
/// System.Text.Json respects the defaults for fields absent from the JSON.
/// Positional records are deserialized via the primary constructor, which
/// receives null for missing fields and silently discards default parameter
/// values — a known System.Text.Json limitation.
/// </summary>
record BuildConfig
{
    [JsonPropertyName("signal_geojson")]
    public string SignalGeojson { get; init; } = Constants.DefaultSignalGeojson;

    [JsonPropertyName("block_geojson")]
    public string BlockGeojson { get; init; } = Constants.DefaultBlockGeojson;

    [JsonPropertyName("geometry_geojson")]
    public string GeometryGeojson { get; init; } = Constants.DefaultGeometryGeojson;

    [JsonPropertyName("acronyms")]
    public AcronymEntry[] Acronyms { get; init; } = [];

    // Default instance — equivalent to new() since all defaults are on the properties.
    // Kept for compatibility with ConfigLoader fallback logic.
    public static readonly BuildConfig Default = new();
}
