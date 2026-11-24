using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RememberPress.Api.Models;
using RememberPress.Api.Services;

namespace RememberPress.Api.Controllers;

[ApiController]
[Route("api/prompts")]
public sealed class PromptsController : ControllerBase
{
    private readonly BookStoreService _store;

    public PromptsController(BookStoreService store)
    {
        _store = store;
    }

    [HttpPost("collaborator")]
    public async Task<IActionResult> CreateCollaboratorPrompt([FromBody] CreateCollaboratorPromptRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Question)
            && string.IsNullOrWhiteSpace(req.VoicePromptBase64)
            && string.IsNullOrWhiteSpace(req.PhotoBase64))
        {
            return BadRequest(new { error = "Enter a question, record a voice prompt, or attach a photo." });
        }

        var savedPhotoUrl = !string.IsNullOrWhiteSpace(req.PhotoBase64)
            ? _store.SaveBase64Media(req.PhotoBase64, req.PhotoMimeType ?? "image/jpeg", "prompt-photo")
            : null;
        var savedVoiceUrl = !string.IsNullOrWhiteSpace(req.VoicePromptBase64)
            ? _store.SaveBase64Media(req.VoicePromptBase64, req.VoicePromptMimeType ?? "audio/webm", "prompt-voice")
            : null;

        var created = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var prompt = new GuidedPrompt
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = string.IsNullOrWhiteSpace(req.Category) ? "Family & Roots" : req.Category,
                Question = !string.IsNullOrWhiteSpace(req.Question)
                    ? req.Question.Trim()
                    : savedPhotoUrl is not null
                        ? "What does this photograph help you remember?"
                        : "Listen to this family voice prompt and share whatever memory comes to mind.",
                MemoryTriggers = (req.MemoryTriggers ?? new List<string>()).Where(t => !string.IsNullOrWhiteSpace(t)).ToList(),
                CoachingTip = string.IsNullOrWhiteSpace(req.CoachingTip)
                    ? "Speak naturally about one real moment—who was there, what you noticed, and why it mattered."
                    : req.CoachingTip,
                EstimatedMinutes = req.EstimatedMinutes ?? 4,
                IsCustom = true,
                CreatedBy = string.IsNullOrWhiteSpace(req.CreatedBy)
                    ? (string.IsNullOrWhiteSpace(book.Settings.OrganizerName) ? "Family Collaborator" : book.Settings.OrganizerName)
                    : req.CreatedBy,
                Cadence = string.IsNullOrWhiteSpace(req.Cadence) ? book.Settings.PromptCadence : req.Cadence,
                Status = string.IsNullOrWhiteSpace(req.Status) ? "inbox" : req.Status,
                PhotoUrl = savedPhotoUrl,
                VoicePromptUrl = savedVoiceUrl,
                VoicePromptDurationSeconds = req.VoicePromptDurationSeconds ?? 0,
                CreatedAt = DateTime.UtcNow.ToString("O"),
            };

            book.Prompts.Insert(0, prompt);
            return prompt;
        }, persist: true);

        return StatusCode(201, created);
    }

    [HttpPost("custom")]
    public async Task<IActionResult> CreateCustomPrompt([FromBody] CreateCustomPromptRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Question))
        {
            return BadRequest(new { error = "Question text is required." });
        }

        var created = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var prompt = new GuidedPrompt
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = string.IsNullOrWhiteSpace(req.Category) ? "Childhood & Early Days" : req.Category,
                Question = req.Question.Trim(),
                MemoryTriggers = req.MemoryTriggers is { Count: > 0 }
                    ? req.MemoryTriggers
                    : new List<string>
                    {
                        "Close your eyes and place yourself in the room or street where this happened.",
                        "Start with the people present and what time of day it was.",
                    },
                CoachingTip = string.IsNullOrWhiteSpace(req.CoachingTip)
                    ? "Speak naturally about one concrete scene, smell, or conversation you still remember."
                    : req.CoachingTip,
                EstimatedMinutes = req.EstimatedMinutes ?? 4,
                IsCustom = true,
                CreatedBy = string.IsNullOrWhiteSpace(req.CreatedBy) ? book.Settings.OrganizerName : req.CreatedBy,
                Cadence = string.IsNullOrWhiteSpace(req.Cadence) ? book.Settings.PromptCadence : req.Cadence,
                Status = "inbox",
                CreatedAt = DateTime.UtcNow.ToString("O"),
            };
            book.Prompts.Insert(0, prompt);
            return prompt;
        }, persist: true);

        return StatusCode(201, created);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdatePrompt(string id, [FromBody] JsonElement patch)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Prompts.FindIndex(p => p.Id == id);
            if (idx == -1) return (GuidedPrompt?)null;

            var merged = BookStoreService.MergeJsonPatch(book.Prompts[idx], patch);
            merged.Id = book.Prompts[idx].Id;
            book.Prompts[idx] = merged;
            return merged;
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Prompt not found." });
        return Ok(updated);
    }

    [HttpPost("{id}/vote")]
    public async Task<IActionResult> VotePrompt(string id, [FromBody] VotePromptRequest req)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Prompts.FindIndex(p => p.Id == id);
            if (idx == -1) return (GuidedPrompt?)null;

            var voter = string.IsNullOrWhiteSpace(req.MemberName) ? "Family Member" : req.MemberName.Trim();
            var prompt = book.Prompts[idx];
            prompt.VotedBy ??= new List<string>();
            var existingIdx = prompt.VotedBy.FindIndex(v => string.Equals(v, voter, StringComparison.OrdinalIgnoreCase));
            if (existingIdx >= 0)
            {
                prompt.VotedBy.RemoveAt(existingIdx);
            }
            else
            {
                prompt.VotedBy.Add(voter);
            }
            prompt.Votes = prompt.VotedBy.Count;
            return prompt;
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Prompt not found." });
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeletePrompt(string id)
    {
        await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            book.Prompts = book.Prompts.Where(p => p.Id != id).ToList();
            return true;
        }, persist: true);

        return Ok(new { ok = true });
    }
}
