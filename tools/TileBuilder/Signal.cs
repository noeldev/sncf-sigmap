/// <summary>
/// One SNCF signal point from signalisation-permanente.geojson.
/// Field names use snake_case to match the source GeoJSON property names
/// so the record serialises directly to the tile JSON format.
/// </summary>

#pragma warning disable IDE1006 // Naming Styles

record Signal(
    double lat,
    double lng,
    string type_if,
    string code_ligne,
    string nom_voie,
    string sens,
    string position,
    string pk,
    string idreseau,
    string code_voie);

#pragma warning restore IDE1006 // Naming Styles
