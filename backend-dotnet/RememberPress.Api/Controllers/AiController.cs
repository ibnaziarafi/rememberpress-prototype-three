using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using RememberPress.Api.Models;
using RememberPress.Api.Services;

namespace RememberPress.Api.Controllers;

[ApiController]
[Route("api/ai")]
public sealed class AiController : ControllerBase
{
    private readonly BookStoreService _store;
    private readonly AiProviderService _ai;

    public AiController(BookStoreService store, AiProviderService ai)
    {
        _store = store;
        _ai = ai;
    }

    [HttpGet("status")]
    public IActionResult GetStatus() => Ok(new
    {
        geminiConfigured = AiProviderService.IsGeminiConfigured,
        groqConfigured = AiProviderService.IsGroqConfigured,
    });

    [HttpPost("transcribe-and-draft")]
    public async Task<IActionResult> TranscribeAndDraft([FromBody] TranscribeAndDraftRequest req, CancellationToken ct)
    {
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var activeProvider = req.PreferredProvider ?? book.Settings.PreferredAiProvider ?? "gemini-lite";
        var allowFallback = book.Settings.EnableProviderFallback;
        var spellingBlock = AiProviderService.BuildSpellingPromptBlock(book, req.SpellingHints);

        var transcriptText = (req.TranscriptOverride ?? string.Empty).Trim();
        string? savedAudioUrl = null;
        string? savedVideoUrl = null;
        var providerUsed = activeProvider;
        string? fallbackNotice = null;

        if (!string.IsNullOrWhiteSpace(req.AudioBase64))
        {
            var rawBaseMime = (req.MimeType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
            var isVideo = rawBaseMime.StartsWith("video/");
            var cleanedMime = BookStoreService.CleanMimeType(req.MimeType, "audio/webm");
            var rawBase64 = BookStoreService.ExtractBase64(req.AudioBase64);
            if (isVideo)
            {
                savedVideoUrl = _store.SaveBase64Media(rawBase64, req.MimeType ?? "video/webm", "interview-video");
            }
            else
            {
                savedAudioUrl = _store.SaveBase64Media(rawBase64, cleanedMime, "interview");
            }

            var audioResult = await _ai.TranscribeAudioAsync(rawBase64, cleanedMime, activeProvider, allowFallback, spellingBlock, ct);
            transcriptText = audioResult.Transcript;
            providerUsed = audioResult.ProviderUsed;
            fallbackNotice = audioResult.FallbackNotice;
        }

        if (string.IsNullOrWhiteSpace(transcriptText))
        {
            return BadRequest(new { error = "Provide either recorded audio or written memory notes." });
        }

        var storytellerName = string.IsNullOrWhiteSpace(req.StorytellerName) ? book.Settings.AuthorName : req.StorytellerName;
        var editInstruction = AiProviderService.BuildEditLevelInstruction(
            req.AiEditLevel ?? "balanced",
            req.ToneStrength ?? "slight",
            req.WritingTone ?? "Warm Memoir",
            req.Perspective ?? "first-person",
            req.LengthPreference ?? "balanced",
            storytellerName);

        var prompt = $"Shape this spoken memory into a family book chapter while strictly respecting the AI editing level and the Founder's Method.\n\n{book.Settings.FounderGuidePrompt}\n\n{editInstruction}\n{(string.IsNullOrWhiteSpace(spellingBlock) ? "" : "\n" + spellingBlock + "\n")}\nStoryteller: {storytellerName}\nPrompt Question: {(string.IsNullOrWhiteSpace(req.PromptQuestion) ? "Spontaneous personal memory" : req.PromptQuestion)}\nAdditional Context: {(string.IsNullOrWhiteSpace(req.MemoryNotes) ? "None" : req.MemoryNotes)}\n\nOriginal Spoken Transcript:\n\"\"\"\n{transcriptText}\n\"\"\"\n\nRequirements:\n1. NEVER invent facts, names, dates, or events not grounded in the transcript.\n2. NEVER flatten the speaker's natural voice into stiff AI clichés.\n3. Preserve exact spelling of any verified names, places, and addresses listed above.\n4. Return JSON with fields: title, subtitle, eraLabel (e.g., \"1974 · Childhood\" or \"Mid-1980s\"), epigraph (1 short opening sentence), pullQuote (1 authentic standout quote from their words), body (multi-paragraph text separated by blank lines matching the exact AI editing level requested), and followUpQuestions (array of 2 gentle follow-up questions).";

        var schema = BuildObjectSchema(new[] { "title", "subtitle", "eraLabel", "epigraph", "pullQuote", "body" }, "followUpQuestions");
        var res = await _ai.GenerateStructuredJsonAsync(
            prompt,
            "You are a careful, warm memoir editor at RememberPress. You act strictly as a helper, never replacing the storyteller’s authentic voice.",
            activeProvider,
            allowFallback,
            schema,
            new ChapterDraftPayload { Title = "Untitled Memory", Body = transcriptText },
            ct);

        return Ok(new
        {
            transcript = transcriptText,
            chapter = res.Data,
            audioUrl = savedAudioUrl,
            videoUrl = savedVideoUrl,
            providerUsed = !string.IsNullOrWhiteSpace(req.AudioBase64) ? $"{providerUsed} + {res.ProviderUsed}" : res.ProviderUsed,
            fallbackNotice = fallbackNotice ?? res.FallbackNotice,
        });
    }

    [HttpPost("rewrite-memory")]
    public async Task<IActionResult> RewriteMemory([FromBody] RewriteMemoryRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Transcript))
        {
            return BadRequest(new { error = "Original transcript is required so AI edits remain grounded in your real words." });
        }

        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var activeProvider = req.PreferredProvider ?? book.Settings.PreferredAiProvider ?? "gemini-lite";
        var allowFallback = book.Settings.EnableProviderFallback;

        if (req.AiEditLevel == "raw" && req.Perspective != "third-person")
        {
            return Ok(new
            {
                title = string.IsNullOrWhiteSpace(req.CurrentTitle) ? "Untitled Memory" : req.CurrentTitle,
                subtitle = req.CurrentSubtitle ?? string.Empty,
                epigraph = string.Empty,
                pullQuote = string.Empty,
                body = req.Transcript.Trim(),
                providerUsed = "verbatim-source",
            });
        }

        var editInstruction = AiProviderService.BuildEditLevelInstruction(
            req.AiEditLevel ?? "balanced",
            req.ToneStrength ?? "slight",
            req.WritingTone ?? "Warm Memoir",
            req.Perspective ?? "first-person",
            req.LengthPreference ?? "balanced",
            string.IsNullOrWhiteSpace(req.StorytellerName) ? book.Settings.AuthorName : req.StorytellerName);

        var prompt = $"Re-shape the original spoken transcript below according to the exact AI Helper Level and Tone Strength requested.\n\n{book.Settings.FounderGuidePrompt}\n{editInstruction}\n\nCurrent Title Suggestion: {(string.IsNullOrWhiteSpace(req.CurrentTitle) ? "Create an authentic title" : req.CurrentTitle)}\nOriginal Spoken Transcript (Source of Truth):\n\"\"\"\n{req.Transcript}\n\"\"\"\n\nReturn JSON with fields: title, subtitle, epigraph, pullQuote, body.";

        var schema = BuildObjectSchema(new[] { "title", "subtitle", "epigraph", "pullQuote", "body" });
        var res = await _ai.GenerateStructuredJsonAsync(
            prompt,
            "You are RememberPress’s gentle editorial helper. Always preserve the storyteller’s natural vocabulary, emotional warmth, and true facts.",
            activeProvider,
            allowFallback,
            schema,
            new RewriteDraftPayload
            {
                Title = string.IsNullOrWhiteSpace(req.CurrentTitle) ? "Untitled Memory" : req.CurrentTitle,
                Subtitle = req.CurrentSubtitle ?? string.Empty,
                Body = req.Transcript,
            },
            ct);

        return Ok(new
        {
            res.Data.Title,
            res.Data.Subtitle,
            res.Data.Epigraph,
            res.Data.PullQuote,
            res.Data.Body,
            res.ProviderUsed,
            res.FallbackNotice,
        });
    }

    [HttpPost("sequence-book")]
    public async Task<IActionResult> SequenceBook(CancellationToken ct)
    {
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        if (book.Chapters.Count < 2)
        {
            return Ok(new
            {
                chapters = book.Chapters,
                rationale = "Add at least two chapters to auto-sequence the book timeline.",
                providerUsed = "none",
            });
        }

        var summaries = book.Chapters.Select(c => new
        {
            c.Id,
            currentOrder = c.Order,
            c.Title,
            c.Subtitle,
            c.EraLabel,
            excerpt = c.Body.Length > 260 ? c.Body[..260] : c.Body,
        });

        var prompt = $"These memoir memories were captured out of order. Organize them into the most natural, heartwarming printed book chapter sequence (typically childhood -> family roots -> coming of age -> work/love -> turning points -> wisdom & legacy).\n\nChapters to sequence:\n{JsonSerializer.Serialize(summaries, BookStoreService.JsonOptions)}\n\nReturn JSON with:\n- orderedIds: array containing every chapter id exactly once in the recommended book order.\n- rationale: 1 short, warm sentence explaining why this chapter sequence flows well.";

        var schema = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["orderedIds"] = new JsonObject { ["type"] = "ARRAY", ["items"] = new JsonObject { ["type"] = "STRING" } },
                ["rationale"] = new JsonObject { ["type"] = "STRING" },
            },
            ["required"] = new JsonArray { "orderedIds", "rationale" },
        };

        var res = await _ai.GenerateStructuredJsonAsync(
            prompt,
            "You are a memoir book editor organizing non-linear family stories into a cohesive, chronologically and emotionally satisfying book.",
            book.Settings.PreferredAiProvider ?? "gemini-lite",
            book.Settings.EnableProviderFallback,
            schema,
            new SequenceResultPayload
            {
                OrderedIds = book.Chapters.Select(c => c.Id).ToList(),
                Rationale = "Preserved your current chapter sequence.",
            },
            ct);

        var updatedChapters = await _store.WithStoreAsync(s =>
        {
            var target = _store.ResolveBook(s, Request);
            var map = target.Chapters.ToDictionary(c => c.Id);
            var reordered = new List<Chapter>();

            foreach (var id in res.Data.OrderedIds)
            {
                if (map.TryGetValue(id, out var ch))
                {
                    ch.Order = reordered.Count + 1;
                    reordered.Add(ch);
                    map.Remove(id);
                }
            }
            foreach (var leftover in map.Values)
            {
                leftover.Order = reordered.Count + 1;
                reordered.Add(leftover);
            }

            target.Chapters = reordered;
            return target.Chapters;
        }, persist: true);

        return Ok(new
        {
            chapters = updatedChapters,
            res.Data.Rationale,
            res.ProviderUsed,
        });
    }

    [HttpPost("refine-chapter")]
    public async Task<IActionResult> RefineChapter([FromBody] RefineChapterRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Body) || string.IsNullOrWhiteSpace(req.Instruction))
        {
            return BadRequest(new { error = "Chapter body and refinement instruction are required." });
        }

        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var prompt = $"Refine the following memoir chapter manuscript according to the instruction while preserving the storyteller's authentic voice and staying faithful to the original transcript.\n\n{book.Settings.FounderGuidePrompt}\nChapter Title: {req.Title}\nInstruction: {req.Instruction}\n\nCurrent Manuscript Body:\n\"\"\"\n{req.Body}\n\"\"\"\n\nOriginal Spoken Transcript (Source of Truth):\n\"\"\"\n{(string.IsNullOrWhiteSpace(req.Transcript) ? "Not provided" : req.Transcript)}\n\"\"\"\n\nReturn JSON with: title, pullQuote, body.";

        var schema = BuildObjectSchema(new[] { "title", "pullQuote", "body" });
        var res = await _ai.GenerateStructuredJsonAsync(
            prompt,
            "You are a careful literary memoir editor. Keep the storyteller’s genuine phrasing and facts.",
            book.Settings.PreferredAiProvider ?? "gemini-lite",
            book.Settings.EnableProviderFallback,
            schema,
            new RefineResultPayload { Title = req.Title ?? string.Empty, Body = req.Body },
            ct);

        return Ok(res.Data);
    }

    [HttpPost("describe-photo")]
    public async Task<IActionResult> DescribePhoto([FromBody] PhotoRequest req, CancellationToken ct)
    {
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var inlineImg = _store.ResolveImageInlineData(req.ImageBase64, req.MimeType ?? "image/jpeg");
        if (inlineImg is null)
        {
            return BadRequest(new { error = "Image data is required to generate a photo story." });
        }

        var prompt = $"Look closely at this family photograph and weave a warm, truthful memoir story around it.\n\nUser's Memory Note: {(string.IsNullOrWhiteSpace(req.MemoryHint) ? "No written hint yet—describe the visible moment warmly." : req.MemoryHint)}\nBook Chapter Context: {(string.IsNullOrWhiteSpace(req.ChapterContext) ? "General family memoir" : req.ChapterContext)}\n\nReturn JSON:\n- caption: Crisp 1-sentence book figure caption.\n- storyNarrative: Warm 2-paragraph narrative grounded strictly in what is visible and the memory note.\n- yearLabel: Era or estimated decade/season.\n- memoryQuestions: 3 specific follow-up questions pointing to real visual details in the photo.";

        var schema = BuildObjectSchema(new[] { "caption", "storyNarrative", "yearLabel" }, "memoryQuestions");
        var res = await _ai.GenerateVisionJsonAsync(
            book.Settings.PreferredAiProvider ?? "gemini-lite",
            book.Settings.EnableProviderFallback,
            inlineImg.Value.MimeType,
            inlineImg.Value.Base64,
            prompt,
            "You are a memoir visual curator at RememberPress. Never fabricate names or dates not present in the note.",
            schema,
            new DescribePhotoPayload { Caption = string.IsNullOrWhiteSpace(req.MemoryHint) ? "Family photograph" : req.MemoryHint },
            ct);

        return Ok(res.Data);
    }

    [HttpPost("photo-memory-questions")]
    public async Task<IActionResult> PhotoMemoryQuestions([FromBody] PhotoRequest req, CancellationToken ct)
    {
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var inlineImg = _store.ResolveImageInlineData(req.ImageBase64, req.MimeType ?? "image/jpeg");
        if (inlineImg is null)
        {
            return BadRequest(new { error = "Select or upload a photograph first." });
        }

        var prompt = $"You are helping a family member craft warm, specific memory questions around this photograph for {book.Settings.AuthorName}.\nApply this coaching methodology:\n{book.Settings.FounderGuidePrompt}\n\nOptional context note: {(string.IsNullOrWhiteSpace(req.MemoryHint) ? "None yet" : req.MemoryHint)}\n\nLook carefully at the setting, people, objects, clothing, and lighting in the photo.\nReturn JSON:\n1. observationLead: 1 warm sentence noticing a visual detail and asking \"What does this photo help you remember?\"\n2. questions: 4 concise, human memory questions anchored in real visual clues (the family member will choose which ones to keep or remove before sending).";

        var schema = BuildObjectSchema(new[] { "observationLead" }, "questions");
        var res = await _ai.GenerateVisionJsonAsync(
            book.Settings.PreferredAiProvider ?? "gemini-lite",
            book.Settings.EnableProviderFallback,
            inlineImg.Value.MimeType,
            inlineImg.Value.Base64,
            prompt,
            "You are a warm oral historian at RememberPress helping families ask thoughtful questions around cherished photos.",
            schema,
            new PhotoQuestionsPayload
            {
                ObservationLead = "Take a quiet moment with this photograph—what does it help you remember first?",
                Questions = new List<string>
                {
                    "Who is in this photograph, and who was holding the camera?",
                    "What happened right before or right after this picture was taken?",
                    "What sounds, smells, or conversations from that day come back to you?",
                },
            },
            ct);

        return Ok(new
        {
            res.Data.ObservationLead,
            res.Data.Questions,
            providerUsed = res.ModelUsed,
        });
    }

    [HttpPost("photo-explanation-story")]
    public async Task<IActionResult> PhotoExplanationStory([FromBody] PhotoExplanationStoryRequest req, CancellationToken ct)
    {
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));
        var inlineImg = _store.ResolveImageInlineData(req.ImageBase64, req.MimeType ?? "image/jpeg");
        if (inlineImg is null)
        {
            return BadRequest(new { error = "A photograph is required." });
        }

        var activeProvider = req.PreferredProvider ?? book.Settings.PreferredAiProvider ?? "gemini-lite";
        var allowFallback = book.Settings.EnableProviderFallback;
        var spellingBlock = AiProviderService.BuildSpellingPromptBlock(book, req.SpellingHints);

        var explanationText = (req.WrittenExplanation ?? string.Empty).Trim();
        string? savedAudioUrl = null;
        string? savedVideoUrl = null;
        var audioProvider = "text";
        string? fallbackNotice = null;

        if (!string.IsNullOrWhiteSpace(req.AudioBase64))
        {
            var rawBaseMime = (req.AudioMimeType ?? string.Empty).Split(';')[0].Trim().ToLowerInvariant();
            var isVideo = rawBaseMime.StartsWith("video/");
            var cleanedAudioMime = BookStoreService.CleanMimeType(req.AudioMimeType, "audio/webm");
            var rawAudioBase64 = BookStoreService.ExtractBase64(req.AudioBase64);
            if (isVideo)
            {
                savedVideoUrl = _store.SaveBase64Media(rawAudioBase64, req.AudioMimeType ?? "video/webm", "photo-video");
            }
            else
            {
                savedAudioUrl = _store.SaveBase64Media(rawAudioBase64, cleanedAudioMime, "photo-interview");
            }

            var audioRes = await _ai.TranscribeAudioAsync(rawAudioBase64, cleanedAudioMime, activeProvider, allowFallback, spellingBlock, ct);
            explanationText = audioRes.Transcript;
            audioProvider = audioRes.ProviderUsed;
            fallbackNotice = audioRes.FallbackNotice;
        }

        if (string.IsNullOrWhiteSpace(explanationText))
        {
            return BadRequest(new { error = "Please record or write the storyteller’s explanation first." });
        }

        var storytellerName = string.IsNullOrWhiteSpace(req.StorytellerName) ? book.Settings.AuthorName : req.StorytellerName;
        var editInstruction = AiProviderService.BuildEditLevelInstruction(
            req.AiEditLevel ?? "balanced",
            req.ToneStrength ?? "slight",
            req.WritingTone ?? "Warm Memoir",
            "first-person",
            "balanced",
            storytellerName);

        var askedList = req.AskedQuestions is { Count: > 0 }
            ? string.Join("\n", req.AskedQuestions.Select((q, i) => $"{i + 1}. {q}"))
            : "What does this photo help you remember?";

        var promptText = $"We showed this photograph to {storytellerName} and asked what memories it brings back.\n\n{book.Settings.FounderGuidePrompt}\n{editInstruction}\n{(string.IsNullOrWhiteSpace(spellingBlock) ? "" : "\n" + spellingBlock + "\n")}\nQuestions Asked:\n{askedList}\n\nOptional Context Note: {(string.IsNullOrWhiteSpace(req.MemoryHint) ? "None" : req.MemoryHint)}\n\nStoryteller's Explanation (Source of Truth):\n\"\"\"\n{explanationText}\n\"\"\"\n\nUsing BOTH the photograph and everything the storyteller explained (staying strictly faithful to their voice, facts, and verified name/place/address spellings), return JSON:\n- caption: Crisp 1-sentence editorial figure caption.\n- storyNarrative: 2-to-3 paragraph narrative shaped exactly to the requested AI editing level.\n- yearLabel: Era or year mentioned (or gentle estimate if unstated).\n- chapterTitle: Evocative chapter title.\n- chapterSubtitle: Concise era/place subtitle.\n- memoryQuestions: 2 gentle follow-up questions if they want to add more later.";

        var fallbackPayload = new PhotoExplanationPayload
        {
            Caption = string.IsNullOrWhiteSpace(req.MemoryHint) ? "Family memory photograph" : req.MemoryHint,
            StoryNarrative = explanationText,
            ChapterTitle = "A Moment Remembered",
        };

        var schema = BuildObjectSchema(new[] { "caption", "storyNarrative", "yearLabel", "chapterTitle", "chapterSubtitle" }, "memoryQuestions");
        PhotoExplanationPayload parsed;
        string visionModelUsed;

        try
        {
            var gemRes = await _ai.GenerateVisionJsonAsync(
                activeProvider,
                allowFallback,
                inlineImg.Value.MimeType,
                inlineImg.Value.Base64,
                promptText,
                "You are a careful memoir editor at RememberPress turning a storyteller’s photo memories into authentic book pages.",
                schema,
                fallbackPayload,
                ct);
            parsed = gemRes.Data;
            visionModelUsed = gemRes.ModelUsed;
            if (!string.IsNullOrWhiteSpace(gemRes.FallbackNotice))
            {
                fallbackNotice = string.IsNullOrWhiteSpace(fallbackNotice)
                    ? gemRes.FallbackNotice
                    : $"{fallbackNotice} · {gemRes.FallbackNotice}";
            }
        }
        catch (Exception ex) when (allowFallback && AiProviderService.IsGroqConfigured)
        {
            var groqRes = await _ai.CallGroqJsonAsync(
                promptText,
                "You are a careful memoir editor at RememberPress turning a storyteller’s photo explanation into authentic book pages.",
                fallbackPayload,
                ct);
            parsed = groqRes.Data;
            visionModelUsed = $"groq-{groqRes.ModelUsed}";
            fallbackNotice = $"Switched to Groq {groqRes.ModelUsed} ({ex.Message})";
        }

        return Ok(new
        {
            transcript = explanationText,
            parsed.Caption,
            parsed.StoryNarrative,
            parsed.YearLabel,
            parsed.ChapterTitle,
            parsed.ChapterSubtitle,
            parsed.MemoryQuestions,
            audioUrl = savedAudioUrl,
            videoUrl = savedVideoUrl,
            providerUsed = !string.IsNullOrWhiteSpace(req.AudioBase64) ? $"{audioProvider} + {visionModelUsed}" : visionModelUsed,
            fallbackNotice,
        });
    }

    [HttpPost("guided-prompts")]
    public async Task<IActionResult> GuidedPrompts([FromBody] GuidedPromptsRequest req, CancellationToken ct)
    {
        var category = string.IsNullOrWhiteSpace(req.Category) ? "Family & Roots" : req.Category;
        var book = await _store.WithStoreAsync(s => _store.ResolveBook(s, Request));

        var createdBy = string.IsNullOrWhiteSpace(req.CreatedBy) ? book.Settings.OrganizerName : req.CreatedBy;
        var cadence = string.IsNullOrWhiteSpace(req.Cadence) ? book.Settings.PromptCadence : req.Cadence;
        var status = string.IsNullOrWhiteSpace(req.Status) ? "queued" : req.Status;

        var existingTitles = req.ExistingTitles is { Count: > 0 } ? string.Join("; ", req.ExistingTitles) : "None yet";
        var prompt = $"Generate 3 thoughtful, human memoir questions for the theme \"{category}\".\n\nFollow this Founder's Book-Writing Guide strictly:\n{book.Settings.FounderGuidePrompt}\n\nStoryteller Name: {book.Settings.AuthorName}\nFamily / Life Context: {(string.IsNullOrWhiteSpace(req.LifeContext) ? "Everyday family life, friendships, work, and traditions" : req.LifeContext)}\nChapters already written: {existingTitles}\n\nFor each question return:\n- question: Warm, specific question inviting one real story (avoid clichés).\n- memoryTriggers: 3 short sensory cues (sounds, objects, routines) to help unlock memories.\n- coachingTip: 1 encouraging speaking tip grounded in the Founder's Method.\n- estimatedMinutes: integer between 3 and 6.";

        var schema = new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = new JsonObject
            {
                ["prompts"] = new JsonObject
                {
                    ["type"] = "ARRAY",
                    ["items"] = new JsonObject
                    {
                        ["type"] = "OBJECT",
                        ["properties"] = new JsonObject
                        {
                            ["question"] = new JsonObject { ["type"] = "STRING" },
                            ["memoryTriggers"] = new JsonObject { ["type"] = "ARRAY", ["items"] = new JsonObject { ["type"] = "STRING" } },
                            ["coachingTip"] = new JsonObject { ["type"] = "STRING" },
                            ["estimatedMinutes"] = new JsonObject { ["type"] = "INTEGER" },
                        },
                        ["required"] = new JsonArray { "question", "memoryTriggers", "coachingTip", "estimatedMinutes" },
                    }
                }
            },
            ["required"] = new JsonArray { "prompts" },
        };

        var res = await _ai.GenerateStructuredJsonAsync(
            prompt,
            "You are an oral historian trained in the RememberPress Founder’s Method, helping families ask warm, story-sparking questions.",
            book.Settings.PreferredAiProvider ?? "gemini-lite",
            book.Settings.EnableProviderFallback,
            schema,
            new GeneratedPromptsPayload(),
            ct);

        var now = DateTime.UtcNow.ToString("O");
        var created = await _store.WithStoreAsync(s =>
        {
            var target = _store.ResolveBook(s, Request);
            var list = res.Data.Prompts.Select(item => new GuidedPrompt
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = category,
                Question = item.Question,
                MemoryTriggers = item.MemoryTriggers ?? new List<string>(),
                CoachingTip = item.CoachingTip ?? string.Empty,
                EstimatedMinutes = item.EstimatedMinutes > 0 ? item.EstimatedMinutes : 4,
                CreatedBy = createdBy,
                Cadence = cadence,
                Status = status,
                CreatedAt = now,
            }).ToList();

            target.Prompts.InsertRange(0, list);
            return list;
        }, persist: true);

        return Ok(new { prompts = created, res.ProviderUsed });
    }

    [HttpPost("narrate-chapter")]
    public async Task<IActionResult> NarrateChapter([FromBody] NarrateChapterRequest req, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.Body))
        {
            return BadRequest(new { error = "Chapter text is required for narration." });
        }

        var audioBase64 = await _ai.NarrateChapterAsync(req.Title, req.Body, ct);
        return Ok(new { audioBase64, mimeType = "audio/wav" });
    }

    private static JsonObject BuildObjectSchema(IEnumerable<string> stringFields, params string[] stringArrayFields)
    {
        var props = new JsonObject();
        var required = new JsonArray();

        foreach (var field in stringFields)
        {
            props[field] = new JsonObject { ["type"] = "STRING" };
            required.Add(field);
        }
        foreach (var arrField in stringArrayFields)
        {
            props[arrField] = new JsonObject
            {
                ["type"] = "ARRAY",
                ["items"] = new JsonObject { ["type"] = "STRING" },
            };
            required.Add(arrField);
        }

        return new JsonObject
        {
            ["type"] = "OBJECT",
            ["properties"] = props,
            ["required"] = required,
        };
    }
}
