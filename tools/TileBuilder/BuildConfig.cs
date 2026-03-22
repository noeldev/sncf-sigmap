using System.Text.Json.Serialization;

/// <summary>
/// Deserialized content of tilebuilder.config.json.
/// All properties have sensible defaults so the file can omit any field.
/// </summary>
record BuildConfig(
    [property: JsonPropertyName("signal_geojson")]
    string SignalGeojson,

    [property: JsonPropertyName("canton_geojson")]
    string CantonGeojson,

    [property: JsonPropertyName("acronyms")]
    AcronymEntry[] Acronyms)
{
    /// <summary>Default instance used when no config file is found.</summary>
    public static readonly BuildConfig Default = new(
        SignalGeojson: Constants.DefaultSignalGeojson,
        CantonGeojson: Constants.DefaultCantonGeojson,
        Acronyms: []);
}
