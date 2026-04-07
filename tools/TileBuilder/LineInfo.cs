using System.Text.Json.Serialization;

/// <summary>
/// Merged line entry stored under each code_ligne key in index.json.
/// Combines the signal count (from the signal dataset) and the optional
/// line display name (from the cantonment dataset, absent when the line
/// does not appear there).
/// </summary>
record LineInfo(
    [property: JsonPropertyName("count")] int Count,
    [property: JsonPropertyName("label")] string? Label);
