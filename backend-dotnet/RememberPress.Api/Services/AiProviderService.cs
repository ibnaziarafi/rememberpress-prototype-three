using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using RememberPress.Api.Models;

namespace RememberPress.Api.Services;

public sealed class AiProviderService
{
    private readonly IHttpClientFactory _httpFactory;

    public AiProviderService(IHttpClientFactory httpFactory)
    {
        _httpFactory = httpFactory;
    }

    public static bool IsGeminiConfigured => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("GEMINI_API_KEY"));
    public static bool IsGroqConfigured => !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("GROQ_API_KEY"));

    public static string BuildSpellingPromptBlock(BookWorkspaceData book, SpellingHintsInput? hints)
    {
        var glossary = book.Settings.SpellingGlossary ?? new List<SpellingCorrection>();
        var names = new HashSet<string>(StringComparer.Ordinal);
        var places = new HashSet<string>(StringComparer.Ordinal);
        var addresses = new HashSet<string>(StringComparer.Ordinal);

        foreach (var item in glossary)
        {
            if (string.IsNullOrWhiteSpace(item.Correct)) continue;
            var val = item.Correct.Trim();
            if (item.Category == "name") names.Add(val);
            else if (item.Category == "place") places.Add(val);
            else if (item.Category == "address") addresses.Add(val);
        }

        void AddCommaList(string? raw, HashSet<string> target)
        {
            if (string.IsNullOrWhiteSpace(raw)) return;
            foreach (var part in raw.Split(','))
            {
                var trimmed = part.Trim();
                if (!string.IsNullOrEmpty(trimmed)) target.Add(trimmed);
            }
        }

        AddCommaList(hints?.Names, names);
        AddCommaList(hints?.Places, places);
        AddCommaList(hints?.Addresses, addresses);

        var lines = new List<string>();
        if (names.Count > 0) lines.Add($"- Verified People Names: {string.Join(", ", names)}");
        if (places.Count > 0) lines.Add($"- Verified Places & Landmarks: {string.Join(", ", places)}");
        if (addresses.Count > 0) lines.Add($"- Verified Addresses & Streets: {string.Join(", ", addresses)}");

        var pairs = glossary
            .Where(g => !string.IsNullOrWhiteSpace(g.Wrong) && !string.IsNullOrWhiteSpace(g.Correct))
            .Select(g => $"\"{g.Wrong.Trim()}\" -> \"{g.Correct.Trim()}\"")
            .ToList();
        if (pairs.Count > 0) lines.Add($"- Known Phonetic Corrections: {string.Join("; ", pairs)}");

        return lines.Count > 0
            ? $"PROPER NOUN SPELLING REFERENCE (use these exact spellings for names, places, and addresses if spoken):\n{string.Join("\n", lines)}"
            : string.Empty;
    }

    public static string BuildEditLevelInstruction(
        string aiLevel,
        string toneStrength,
        string writingTone,
        string perspective = "first-person",
        string lengthPreference = "balanced",
        string storytellerName = "the storyteller")
    {
        var levelGuide = aiLevel switch
        {
            "raw" => "LEVEL: RAW TRANSCRIPT — Keep the exact spoken words and sentences nearly verbatim. Only fix obvious punctuation, paragraph spacing, and remove pure filler sounds (\"um\", \"uh\"). Do NOT rewrite or embellish.",
            "light" => "LEVEL: LIGHT CLEANUP — Preserve 95%+ of the storyteller’s original wording, sentence rhythm, humor, and idioms. Smooth awkward false starts and organize into readable paragraphs without changing their voice.",
            "full" => "LEVEL: FULL REWRITE — Shape the spoken story into richly paced literary memoir prose while remaining 100% faithful to every fact, person, and feeling from the transcript—never invent names or events.",
            _ => "LEVEL: BALANCED POLISH — Keep every factual detail, idiom, and emotional tone authentic to the speaker while smoothing transitions, sensory flow, and opening/closing lines so it reads naturally in a family book.",
        };

        var strengthGuide = toneStrength == "stronger"
            ? "TONE INTENSITY: STRONGER — Lean clearly into the chosen editorial voice while keeping the heart and facts intact."
            : "TONE INTENSITY: SLIGHT — Apply the requested tone gently so it still sounds unmistakably like the storyteller talking at the kitchen table.";

        var perspectiveGuide = perspective switch
        {
            "verbatim" => "PERSPECTIVE: CLEANED TRANSCRIPT (\"I\" AS SPOKEN) — Preserve spoken phrasing and natural sentence cadence with minimal structural changes.",
            "third-person" => $"PERSPECTIVE: THIRD-PERSON BIOGRAPHY (\"{storytellerName} / He / She / They\") — Write as an intimate third-person family biography about {storytellerName}, preserving all spoken anecdotes and sensory details.",
            _ => "PERSPECTIVE: FIRST-PERSON MEMOIR (\"I / WE\") — Write as a warm first-person story told in the storyteller’s own voice.",
        };

        var lengthGuide = lengthPreference switch
        {
            "concise" => "LENGTH: CONCISE — Trim repetition and deliver a crisp, vivid 1-to-2 paragraph memory.",
            "detailed" => "LENGTH: DETAILED — Preserve every spoken aside, sensory observation, and reflection across rich, unhurried paragraphs.",
            _ => "LENGTH: BALANCED — Deliver a complete 2-to-4 paragraph narrative with room for scene-setting and emotion.",
        };

        return $"{levelGuide}\n{strengthGuide}\n{perspectiveGuide}\n{lengthGuide}\nVOICE STYLE: {writingTone}";
    }

    private static bool IsTransientError(Exception ex)
    {
        var msg = ex.Message.ToLowerInvariant();
        return msg.Contains("503")
            || msg.Contains("unavailable")
            || msg.Contains("high demand")
            || msg.Contains("429")
            || msg.Contains("resource_exhausted")
            || msg.Contains("overloaded")
            || msg.Contains("timed out")
            || msg.Contains("timeout");
    }

    private static string RequireGeminiKey()
    {
        var key = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new ApiErrorException(500, "GEMINI_API_KEY is not configured in environment secrets.");
        }
        return key;
    }

    private static string RequireGroqKey()
    {
        var key = Environment.GetEnvironmentVariable("GROQ_API_KEY");
        if (string.IsNullOrWhiteSpace(key))
        {
            throw new ApiErrorException(500, "GROQ_API_KEY is not configured.");
        }
        return key;
    }

    private static T SafeParseModelJson<T>(string? rawText, T fallback)
    {
        var withoutThink = Regex.Replace(rawText ?? string.Empty, @"<think>[\s\S]*?</think>", string.Empty, RegexOptions.IgnoreCase).Trim();
        var cleaned = Regex.Replace(withoutThink, @"^```(?:json)?\s*", string.Empty, RegexOptions.IgnoreCase);
        cleaned = Regex.Replace(cleaned, @"\s*```$", string.Empty, RegexOptions.IgnoreCase).Trim();
        if (string.IsNullOrWhiteSpace(cleaned)) return fallback;

        try
        {
            return JsonSerializer.Deserialize<T>(cleaned, BookStoreService.JsonOptions) ?? fallback;
        }
        catch
        {
            var firstBrace = cleaned.IndexOf('{');
            var lastBrace = cleaned.LastIndexOf('}');
            if (firstBrace >= 0 && lastBrace > firstBrace)
            {
                var slice = cleaned[firstBrace..(lastBrace + 1)];
                return JsonSerializer.Deserialize<T>(slice, BookStoreService.JsonOptions) ?? fallback;
            }
            throw new ApiErrorException(502, "AI response could not be parsed as structured JSON. Please try again.");
        }
    }

    public async Task<(string Text, string ModelUsed, string? FallbackNotice)> GenerateGeminiContentAsync(
        string preferredProvider,
        bool enableFallback,
        Func<string, JsonObject> buildBody,
        CancellationToken ct)
    {
        var apiKey = RequireGeminiKey();
        var primary = preferredProvider == "gemini" ? "gemini-4-hydrogen" : "gemini-3.1-flash-lite";
        var secondary = primary == "gemini-3.1-flash-lite" ? "gemini-4-hydrogen" : "gemini-3.1-flash-lite";
        var hasGroq = enableFallback && IsGroqConfigured;
        var timeout = TimeSpan.FromMilliseconds(hasGroq ? 5000 : enableFallback ? 9000 : 25000);

        async Task<string> CallModelAsync(string model)
        {
            var payload = buildBody(model);
            if (model == "gemini-4-hydrogen")
            {
                var genConfig = payload["generationConfig"]?.AsObject() ?? new JsonObject();
                if (!genConfig.ContainsKey("thinkingConfig"))
                {
                    genConfig["thinkingConfig"] = new JsonObject { ["thinkingLevel"] = "LOW" };
                }
                payload["generationConfig"] = genConfig;
            }

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(timeout);

            var client = _httpFactory.CreateClient();
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{Uri.EscapeDataString(model)}:generateContent?key={Uri.EscapeDataString(apiKey)}";
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.UserAgent.ParseAdd("aistudio-build");

            HttpResponseMessage resp;
            try
            {
                resp = await client.SendAsync(req, cts.Token);
            }
            catch (OperationCanceledException) when (!ct.IsCancellationRequested)
            {
                throw new ApiErrorException(503, $"{model} timed out after {Math.Round(timeout.TotalSeconds)}s (503 high demand)");
            }

            var jsonStr = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
            {
                throw new ApiErrorException((int)resp.StatusCode, $"Gemini ({model}) error ({(int)resp.StatusCode}): {jsonStr}");
            }

            using var doc = JsonDocument.Parse(jsonStr);
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates) || candidates.GetArrayLength() == 0)
            {
                return string.Empty;
            }
            var parts = candidates[0].GetProperty("content").GetProperty("parts");
            var sb = new StringBuilder();
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("text", out var textEl))
                {
                    sb.Append(textEl.GetString());
                }
            }
            return sb.ToString().Trim();
        }

        try
        {
            var text = await CallModelAsync(primary);
            return (text, primary, null);
        }
        catch (Exception ex) when (IsTransientError(ex) && enableFallback)
        {
            if (primary == "gemini-3.1-flash-lite" && hasGroq)
            {
                throw;
            }

            var switchedText = await CallModelAsync(secondary);
            return (switchedText, secondary, $"{primary} was busy; processed cleanly with {secondary}.");
        }
    }

    public async Task<string> CallGroqWhisperAsync(string rawBase64, string mimeType, string spellingBlock, CancellationToken ct)
    {
        var apiKey = RequireGroqKey();
        var ext = mimeType switch
        {
            "audio/webm" => "webm",
            "audio/mp4" => "m4a",
            "audio/mpeg" => "mp3",
            "audio/wav" => "wav",
            "audio/ogg" => "ogg",
            _ => "webm",
        };

        var bytes = Convert.FromBase64String(BookStoreService.ExtractBase64(rawBase64));
        using var form = new MultipartFormDataContent();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(mimeType);
        form.Add(fileContent, "file", $"story.{ext}");
        form.Add(new StringContent("whisper-large-v3-turbo"), "model");
        form.Add(new StringContent("0"), "temperature");
        form.Add(new StringContent("verbose_json"), "response_format");

        var promptHint = $"Verbatim personal family memoir recording. Preserve speaker phrasing, names, places, addresses, and dates.{(string.IsNullOrWhiteSpace(spellingBlock) ? "" : " " + spellingBlock.Replace('\n', ' '))}";
        if (promptHint.Length > 800) promptHint = promptHint[..800];
        form.Add(new StringContent(promptHint), "prompt");

        var client = _httpFactory.CreateClient();
        using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.groq.com/openai/v1/audio/transcriptions")
        {
            Content = form,
        };
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

        var resp = await client.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new ApiErrorException((int)resp.StatusCode, $"Groq Whisper v3 Turbo error ({(int)resp.StatusCode}): {body}");
        }

        using var doc = JsonDocument.Parse(body);
        var text = doc.RootElement.TryGetProperty("text", out var t) ? (t.GetString() ?? "").Trim() : string.Empty;
        if (string.IsNullOrWhiteSpace(text))
        {
            throw new ApiErrorException(502, "Groq Whisper v3 Turbo returned an empty transcript.");
        }
        return text;
    }

    public async Task<(T Data, string ModelUsed)> CallGroqJsonAsync<T>(string prompt, string systemInstruction, T fallback, CancellationToken ct)
    {
        var apiKey = RequireGroqKey();
        var candidates = new[] { "qwen/qwen3.8-27b", "llama-3.1-8b-instant", "llama-3.3-70b-versatile" };

        async Task<(T Data, string ModelUsed)> AttemptAsync(string model, bool useJsonMode, string effort)
        {
            var payload = new JsonObject
            {
                ["model"] = model,
                ["messages"] = new JsonArray
                {
                    new JsonObject { ["role"] = "system", ["content"] = $"{systemInstruction}\nAlways output valid JSON only." },
                    new JsonObject { ["role"] = "user", ["content"] = prompt },
                },
                ["temperature"] = 0.6,
                ["max_completion_tokens"] = 2048,
                ["top_p"] = 0.95,
                ["stream"] = true,
                ["stop"] = null,
            };

            if (effort != "omit")
            {
                payload["reasoning_effort"] = effort;
            }
            if (useJsonMode)
            {
                payload["response_format"] = new JsonObject { ["type"] = "json_object" };
            }

            var client = _httpFactory.CreateClient();
            using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.groq.com/openai/v1/chat/completions")
            {
                Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json")
            };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!resp.IsSuccessStatusCode)
            {
                var errText = await resp.Content.ReadAsStringAsync(ct);
                if (resp.StatusCode == HttpStatusCode.BadRequest && effort == "none" && errText.Contains("reasoning", StringComparison.OrdinalIgnoreCase))
                {
                    return await AttemptAsync(model, useJsonMode, "default");
                }
                if (resp.StatusCode == HttpStatusCode.BadRequest && useJsonMode && errText.Contains("json", StringComparison.OrdinalIgnoreCase))
                {
                    return await AttemptAsync(model, false, effort);
                }
                throw new ApiErrorException((int)resp.StatusCode, $"Groq ({model}) error ({(int)resp.StatusCode}): {errText}");
            }

            using var stream = await resp.Content.ReadAsStreamAsync(ct);
            using var reader = new StreamReader(stream);
            var sb = new StringBuilder();
            while (!reader.EndOfStream)
            {
                var line = await reader.ReadLineAsync(ct);
                if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:", StringComparison.Ordinal))
                    continue;
                var dataPart = line[5..].Trim();
                if (dataPart == "[DONE]") break;

                try
                {
                    using var chunk = JsonDocument.Parse(dataPart);
                    if (chunk.RootElement.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0)
                    {
                        if (choices[0].TryGetProperty("delta", out var delta)
                            && delta.TryGetProperty("content", out var contentEl)
                            && contentEl.ValueKind == JsonValueKind.String)
                        {
                            sb.Append(contentEl.GetString());
                        }
                    }
                }
                catch
                {
                    // Skip partial SSE keepalive
                }
            }

            return (SafeParseModelJson(sb.ToString(), fallback), model);
        }

        Exception? lastErr = null;
        foreach (var model in candidates)
        {
            try
            {
                var effort = model.Contains("qwen", StringComparison.OrdinalIgnoreCase) ? "none" : "omit";
                return await AttemptAsync(model, true, effort);
            }
            catch (ApiErrorException ex) when (ex.StatusCode is 404 or 400 or 429 or 503)
            {
                lastErr = ex;
            }
        }

        throw lastErr ?? new ApiErrorException(502, "Groq text generation failed.");
    }

    public async Task<(string Transcript, string ProviderUsed, string? FallbackNotice)> TranscribeAudioAsync(
        string rawBase64,
        string mimeType,
        string preferredProvider,
        bool enableFallback,
        string spellingBlock,
        CancellationToken ct)
    {
        if (preferredProvider == "groq")
        {
            try
            {
                var text = await CallGroqWhisperAsync(rawBase64, mimeType, spellingBlock, ct);
                return (text, "groq-whisper-v3-turbo", null);
            }
            catch (Exception ex) when (enableFallback && IsGeminiConfigured)
            {
                var gem = await TranscribeWithGeminiAudioAsync(rawBase64, mimeType, "gemini-lite", true, spellingBlock, ct);
                return (gem.Transcript, gem.ModelUsed, $"Switched to {gem.ModelUsed} ({ex.Message})");
            }
        }

        try
        {
            var gem = await TranscribeWithGeminiAudioAsync(rawBase64, mimeType, preferredProvider, enableFallback, spellingBlock, ct);
            return (gem.Transcript, gem.ModelUsed, gem.FallbackNotice);
        }
        catch (Exception ex) when (enableFallback && IsGroqConfigured)
        {
            var text = await CallGroqWhisperAsync(rawBase64, mimeType, spellingBlock, ct);
            return (text, "groq-whisper-v3-turbo", $"Switched to Groq Whisper v3 Turbo ({ex.Message})");
        }
    }

    private async Task<(string Transcript, string ModelUsed, string? FallbackNotice)> TranscribeWithGeminiAudioAsync(
        string rawBase64,
        string mimeType,
        string preferredProvider,
        bool enableFallback,
        string spellingBlock,
        CancellationToken ct)
    {
        var promptText = $"Transcribe this spoken personal memory recording accurately into clean, readable paragraphs. Preserve the speaker’s authentic phrasing, names, places, addresses, expressions, and emotional cadence. Output only the verbatim transcript text.{(string.IsNullOrWhiteSpace(spellingBlock) ? "" : "\n\n" + spellingBlock)}";

        JsonObject BuildAudioReq(string _) => new()
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["parts"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["inlineData"] = new JsonObject
                            {
                                ["mimeType"] = mimeType,
                                ["data"] = rawBase64,
                            }
                        },
                        new JsonObject { ["text"] = promptText },
                    }
                }
            }
        };

        var apiKey = RequireGeminiKey();
        var client = _httpFactory.CreateClient();
        var audioModels = new[] { "gemini-3.5-transcribe", "gemini-3.1-flash-lite" };
        Exception? lastErr = null;

        for (var i = 0; i < audioModels.Length; i++)
        {
            var model = audioModels[i];
            try
            {
                var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={Uri.EscapeDataString(apiKey)}";
                using var req = new HttpRequestMessage(HttpMethod.Post, url)
                {
                    Content = new StringContent(BuildAudioReq(model).ToJsonString(), Encoding.UTF8, "application/json")
                };
                req.Headers.UserAgent.ParseAdd("aistudio-build");

                using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
                cts.CancelAfter(TimeSpan.FromSeconds(12));
                using var resp = await client.SendAsync(req, cts.Token);
                var json = await resp.Content.ReadAsStringAsync(ct);
                if (!resp.IsSuccessStatusCode)
                {
                    throw new ApiErrorException((int)resp.StatusCode, $"Gemini ({model}) audio error ({(int)resp.StatusCode}): {json}");
                }

                using var doc = JsonDocument.Parse(json);
                var sbText = new StringBuilder();
                if (doc.RootElement.TryGetProperty("candidates", out var candidates)
                    && candidates.GetArrayLength() > 0
                    && candidates[0].TryGetProperty("content", out var contentObj)
                    && contentObj.TryGetProperty("parts", out var parts))
                {
                    foreach (var part in parts.EnumerateArray())
                    {
                        if (part.TryGetProperty("text", out var tEl) && tEl.ValueKind == JsonValueKind.String)
                        {
                            sbText.Append(tEl.GetString());
                        }
                    }
                }
                var text = sbText.ToString().Trim();
                if (string.IsNullOrWhiteSpace(text))
                {
                    throw new ApiErrorException(502, "Audio transcription returned empty text.");
                }
                return (text, model, i > 0 ? $"Processed audio with fast fallback model {model}." : null);
            }
            catch (Exception ex)
            {
                lastErr = ex;
                if (!enableFallback && i == 0) break;
            }
        }

        if (enableFallback)
        {
            var res = await GenerateGeminiContentAsync(preferredProvider, enableFallback, BuildAudioReq, ct);
            if (!string.IsNullOrWhiteSpace(res.Text))
            {
                return (res.Text, res.ModelUsed, res.FallbackNotice);
            }
        }

        throw lastErr ?? new ApiErrorException(502, "Audio transcription failed.");
    }

    public async Task<(T Data, string ProviderUsed, string? FallbackNotice)> GenerateStructuredJsonAsync<T>(
        string prompt,
        string systemInstruction,
        string preferredProvider,
        bool enableFallback,
        JsonObject geminiSchema,
        T fallbackObj,
        CancellationToken ct)
    {
        async Task<(T Data, string ModelUsed, string? FallbackNotice)> RunGeminiAsync(string pref)
        {
            var res = await GenerateGeminiContentAsync(pref, enableFallback, _ => new JsonObject
            {
                ["systemInstruction"] = new JsonObject
                {
                    ["parts"] = new JsonArray { new JsonObject { ["text"] = systemInstruction } }
                },
                ["contents"] = new JsonArray
                {
                    new JsonObject { ["parts"] = new JsonArray { new JsonObject { ["text"] = prompt } } }
                },
                ["generationConfig"] = new JsonObject
                {
                    ["responseMimeType"] = "application/json",
                    ["responseSchema"] = JsonNode.Parse(geminiSchema.ToJsonString()),
                }
            }, ct);
            return (SafeParseModelJson(res.Text, fallbackObj), res.ModelUsed, res.FallbackNotice);
        }

        if (preferredProvider == "groq")
        {
            try
            {
                var groqRes = await CallGroqJsonAsync(prompt, systemInstruction, fallbackObj, ct);
                return (groqRes.Data, $"groq-{groqRes.ModelUsed}", null);
            }
            catch (Exception ex) when (enableFallback && IsGeminiConfigured)
            {
                var gem = await RunGeminiAsync("gemini-lite");
                return (gem.Data, gem.ModelUsed, $"Switched to {gem.ModelUsed} ({ex.Message})");
            }
        }

        try
        {
            var gem = await RunGeminiAsync(preferredProvider);
            return (gem.Data, gem.ModelUsed, gem.FallbackNotice);
        }
        catch (Exception ex) when (enableFallback && IsGroqConfigured)
        {
            var groqRes = await CallGroqJsonAsync(prompt, systemInstruction, fallbackObj, ct);
            return (groqRes.Data, $"groq-{groqRes.ModelUsed}", $"Switched to Groq {groqRes.ModelUsed} ({ex.Message})");
        }
    }

    public async Task<(T Data, string ModelUsed, string? FallbackNotice)> GenerateVisionJsonAsync<T>(
        string preferredProvider,
        bool enableFallback,
        string mimeType,
        string base64Image,
        string prompt,
        string systemInstruction,
        JsonObject geminiSchema,
        T fallbackObj,
        CancellationToken ct)
    {
        var res = await GenerateGeminiContentAsync(preferredProvider, enableFallback, _ => new JsonObject
        {
            ["systemInstruction"] = new JsonObject
            {
                ["parts"] = new JsonArray { new JsonObject { ["text"] = systemInstruction } }
            },
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["parts"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["inlineData"] = new JsonObject
                            {
                                ["mimeType"] = mimeType,
                                ["data"] = base64Image,
                            }
                        },
                        new JsonObject { ["text"] = prompt },
                    }
                }
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseMimeType"] = "application/json",
                ["responseSchema"] = JsonNode.Parse(geminiSchema.ToJsonString()),
            }
        }, ct);

        return (SafeParseModelJson(res.Text, fallbackObj), res.ModelUsed, res.FallbackNotice);
    }

    public async Task<string> NarrateChapterAsync(string? title, string body, CancellationToken ct)
    {
        var apiKey = RequireGeminiKey();
        var excerpt = $"{(string.IsNullOrWhiteSpace(title) ? "" : title + ". ")}{body}";
        if (excerpt.Length > 1800) excerpt = excerpt[..1800];

        var payload = new JsonObject
        {
            ["contents"] = new JsonArray
            {
                new JsonObject
                {
                    ["role"] = "user",
                    ["parts"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["text"] = excerpt,
                            ["speechMetadata"] = new JsonObject
                            {
                                ["style"] = "Warm, unhurried audiobook narrator reading a personal family memoir"
                            }
                        }
                    }
                }
            },
            ["generationConfig"] = new JsonObject
            {
                ["responseModalities"] = new JsonArray { "AUDIO" },
                ["speechConfig"] = new JsonObject
                {
                    ["voiceConfig"] = new JsonObject
                    {
                        ["prebuiltVoiceConfig"] = new JsonObject { ["voiceName"] = "Kore" }
                    }
                }
            }
        };

        var client = _httpFactory.CreateClient();
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent?key={Uri.EscapeDataString(apiKey)}";
        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json")
        };
        req.Headers.UserAgent.ParseAdd("aistudio-build");

        using var resp = await client.SendAsync(req, ct);
        var json = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
        {
            throw new ApiErrorException((int)resp.StatusCode, $"Narration failed ({(int)resp.StatusCode}): {json}");
        }

        using var doc = JsonDocument.Parse(json);
        string? audioBase64 = null;
        if (doc.RootElement.TryGetProperty("candidates", out var candidates)
            && candidates.GetArrayLength() > 0
            && candidates[0].TryGetProperty("content", out var contentObj)
            && contentObj.TryGetProperty("parts", out var parts))
        {
            foreach (var part in parts.EnumerateArray())
            {
                if (part.TryGetProperty("inlineData", out var inlineObj)
                    && inlineObj.TryGetProperty("data", out var dataEl)
                    && dataEl.ValueKind == JsonValueKind.String)
                {
                    audioBase64 = dataEl.GetString();
                    if (!string.IsNullOrWhiteSpace(audioBase64)) break;
                }
            }
        }

        if (string.IsNullOrWhiteSpace(audioBase64))
        {
            throw new ApiErrorException(502, "Narration audio was not returned.");
        }
        return audioBase64;
    }
}
