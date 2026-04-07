using System.Collections.Generic;


/// <summary>
/// Output tables produced by <see cref="BlockProcessor.Process"/>.
/// </summary>
record BlockResult(
    Dictionary<string, string> Lines,
    List<string> Types,
    List<object[]> Segments);
