using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using RememberPress.Api.Models;

namespace RememberPress.Api.Services;

public sealed class BookStoreService
{
    public const string DefaultFounderGuide =
        "Founder’s Method (Who · What · Why · Sensory Details): Always anchor the memory in one real place and one ordinary day rather than summarizing an entire decade. Ask who was in the room, what small sounds or smells stood out, what went unexpectedly, and why that moment still matters to the people reading this book.";

    public static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly string _dataDir;
    private readonly string _uploadsDir;
    private readonly string _dbPath;
    private MultiBookStore? _cache;

    public string UploadsDir => _uploadsDir;

    public BookStoreService(IConfiguration config)
    {
        var configuredDir = Environment.GetEnvironmentVariable("DATA_DIR") ?? config["RememberPress:DataDir"];
        _dataDir = !string.IsNullOrWhiteSpace(configuredDir)
            ? Path.GetFullPath(configuredDir)
            : ResolveDefaultDataDir();
        _uploadsDir = Path.Combine(_dataDir, "uploads");
        _dbPath = Path.Combine(_dataDir, "rememberpress-books-db.json");

        Directory.CreateDirectory(_dataDir);
        Directory.CreateDirectory(_uploadsDir);
    }

    private static string ResolveDefaultDataDir()
    {
        var candidate = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "..", "data"));
        if (Directory.Exists(candidate))
        {
            return candidate;
        }
        return Path.Combine(Directory.GetCurrentDirectory(), "data");
    }

    public async Task<T> WithStoreAsync<T>(Func<MultiBookStore, T> action, bool persist = false)
    {
        await _lock.WaitAsync();
        try
        {
            var store = LoadStoreUnsafe();
            var result = action(store);
            if (persist)
            {
                SaveStoreUnsafe(store);
            }
            return result;
        }
        finally
        {
            _lock.Release();
        }
    }

    public BookWorkspaceData ResolveBook(MultiBookStore store, HttpRequest request, string? explicitBookId = null)
    {
        static string? FirstNonEmpty(params string?[] candidates) =>
            candidates.FirstOrDefault(c => !string.IsNullOrWhiteSpace(c))?.Trim();

        var requestedId = FirstNonEmpty(
            explicitBookId,
            request.Query["bookId"].FirstOrDefault(),
            request.Headers["X-Book-Id"].FirstOrDefault(),
            store.DefaultBookId);

        if (!string.IsNullOrWhiteSpace(requestedId) && store.Books.TryGetValue(requestedId, out var matchedById))
        {
            return matchedById;
        }

        var invite = request.Query["invite"].FirstOrDefault()?.Trim().ToUpperInvariant();
        if (!string.IsNullOrWhiteSpace(invite))
        {
            var matchedByInvite = store.Books.Values.FirstOrDefault(
                b => string.Equals(b.Settings.InviteCode, invite, StringComparison.OrdinalIgnoreCase));
            if (matchedByInvite is not null)
            {
                return matchedByInvite;
            }
        }

        return store.Books.TryGetValue(store.DefaultBookId, out var defaultBook)
            ? defaultBook
            : store.Books.Values.First();
    }

    public BookWorkspaceData NormalizeBook(BookWorkspaceData book)
    {
        var seed = BuildSeedWorkspace();
        var now = DateTime.UtcNow.ToString("O");
        var defaultProvider = !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("GROQ_API_KEY"))
            ? "groq"
            : "gemini-lite";

        book.Settings ??= seed.Settings;
        if (string.IsNullOrWhiteSpace(book.Settings.FounderGuidePrompt))
            book.Settings.FounderGuidePrompt = DefaultFounderGuide;
        if (string.IsNullOrWhiteSpace(book.Settings.InviteCode))
            book.Settings.InviteCode = "CEDAR-1974";
        if (string.IsNullOrWhiteSpace(book.Settings.PreferredAiProvider))
            book.Settings.PreferredAiProvider = defaultProvider;
        if (string.IsNullOrWhiteSpace(book.Settings.PromptCadence))
            book.Settings.PromptCadence = "weekly";
        if (string.IsNullOrWhiteSpace(book.Settings.BookMode))
            book.Settings.BookMode = "self";
        if (string.IsNullOrWhiteSpace(book.Settings.OrganizerName))
            book.Settings.OrganizerName = string.IsNullOrWhiteSpace(book.Settings.AuthorName) ? "Organizer" : book.Settings.AuthorName;
        book.Settings.SpellingGlossary ??= seed.Settings.SpellingGlossary;

        book.Collaborators ??= new();
        book.Chapters ??= new();
        book.Photos ??= new();
        book.Prompts ??= new();

        for (var i = 0; i < book.Chapters.Count; i++)
        {
            var c = book.Chapters[i];
            if (c.Order <= 0) c.Order = i + 1;
            if (string.IsNullOrWhiteSpace(c.AiEditLevel)) c.AiEditLevel = "balanced";
            if (string.IsNullOrWhiteSpace(c.ToneStrength)) c.ToneStrength = "slight";
            if (string.IsNullOrWhiteSpace(c.Perspective)) c.Perspective = "first-person";
            if (string.IsNullOrWhiteSpace(c.LengthPreference)) c.LengthPreference = "balanced";
            if (string.IsNullOrWhiteSpace(c.EditingStatus)) c.EditingStatus = "none";
            if (string.IsNullOrWhiteSpace(c.EraLabel)) c.EraLabel = c.Subtitle ?? string.Empty;
            c.Comments ??= new();
        }

        foreach (var p in book.Prompts)
        {
            if (string.IsNullOrWhiteSpace(p.CreatedBy)) p.CreatedBy = "Family Organizer";
            if (string.IsNullOrWhiteSpace(p.Cadence)) p.Cadence = "weekly";
            if (string.IsNullOrWhiteSpace(p.Status))
                p.Status = !string.IsNullOrWhiteSpace(p.AnsweredChapterId) ? "answered" : "inbox";
            p.VotedBy ??= new();
            p.Votes = p.VotedBy.Count > 0 ? p.VotedBy.Count : p.Votes;
            if (string.IsNullOrWhiteSpace(p.CreatedAt)) p.CreatedAt = now;
        }

        return book;
    }

    public static T MergeJsonPatch<T>(T current, JsonElement patch)
    {
        var baseNode = JsonSerializer.SerializeToNode(current, JsonOptions)?.AsObject() ?? new JsonObject();
        if (patch.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in patch.EnumerateObject())
            {
                if (string.Equals(prop.Name, "bookId", StringComparison.OrdinalIgnoreCase))
                    continue;
                baseNode[prop.Name] = JsonNode.Parse(prop.Value.GetRawText());
            }
        }
        return baseNode.Deserialize<T>(JsonOptions) ?? current;
    }

    public string SaveBase64Media(string base64Data, string mimeType, string prefix)
    {
        var cleanBase64 = ExtractBase64(base64Data);
        var rawBase = (mimeType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
        var isVideo = prefix.Contains("video", StringComparison.OrdinalIgnoreCase) || rawBase.StartsWith("video/");
        var baseMime = isVideo
            ? (rawBase == "video/mp4" ? "video/mp4" : "video/webm")
            : CleanMimeType(mimeType, prefix.Contains("photo") ? "image/jpeg" : "audio/webm");
        var ext = baseMime switch
        {
            "video/webm" => "webm",
            "video/mp4" => "mp4",
            "audio/webm" => "webm",
            "audio/mp4" => "m4a",
            "audio/mpeg" => "mp3",
            "audio/wav" => "wav",
            "audio/ogg" => "ogg",
            "image/jpeg" => "jpg",
            "image/png" => "png",
            "image/webp" => "webp",
            _ => baseMime.StartsWith("video/") ? "webm" : baseMime.StartsWith("audio/") ? "webm" : "jpg",
        };

        var fileName = $"{prefix}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant()}.{ext}";
        var fullPath = Path.Combine(_uploadsDir, fileName);

        try
        {
            Directory.CreateDirectory(_uploadsDir);
            var bytes = Convert.FromBase64String(cleanBase64);
            File.WriteAllBytes(fullPath, bytes);
            return $"/uploads/{fileName}";
        }
        catch
        {
            return $"data:{baseMime};base64,{cleanBase64}";
        }
    }

    public static string ExtractBase64(string dataUrlOrBase64)
    {
        var idx = dataUrlOrBase64.IndexOf(',');
        return idx >= 0 ? dataUrlOrBase64[(idx + 1)..] : dataUrlOrBase64;
    }

    public static string CleanMimeType(string? mimeType, string fallback)
    {
        if (string.IsNullOrWhiteSpace(mimeType)) return fallback;
        var baseMime = mimeType.Split(';')[0].Trim().ToLowerInvariant();
        return baseMime switch
        {
            "audio/x-m4a" or "audio/m4a" or "video/mp4" => "audio/mp4",
            "audio/x-wav" or "audio/wave" => "audio/wav",
            "audio/mp3" => "audio/mpeg",
            "video/webm" => "audio/webm",
            "image/jpg" => "image/jpeg",
            _ => baseMime,
        };
    }

    public (string MimeType, string Base64)? ResolveImageInlineData(string? imageBase64OrUrl, string mimeType = "image/jpeg")
    {
        if (string.IsNullOrWhiteSpace(imageBase64OrUrl)) return null;

        if (imageBase64OrUrl.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var header = imageBase64OrUrl.Split(',')[0];
            var inferred = header.Replace("data:", "", StringComparison.OrdinalIgnoreCase)
                .Replace(";base64", "", StringComparison.OrdinalIgnoreCase)
                .Trim();
            return (CleanMimeType(string.IsNullOrWhiteSpace(inferred) ? mimeType : inferred, "image/jpeg"), ExtractBase64(imageBase64OrUrl));
        }

        if (imageBase64OrUrl.StartsWith("/src/assets/", StringComparison.OrdinalIgnoreCase))
        {
            var rel = imageBase64OrUrl.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var repoRoot = Path.GetFullPath(Path.Combine(_dataDir, ".."));
            var candidates = new[]
            {
                Path.Combine(Directory.GetCurrentDirectory(), rel),
                Path.Combine(repoRoot, rel),
                Path.Combine(repoRoot, "dist", rel),
            };
            foreach (var assetPath in candidates)
            {
                if (File.Exists(assetPath))
                {
                    var ext = Path.GetExtension(assetPath).ToLowerInvariant();
                    var resolvedMime = ext == ".png" ? "image/png" : ext == ".webp" ? "image/webp" : "image/jpeg";
                    return (resolvedMime, Convert.ToBase64String(File.ReadAllBytes(assetPath)));
                }
            }
        }

        if (imageBase64OrUrl.StartsWith("/uploads/", StringComparison.OrdinalIgnoreCase))
        {
            var uploadFile = Path.Combine(_uploadsDir, Path.GetFileName(imageBase64OrUrl));
            if (File.Exists(uploadFile))
            {
                var ext = Path.GetExtension(uploadFile).ToLowerInvariant();
                var resolvedMime = ext == ".png" ? "image/png" : ext == ".webp" ? "image/webp" : "image/jpeg";
                return (resolvedMime, Convert.ToBase64String(File.ReadAllBytes(uploadFile)));
            }
        }

        return (CleanMimeType(mimeType, "image/jpeg"), ExtractBase64(imageBase64OrUrl));
    }

    private MultiBookStore LoadStoreUnsafe()
    {
        if (_cache is not null) return _cache;

        try
        {
            if (File.Exists(_dbPath))
            {
                var raw = File.ReadAllText(_dbPath);
                var parsed = JsonSerializer.Deserialize<MultiBookStore>(raw, JsonOptions);
                if (parsed?.Books is { Count: > 0 })
                {
                    var normalized = new Dictionary<string, BookWorkspaceData>();
                    foreach (var kv in parsed.Books)
                    {
                        normalized[kv.Key] = NormalizeBook(kv.Value);
                    }
                    _cache = new MultiBookStore
                    {
                        DefaultBookId = !string.IsNullOrWhiteSpace(parsed.DefaultBookId) && normalized.ContainsKey(parsed.DefaultBookId)
                            ? parsed.DefaultBookId
                            : normalized.Keys.First(),
                        Books = normalized,
                    };
                    return _cache;
                }
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to read multi-book database, re-seeding: {ex.Message}");
        }

        var seed = BuildSeedWorkspace();
        var initial = new MultiBookStore
        {
            DefaultBookId = seed.Settings.Id,
            Books = new Dictionary<string, BookWorkspaceData> { [seed.Settings.Id] = seed },
        };
        SaveStoreUnsafe(initial);
        return initial;
    }

    private void SaveStoreUnsafe(MultiBookStore store)
    {
        _cache = store;
        try
        {
            Directory.CreateDirectory(_dataDir);
            var tmpPath = _dbPath + ".tmp";
            File.WriteAllText(tmpPath, JsonSerializer.Serialize(store, JsonOptions));
            File.Move(tmpPath, _dbPath, overwrite: true);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Persist to disk skipped (using in-memory store): {ex.Message}");
        }
    }

    public static BookWorkspaceData BuildSeedWorkspace()
    {
        var now = DateTime.UtcNow.ToString("O");
        var defaultProvider = !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("GROQ_API_KEY"))
            ? "groq"
            : "gemini-lite";

        return new BookWorkspaceData
        {
            Settings = new BookSettings
            {
                Id = "book-cedar-cove",
                InviteCode = "CEDAR-1974",
                BookMode = "gift",
                Title = "The Years Between",
                Subtitle = "Stories of Cedar Cove, Family Tables & Second Acts",
                AuthorName = "Clara Vance",
                OrganizerName = "Maya Vance",
                Dedication = "For Leo, Maya, and every grandchild who asks what the lake looked like before the highway arrived.",
                CoverTheme = "linen-forest",
                CoverImageUrl = "/src/assets/images/sample_book_cover_1794804939349.jpg",
                TrimSize = "6x9",
                InteriorColorMode = "color",
                FontScale = "classic",
                IncludeQrAudioArchive = true,
                IncludeDropCaps = true,
                EditionYear = "2026",
                AuthorPreviewEnabled = true,
                PromptCadence = "weekly",
                PreferredAiProvider = defaultProvider,
                EnableProviderFallback = true,
                FounderGuidePrompt = DefaultFounderGuide,
                SpellingGlossary = new List<SpellingCorrection>
                {
                    new() { Id = "gloss-01", Category = "name", Wrong = "Klara", Correct = "Clara Vance" },
                    new() { Id = "gloss-02", Category = "place", Wrong = "Cedar Grove", Correct = "Cedar Cove" },
                    new() { Id = "gloss-03", Category = "address", Wrong = "Helm Street", Correct = "Elm Street, Portland" },
                },
            },
            Collaborators = new List<Collaborator>
            {
                new() { Id = "collab-01", Name = "Clara Vance", Role = "author", Relationship = "Storyteller", JoinedAt = now },
                new() { Id = "collab-02", Name = "Maya Vance", Role = "organizer", Relationship = "Daughter & Organizer", JoinedAt = now },
                new() { Id = "collab-03", Name = "Leo Vance", Role = "collaborator", Relationship = "Brother", JoinedAt = now },
            },
            Chapters = new List<Chapter>
            {
                new()
                {
                    Id = "chap-01",
                    Order = 1,
                    Title = "Cedar Dock at Seven O’Clock",
                    Subtitle = "Summers on the northern shore, 1972–1976",
                    PromptQuestion = "What is a childhood place whose smells, light, or sounds you can still recall immediately?",
                    Epigraph = "We measured August not by the calendar, but by how warm the weathered planks stayed after sunset.",
                    PullQuote = "My brother Leo always claimed he could hear the ferry whistle twenty minutes before anyone else on the point.",
                    Body = "Before the highway widened past Heron Creek, getting to my grandfather’s cabin meant an hour on gravel roads with the windows rolled halfway down. Even now, if I catch the scent of sun-warmed cedar and pine resin at the end of a long day, I am eight years old again, sitting barefoot at the end of the dock with my brother Leo.\n\nOur grandfather built that dock in the spring of 1959 out of salvaged barn timbers. By the time we were old enough to dangle our heels in the shallows, the wood had bleached to a silver-gray that held the afternoon heat long after the sun dropped behind the spruce line.",
                    Transcript = "Well, if I close my eyes and think back to being eight years old, it’s always the dock at Cedar Cove. My grandfather built that dock in 1959 from barn timbers.",
                    AudioDurationSeconds = 164,
                    WritingTone = "Warm Memoir",
                    AiEditLevel = "balanced",
                    ToneStrength = "slight",
                    ProviderUsed = "gemini",
                    IsPrivate = false,
                    EditingStatus = "none",
                    EraLabel = "1972–1976 · Childhood",
                    FollowUpQuestions = new List<string>
                    {
                        "What was usually on the supper table when your grandmother rang the bell twice?",
                        "Did you and Leo ever take the rowboat out past the point without telling anyone?",
                    },
                    UpdatedAt = now,
                },
            },
            Photos = new List<MemoryPhoto>
            {
                new()
                {
                    Id = "photo-01",
                    ChapterId = "chap-01",
                    ImageUrl = "/src/assets/images/sample_childhood_summer_1794804938197.jpg",
                    Caption = "Figure 1.1 — Leo and Clara on the Cedar Cove dock, late August 1974.",
                    StoryNarrative = "Taken by our mother with her brown leather Kodak just after supper.",
                    MemoryHint = "Cedar Cove dock, summer 1974",
                    YearLabel = "1974",
                    LocationLabel = "Cedar Cove, Northern Shore",
                    Placement = "chapter-opener",
                    FollowUpQuestions = new List<string> { "Whose red canvas sneakers were those?" },
                    CreatedAt = now,
                },
            },
            Prompts = new List<GuidedPrompt>
            {
                new()
                {
                    Id = "prompt-01",
                    Category = "Childhood & Early Days",
                    Question = "What does this family photograph help you remember about that summer afternoon?",
                    MemoryTriggers = new List<string>
                    {
                        "Who was standing behind the camera when it was taken?",
                        "What happened right before or right after this picture?",
                    },
                    CoachingTip = "Take a moment to look at the light and faces first—describe the day like you are holding the print in your hands.",
                    EstimatedMinutes = 4,
                    IsCustom = false,
                    CreatedBy = "Leo Vance",
                    Cadence = "weekly",
                    Status = "inbox",
                    PhotoUrl = "/src/assets/images/sample_childhood_summer_1794804938197.jpg",
                    CreatedAt = now,
                },
                new()
                {
                    Id = "prompt-02",
                    Category = "Love & Companionship",
                    Question = "What was the funniest misunderstanding or small disaster from your first year of marriage?",
                    MemoryTriggers = new List<string>
                    {
                        "Where were you living at the time?",
                        "Who started laughing first?",
                    },
                    CoachingTip = "Don’t polish away the imperfect details—those are usually everyone’s favorite part.",
                    EstimatedMinutes = 4,
                    IsCustom = false,
                    CreatedBy = "Maya Vance",
                    Cadence = "weekly",
                    Status = "inbox",
                    CreatedAt = now,
                },
            },
        };
    }
}
