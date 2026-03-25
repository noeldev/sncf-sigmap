/// <summary>
/// One entry in the block mode abbreviation table.
/// Declared as a record (not a tuple alias) so System.Text.Json can
/// deserialise it directly from tilebuilder.config.json.
/// </summary>
record AcronymEntry(string Expanded, string Acronym);
