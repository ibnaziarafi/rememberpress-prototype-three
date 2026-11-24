import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit3,
  Heart,
  Loader2,
  Lock,
  MessageCircle,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Unlock,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AiEditLevel,
  BookSettings,
  BookWorkspaceData,
  Chapter,
  CorrectionCategory,
  NarrativePerspective,
  SequenceBookResponse,
  SpellingCorrection,
  StoryLength,
  ToneStrength,
  UserRole,
  WritingTone,
} from '../types';
import { parseJsonResponse, withBookId } from '../utils/api';
import { applyGlossaryToFields } from '../utils/spelling';
import { ResilientImage } from './ResilientImage';

interface StoriesReviewViewProps {
  workspace: BookWorkspaceData;
  activeRole: UserRole;
  currentMemberName?: string;
  initialChapterId: string | null;
  onChaptersUpdated: (chapters: Chapter[]) => void;
  onSettingsUpdated?: (settings: BookSettings) => void;
  onOpenPreview?: (chapterId: string) => void;
}

const AI_LEVELS: Array<{ id: AiEditLevel; label: string }> = [
  { id: 'raw', label: 'Raw' },
  { id: 'light', label: 'Light' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'full', label: 'Full Rewrite' },
];

const WRITING_TONES: WritingTone[] = [
  'Warm Memoir',
  'Preserve Spoken Voice',
  'Crisp Literary',
  'Legacy Biography',
];

const PERSPECTIVES: Array<{
  id: NarrativePerspective;
  label: string;
  description: string;
}> = [
  {
    id: 'first-person',
    label: 'First person',
    description: 'Retells the memory in the storyteller’s own “I” voice with gentle narrative flow.',
  },
  {
    id: 'third-person',
    label: 'Third person',
    description: 'Presents the memory as a timeless biographical chapter written about them.',
  },
  {
    id: 'verbatim',
    label: 'Cleaned transcript',
    description: 'The original transcription, with words like “um” and “ah” removed.',
  },
];

const LENGTH_OPTIONS: Array<{ id: StoryLength; label: string }> = [
  { id: 'concise', label: 'Concise' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'detailed', label: 'Detailed' },
];

function formatDateShort(iso?: string): string {
  if (!iso) return 'Recently';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StoriesReviewView({
  workspace,
  activeRole,
  currentMemberName,
  initialChapterId,
  onChaptersUpdated,
  onSettingsUpdated,
  onOpenPreview,
}: StoriesReviewViewProps) {
  const { chapters, settings, photos } = workspace;
  const bookId = settings.id;
  const isStoryteller = activeRole === 'author';
  const showAutoSequence = activeRole === 'organizer' || settings.bookMode === 'self';
  const canSeePreviewButton =
    Boolean(onOpenPreview) &&
    (!isStoryteller || settings.bookMode === 'self' || settings.authorPreviewEnabled);

  const [selectedId, setSelectedId] = useState<string>(
    initialChapterId || chapters[0]?.id || ''
  );
  const selectedChapter = chapters.find((c) => c.id === selectedId) || chapters[0] || null;
  const chapterPhoto = selectedChapter
    ? photos.find((p) => p.chapterId === selectedChapter.id) || null
    : null;

  // Story reader vs edit mode + Writing assistant overlay (Screenshots 2, 5, 18)
  const [isEditing, setIsEditing] = useState(false);
  const [showHighlights, setShowHighlights] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);

  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [eraLabel, setEraLabel] = useState('');
  const [pullQuote, setPullQuote] = useState('');
  const [body, setBody] = useState('');
  const [transcript, setTranscript] = useState('');
  const [aiEditLevel, setAiEditLevel] = useState<AiEditLevel>('balanced');
  const [toneStrength, setToneStrength] = useState<ToneStrength>('slight');
  const [writingTone, setWritingTone] = useState<WritingTone>('Warm Memoir');
  const [perspective, setPerspective] = useState<NarrativePerspective>('first-person');
  const [lengthPreference, setLengthPreference] = useState<StoryLength>('balanced');
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingNote, setEditingNote] = useState('');

  // Staging controls inside Writing Assistant sheet
  const [draftPerspective, setDraftPerspective] = useState<NarrativePerspective>('first-person');
  const [draftLength, setDraftLength] = useState<StoryLength>('balanced');
  const [draftAiLevel, setDraftAiLevel] = useState<AiEditLevel>('balanced');
  const [draftTone, setDraftTone] = useState<WritingTone>('Warm Memoir');
  const [draftStrength, setDraftStrength] = useState<ToneStrength>('slight');

  const [commentAuthor, setCommentAuthor] = useState(
    currentMemberName || (isStoryteller ? settings.authorName : settings.organizerName) || ''
  );
  const [commentRelationship, setCommentRelationship] = useState(
    isStoryteller ? 'Storyteller' : 'Family'
  );
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const [fixCategory, setFixCategory] = useState<CorrectionCategory>('name');
  const [fixWrong, setFixWrong] = useState('');
  const [fixCorrect, setFixCorrect] = useState('');
  const [rememberFix, setRememberFix] = useState(true);
  const [fixFeedback, setFixFeedback] = useState<string | null>(null);

  const [reshaping, setReshaping] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [sequencing, setSequencing] = useState(false);
  const [sequenceRationale, setSequenceRationale] = useState<string | null>(null);
  const [requestingEdit, setRequestingEdit] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialChapterId && chapters.some((c) => c.id === initialChapterId)) {
      setSelectedId(initialChapterId);
    }
  }, [initialChapterId, chapters]);

  useEffect(() => {
    if (selectedChapter) {
      setTitle(selectedChapter.title);
      setSubtitle(selectedChapter.subtitle);
      setEraLabel(selectedChapter.eraLabel || '');
      setPullQuote(selectedChapter.pullQuote || '');
      setBody(selectedChapter.body);
      setTranscript(selectedChapter.transcript || '');
      setAiEditLevel(selectedChapter.aiEditLevel || 'balanced');
      setToneStrength(selectedChapter.toneStrength || 'slight');
      setWritingTone(selectedChapter.writingTone || 'Warm Memoir');
      setPerspective(selectedChapter.perspective || 'first-person');
      setLengthPreference(selectedChapter.lengthPreference || 'balanced');
      setIsPrivate(Boolean(selectedChapter.isPrivate));
      setEditingNote(selectedChapter.editingNote || '');
      setIsEditing(false);
      setAssistantOpen(false);
      setShowHighlights(false);
      setErrorMsg(null);
      setSavedFlag(false);
    }
  }, [selectedChapter?.id]);

  function openWritingAssistant() {
    setDraftPerspective(perspective);
    setDraftLength(lengthPreference);
    setDraftAiLevel(aiEditLevel);
    setDraftTone(writingTone);
    setDraftStrength(toneStrength);
    setAssistantOpen(true);
  }

  async function handleSaveChapter(override?: Partial<Chapter>) {
    if (!selectedChapter) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId(`/api/chapters/${selectedChapter.id}`, bookId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: override?.title ?? title,
          subtitle: override?.subtitle ?? subtitle,
          eraLabel: override?.eraLabel ?? eraLabel,
          pullQuote: override?.pullQuote ?? pullQuote,
          body: override?.body ?? body,
          transcript: override?.transcript ?? transcript,
          aiEditLevel: override?.aiEditLevel ?? aiEditLevel,
          toneStrength: override?.toneStrength ?? toneStrength,
          writingTone: override?.writingTone ?? writingTone,
          perspective: override?.perspective ?? perspective,
          lengthPreference: override?.lengthPreference ?? lengthPreference,
          isPrivate: override?.isPrivate ?? isPrivate,
        }),
      });
      const updated = await parseJsonResponse<Chapter>(res, 'Could not save chapter changes');
      onChaptersUpdated(chapters.map((c) => (c.id === updated.id ? updated : c)));
      setSavedFlag(true);
      window.setTimeout(() => setSavedFlag(false), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateAssistantPreview() {
    if (!selectedChapter) return;
    const sourceText = transcript.trim() || body.trim();
    if (!sourceText) return;

    const effectiveLevel: AiEditLevel =
      draftPerspective === 'verbatim' && draftAiLevel === 'balanced' ? 'light' : draftAiLevel;

    setAiEditLevel(effectiveLevel);
    setToneStrength(draftStrength);
    setWritingTone(draftTone);
    setPerspective(draftPerspective);
    setLengthPreference(draftLength);
    setReshaping(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId('/api/ai/rewrite-memory', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: sourceText,
          currentTitle: title,
          currentSubtitle: subtitle,
          aiEditLevel: effectiveLevel,
          toneStrength: draftStrength,
          writingTone: draftTone,
          perspective: draftPerspective,
          lengthPreference: draftLength,
          storytellerName: settings.authorName,
        }),
      });
      const data = await parseJsonResponse<{
        title: string;
        subtitle: string;
        pullQuote: string;
        body: string;
      }>(res, 'Could not reshape story');

      setTitle(data.title || title);
      setSubtitle(data.subtitle || subtitle);
      setPullQuote(data.pullQuote || pullQuote);
      setBody(data.body);

      await handleSaveChapter({
        title: data.title || title,
        subtitle: data.subtitle || subtitle,
        pullQuote: data.pullQuote || pullQuote,
        body: data.body,
        aiEditLevel: effectiveLevel,
        toneStrength: draftStrength,
        writingTone: draftTone,
        perspective: draftPerspective,
        lengthPreference: draftLength,
      });
      setAssistantOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI adjustment failed.');
    } finally {
      setReshaping(false);
    }
  }

  async function handleShareChapter() {
    if (!selectedChapter || typeof window === 'undefined') return;
    const shareUrl = `${window.location.origin}/?bookId=${encodeURIComponent(
      bookId
    )}&chapter=${encodeURIComponent(selectedChapter.id)}`;
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: selectedChapter.title,
          text: `Read and listen to "${selectedChapter.title}" from ${settings.title}`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 2000);
    } catch {
      // Clipboard blocked
    }
  }

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChapter || !commentText.trim()) return;
    setPostingComment(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        withBookId(`/api/chapters/${selectedChapter.id}/comments`, bookId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorName:
              commentAuthor.trim() ||
              currentMemberName ||
              (isStoryteller ? settings.authorName : settings.organizerName) ||
              'Family',
            relationship: commentRelationship.trim() || 'Family',
            text: commentText.trim(),
          }),
        }
      );
      const updated = await parseJsonResponse<Chapter>(res, 'Could not add family note');
      onChaptersUpdated(chapters.map((c) => (c.id === updated.id ? updated : c)));
      setCommentText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not post family note.');
    } finally {
      setPostingComment(false);
    }
  }

  async function handleAutoSequenceBook() {
    if (chapters.length < 2) return;
    setSequencing(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId('/api/ai/sequence-book', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await parseJsonResponse<SequenceBookResponse>(
        res,
        'Could not auto-sequence chapters'
      );
      onChaptersUpdated(data.chapters);
      setSequenceRationale(data.rationale);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Auto-sequence failed.');
    } finally {
      setSequencing(false);
    }
  }

  async function handleMoveChapter(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= chapters.length) return;
    const copy = [...chapters];
    const [moved] = copy.splice(index, 1);
    copy.splice(target, 0, moved);
    const renumbered = copy.map((c, idx) => ({ ...c, order: idx + 1 }));
    onChaptersUpdated(renumbered);
    await fetch(withBookId('/api/chapters/reorder', bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: renumbered.map((c) => c.id) }),
    });
  }

  async function handleRequestEditing() {
    if (!selectedChapter) return;
    setRequestingEdit(true);
    setErrorMsg(null);
    try {
      const nextStatus =
        selectedChapter.editingStatus === 'requested' ? 'none' : 'requested';
      const res = await fetch(
        withBookId(`/api/chapters/${selectedChapter.id}/request-editing`, bookId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus, note: editingNote }),
        }
      );
      const updated = await parseJsonResponse<Chapter>(res, 'Could not update editing status');
      onChaptersUpdated(chapters.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to flag for editing.');
    } finally {
      setRequestingEdit(false);
    }
  }

  async function handleDeleteChapter(id: string) {
    const res = await fetch(withBookId(`/api/chapters/${id}`, bookId), { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { chapters: Chapter[] };
      onChaptersUpdated(data.chapters);
      if (selectedId === id) {
        setSelectedId(data.chapters[0]?.id || '');
      }
    }
  }

  async function handleApplyTermFix(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedChapter) return;
    const wrong = fixWrong.trim();
    const correct = fixCorrect.trim();
    if (!wrong || !correct) return;

    const { next, totalCount } = applyGlossaryToFields(
      { transcript, title, subtitle, eraLabel, pullQuote, body },
      wrong,
      correct
    );

    setTranscript(next.transcript);
    setTitle(next.title);
    setSubtitle(next.subtitle);
    setEraLabel(next.eraLabel);
    setPullQuote(next.pullQuote);
    setBody(next.body);

    if (totalCount > 0) {
      await handleSaveChapter({
        transcript: next.transcript,
        title: next.title,
        subtitle: next.subtitle,
        eraLabel: next.eraLabel,
        pullQuote: next.pullQuote,
        body: next.body,
      });
    }

    if (rememberFix) {
      const currentGlossary = settings.spellingGlossary || [];
      const exists = currentGlossary.some(
        (g) =>
          g.wrong.toLowerCase() === wrong.toLowerCase() &&
          g.correct.toLowerCase() === correct.toLowerCase()
      );
      if (!exists) {
        const entry: SpellingCorrection = {
          id: `gloss-${Date.now().toString(36)}`,
          category: fixCategory,
          wrong,
          correct,
        };
        const nextGlossary = [entry, ...currentGlossary];
        const nextSettings = { ...settings, spellingGlossary: nextGlossary };
        onSettingsUpdated?.(nextSettings);
        fetch(withBookId('/api/book/settings', bookId), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spellingGlossary: nextGlossary }),
        }).catch(() => {});
      }
    }

    setFixFeedback(
      totalCount > 0
        ? `Fixed ${totalCount} occurrence${totalCount === 1 ? '' : 's'} of “${wrong}” → “${correct}” & saved.`
        : `No match for “${wrong}” in this chapter${rememberFix ? ' — saved spelling for future recordings.' : '.'}`
    );
    setFixWrong('');
    setFixCorrect('');
  }

  const activePerspectiveInfo =
    PERSPECTIVES.find((p) => p.id === draftPerspective) || PERSPECTIVES[0];

  return (
    <div className="max-w-[1360px] mx-auto px-5 sm:px-8 py-8 space-y-6">
      {/* Header + AI Auto-Sequence */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E4E2DD] pb-5">
        <div className="space-y-1">
          <p className="text-xs font-medium text-[#1B4332]">
            {isStoryteller ? 'Your Saved Memories' : 'Stories & Book Order'}
          </p>
          <h1 className="font-editorial text-3xl font-semibold text-[#18181B]">
            {isStoryteller ? 'My Stories' : 'Stories'}
          </h1>
        </div>

        {showAutoSequence && (
          <button
            type="button"
            onClick={handleAutoSequenceBook}
            disabled={sequencing || chapters.length < 2}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            {sequencing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Sequencing Book...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                AI Auto-Sequence Book
              </>
            )}
          </button>
        )}
      </div>

      {sequenceRationale && (
        <div className="p-3.5 rounded-lg bg-[#F2EFE9] border border-[#E4E2DD] text-xs text-[#18181B]">
          <strong>Book Sequence Updated:</strong> {sequenceRationale}
        </div>
      )}

      {chapters.length === 0 ? (
        <div className="border border-[#E4E2DD] rounded-2xl bg-white p-12 text-center space-y-2">
          <p className="font-editorial text-xl font-semibold text-[#18181B]">
            No memories recorded yet
          </p>
          <p className="text-sm text-[#57534E]">
            {isStoryteller
              ? 'Tap Record to capture your first memory.'
              : 'Send your storyteller a prompt link from Prompts to collect their first story.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Compact Chapter Sequence List */}
          <aside className="lg:col-span-3 border border-[#E4E2DD] rounded-2xl bg-white divide-y divide-[#E4E2DD] overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between bg-[#FAF9F6]">
              <span className="text-xs font-semibold text-[#18181B] tabular-nums">
                Chapters ({chapters.length})
              </span>
              <span className="text-[11px] text-[#57534E]">Reorder</span>
            </div>

            {chapters.map((ch, idx) => {
              const active = ch.id === selectedChapter?.id;
              return (
                <div
                  key={ch.id}
                  onClick={() => setSelectedId(ch.id)}
                  className={`px-4 py-3.5 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    active ? 'bg-[#F2EFE9]' : 'hover:bg-[#FAF9F6]'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#57534E] tabular-nums">
                      Ch. {String(ch.order).padStart(2, '0')}
                      {ch.isPrivate ? ' · Private' : ''}
                      {ch.editingStatus === 'requested' ? ' · Editing' : ''}
                    </p>
                    <p className="font-editorial text-sm font-semibold text-[#18181B] truncate">
                      {ch.isPrivate && !isStoryteller ? 'Private Memory' : ch.title}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      aria-label="Move chapter up"
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveChapter(idx, -1);
                      }}
                      className="p-1 text-[#57534E] hover:text-[#18181B] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Move chapter down"
                      disabled={idx === chapters.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMoveChapter(idx, 1);
                      }}
                      className="p-1 text-[#57534E] hover:text-[#18181B] disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </aside>

          {/* RIGHT: Split Media + Story Reader Card (Screenshot 18) + Writing Assistant Sheet (Screenshots 2 & 5) */}
          {selectedChapter && selectedChapter.isPrivate && !isStoryteller ? (
            <div className="lg:col-span-9 border border-[#E4E2DD] rounded-2xl bg-white p-12 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-[#F2EFE9] text-[#18181B] flex items-center justify-center mx-auto">
                <Lock className="w-4 h-4" />
              </div>
              <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
                Kept Private by {settings.authorName}
              </h2>
              <p className="text-sm text-[#57534E] max-w-md mx-auto leading-relaxed">
                This memory was marked private by the storyteller. Only {settings.authorName} can
                read, edit, or choose to include it in the published book.
              </p>
            </div>
          ) : selectedChapter ? (
            <div className="lg:col-span-9 space-y-6">
              {/* Split Detail Card matching Screenshot 18 */}
              <div className="border border-[#E4E2DD] rounded-2xl bg-white overflow-hidden grid grid-cols-1 xl:grid-cols-12 shadow-xs">
                {/* LEFT MEDIA PLAYER PANE */}
                <div className="xl:col-span-5 bg-[#141416] text-white flex flex-col justify-between p-4 sm:p-5 min-h-[340px] xl:min-h-[560px]">
                  <div className="flex items-center justify-between gap-2 text-xs text-white/80">
                    <span>Recorded {formatDateShort(selectedChapter.updatedAt)}</span>
                    <button
                      type="button"
                      onClick={() => setShowHighlights((v) => !v)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[#E8F09C] font-medium cursor-pointer"
                    >
                      <Sparkles className="w-3 h-3" />
                      {showHighlights ? 'Hide transcript' : 'View highlights'}
                    </button>
                  </div>

                  {/* Video / Photo / Audio stage */}
                  <div className="my-4 space-y-3 flex-1 flex flex-col justify-center">
                    {showHighlights ? (
                      <div className="p-4 rounded-xl bg-white/10 border border-white/10 space-y-3 max-h-[360px] overflow-y-auto text-left">
                        {pullQuote && (
                          <p className="font-editorial italic text-sm text-[#E8F09C]">
                            “{pullQuote}”
                          </p>
                        )}
                        <div className="space-y-1">
                          <p className="text-[11px] uppercase tracking-wider text-white/60">
                            Original Spoken Transcript
                          </p>
                          <p className="text-xs leading-relaxed text-white/90 whitespace-pre-wrap">
                            {transcript || 'No spoken transcript recorded for this chapter.'}
                          </p>
                        </div>
                      </div>
                    ) : selectedChapter.videoUrl ? (
                      <video
                        controls
                        playsInline
                        src={selectedChapter.videoUrl}
                        className="w-full max-h-[380px] rounded-xl bg-black"
                      />
                    ) : (
                      <div className="space-y-4">
                        {chapterPhoto && (
                          <div className="aspect-[4/3] rounded-xl overflow-hidden border border-white/15 bg-black/40">
                            <ResilientImage
                              src={chapterPhoto.imageUrl}
                              alt={chapterPhoto.caption || selectedChapter.title}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}
                        {selectedChapter.audioUrl ? (
                          <div className="p-4 rounded-xl bg-[#1D3E33] border border-white/10 space-y-2.5">
                            <div className="flex items-center gap-2 text-xs text-[#E8F09C]">
                              <Volume2 className="w-4 h-4" />
                              <span>Voice Recording · {settings.authorName.split(' ')[0]}</span>
                            </div>
                            <audio
                              controls
                              src={selectedChapter.audioUrl}
                              className="w-full h-10"
                            />
                          </div>
                        ) : !chapterPhoto ? (
                          <div className="p-6 rounded-xl bg-white/5 border border-white/10 text-center text-xs text-white/65">
                            Written story entry (no audio or video attached)
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/10 flex items-center justify-between gap-2 text-xs text-white/75">
                    <span className="truncate">
                      {selectedChapter.promptQuestion || 'Spontaneous memory'}
                    </span>
                    {selectedChapter.audioDurationSeconds > 0 && (
                      <span className="font-mono tabular-nums shrink-0">
                        {Math.floor(selectedChapter.audioDurationSeconds / 60)}:
                        {String(selectedChapter.audioDurationSeconds % 60).padStart(2, '0')}
                      </span>
                    )}
                  </div>
                </div>

                {/* RIGHT STORY READER / EDITOR PANE + WRITING ASSISTANT DRAWER */}
                <div className="xl:col-span-7 relative flex flex-col justify-between bg-[#FAF9F6] min-h-[560px]">
                  {/* Top Story Toolbar */}
                  <div className="px-6 py-4 bg-white border-b border-[#EFECE6] flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[#57534E] tabular-nums">
                      Chapter {String(selectedChapter.order).padStart(2, '0')}
                      {eraLabel ? ` · ${eraLabel}` : ''}
                    </span>

                    <div className="flex flex-wrap items-center gap-2">
                      {showAutoSequence && (
                        <button
                          type="button"
                          onClick={openWritingAssistant}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#18181B] bg-[#F2EFE9] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-[#1B4332]" />
                          AI writing tool
                        </button>
                      )}

                      {canSeePreviewButton && onOpenPreview && (
                        <button
                          type="button"
                          onClick={() => onOpenPreview(selectedChapter.id)}
                          className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
                        >
                          Book Preview
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Main Reading or Editing Body */}
                  <div className="p-6 sm:p-8 flex-1 space-y-5 overflow-y-auto max-h-[520px]">
                    {errorMsg && (
                      <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
                        {errorMsg}
                      </div>
                    )}

                    {!isEditing ? (
                      <div className="space-y-5">
                        <div className="space-y-1.5">
                          <h2 className="font-editorial text-2xl sm:text-3xl font-normal text-[#18181B]">
                            {title}
                          </h2>
                          {subtitle && (
                            <p className="text-sm font-editorial italic text-[#57534E]">
                              {subtitle}
                            </p>
                          )}
                        </div>

                        <div className="space-y-4 font-editorial text-base sm:text-[17px] leading-[1.78] text-[#18181B]">
                          {body
                            .split(/\n\s*\n/)
                            .filter((p) => p.trim())
                            .map((para, idx) => (
                              <p key={idx}>{para}</p>
                            ))}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {/* Name, Place & Address Fixer */}
                        <form
                          onSubmit={handleApplyTermFix}
                          className="p-4 rounded-xl bg-white border border-[#E4E2DD] space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-[#18181B]">
                              Fix Misheard Names, Places &amp; Addresses
                            </p>
                            {fixFeedback && (
                              <span className="text-xs font-medium text-[#1B4332]">
                                {fixFeedback}
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <select
                              value={fixCategory}
                              onChange={(e) => setFixCategory(e.target.value as CorrectionCategory)}
                              className="sm:col-span-2 px-2 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                            >
                              <option value="name">Name</option>
                              <option value="place">Place</option>
                              <option value="address">Address</option>
                            </select>
                            <input
                              type="text"
                              value={fixWrong}
                              onChange={(e) => setFixWrong(e.target.value)}
                              placeholder="Misheard word..."
                              className="sm:col-span-4 px-3 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                            />
                            <input
                              type="text"
                              value={fixCorrect}
                              onChange={(e) => setFixCorrect(e.target.value)}
                              placeholder="Correct spelling..."
                              className="sm:col-span-4 px-3 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                            />
                            <button
                              type="submit"
                              disabled={!fixWrong.trim() || !fixCorrect.trim()}
                              className="sm:col-span-2 px-3 py-1.5 text-xs font-medium text-white bg-[#1B4332] rounded-lg cursor-pointer disabled:opacity-45"
                            >
                              Fix
                            </button>
                          </div>
                          <label className="inline-flex items-center gap-2 text-xs text-[#57534E] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={rememberFix}
                              onChange={(e) => setRememberFix(e.target.checked)}
                              className="accent-[#1B4332] w-3.5 h-3.5"
                            />
                            Save to glossary for future stories
                          </label>
                        </form>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-[#57534E] mb-1">
                              Chapter Title
                            </label>
                            <input
                              type="text"
                              value={title}
                              onChange={(e) => setTitle(e.target.value)}
                              className="w-full px-3 py-2 text-sm font-editorial font-semibold bg-white border border-[#E4E2DD] rounded-lg"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-[#57534E] mb-1">
                              Era / Date Tag
                            </label>
                            <input
                              type="text"
                              value={eraLabel}
                              onChange={(e) => setEraLabel(e.target.value)}
                              placeholder="e.g., 1974 · Childhood"
                              className="w-full px-3 py-2 text-sm bg-white border border-[#E4E2DD] rounded-lg"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Subtitle
                          </label>
                          <input
                            type="text"
                            value={subtitle}
                            onChange={(e) => setSubtitle(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-white border border-[#E4E2DD] rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Book Manuscript
                          </label>
                          <textarea
                            rows={8}
                            value={body}
                            onChange={(e) => setBody(e.target.value)}
                            className="w-full p-3.5 text-sm leading-relaxed bg-white border border-[#E4E2DD] rounded-lg"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Original Spoken Transcript
                          </label>
                          <textarea
                            rows={4}
                            value={transcript}
                            onChange={(e) => setTranscript(e.target.value)}
                            className="w-full p-3 text-xs leading-relaxed bg-white border border-[#E4E2DD] rounded-lg"
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E4E2DD]">
                          {isStoryteller && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = !isPrivate;
                                setIsPrivate(next);
                                handleSaveChapter({ isPrivate: next });
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                                isPrivate
                                  ? 'bg-[#18181B] text-white border-[#18181B]'
                                  : 'bg-white text-[#18181B] border-[#E4E2DD]'
                              }`}
                            >
                              {isPrivate ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                              {isPrivate ? 'Kept Private' : 'Included in Book'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handleRequestEditing}
                            disabled={requestingEdit}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                              selectedChapter.editingStatus === 'requested'
                                ? 'bg-[#B45309]/10 text-[#92400E] border-[#B45309]/40'
                                : 'bg-white text-[#18181B] border-[#E4E2DD]'
                            }`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {selectedChapter.editingStatus === 'requested'
                              ? 'Human Editing Requested'
                              : 'Request Editing'}
                          </button>

                          <input
                            type="text"
                            value={editingNote}
                            onChange={(e) => setEditingNote(e.target.value)}
                            placeholder="Note for editor..."
                            className="flex-1 min-w-[140px] px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
                          />

                          <button
                            type="button"
                            onClick={() => handleDeleteChapter(selectedChapter.id)}
                            className="p-2 text-[#57534E] hover:text-[#B91C1C] cursor-pointer"
                            aria-label="Delete chapter"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom Story Reader Footer Bar (Screenshot 18: Heart + Share + Make changes) */}
                  <div className="px-6 py-4 bg-white border-t border-[#E4E2DD] flex flex-wrap items-center justify-between gap-3">
                    <a
                      href="#family-notes"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#57534E] hover:text-[#18181B]"
                    >
                      <Heart className="w-4 h-4 text-[#1B4332]" />
                      <span className="tabular-nums">
                        {selectedChapter.comments?.length || 0} Family Notes
                      </span>
                    </a>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={handleShareChapter}
                        className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        {copiedShare ? 'Link Copied' : 'Share'}
                      </button>

                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
                        >
                          Make changes
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setIsEditing(false)}
                            className="px-3.5 py-2 min-h-[40px] text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveChapter()}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                          >
                            {savedFlag ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Saved
                              </>
                            ) : saving ? (
                              'Saving...'
                            ) : (
                              'Save changes'
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* WRITING ASSISTANT BOTTOM-SHEET OVERLAY (Screenshots 2 & 5) */}
                  {assistantOpen && (
                    <div className="absolute inset-x-0 bottom-0 z-20 bg-white border-t border-[#E4E2DD] rounded-t-2xl shadow-2xl p-6 space-y-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <Sparkles className="w-4 h-4 text-[#1B4332]" />
                            <h3 className="text-sm font-semibold text-[#18181B]">
                              Writing assistant
                            </h3>
                          </div>
                          <p className="text-xs text-[#57534E]">
                            Adjust the settings below to create a new version of the story.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAssistantOpen(false)}
                          className="p-1.5 rounded-lg text-[#57534E] hover:text-[#18181B] hover:bg-[#F2EFE9] cursor-pointer"
                          aria-label="Close writing assistant"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {/* STORY PERSPECTIVE (3 Cards) */}
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#57534E]">
                          Story Perspective
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          {PERSPECTIVES.map((p) => {
                            const active = draftPerspective === p.id;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setDraftPerspective(p.id)}
                                className={`px-3.5 py-3 min-h-[48px] text-xs font-medium rounded-xl border text-center transition-colors cursor-pointer ${
                                  active
                                    ? 'bg-[#FAF9F6] text-[#18181B] border-[#1B4332] ring-1 ring-[#1B4332]'
                                    : 'bg-white text-[#57534E] border-[#E4E2DD] hover:border-[#1B4332]/50'
                                }`}
                              >
                                {p.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-xs text-[#57534E]">{activePerspectiveInfo.description}</p>
                      </div>

                      {/* Length + Edit Depth + Tone */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-[#57534E]">Story Length</span>
                          <div className="grid grid-cols-3 gap-1 p-1 bg-[#F2EFE9] rounded-lg">
                            {LENGTH_OPTIONS.map((len) => (
                              <button
                                key={len.id}
                                type="button"
                                onClick={() => setDraftLength(len.id)}
                                className={`py-1 text-[11px] font-medium rounded-md cursor-pointer ${
                                  draftLength === len.id
                                    ? 'bg-white text-[#18181B] shadow-xs'
                                    : 'text-[#57534E]'
                                }`}
                              >
                                {len.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-[#57534E]">AI Edit Level</span>
                          <select
                            value={draftAiLevel}
                            onChange={(e) => setDraftAiLevel(e.target.value as AiEditLevel)}
                            className="w-full px-2.5 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                          >
                            {AI_LEVELS.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-1">
                          <span className="text-[11px] font-medium text-[#57534E]">Writing Tone</span>
                          <select
                            value={draftTone}
                            onChange={(e) => setDraftTone(e.target.value as WritingTone)}
                            className="w-full px-2.5 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                          >
                            {WRITING_TONES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#EFECE6]">
                        <button
                          type="button"
                          onClick={() => setAssistantOpen(false)}
                          className="px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          disabled={reshaping}
                          onClick={handleGenerateAssistantPreview}
                          className="inline-flex items-center gap-1.5 px-5 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                        >
                          {reshaping && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          {reshaping ? 'Generating...' : 'Generate preview'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Family Notes & Reactions (Screenshot 4) */}
              {!selectedChapter.isPrivate && (
                <section
                  id="family-notes"
                  className="border border-[#E4E2DD] rounded-2xl bg-white p-6 space-y-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="w-4 h-4 text-[#1B4332]" />
                      <h3 className="font-editorial text-lg font-semibold text-[#18181B]">
                        Share a reaction with {settings.authorName.split(' ')[0]} (
                        {selectedChapter.comments?.length || 0})
                      </h3>
                    </div>
                  </div>

                  {selectedChapter.comments && selectedChapter.comments.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {selectedChapter.comments.map((cmt) => (
                        <div
                          key={cmt.id}
                          className="p-3.5 rounded-xl bg-[#FAF9F6] border border-[#E4E2DD] space-y-1"
                        >
                          <p className="text-xs text-[#57534E]">
                            <strong className="text-[#18181B]">{cmt.authorName}</strong> ·{' '}
                            {cmt.relationship}
                          </p>
                          <p className="text-xs text-[#18181B] leading-relaxed">{cmt.text}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <form onSubmit={handleAddComment} className="space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <input
                        type="text"
                        value={commentAuthor}
                        onChange={(e) => setCommentAuthor(e.target.value)}
                        placeholder="Your name"
                        className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                      />
                      <input
                        type="text"
                        value={commentRelationship}
                        onChange={(e) => setCommentRelationship(e.target.value)}
                        placeholder="Relationship (e.g., Daughter, Son)"
                        className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                      />
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a comment or memory reaction..."
                        className="flex-1 min-w-0 px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      />
                      <button
                        type="submit"
                        disabled={postingComment || !commentText.trim()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {postingComment ? 'Posting...' : 'Add comment'}
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
