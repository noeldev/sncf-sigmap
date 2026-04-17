using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

/// <summary>
/// Computes per-line bounding boxes from formes-des-lignes-du-rfn.geojson.
///
/// A line (code_ligne) may span multiple GeoJSON features (tronçons).
/// Their individual bboxes are unioned so the final result covers the
/// complete extent of the line.
///
/// Supports geometry types: LineString, MultiLineString.
///
/// Output bbox format: [[minLat, minLng], [maxLat, maxLng]]
/// This is Leaflet's LatLngBounds format, ready for direct use in
/// flyToBounds() / fitBounds() without any client-side coordinate swap.
///
/// Only lines present in the provided knownLineCodes collection are
/// processed — geometry for unknown codes is ignored.
/// </summary>
static class GeometryProcessor
{
    public record Result(IReadOnlyDictionary<string, double[][]> Bboxes);

    public static readonly Result Empty = new(new Dictionary<string, double[][]>());

    /// <summary>
    /// Parse the GeoJSON file and compute bounding boxes.
    /// </summary>
    /// <param name="geojsonPath">Full path to the GeoJSON file.</param>
    /// <param name="knownLineCodes">
    ///   Collection of line codes to process. Codes not in this set are skipped.
    /// </param>
    public static Result Process(string geojsonPath, IReadOnlyCollection<string> knownLineCodes)
    {
        var known = new HashSet<string>(knownLineCodes, StringComparer.Ordinal);
        var accumulators = new Dictionary<string, BboxAccumulator>(StringComparer.Ordinal);

        using var stream = File.OpenRead(geojsonPath);
        using var doc = JsonDocument.Parse(stream, new JsonDocumentOptions
        {
            AllowTrailingCommas = true,
            CommentHandling = JsonCommentHandling.Skip,
        });

        if (!doc.RootElement.TryGetProperty("features", out var features))
        {
            Console.Error.WriteLine("[GeometryProcessor] Warning: no 'features' array found.");
            return Empty;
        }

        foreach (var feature in features.EnumerateArray())
        {
            var code = GetLineCode(feature);
            if (code is null || !known.Contains(code)) continue;

            if (!feature.TryGetProperty("geometry", out var geometry)) continue;

            if (!accumulators.TryGetValue(code, out var acc))
                accumulators[code] = acc = new BboxAccumulator();

            ExpandGeometry(acc, geometry);
        }

        // Convert accumulators to final bbox arrays, skipping degenerate results.
        var result = new Dictionary<string, double[][]>(accumulators.Count, StringComparer.Ordinal);
        foreach (var (code, acc) in accumulators)
        {
            var bbox = acc.ToBbox();
            if (bbox is not null) result[code] = bbox;
        }

        Console.WriteLine($"  Geometry: {result.Count} line bbox(es) computed.");
        return new Result(result);
    }


    // ===== Private helpers =====

    private static string? GetLineCode(JsonElement feature)
    {
        if (!feature.TryGetProperty("properties", out var props)) return null;
        if (!props.TryGetProperty("code_ligne", out var codeProp)) return null;
        return codeProp.ValueKind == JsonValueKind.String
            ? codeProp.GetString()
            : null;
    }

    private static void ExpandGeometry(BboxAccumulator acc, JsonElement geometry)
    {
        if (!geometry.TryGetProperty("type", out var typeProp)) return;
        if (!geometry.TryGetProperty("coordinates", out var coordinatesProp)) return;

        switch (typeProp.GetString())
        {
            case "LineString":
                acc.ExpandLineString(coordinatesProp);
                break;

            case "MultiLineString":
                foreach (var ring in coordinatesProp.EnumerateArray())
                    acc.ExpandLineString(ring);
                break;

                // Other geometry types (Point, Polygon…) are not expected from
                // this dataset and are silently ignored.
        }
    }


    // ===== BboxAccumulator =====

    private sealed class BboxAccumulator
    {
        private double _minLng = double.MaxValue;
        private double _minLat = double.MaxValue;
        private double _maxLng = double.MinValue;
        private double _maxLat = double.MinValue;

        /// <summary>
        /// Expand the accumulator with all [lng, lat] pairs in a LineString
        /// coordinates array.
        /// </summary>
        public void ExpandLineString(JsonElement coordinates)
        {
            foreach (var coord in coordinates.EnumerateArray())
            {
                // GeoJSON coordinates: [longitude, latitude, elevation?]
                if (coord.GetArrayLength() < 2) continue;
                var lng = coord[0].GetDouble();
                var lat = coord[1].GetDouble();
                if (lng < _minLng) _minLng = lng;
                if (lat < _minLat) _minLat = lat;
                if (lng > _maxLng) _maxLng = lng;
                if (lat > _maxLat) _maxLat = lat;
            }
        }

        /// <summary>
        /// Convert to Leaflet LatLngBounds format: [[minLat, minLng], [maxLat, maxLng]].
        /// Coordinates are rounded to 5 decimal places (~1 m precision).
        /// Returns null when no coordinate was ever expanded (empty or invalid geometry).
        /// </summary>
        public double[][]? ToBbox()
        {
            if (_minLng == double.MaxValue) return null;
            return
            [
                [Math.Round(_minLat, 5), Math.Round(_minLng, 5)],
                [Math.Round(_maxLat, 5), Math.Round(_maxLng, 5)],
            ];
        }
    }
}
