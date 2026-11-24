using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RememberPress.Api.Models;
using RememberPress.Api.Services;

namespace RememberPress.Api.Controllers;

[ApiController]
[Route("api")]
public sealed class BooksController : ControllerBase
{
    private readonly BookStoreService _store;

    public BooksController(BookStoreService store)
    {
        _store = store;
    }

    [HttpGet]
    public IActionResult Health() => Ok(new { ok = true, service = "remember-press-dotnet-api" });

    [HttpGet("book")]
    public async Task<ActionResult<BookWorkspaceData>> GetBook()
    {
        var book = await _store.WithStoreAsync(store =>
        {
            var resolved = _store.ResolveBook(store, Request);
            resolved.Chapters.Sort((a, b) => a.Order.CompareTo(b.Order));
            return resolved;
        });
        return Ok(book);
    }

    [HttpPost("books")]
    public async Task<ActionResult<BookWorkspaceData>> CreateBook([FromBody] CreateBookRequest req)
    {
        var bookMode = string.IsNullOrWhiteSpace(req.BookMode) ? "self" : req.BookMode;
        var cleanAuthor = string.IsNullOrWhiteSpace(req.AuthorName) ? "Our Storyteller" : req.AuthorName.Trim();
        var cleanOrganizer = bookMode == "self"
            ? cleanAuthor
            : string.IsNullOrWhiteSpace(req.OrganizerName) ? "Family Organizer" : req.OrganizerName.Trim();
        var firstName = cleanAuthor.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? cleanAuthor;
        var bookTitle = string.IsNullOrWhiteSpace(req.Title) ? $"{firstName}’s Stories" : req.Title.Trim();
        var subtitle = string.IsNullOrWhiteSpace(req.Subtitle) ? "Family Stories, Photographs & Memories" : req.Subtitle.Trim();
        var promptCadence = string.IsNullOrWhiteSpace(req.PromptCadence) ? "weekly" : req.PromptCadence;

        var inviteCode = $"MEM-{Convert.ToHexString(RandomNumberGenerator.GetBytes(2)).ToUpperInvariant()}";
        var bookId = $"book-{Guid.NewGuid():N}"[..13];
        var now = DateTime.UtcNow.ToString("O");
        var defaultProvider = AiProviderService.IsGroqConfigured ? "groq" : "gemini-lite";

        var freshPrompts = new List<GuidedPrompt>
        {
            new()
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = "Childhood & Early Days",
                Question = "Tell me about a home, porch, or street from childhood you still picture clearly.",
                MemoryTriggers = new List<string>
                {
                    "What time of day did you feel happiest there?",
                    "Who else was usually around, and what sound do you remember first?",
                },
                CoachingTip = "Speak as if showing a grandchild around that room for the first time.",
                EstimatedMinutes = 4,
                CreatedBy = cleanOrganizer,
                Cadence = promptCadence,
                Status = "inbox",
                CreatedAt = now,
            },
            new()
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = "Traditions & Table",
                Question = "What family meal, holiday, or Saturday routine always brought everyone to the table?",
                MemoryTriggers = new List<string>
                {
                    "What was cooking or sitting on the table?",
                    "Did someone always tell the same joke or make the same dish?",
                },
                CoachingTip = "Focus on one concrete gathering you still smile remembering.",
                EstimatedMinutes = 4,
                CreatedBy = cleanOrganizer,
                Cadence = promptCadence,
                Status = "inbox",
                CreatedAt = now,
            },
            new()
            {
                Id = $"prompt-{Guid.NewGuid():N}"[..15],
                Category = "Wisdom & Legacy",
                Question = "Looking back, what small decision ended up changing your life more than you expected?",
                MemoryTriggers = new List<string>
                {
                    "What made you hesitate or feel nervous right before choosing?",
                    "Who encouraged you to take that step?",
                },
                CoachingTip = "Share the turning point honestly—every detail helps family feel like they were there.",
                EstimatedMinutes = 5,
                CreatedBy = cleanOrganizer,
                Cadence = promptCadence,
                Status = "queued",
                CreatedAt = now,
            },
        };

        var collaborators = bookMode == "self"
            ? new List<Collaborator>
            {
                new() { Id = $"collab-{Guid.NewGuid():N}"[..13], Name = cleanAuthor, Role = "author", Relationship = "Author & Organizer", JoinedAt = now }
            }
            : new List<Collaborator>
            {
                new() { Id = $"collab-{Guid.NewGuid():N}"[..13], Name = cleanOrganizer, Role = "organizer", Relationship = "Book Organizer", JoinedAt = now },
                new() { Id = $"collab-{Guid.NewGuid():N}"[..13], Name = cleanAuthor, Role = "author", Relationship = "Storyteller", JoinedAt = now },
            };

        var newBook = new BookWorkspaceData
        {
            Settings = new BookSettings
            {
                Id = bookId,
                InviteCode = inviteCode,
                BookMode = bookMode,
                Title = bookTitle,
                Subtitle = subtitle,
                AuthorName = cleanAuthor,
                OrganizerName = cleanOrganizer,
                Dedication = $"Collected with love for the family of {cleanAuthor}.",
                AuthorPreviewEnabled = bookMode == "self",
                PromptCadence = promptCadence,
                PreferredAiProvider = defaultProvider,
                EnableProviderFallback = true,
                EditionYear = DateTime.UtcNow.Year.ToString(),
                FounderGuidePrompt = BookStoreService.DefaultFounderGuide,
            },
            Collaborators = collaborators,
            Prompts = freshPrompts,
        };

        await _store.WithStoreAsync(store =>
        {
            store.Books[bookId] = newBook;
            return true;
        }, persist: true);

        return StatusCode(201, newBook);
    }

    [HttpPost("books/join")]
    public async Task<IActionResult> JoinBook([FromBody] JoinBookRequest req)
    {
        var code = (req.InviteCode ?? string.Empty).Trim().ToUpperInvariant();
        if (string.IsNullOrWhiteSpace(code))
        {
            return BadRequest(new { error = "Enter a book invite code (for example, CEDAR-1974)." });
        }

        var (matched, found) = await _store.WithStoreAsync<(BookWorkspaceData? Book, bool Found)>(store =>
        {
            var book = store.Books.Values.FirstOrDefault(
                b => string.Equals(b.Settings.InviteCode, code, StringComparison.OrdinalIgnoreCase));
            if (book is null) return (null, false);

            var cleanName = string.IsNullOrWhiteSpace(req.MemberName) ? "Family Member" : req.MemberName.Trim();
            var exists = book.Collaborators.Any(c => string.Equals(c.Name, cleanName, StringComparison.OrdinalIgnoreCase));
            if (!exists)
            {
                book.Collaborators.Add(new Collaborator
                {
                    Id = $"collab-{Guid.NewGuid():N}"[..13],
                    Name = cleanName,
                    Role = string.IsNullOrWhiteSpace(req.Role) ? "collaborator" : req.Role,
                    Relationship = string.IsNullOrWhiteSpace(req.Relationship) ? "Family Collaborator" : req.Relationship,
                    JoinedAt = DateTime.UtcNow.ToString("O"),
                });
            }

            book.Chapters.Sort((a, b) => a.Order.CompareTo(b.Order));
            return (book, true);
        }, persist: true);

        if (!found || matched is null)
        {
            return NotFound(new { error = $"No active book matched code \"{code}\". Try CEDAR-1974 for the sample book or check your code." });
        }

        return Ok(matched);
    }

    [HttpPost("book/sync")]
    public async Task<IActionResult> SyncWorkspace([FromBody] BookWorkspaceData incoming)
    {
        if (incoming?.Settings is null || incoming.Chapters is null)
        {
            return BadRequest(new { error = "Invalid workspace snapshot." });
        }

        var normalized = await _store.WithStoreAsync(store =>
        {
            var clean = _store.NormalizeBook(incoming);
            store.Books[clean.Settings.Id] = clean;
            return clean;
        }, persist: true);

        return Ok(normalized);
    }

    [HttpPut("book/settings")]
    public async Task<ActionResult<BookSettings>> UpdateSettings([FromBody] JsonElement patch)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            book.Settings = BookStoreService.MergeJsonPatch(book.Settings, patch);
            return book.Settings;
        }, persist: true);

        return Ok(updated);
    }
}
