import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  Edit3,
  EyeOff,
  Loader2,
  PenLine,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  BookSettings,
  BookWorkspaceData,
  Chapter,
  CoverTheme,
  FontScale,
  InteriorColorMode,
  TrimSize,
  UserRole,
} from '../types';
import { ResilientImage } from './ResilientImage';
import { parseJsonResponse, withBookId } from '../utils/api';

interface BookLayoutViewProps {
  workspace: BookWorkspaceData;
  activeRole: UserRole;
  initialChapterId: string | null;
  onSettingsUpdated: (settings: BookSettings) => void;
  onChaptersUpdated: (chapters: Chapter[]) => void;
  onBackToStories?: () => void;
}

const COVER_THEMES: Array<{
  id: CoverTheme;
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}> = [
  {
    id: 'linen-forest',
    label: 'Forest Linen',
    bgClass: 'bg-[#1B4332]',
    textClass: 'text-[#FAF9F6]',
    borderClass: 'border-[#D4AF37]/40',
  },
  {
    id: 'ivory-botanical',
    label: 'Ivory Botanical',
    bgClass: 'bg-[#F5F2EA]',
    textClass: 'text-[#18181B]',
    borderClass: 'border-[#18181B]/20',
  },
  {
    id: 'slate-cloth',
    label: 'Slate Cloth',
    bgClass: 'bg-[#2C3E50]',
    textClass: 'text-[#FAF9F6]',
    borderClass: 'border-[#FAF9F6]/30',
  },
  {
    id: 'charcoal-foil',
    label: 'Charcoal Foil',
    bgClass: 'bg-[#1C1917]',
    textClass: 'text-[#F5F2EA]',
    borderClass: 'border-[#C5A059]/50',
  },
];

export function BookLayoutView({
  workspace,
  activeRole,
  initialChapterId,
  onSettingsUpdated,
  onChaptersUpdated,
  onBackToStories,
}: BookLayoutViewProps) {
  const { settings, chapters, photos } = workspace;
  const bookId = settings.id;
  const visibleChapters = chapters.filter((c) => !c.isPrivate);
  const isCollaborator = activeRole === 'collaborator';
  const isStorytellerOnly = activeRole === 'author' && settings.bookMode !== 'self';
  const canEditBookDesign = activeRole === 'organizer' || settings.bookMode === 'self';
  const canRequestEditing =
    activeRole === 'organizer' || (activeRole === 'author' && settings.bookMode === 'self');
  const previewHiddenForAuthor =
    activeRole === 'author' && settings.bookMode === 'gift' && !settings.authorPreviewEnabled;

  const [stageMode, setStageMode] = useState<'spread' | 'edit' | 'cover'>('spread');
  const [activeChapterId, setActiveChapterId] = useState<string>(
    initialChapterId || visibleChapters[0]?.id || chapters[0]?.id || ''
  );

  // Inline editor states
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftEpigraph, setDraftEpigraph] = useState('');
  const [draftPullQuote, setDraftPullQuote] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [requestingEditing, setRequestingEditing] = useState(false);

  // AI refinement
  const [customInstruction, setCustomInstruction] = useState('');
  const [refining, setRefining] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // TTS audio proof
  const [narrating, setNarrating] = useState(false);
  const [narrationUrl, setNarrationUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (initialChapterId && visibleChapters.some((c) => c.id === initialChapterId)) {
      setActiveChapterId(initialChapterId);
    }
  }, [initialChapterId, chapters]);

  useEffect(() => {
    if ((isCollaborator || isStorytellerOnly) && stageMode === 'edit') {
      setStageMode('spread');
    }
  }, [isCollaborator, isStorytellerOnly, stageMode]);

  const activeChapter =
    visibleChapters.find((c) => c.id === activeChapterId) || visibleChapters[0] || null;

  useEffect(() => {
    if (activeChapter) {
      setDraftTitle(activeChapter.title);
      setDraftSubtitle(activeChapter.subtitle);
      setDraftEpigraph(activeChapter.epigraph);
      setDraftPullQuote(activeChapter.pullQuote);
      setDraftBody(activeChapter.body);
      setNarrationUrl(null);
      setAiError(null);
    }
  }, [activeChapter?.id]);

  async function updateSettings(patch: Partial<BookSettings>) {
    const optimistic = { ...settings, ...patch };
    onSettingsUpdated(optimistic);
    await fetch(withBookId('/api/book/settings', bookId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  }

  async function saveActiveChapter(override?: Partial<Chapter>) {
    if (!activeChapter) return;
    setSaveState('saving');
    const payload = {
      title: override?.title ?? draftTitle,
      subtitle: override?.subtitle ?? draftSubtitle,
      epigraph: override?.epigraph ?? draftEpigraph,
      pullQuote: override?.pullQuote ?? draftPullQuote,
      body: override?.body ?? draftBody,
    };
    try {
      const res = await fetch(withBookId(`/api/chapters/${activeChapter.id}`, bookId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = (await res.json()) as Chapter;
        onChaptersUpdated(chapters.map((c) => (c.id === updated.id ? updated : c)));
        setSaveState('saved');
        window.setTimeout(() => setSaveState('idle'), 1800);
      }
    } catch {
      setSaveState('idle');
    }
  }

  async function handleReorderChapter(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= visibleChapters.length) return;
    const movedId = visibleChapters[index].id;
    const swapId = visibleChapters[target].id;
    const fullCopy = [...chapters];
    const fullIdxA = fullCopy.findIndex((c) => c.id === movedId);
    const fullIdxB = fullCopy.findIndex((c) => c.id === swapId);
    if (fullIdxA === -1 || fullIdxB === -1) return;
    const [moved] = fullCopy.splice(fullIdxA, 1);
    fullCopy.splice(fullIdxB, 0, moved);
    const renumbered = fullCopy.map((c, idx) => ({ ...c, order: idx + 1 }));
    onChaptersUpdated(renumbered);

    await fetch(withBookId('/api/chapters/reorder', bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: renumbered.map((c) => c.id) }),
    });
  }

  async function handleAddBlankChapter() {
    const res = await fetch(withBookId('/api/chapters', bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `New Chapter ${chapters.length + 1}`,
        subtitle: 'Untitled memory',
        body: 'Begin writing or record an audio interview to populate this chapter.',
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as Chapter;
      onChaptersUpdated([...chapters, created]);
      setActiveChapterId(created.id);
      setStageMode('edit');
    }
  }

  async function handleDeleteChapter(id: string) {
    const res = await fetch(withBookId(`/api/chapters/${id}`, bookId), { method: 'DELETE' });
    if (res.ok) {
      const data = (await res.json()) as { chapters: Chapter[] };
      onChaptersUpdated(data.chapters);
      if (activeChapterId === id) {
        const nextVisible = data.chapters.filter((c) => !c.isPrivate);
        setActiveChapterId(nextVisible[0]?.id || data.chapters[0]?.id || '');
      }
    }
  }

  async function handleRequestEditing() {
    if (!activeChapter) return;
    setRequestingEditing(true);
    setAiError(null);
    try {
      const res = await fetch(
        withBookId(`/api/chapters/${activeChapter.id}/request-editing`, bookId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'requested',
            note: activeChapter.editingNote || 'Requested human editorial review from Book Preview.',
          }),
        }
      );
      const updated = await parseJsonResponse<Chapter>(res, 'Could not request editing');
      onChaptersUpdated(chapters.map((c) => (c.id === updated.id ? updated : c)));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not request editing.');
    } finally {
      setRequestingEditing(false);
    }
  }

  async function handleAiRefine(instruction: string) {
    if (!activeChapter || !instruction.trim()) return;
    setRefining(true);
    setAiError(null);
    try {
      const res = await fetch(withBookId('/api/ai/refine-chapter', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          body: draftBody,
          transcript: activeChapter.transcript,
          instruction,
        }),
      });
      const data = await parseJsonResponse<{ title?: string; pullQuote?: string; body?: string }>(
        res,
        'Could not refine chapter'
      );
      setDraftTitle(data.title || draftTitle);
      setDraftPullQuote(data.pullQuote || draftPullQuote);
      setDraftBody(data.body || draftBody);
      await saveActiveChapter({
        title: data.title || draftTitle,
        pullQuote: data.pullQuote || draftPullQuote,
        body: data.body || draftBody,
      });
      setCustomInstruction('');
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Refinement failed.');
    } finally {
      setRefining(false);
    }
  }

  async function handleNarrateProof() {
    if (!activeChapter) return;
    setNarrating(true);
    setAiError(null);
    try {
      const res = await fetch(withBookId('/api/ai/narrate-chapter', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle,
          body: draftBody,
        }),
      });
      const data = await parseJsonResponse<{ audioBase64: string; mimeType: string }>(
        res,
        'Narration failed'
      );
      const url = `data:audio/wav;base64,${data.audioBase64}`;
      setNarrationUrl(url);
      window.setTimeout(() => {
        audioRef.current?.play().catch(() => {});
      }, 100);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Could not narrate chapter.');
    } finally {
      setNarrating(false);
    }
  }

  const chapterPhotos = activeChapter
    ? photos.filter((p) => p.chapterId === activeChapter.id)
    : [];

  const paragraphs = draftBody
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Split paragraphs cleanly across left and right pages for a realistic 2-page spread
  const midpoint = Math.max(1, Math.ceil(paragraphs.length / 2));
  const leftParagraphs = paragraphs.slice(0, midpoint);
  const rightParagraphs = paragraphs.slice(midpoint);

  // Calculate starting page number based on preceding non-private chapters
  let runningPage = 7;
  for (const ch of visibleChapters) {
    if (ch.id === activeChapter?.id) break;
    const words = ch.body.split(/\s+/).filter(Boolean).length;
    runningPage += Math.max(2, Math.ceil(words / 220) + 1);
  }

  const fontSizeClass =
    settings.fontScale === 'compact'
      ? 'text-[13px] leading-[1.65]'
      : settings.fontScale === 'large-print'
        ? 'text-[16px] leading-[1.8]'
        : 'text-[14.5px] leading-[1.72]';

  const activeCoverTheme =
    COVER_THEMES.find((t) => t.id === settings.coverTheme) || COVER_THEMES[0];

  const qrLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?invite=${settings.inviteCode}&chapter=${activeChapter?.id || 'book'}`
      : 'https://rememberpress.com';

  if (previewHiddenForAuthor) {
    return (
      <div className="max-w-[760px] mx-auto px-6 py-16">
        <div className="border border-[#E4E2DD] rounded-xl bg-white p-8 space-y-5 text-center">
          <div className="w-11 h-11 rounded-full bg-[#F2EFE9] text-[#1B4332] flex items-center justify-center mx-auto">
            <EyeOff className="w-5 h-5" />
          </div>
          <div className="space-y-2">
            <h1 className="font-editorial text-2xl font-semibold text-[#18181B]">
              Book Preview is Paused for Now
            </h1>
            <p className="text-sm text-[#57534E] leading-relaxed max-w-lg mx-auto">
              {settings.organizerName} has turned off the formatted Book Preview while you gather
              memories so you can share freely without worrying about page layout—or to keep the
              finished edition a surprise.
            </p>
          </div>
          {onBackToStories && (
            <div className="pt-2">
              <button
                type="button"
                onClick={onBackToStories}
                className="px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
              >
                Return to Stories &amp; Review
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1360px] mx-auto px-6 py-8 space-y-6">
      {/* Top Studio Header */}
      <div className="no-print flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#E4E2DD] pb-5">
        <div>
          <p className="text-xs font-medium text-[#1B4332]">
            {isStorytellerOnly ? 'Book Preview' : 'Book Preview & Print Studio'}
            {chapters.some((c) => c.isPrivate)
              ? ` · ${chapters.filter((c) => c.isPrivate).length} private memory excluded`
              : ''}
          </p>
          <h1 className="font-editorial text-2xl md:text-3xl font-semibold text-[#18181B]">
            {settings.title || 'Untitled Book'}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-lg">
            <button
              type="button"
              onClick={() => setStageMode('spread')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                stageMode === 'spread'
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              Two-Page Spread
            </button>
            {!isCollaborator && !isStorytellerOnly && (
              <button
                type="button"
                onClick={() => setStageMode('edit')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  stageMode === 'edit'
                    ? 'bg-white text-[#18181B] shadow-xs'
                    : 'text-[#57534E] hover:text-[#18181B]'
                }`}
              >
                <PenLine className="w-3.5 h-3.5" />
                Edit Manuscript
              </button>
            )}
            <button
              type="button"
              onClick={() => setStageMode('cover')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                stageMode === 'cover'
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Cover &amp; Contents
            </button>
          </div>

          {canRequestEditing && activeChapter && (
            <button
              type="button"
              onClick={handleRequestEditing}
              disabled={requestingEditing || activeChapter.editingStatus === 'requested'}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Edit3 className="w-3.5 h-3.5 text-[#1B4332]" />
              {activeChapter.editingStatus === 'requested'
                ? 'Editing Requested'
                : activeChapter.editingStatus === 'in-review'
                  ? 'In Human Review'
                  : activeChapter.editingStatus === 'completed'
                    ? 'Editor Reviewed'
                    : requestingEditing
                      ? 'Flagging...'
                      : 'Request Editing'}
            </button>
          )}

          {!isStorytellerOnly && (
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Export Proof
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* LEFT SPINE: Chapters & Print Specifications */}
        <aside className="no-print lg:col-span-4 space-y-6">
          {/* Chapter Sequence */}
          <div className="border border-[#E4E2DD] rounded-xl bg-white p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[#18181B]">
                Book Chapters ({visibleChapters.length})
              </h2>
              {canEditBookDesign && (
                <button
                  type="button"
                  onClick={handleAddBlankChapter}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Chapter
                </button>
              )}
            </div>

            {visibleChapters.length === 0 ? (
              <p className="text-xs text-[#57534E] leading-relaxed">
                No public chapters in the book preview yet. Approve or un-mark private memories in
                Stories &amp; Review.
              </p>
            ) : (
              <div className="divide-y divide-[#E4E2DD]">
                {visibleChapters.map((ch, idx) => {
                  const isSelected = ch.id === activeChapter?.id;
                  const wordCount = ch.body.trim().split(/\s+/).filter(Boolean).length;
                  return (
                    <div
                      key={ch.id}
                      className={`py-3 px-2.5 flex items-center justify-between gap-2 rounded-md transition-colors ${
                        isSelected ? 'bg-[#F2EFE9]' : 'hover:bg-[#FAF9F6]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveChapterId(ch.id)}
                        className="text-left flex-1 min-w-0 cursor-pointer"
                      >
                        <p className="text-xs text-[#57534E] tabular-nums">
                          Chapter {String(idx + 1).padStart(2, '0')} · {wordCount} words
                          {ch.editingStatus !== 'none' ? ` · ${ch.editingStatus}` : ''}
                        </p>
                        <p className="text-sm font-medium text-[#18181B] truncate">{ch.title}</p>
                      </button>

                      {canEditBookDesign && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleReorderChapter(idx, -1)}
                            disabled={idx === 0}
                            aria-label="Move chapter up"
                            className="p-1 text-[#57534E] hover:text-[#18181B] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReorderChapter(idx, 1)}
                            disabled={idx === visibleChapters.length - 1}
                            aria-label="Move chapter down"
                            className="p-1 text-[#57534E] hover:text-[#18181B] disabled:opacity-30 cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          {chapters.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteChapter(ch.id)}
                              aria-label="Delete chapter"
                              className="p-1 text-[#57534E] hover:text-[#B91C1C] cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Book Design & Print Options (Organizer / Self-Author only) */}
          {canEditBookDesign && (
            <div className="border border-[#E4E2DD] rounded-xl bg-white p-5 space-y-5">
              <h2 className="text-sm font-semibold text-[#18181B]">Edition &amp; Typography</h2>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Book Title
                </label>
                <input
                  type="text"
                  value={settings.title}
                  onChange={(e) => updateSettings({ title: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Subtitle
                </label>
                <input
                  type="text"
                  value={settings.subtitle}
                  onChange={(e) => updateSettings({ subtitle: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Author Name
                </label>
                <input
                  type="text"
                  value={settings.authorName}
                  onChange={(e) => updateSettings({ authorName: e.target.value })}
                  className="w-full px-3 py-1.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#E4E2DD]">
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Trim Size
                </label>
                <select
                  value={settings.trimSize}
                  onChange={(e) => updateSettings({ trimSize: e.target.value as TrimSize })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
                >
                  <option value="6x9">6 × 9 in (Standard)</option>
                  <option value="5.5x8.5">5.5 × 8.5 in (Compact)</option>
                  <option value="8x10">8 × 10 in (Photo Album)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Interior Print
                </label>
                <select
                  value={settings.interiorColorMode}
                  onChange={(e) =>
                    updateSettings({ interiorColorMode: e.target.value as InteriorColorMode })
                  }
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
                >
                  <option value="color">Full Color</option>
                  <option value="grayscale">Classic Grayscale</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Type Scale
                </label>
                <select
                  value={settings.fontScale}
                  onChange={(e) => updateSettings({ fontScale: e.target.value as FontScale })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
                >
                  <option value="compact">Compact (13px)</option>
                  <option value="classic">Classic (14.5px)</option>
                  <option value="large-print">Large Print (16px)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Cover Cloth
                </label>
                <select
                  value={settings.coverTheme}
                  onChange={(e) => updateSettings({ coverTheme: e.target.value as CoverTheme })}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
                >
                  {COVER_THEMES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2.5 pt-2 border-t border-[#E4E2DD]">
              <label className="flex items-center justify-between gap-2 text-xs text-[#18181B] cursor-pointer">
                <span>Editorial drop caps on chapter openers</span>
                <input
                  type="checkbox"
                  checked={settings.includeDropCaps}
                  onChange={(e) => updateSettings({ includeDropCaps: e.target.checked })}
                  className="accent-[#1B4332] w-4 h-4"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs text-[#18181B] cursor-pointer">
                <span>Embed QR audio archive keepsakes</span>
                <input
                  type="checkbox"
                  checked={settings.includeQrAudioArchive}
                  onChange={(e) => updateSettings({ includeQrAudioArchive: e.target.checked })}
                  className="accent-[#1B4332] w-4 h-4"
                />
              </label>
            </div>
            </div>
          )}
        </aside>

        {/* RIGHT STAGE: Live Book Spread / Manuscript Editor / Cover Preview */}
        <section className="lg:col-span-8 space-y-6">
          {stageMode !== 'cover' && !activeChapter && (
            <div className="border border-[#E4E2DD] rounded-xl bg-white p-10 text-center space-y-3">
              <p className="font-editorial text-xl font-semibold text-[#18181B]">
                No chapters ready in Book Preview yet
              </p>
              <p className="text-sm text-[#57534E] max-w-md mx-auto leading-relaxed">
                Record a memory or make a private chapter visible in Stories &amp; Review to
                preview it inside the book spread.
              </p>
            </div>
          )}

          {stageMode === 'spread' && activeChapter && (
            <div className="space-y-4">
              {/* Audio Proof Bar */}
              <div className="no-print flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[#E4E2DD] bg-white">
                <div className="text-xs text-[#57534E]">
                  Previewing{' '}
                  <span className="font-medium text-[#18181B]">
                    Chapter {activeChapter.order}: {activeChapter.title}
                  </span>{' '}
                  · {settings.trimSize.replace('x', ' × ')} in ·{' '}
                  {settings.interiorColorMode === 'color' ? 'Color' : 'Grayscale'}
                </div>
                <div className="flex items-center gap-3">
                  {narrationUrl && (
                    <audio ref={audioRef} controls src={narrationUrl} className="h-8 w-52" />
                  )}
                  <button
                    type="button"
                    onClick={handleNarrateProof}
                    disabled={narrating}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B4332] bg-[#F2EFE9] rounded-lg hover:bg-[#E4E2DD] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {narrating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Generating Audio...
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        Listen to Chapter Proof
                      </>
                    )}
                  </button>
                </div>
              </div>

              {aiError && (
                <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
                  {aiError}
                </div>
              )}

              {/* Open Book Two-Page Spread */}
              <div className="print-only-spread grid grid-cols-1 md:grid-cols-2 border border-[#E4E2DD] rounded-xl overflow-hidden bg-[#FFFEFA] book-page-shadow">
                {/* LEFT PAGE (Verso) */}
                <div className="p-8 md:p-10 min-h-[620px] flex flex-col justify-between book-gutter-left border-b md:border-b-0 md:border-r border-[#E4E2DD]">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between text-[11px] tracking-wide text-[#57534E] font-serif italic">
                      <span>{settings.title}</span>
                      <span className="font-mono not-italic tabular-nums">
                        Chapter {String(activeChapter.order).padStart(2, '0')}
                      </span>
                    </div>

                    <div className="space-y-2 pt-4">
                      <p className="font-mono text-[11px] text-[#1B4332] tabular-nums">
                        CHAPTER {String(activeChapter.order).padStart(2, '0')}
                      </p>
                      <h2 className="font-editorial text-2xl md:text-3xl font-semibold text-[#18181B] leading-tight">
                        {draftTitle}
                      </h2>
                      {draftSubtitle && (
                        <p className="text-xs text-[#57534E]">{draftSubtitle}</p>
                      )}
                      {draftEpigraph && (
                        <p className="font-editorial italic text-xs text-[#57534E] pt-3 border-t border-[#E4E2DD]">
                          “{draftEpigraph}”
                        </p>
                      )}
                    </div>

                    {chapterPhotos[0]?.placement === 'chapter-opener' && (
                      <figure className="space-y-2 pt-1">
                        <div className="aspect-[4/3] overflow-hidden rounded border border-[#E4E2DD]">
                          <ResilientImage
                            src={chapterPhotos[0].imageUrl}
                            alt={chapterPhotos[0].caption}
                            grayscale={settings.interiorColorMode === 'grayscale'}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <figcaption className="text-[11px] text-[#57534E] italic">
                          {chapterPhotos[0].caption}
                        </figcaption>
                      </figure>
                    )}

                    <div className={`space-y-4 font-serif text-[#18181B] ${fontSizeClass}`}>
                      {leftParagraphs.map((para, i) => (
                        <p
                          key={i}
                          className={
                            i === 0 && settings.includeDropCaps ? 'drop-cap' : ''
                          }
                        >
                          {para}
                        </p>
                      ))}
                    </div>
                  </div>

                  <div className="pt-8 flex items-center justify-between text-[11px] font-mono text-[#57534E] tabular-nums">
                    <span>{runningPage}</span>
                    <span>{settings.authorName}</span>
                  </div>
                </div>

                {/* RIGHT PAGE (Recto) */}
                <div className="p-8 md:p-10 min-h-[620px] flex flex-col justify-between book-gutter-right">
                  <div className="space-y-6">
                    <div className="flex items-center justify-between text-[11px] tracking-wide text-[#57534E] font-serif italic">
                      <span>{draftTitle}</span>
                      <span className="font-mono not-italic tabular-nums">
                        {settings.editionYear}
                      </span>
                    </div>

                    <div className={`space-y-4 font-serif text-[#18181B] pt-4 ${fontSizeClass}`}>
                      {rightParagraphs.map((para, i) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>

                    {draftPullQuote && (
                      <blockquote className="my-4 py-4 px-5 border-y border-[#E4E2DD] font-editorial italic text-base text-[#1B4332] text-center leading-relaxed">
                        “{draftPullQuote}”
                      </blockquote>
                    )}

                    {chapterPhotos
                      .filter((p, i) => !(i === 0 && p.placement === 'chapter-opener'))
                      .map((photo) => (
                        <figure key={photo.id} className="space-y-2 pt-2">
                          <div
                            className={`overflow-hidden rounded border border-[#E4E2DD] ${
                              photo.placement === 'full-width' ? 'aspect-[16/10]' : 'aspect-[4/3]'
                            }`}
                          >
                            <ResilientImage
                              src={photo.imageUrl}
                              alt={photo.caption}
                              grayscale={settings.interiorColorMode === 'grayscale'}
                              className="w-full h-full object-cover"
                            />
                          </div>
                          <figcaption className="text-[11px] text-[#57534E] leading-snug">
                            <span className="font-medium text-[#18181B]">{photo.caption}</span>
                            {photo.storyNarrative ? ` — ${photo.storyNarrative}` : ''}
                          </figcaption>
                        </figure>
                      ))}

                    {settings.includeQrAudioArchive && (
                      <div className="mt-6 pt-4 border-t border-[#E4E2DD] flex items-center justify-between gap-4">
                        <div className="space-y-1">
                          <p className="text-xs font-semibold text-[#18181B]">
                            Audio Archive Keepsake
                          </p>
                          <p className="text-[11px] text-[#57534E] leading-snug max-w-xs">
                            {activeChapter.audioUrl
                              ? 'Scan to listen to the original recorded interview in the storyteller’s own voice.'
                              : 'Scan to open the digital memory archive for this chapter.'}
                          </p>
                        </div>
                        <div className="p-1.5 bg-white border border-[#E4E2DD] rounded shrink-0">
                          <QRCodeSVG value={qrLink} size={56} fgColor="#18181B" />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-8 flex items-center justify-between text-[11px] font-mono text-[#57534E] tabular-nums">
                    <span>Remember Press</span>
                    <span>{runningPage + 1}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {stageMode === 'edit' && activeChapter && (
            <div className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E4E2DD]">
                <div>
                  <p className="text-xs text-[#57534E] tabular-nums">
                    Chapter {activeChapter.order} ·{' '}
                    {draftBody.trim().split(/\s+/).filter(Boolean).length} words
                  </p>
                  <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
                    Manuscript Editor
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => saveActiveChapter()}
                  disabled={saveState === 'saving'}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors cursor-pointer"
                >
                  {saveState === 'saved' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Saved
                    </>
                  ) : saveState === 'saving' ? (
                    'Saving...'
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>

              {/* AI Editorial Polish Controls */}
              <div className="p-4 rounded-lg bg-[#F2EFE9] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1B4332]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Editorial Refinement Assistant</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Deepen sensory details without inventing facts',
                    'Preserve exact spoken voice and warmth',
                    'Tighten pacing and paragraph transitions',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={refining}
                      onClick={() => handleAiRefine(preset)}
                      className="px-3 py-1.5 text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-md hover:border-[#1B4332] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={customInstruction}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder="Custom edit instruction (e.g., Add a gentler opening transition)..."
                    className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                  <button
                    type="button"
                    disabled={refining || !customInstruction.trim()}
                    onClick={() => handleAiRefine(customInstruction)}
                    className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#1B4332] rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    {refining ? 'Refining...' : 'Apply'}
                  </button>
                </div>
                {aiError && <p className="text-xs text-[#991B1B]">{aiError}</p>}
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Chapter Title
                    </label>
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full px-3 py-2 font-editorial text-base font-semibold bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Subtitle
                    </label>
                    <input
                      type="text"
                      value={draftSubtitle}
                      onChange={(e) => setDraftSubtitle(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#57534E] mb-1">
                    Epigraph
                  </label>
                  <input
                    type="text"
                    value={draftEpigraph}
                    onChange={(e) => setDraftEpigraph(e.target.value)}
                    className="w-full px-3 py-2 text-sm italic bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#57534E] mb-1">
                    Chapter Body (Separate paragraphs with a blank line)
                  </label>
                  <textarea
                    rows={14}
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    className="w-full p-4 font-serif text-[15px] leading-relaxed bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#57534E] mb-1">
                    Pull Quote Callout
                  </label>
                  <input
                    type="text"
                    value={draftPullQuote}
                    onChange={(e) => setDraftPullQuote(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>

                {activeChapter.audioUrl && (
                  <div className="p-4 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] space-y-2">
                    <p className="text-xs font-medium text-[#18181B]">
                      Original Interview Recording
                    </p>
                    <audio controls src={activeChapter.audioUrl} className="w-full h-9" />
                  </div>
                )}
              </div>
            </div>
          )}

          {stageMode === 'cover' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Hardcover Front Cover Preview */}
              <div
                className={`aspect-[3/4] rounded-xl p-8 flex flex-col justify-between border border-[#E4E2DD] book-page-shadow ${activeCoverTheme.bgClass} ${activeCoverTheme.textClass}`}
              >
                <div className={`h-full border ${activeCoverTheme.borderClass} p-6 flex flex-col justify-between text-center`}>
                  <p className="font-mono text-[10px] tracking-[0.2em] uppercase opacity-75">
                    Remember Press Edition
                  </p>

                  <div className="space-y-4">
                    {settings.coverTheme === 'ivory-botanical' && (
                      <div className="w-28 h-28 mx-auto overflow-hidden rounded-md opacity-90">
                        <ResilientImage
                          src={settings.coverImageUrl}
                          alt="Botanical book cover motif"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <h2 className="font-editorial text-3xl font-semibold leading-tight">
                      {settings.title}
                    </h2>
                    <p className="text-xs opacity-85 max-w-[240px] mx-auto leading-relaxed">
                      {settings.subtitle}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <p className="font-editorial text-sm font-medium">{settings.authorName}</p>
                    <p className="font-mono text-[10px] opacity-70 tabular-nums">
                      {settings.editionYear}
                    </p>
                  </div>
                </div>
              </div>

              {/* Dedication & Table of Contents */}
              <div className="border border-[#E4E2DD] rounded-xl bg-white p-8 flex flex-col justify-between space-y-8 book-page-shadow">
                <div className="space-y-4">
                  <p className="font-mono text-[11px] text-[#57534E]">DEDICATION</p>
                  {canEditBookDesign ? (
                    <textarea
                      rows={3}
                      value={settings.dedication}
                      onChange={(e) => updateSettings({ dedication: e.target.value })}
                      className="w-full font-editorial italic text-sm text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg p-3 focus:outline-none focus:border-[#1B4332]"
                    />
                  ) : (
                    <p className="font-editorial italic text-sm text-[#18181B] leading-relaxed">
                      “{settings.dedication}”
                    </p>
                  )}
                </div>

                <div className="space-y-4 flex-1">
                  <p className="font-mono text-[11px] text-[#57534E]">TABLE OF CONTENTS</p>
                  <div className="divide-y divide-[#E4E2DD]">
                    {visibleChapters.map((ch, i) => {
                      const startPg = 7 + i * 4;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            setActiveChapterId(ch.id);
                            setStageMode('spread');
                          }}
                          className="w-full py-2.5 flex items-baseline justify-between gap-3 text-left hover:text-[#1B4332] transition-colors cursor-pointer"
                        >
                          <span className="text-sm font-serif text-[#18181B]">
                            <span className="font-mono text-xs text-[#57534E] mr-2 tabular-nums">
                              {String(i + 1).padStart(2, '0')}
                            </span>
                            {ch.title}
                          </span>
                          <span className="font-mono text-xs text-[#57534E] tabular-nums shrink-0">
                            {startPg}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-[#E4E2DD] text-xs text-[#57534E]">
                  Hardcover {settings.trimSize.replace('x', ' × ')} in · Archival acid-free paper
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
