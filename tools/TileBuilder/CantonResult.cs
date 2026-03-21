using System.Collections.Generic;


/// <summary>
/// Output tables produced by <see cref="CantonProcessor.Process"/>.
/// </summary>
record CantonResult(
    Dictionary<string, string> Lignes,
    List<string> Cantons,
    List<object[]> Segments);
