using System.Text.Json.Serialization;

namespace RememberPress.Api.Models;

public sealed class MultiBookStore
{
    public string DefaultBookId { get; set; } = "book-cedar-cove";
    public Dictionary<string, BookWorkspaceData> Books { get; set; } = new();
}

public sealed class BookWorkspaceData
{
    public BookSettings Settings { get; set; } = new();
    public List<Collaborator> Collaborators { get; set; } = new();
    public List<Chapter> Chapters { get; set; } = new();
    public List<MemoryPhoto> Photos { get; set; } = new();
    public List<GuidedPrompt> Prompts { get; set; } = new();
}

public sealed class SpellingCorrection
{
    public string Id { get; set; } = string.Empty;
    public string Category { get; set; } = "name";
    public string Wrong { get; set; } = string.Empty;
    public string Correct { get; set; } = string.Empty;
}

public sealed class Collaborator
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Role { get; set; } = "collaborator";
    public string Relationship { get; set; } = string.Empty;
    public string JoinedAt { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class BookSettings
{
    public string Id { get; set; } = "book-cedar-cove";
    public string InviteCode { get; set; } = "CEDAR-1974";
    public string BookMode { get; set; } = "gift";
    public string Title { get; set; } = "The Years Between";
    public string Subtitle { get; set; } = "Stories of Cedar Cove, Family Tables & Second Acts";
    public string AuthorName { get; set; } = "Clara Vance";
    public string OrganizerName { get; set; } = "Maya Vance";
    public string Dedication { get; set; } = string.Empty;
    public string CoverTheme { get; set; } = "linen-forest";
    public string CoverImageUrl { get; set; } = "/src/assets/images/sample_book_cover_1794804939349.jpg";
    public string TrimSize { get; set; } = "6x9";
    public string InteriorColorMode { get; set; } = "color";
    public string FontScale { get; set; } = "classic";
    public bool IncludeQrAudioArchive { get; set; } = true;
    public bool IncludeDropCaps { get; set; } = true;
    public string EditionYear { get; set; } = "2026";
    public bool AuthorPreviewEnabled { get; set; } = true;
    public string PromptCadence { get; set; } = "weekly";
    public string PreferredAiProvider { get; set; } = "groq";
    public bool EnableProviderFallback { get; set; } = true;
    public string FounderGuidePrompt { get; set; } = string.Empty;
    public List<SpellingCorrection> SpellingGlossary { get; set; } = new();
}

public sealed class MemoryPhoto
{
    public string Id { get; set; } = string.Empty;
    public string? ChapterId { get; set; }
    public string ImageUrl { get; set; } = string.Empty;
    public string Caption { get; set; } = string.Empty;
    public string StoryNarrative { get; set; } = string.Empty;
    public string MemoryHint { get; set; } = string.Empty;
    public string YearLabel { get; set; } = string.Empty;
    public string LocationLabel { get; set; } = string.Empty;
    public string Placement { get; set; } = "framed-figure";
    public List<string> FollowUpQuestions { get; set; } = new();
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class ChapterComment
{
    public string Id { get; set; } = string.Empty;
    public string AuthorName { get; set; } = string.Empty;
    public string Relationship { get; set; } = string.Empty;
    public string Text { get; set; } = string.Empty;
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class Chapter
{
    public string Id { get; set; } = string.Empty;
    public int Order { get; set; } = 1;
    public string Title { get; set; } = string.Empty;
    public string Subtitle { get; set; } = string.Empty;
    public string PromptQuestion { get; set; } = string.Empty;
    public string Epigraph { get; set; } = string.Empty;
    public string PullQuote { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string Transcript { get; set; } = string.Empty;
    public string? AudioUrl { get; set; }
    public string? VideoUrl { get; set; }
    public int AudioDurationSeconds { get; set; }
    public string WritingTone { get; set; } = "Warm Memoir";
    public string AiEditLevel { get; set; } = "balanced";
    public string ToneStrength { get; set; } = "slight";
    public string Perspective { get; set; } = "first-person";
    public string LengthPreference { get; set; } = "balanced";
    public string? ProviderUsed { get; set; }
    public bool IsPrivate { get; set; }
    public string EditingStatus { get; set; } = "none";
    public string EditingNote { get; set; } = string.Empty;
    public string EraLabel { get; set; } = string.Empty;
    public List<string> FollowUpQuestions { get; set; } = new();
    public List<ChapterComment> Comments { get; set; } = new();
    public string UpdatedAt { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class GuidedPrompt
{
    public string Id { get; set; } = string.Empty;
    public string Category { get; set; } = "Family & Roots";
    public string Question { get; set; } = string.Empty;
    public List<string> MemoryTriggers { get; set; } = new();
    public string CoachingTip { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; } = 4;
    public bool IsCustom { get; set; }
    public string CreatedBy { get; set; } = "Family Organizer";
    public string Cadence { get; set; } = "weekly";
    public string Status { get; set; } = "inbox";
    public string? PhotoUrl { get; set; }
    public string? VoicePromptUrl { get; set; }
    public int? VoicePromptDurationSeconds { get; set; }
    public int Votes { get; set; }
    public List<string> VotedBy { get; set; } = new();
    public string? AnsweredChapterId { get; set; }
    public string CreatedAt { get; set; } = DateTime.UtcNow.ToString("O");
}

public sealed class CreateBookRequest
{
    public string? BookMode { get; set; }
    public string? Title { get; set; }
    public string? Subtitle { get; set; }
    public string? AuthorName { get; set; }
    public string? OrganizerName { get; set; }
    public string? PromptCadence { get; set; }
}

public sealed class JoinBookRequest
{
    public string? InviteCode { get; set; }
    public string? MemberName { get; set; }
    public string? Role { get; set; }
    public string? Relationship { get; set; }
}

public sealed class CreateChapterRequest
{
    public string? BookId { get; set; }
    public string? Title { get; set; }
    public string? Subtitle { get; set; }
    public string? PromptQuestion { get; set; }
    public string? Epigraph { get; set; }
    public string? PullQuote { get; set; }
    public string? Body { get; set; }
    public string? Transcript { get; set; }
    public string? AudioUrl { get; set; }
    public string? VideoUrl { get; set; }
    public int? AudioDurationSeconds { get; set; }
    public string? WritingTone { get; set; }
    public string? AiEditLevel { get; set; }
    public string? ToneStrength { get; set; }
    public string? Perspective { get; set; }
    public string? LengthPreference { get; set; }
    public string? ProviderUsed { get; set; }
    public bool? IsPrivate { get; set; }
    public string? EditingStatus { get; set; }
    public string? EditingNote { get; set; }
    public string? EraLabel { get; set; }
    public List<string>? FollowUpQuestions { get; set; }
    public string? PromptId { get; set; }
}

public sealed class AddCommentRequest
{
    public string? AuthorName { get; set; }
    public string? Relationship { get; set; }
    public string? Text { get; set; }
}

public sealed class VotePromptRequest
{
    public string? MemberName { get; set; }
}

public sealed class RequestEditingRequest
{
    public string? Note { get; set; }
    public string? Status { get; set; }
}

public sealed class ReorderChaptersRequest
{
    public List<string>? OrderedIds { get; set; }
}

public sealed class CreatePhotoRequest
{
    public string? ImageBase64 { get; set; }
    public string? MimeType { get; set; }
    public string? ImageUrl { get; set; }
    public string? ChapterId { get; set; }
    public string? Caption { get; set; }
    public string? StoryNarrative { get; set; }
    public string? MemoryHint { get; set; }
    public string? YearLabel { get; set; }
    public string? LocationLabel { get; set; }
    public string? Placement { get; set; }
    public List<string>? FollowUpQuestions { get; set; }
}

public sealed class CreateCollaboratorPromptRequest
{
    public string? Category { get; set; }
    public string? Question { get; set; }
    public List<string>? MemoryTriggers { get; set; }
    public string? CoachingTip { get; set; }
    public int? EstimatedMinutes { get; set; }
    public string? CreatedBy { get; set; }
    public string? Cadence { get; set; }
    public string? Status { get; set; }
    public string? PhotoBase64 { get; set; }
    public string? PhotoMimeType { get; set; }
    public string? VoicePromptBase64 { get; set; }
    public string? VoicePromptMimeType { get; set; }
    public int? VoicePromptDurationSeconds { get; set; }
}

public sealed class CreateCustomPromptRequest
{
    public string? Category { get; set; }
    public string? Question { get; set; }
    public List<string>? MemoryTriggers { get; set; }
    public string? CoachingTip { get; set; }
    public int? EstimatedMinutes { get; set; }
    public string? CreatedBy { get; set; }
    public string? Cadence { get; set; }
}

public sealed class SpellingHintsInput
{
    public string? Names { get; set; }
    public string? Places { get; set; }
    public string? Addresses { get; set; }
}

public sealed class TranscribeAndDraftRequest
{
    public string? AudioBase64 { get; set; }
    public string? MimeType { get; set; }
    public string? TranscriptOverride { get; set; }
    public string? PromptQuestion { get; set; }
    public string? StorytellerName { get; set; }
    public string? WritingTone { get; set; }
    public string? AiEditLevel { get; set; }
    public string? ToneStrength { get; set; }
    public string? Perspective { get; set; }
    public string? LengthPreference { get; set; }
    public string? PreferredProvider { get; set; }
    public string? MemoryNotes { get; set; }
    public SpellingHintsInput? SpellingHints { get; set; }
}

public sealed class RewriteMemoryRequest
{
    public string? Transcript { get; set; }
    public string? CurrentTitle { get; set; }
    public string? CurrentSubtitle { get; set; }
    public string? WritingTone { get; set; }
    public string? AiEditLevel { get; set; }
    public string? ToneStrength { get; set; }
    public string? Perspective { get; set; }
    public string? LengthPreference { get; set; }
    public string? StorytellerName { get; set; }
    public string? PreferredProvider { get; set; }
}

public sealed class RefineChapterRequest
{
    public string? Title { get; set; }
    public string? Body { get; set; }
    public string? Transcript { get; set; }
    public string? Instruction { get; set; }
}

public sealed class PhotoRequest
{
    public string? ImageBase64 { get; set; }
    public string? MimeType { get; set; }
    public string? MemoryHint { get; set; }
    public string? ChapterContext { get; set; }
}

public sealed class PhotoExplanationStoryRequest
{
    public string? ImageBase64 { get; set; }
    public string? MimeType { get; set; }
    public string? AudioBase64 { get; set; }
    public string? AudioMimeType { get; set; }
    public string? WrittenExplanation { get; set; }
    public List<string>? AskedQuestions { get; set; }
    public string? StorytellerName { get; set; }
    public string? MemoryHint { get; set; }
    public string? WritingTone { get; set; }
    public string? AiEditLevel { get; set; }
    public string? ToneStrength { get; set; }
    public string? PreferredProvider { get; set; }
    public SpellingHintsInput? SpellingHints { get; set; }
}

public sealed class GuidedPromptsRequest
{
    public string? Category { get; set; }
    public string? LifeContext { get; set; }
    public List<string>? ExistingTitles { get; set; }
    public string? CreatedBy { get; set; }
    public string? Cadence { get; set; }
    public string? Status { get; set; }
}

public sealed class NarrateChapterRequest
{
    public string? Title { get; set; }
    public string? Body { get; set; }
}

public sealed class ChapterDraftPayload
{
    public string Title { get; set; } = "Untitled Memory";
    public string Subtitle { get; set; } = string.Empty;
    public string EraLabel { get; set; } = string.Empty;
    public string Epigraph { get; set; } = string.Empty;
    public string PullQuote { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public List<string> FollowUpQuestions { get; set; } = new();
}

public sealed class RewriteDraftPayload
{
    public string Title { get; set; } = "Untitled Memory";
    public string Subtitle { get; set; } = string.Empty;
    public string Epigraph { get; set; } = string.Empty;
    public string PullQuote { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
}

public sealed class SequenceResultPayload
{
    public List<string> OrderedIds { get; set; } = new();
    public string Rationale { get; set; } = string.Empty;
}

public sealed class RefineResultPayload
{
    public string Title { get; set; } = string.Empty;
    public string PullQuote { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
}

public sealed class DescribePhotoPayload
{
    public string Caption { get; set; } = string.Empty;
    public string StoryNarrative { get; set; } = string.Empty;
    public string YearLabel { get; set; } = string.Empty;
    public List<string> MemoryQuestions { get; set; } = new();
}

public sealed class PhotoQuestionsPayload
{
    public string ObservationLead { get; set; } = string.Empty;
    public List<string> Questions { get; set; } = new();
}

public sealed class PhotoExplanationPayload
{
    public string Caption { get; set; } = string.Empty;
    public string StoryNarrative { get; set; } = string.Empty;
    public string YearLabel { get; set; } = string.Empty;
    public string ChapterTitle { get; set; } = "A Moment Remembered";
    public string ChapterSubtitle { get; set; } = string.Empty;
    public List<string> MemoryQuestions { get; set; } = new();
}

public sealed class GeneratedPromptsPayload
{
    public List<GeneratedPromptItem> Prompts { get; set; } = new();
}

public sealed class GeneratedPromptItem
{
    public string Question { get; set; } = string.Empty;
    public List<string> MemoryTriggers { get; set; } = new();
    public string CoachingTip { get; set; } = string.Empty;
    public int EstimatedMinutes { get; set; } = 4;
}

public sealed class ApiErrorException : Exception
{
    public int StatusCode { get; }

    public ApiErrorException(int statusCode, string message) : base(message)
    {
        StatusCode = statusCode;
    }
}
