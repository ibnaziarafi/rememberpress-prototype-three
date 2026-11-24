using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using RememberPress.Api.Models;
using RememberPress.Api.Services;

namespace RememberPress.Api.Controllers;

[ApiController]
[Route("api/photos")]
public sealed class PhotosController : ControllerBase
{
    private readonly BookStoreService _store;

    public PhotosController(BookStoreService store)
    {
        _store = store;
    }

    [HttpPost]
    public async Task<IActionResult> CreatePhoto([FromBody] CreatePhotoRequest req)
    {
        var finalUrl = req.ImageUrl ?? string.Empty;
        if (!string.IsNullOrWhiteSpace(req.ImageBase64))
        {
            finalUrl = _store.SaveBase64Media(req.ImageBase64, req.MimeType ?? "image/jpeg", "photo");
        }
        if (string.IsNullOrWhiteSpace(finalUrl))
        {
            return BadRequest(new { error = "An image file or URL is required." });
        }

        var created = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var photo = new MemoryPhoto
            {
                Id = $"photo-{Guid.NewGuid():N}"[..14],
                ChapterId = req.ChapterId,
                ImageUrl = finalUrl,
                Caption = req.Caption ?? string.Empty,
                StoryNarrative = req.StoryNarrative ?? string.Empty,
                MemoryHint = req.MemoryHint ?? string.Empty,
                YearLabel = req.YearLabel ?? string.Empty,
                LocationLabel = req.LocationLabel ?? string.Empty,
                Placement = string.IsNullOrWhiteSpace(req.Placement) ? "framed-figure" : req.Placement,
                FollowUpQuestions = req.FollowUpQuestions ?? new List<string>(),
                CreatedAt = DateTime.UtcNow.ToString("O"),
            };
            book.Photos.Insert(0, photo);
            return photo;
        }, persist: true);

        return StatusCode(201, created);
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdatePhoto(string id, [FromBody] JsonElement patch)
    {
        var updated = await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            var idx = book.Photos.FindIndex(p => p.Id == id);
            if (idx == -1) return (MemoryPhoto?)null;

            var merged = BookStoreService.MergeJsonPatch(book.Photos[idx], patch);
            merged.Id = book.Photos[idx].Id;
            book.Photos[idx] = merged;
            return merged;
        }, persist: true);

        if (updated is null) return NotFound(new { error = "Photo not found." });
        return Ok(updated);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeletePhoto(string id)
    {
        await _store.WithStoreAsync(store =>
        {
            var book = _store.ResolveBook(store, Request);
            book.Photos = book.Photos.Where(p => p.Id != id).ToList();
            return true;
        }, persist: true);

        return Ok(new { ok = true });
    }
}
