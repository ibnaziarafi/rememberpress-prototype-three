using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RememberPress.Api.Models;
using RememberPress.Api.Services;

namespace RememberPress.Api.Controllers;

[ApiController]
[Route("api/chapters")]
public sealed class ChaptersController : ControllerBase
{
    private readonly BookStoreService _store;

    public ChaptersController(BookStoreService store)
    {
        _store = store;
    }

    [HttpPost]
    public async Task<ActionResult<Chapter>> CreateChapter([FromBody] CreateChapterRequest req)
    {
        var created = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request, req.BookId);
            var nextOrder = book.Chapters.Count > 0 ? book.Chapters.Max(c => c.Order) + 1 : 1;
            var subtitle = req.Subtitle ?? string.Empty;

            var chapter = new Chapter
            {
                Id = $"chap-{Guid.NewGuid():N}"[..13],
                Order = nextOrder,
                Title = string.IsNullOrWhiteSpace(req.Title) ? $"Untitled Memory {nextOrder}" : req.Title,
                Subtitle = subtitle,
                PromptQuestion = req.PromptQuestion ?? string.Empty,
                Epigraph = req.Epigraph ?? string.Empty,
                PullQuote = req.PullQuote ?? string.Empty,
                Body = req.Body ?? string.Empty,
                Transcript = req.Transcript ?? string.Empty,
                AudioUrl = req.AudioUrl,
                VideoUrl = req.VideoUrl,
                AudioDurationSeconds = req.AudioDurationSeconds ?? 0,
                WritingTone = string.IsNullOrWhiteSpace(req.WritingTone) ? "Warm Memoir" : req.WritingTone,
                AiEditLevel = string.IsNullOrWhiteSpace(req.AiEditLevel) ? "balanced" : req.AiEditLevel,
                ToneStrength = string.IsNullOrWhiteSpace(req.ToneStrength) ? "slight" : req.ToneStrength,
                Perspective = string.IsNullOrWhiteSpace(req.Perspective) ? "first-person" : req.Perspective,
                LengthPreference = string.IsNullOrWhiteSpace(req.LengthPreference) ? "balanced" : req.LengthPreference,
                ProviderUsed = string.IsNullOrWhiteSpace(req.ProviderUsed) ? "gemini-lite" : req.ProviderUsed,
                IsPrivate = req.IsPrivate ?? false,
                EditingStatus = string.IsNullOrWhiteSpace(req.EditingStatus) ? "none" : req.EditingStatus,
                EditingNote = req.EditingNote ?? string.Empty,
                EraLabel = string.IsNullOrWhiteSpace(req.EraLabel) ? subtitle : req.EraLabel,
                FollowUpQuestions = req.FollowUpQuestions ?? new List<string>(),
                Comments = new List<ChapterComment>(),
                UpdatedAt = DateTime.UtcNow.ToString("O"),
            };

            book.Chapters.Add(chapter);
            if (!string.IsNullOrWhiteSpace(req.PromptId))
            {
                var prompt = book.Prompts.FirstOrDefault(p => p.Id == req.PromptId);
                if (prompt is not null)
                {
                    prompt.AnsweredChapterId = chapter.Id;
                    prompt.Status = "answered";
                }
            }

            return chapter;
        }, persist: true);

        return StatusCode(201, created);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateChapter(string id, [FromBody] JsonElement patch)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Chapters.FindIndex(c => c.Id == id);
            if (idx == -1) return (Chapter?)null;

            var merged = BookStoreService.MergeJsonPatch(book.Chapters[idx], patch);
            merged.Id = book.Chapters[idx].Id;
            merged.UpdatedAt = DateTime.UtcNow.ToString("O");
            book.Chapters[idx] = merged;
            return merged;
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Chapter not found." });
        return Ok(updated);
    }

    [HttpPost("{id}/comments")]
    public async Task<IActionResult> AddComment(string id, [FromBody] AddCommentRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Text))
        {
            return BadRequest(new { error = "Comment text is required." });
        }

        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Chapters.FindIndex(c => c.Id == id);
            if (idx == -1) return (Chapter?)null;

            book.Chapters[idx].Comments ??= new List<ChapterComment>();
            book.Chapters[idx].Comments.Add(new ChapterComment
            {
                Id = $"cmt-{Guid.NewGuid():N}"[..12],
                AuthorName = string.IsNullOrWhiteSpace(req.AuthorName) ? "Family Member" : req.AuthorName.Trim(),
                Relationship = string.IsNullOrWhiteSpace(req.Relationship) ? "Family" : req.Relationship.Trim(),
                Text = req.Text.Trim(),
                CreatedAt = DateTime.UtcNow.ToString("O"),
            });
            return book.Chapters[idx];
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Chapter not found." });
        return StatusCode(201, updated);
    }

    [HttpPost("{id}/request-editing")]
    public async Task<IActionResult> RequestEditing(string id, [FromBody] RequestEditingRequest req)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Chapters.FindIndex(c => c.Id == id);
            if (idx == -1) return (Chapter?)null;

            book.Chapters[idx].EditingStatus = string.IsNullOrWhiteSpace(req.Status) ? "requested" : req.Status;
            book.Chapters[idx].EditingNote = req.Note ?? string.Empty;
            book.Chapters[idx].UpdatedAt = DateTime.UtcNow.ToString("O");
            return book.Chapters[idx];
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Chapter not found." });
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteChapter(string id)
    {
        var remaining = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            book.Chapters = book.Chapters.Where(c => c.Id != id).ToList();
            for (var i = 0; i < book.Chapters.Count; i++)
            {
                book.Chapters[i].Order = i + 1;
            }
            foreach (var p in book.Photos.Where(p => p.ChapterId == id))
            {
                p.ChapterId = null;
            }
            foreach (var pr in book.Prompts.Where(p => p.AnsweredChapterId == id))
            {
                pr.AnsweredChapterId = null;
                pr.Status = "inbox";
            }
            return book.Chapters;
        }, persist: true);

        return Ok(new { ok = true, chapters = remaining });
    }

    [HttpPost("reorder")]
    public async Task<IActionResult> ReorderChapters([FromBody] ReorderChaptersRequest req)
    {
        if (req.OrderedIds is null)
        {
            return BadRequest(new { error = "orderedIds array is required." });
        }

        var reordered = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var map = book.Chapters.ToDictionary(c => c.Id);
            var list = new List<Chapter>();

            foreach (var id in req.OrderedIds)
            {
                if (map.TryGetValue(id, out var ch))
                {
                    ch.Order = list.Count + 1;
                    list.Add(ch);
                    map.Remove(id);
                }
            }
            foreach (var leftover in map.Values)
            {
                leftover.Order = list.Count + 1;
                list.Add(leftover);
            }

            book.Chapters = list;
            return book.Chapters;
        }, persist: true);

        return Ok(reordered);
    }
}
