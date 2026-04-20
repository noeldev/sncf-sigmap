using System.Text.Json.Serialization;

/// <summary>
/// Merged line entry stored under each code_ligne key in index.json.
/// Combines the signal count (from the signal dataset), the optional line
/// display name (from the cantonment dataset), and the optional bounding box
/// (from the line geometry dataset).
///
/// <para>
/// <c>Label</c> is null when the line does not appear in the block system
/// dataset; it is serialized as <c>null</c> so the client can distinguish
/// "line known but no label" from "line code absent entirely".
/// </para>
/// <para>
/// <c>Bbox</c> is null when the line does not appear in the geometry dataset
/// and is omitted from the JSON entirely (<see cref="JsonIgnoreCondition.WhenWritingNull"/>)
/// to keep index.json compact.
/// Format: <c>[[minLat, minLng], [maxLat, maxLng]]</c> — Leaflet LatLngBounds,
/// ready for direct use in <c>flyToBounds()</c> / <c>fitBounds()</c>.
/// </para>
/// </summary>
record LineInfo(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("label")] string? Label,
    [property: JsonPropertyName("bbox")]
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    double[][]? Bbox = null);
