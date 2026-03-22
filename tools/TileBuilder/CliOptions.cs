using System;
using System.IO;


/// <summary>
/// Parsed command-line options.
/// </summary>
record CliOptions(
    string SourceDir,
    string OutputDir,
    bool NoTiles)
{
    /// <summary>Parse args, or return null on error / after --help.</summary>
    public static CliOptions? Parse(string[] args)
    {
        var currentDir = Directory.GetCurrentDirectory();
        var sourceDir = currentDir;
        var outputDir = currentDir;
        var noTiles = false;

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "-h":
                case "--help":
                    PrintUsage();
                    Environment.Exit(0);
                    break;

                case "-s":
                case "--source":
                    if (++i >= args.Length)
                    {
                        Console.Error.WriteLine("[Error] --source requires a value.");
                        return null;
                    }
                    sourceDir = args[i];
                    break;

                case "-o":
                case "--output":
                    if (++i >= args.Length)
                    {
                        Console.Error.WriteLine("[Error] --output requires a value.");
                        return null;
                    }
                    outputDir = args[i];
                    break;

                case "-n":
                case "--no-tiles":
                    noTiles = true;
                    break;

                default:
                    Console.Error.WriteLine($"[Error] Unknown option: {args[i]}");
                    return null;
            }
        }

        return new CliOptions(sourceDir, outputDir, noTiles);
    }

    public static void PrintUsage() => Console.WriteLine("""
        Usage: TileBuilder [options]

        Options:
          -s, --source  <dir>   Source directory containing SNCF GeoJSON files
                                (default: current directory)
          -o, --output  <dir>   Output directory  (default: current directory)
          -n, --no-tiles        Skip tile files; write index.json + manifest.json only
          -h, --help            Show this help
        """);
}
