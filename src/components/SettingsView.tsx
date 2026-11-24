import { useEffect, useState } from 'react';
import { Check, Download, Edit3, Eye, EyeOff, RefreshCw, Upload } from 'lucide-react';
import type {
  AiVoiceProvider,
  BookSettings,
  BookWorkspaceData,
  Chapter,
  PromptCadence,
  UserRole,
} from '../types';
import { parseJsonResponse, withBookId } from '../utils/api';

interface SettingsViewProps {
  workspace: BookWorkspaceData;
  activeRole: UserRole;
  onSettingsUpdated: (settings: BookSettings) => void;
  onChaptersUpdated: (chapters: Chapter[]) => void;
  onWorkspaceImported?: (workspace: BookWorkspaceData) => void;
  onOpenSetup: () => void;
}

export function SettingsView({
  workspace,
  activeRole,
  onSettingsUpdated,
  onChaptersUpdated,
  onWorkspaceImported,
  onOpenSetup,
}: SettingsViewProps) {
  const { settings, chapters } = workspace;
  const bookId = settings.id;

  const [aiStatus, setAiStatus] = useState<{
    geminiConfigured: boolean;
    groqConfigured: boolean;
  } | null>(null);

  const [title, setTitle] = useState(settings.title);
  const [subtitle, setSubtitle] = useState(settings.subtitle);
  const [authorName, setAuthorName] = useState(settings.authorName);
  const [organizerName, setOrganizerName] = useState(settings.organizerName);
  const [dedication, setDedication] = useState(settings.dedication);
  const [founderGuide, setFounderGuide] = useState(settings.founderGuidePrompt);
  const [savedToast, setSavedToast] = useState(false);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [importingArchive, setImportingArchive] = useState(false);

  useEffect(() => {
    setTitle(settings.title);
    setSubtitle(settings.subtitle);
    setAuthorName(settings.authorName);
    setOrganizerName(settings.organizerName);
    setDedication(settings.dedication);
    setFounderGuide(settings.founderGuidePrompt);
  }, [settings.id]);

  useEffect(() => {
    fetch('/api/ai/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setAiStatus(d);
      })
      .catch(() => {});
  }, []);

  async function patchSettings(patch: Partial<BookSettings>) {
    const optimistic = { ...settings, ...patch };
    onSettingsUpdated(optimistic);
    const res = await fetch(withBookId('/api/book/settings', bookId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      setSavedToast(true);
      window.setTimeout(() => setSavedToast(false), 1800);
    }
  }

  async function handleSaveBookDetails(e: React.FormEvent) {
    e.preventDefault();
    await patchSettings({
      title,
      subtitle,
      authorName,
      organizerName,
      dedication,
      founderGuidePrompt: founderGuide,
    });
  }

  async function handleResolveEditing(chapterId: string, status: 'in-review' | 'completed') {
    const res = await fetch(
      withBookId(`/api/chapters/${chapterId}/request-editing`, bookId),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }
    );
    const updated = await parseJsonResponse<Chapter>(res, 'Could not update status');
    onChaptersUpdated(chapters.map((c) => (c.id === chapterId ? updated : c)));
  }

  function handleDownloadArchive() {
    setArchiveError(null);
    const json = JSON.stringify(workspace, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(settings.inviteCode || settings.id).toLowerCase()}-archive.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setArchiveNotice('Book archive downloaded.');
    window.setTimeout(() => setArchiveNotice(null), 2500);
  }

  async function handleImportArchive(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setArchiveError(null);
    setArchiveNotice(null);
    setImportingArchive(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as BookWorkspaceData;
      if (!parsed?.settings || !Array.isArray(parsed?.chapters)) {
        throw new Error('Selected file is not a valid Remember Press archive JSON.');
      }
      const targetBookId = parsed.settings.id || bookId;
      const res = await fetch(withBookId('/api/book/sync', targetBookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          settings: {
            ...parsed.settings,
            id: targetBookId,
          },
        }),
      });
      const synced = await parseJsonResponse<BookWorkspaceData>(
        res,
        'Could not restore book archive'
      );
      onWorkspaceImported?.(synced);
      setArchiveNotice(`Restored "${synced.settings.title}" (${synced.chapters.length} chapters).`);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : 'Could not restore archive file.');
    } finally {
      setImportingArchive(false);
    }
  }

  const editingQueue = chapters.filter(
    (c) => c.editingStatus === 'requested' || c.editingStatus === 'in-review'
  );

  return (
    <div className="max-w-[1040px] mx-auto px-6 py-8 space-y-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E4E2DD] pb-6">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#1B4332]">Studio &amp; Book Administration</p>
          <h1 className="font-editorial text-3xl font-semibold text-[#18181B]">
            Voice AI Engine, Visibility &amp; Book Settings
          </h1>
          <p className="text-sm text-[#57534E]">
            Configure audio transcription providers, organizer preview visibility, Founder’s
            Method guidance, and human editing requests.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenSetup}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Start or Join Another Book
        </button>
      </div>

      {savedToast && (
        <div className="p-3 rounded-lg bg-[#1B4332]/10 border border-[#1B4332]/25 text-xs font-medium text-[#1B4332] inline-flex items-center gap-1.5">
          <Check className="w-4 h-4" />
          Settings saved
        </div>
      )}

      {/* 1. Dual Voice & AI API Architecture Switch */}
      <section className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-5">
        <div className="space-y-1">
          <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
            Voice &amp; AI Processing Engine
          </h2>
          <p className="text-xs text-[#57534E]">
            Choose between fast, low-demand models for instant voice transcription and story
            rewriting, with automatic cross-provider fallback.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(
            [
              {
                id: 'groq' as AiVoiceProvider,
                name: 'Groq (Whisper Turbo + Qwen 3.8)',
                detail:
                  'Fastest (~0.4s): Groq whisper-large-v3-turbo for speech-to-text and qwen/qwen3.8-27b streaming for instant rewriting & prompts.',
                available: aiStatus ? aiStatus.groqConfigured : false,
              },
              {
                id: 'gemini-lite' as AiVoiceProvider,
                name: 'Gemini 3.1 Flash Lite',
                detail:
                  'Fast Gemini (~1.5s): low-demand Gemini 3.5 Transcribe + Flash Lite for audio, photos & drafts.',
                available: aiStatus ? aiStatus.geminiConfigured : true,
              },
              {
                id: 'gemini' as AiVoiceProvider,
                name: 'Gemini 4 Hydrogen',
                detail:
                  'Heavyweight editorial model (higher peak latency; automatically fails over if slow).',
                available: aiStatus ? aiStatus.geminiConfigured : true,
              },
            ] as const
          ).map((provider) => {
            const active = settings.preferredAiProvider === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => patchSettings({ preferredAiProvider: provider.id })}
                className={`p-4 text-left rounded-xl border transition-colors cursor-pointer space-y-2 ${
                  active
                    ? 'border-[#1B4332] bg-[#1B4332]/5'
                    : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-editorial text-base font-semibold text-[#18181B]">
                    {provider.name}
                  </span>
                  <span className="text-xs font-medium text-[#1B4332]">
                    {active ? 'Selected' : 'Use'}
                  </span>
                </div>
                <p className="text-xs text-[#57534E] leading-relaxed">{provider.detail}</p>
                <p className="text-xs text-[#57534E]">
                  Status:{' '}
                  <span className="font-medium text-[#18181B]">
                    {provider.available
                      ? 'Configured'
                      : 'Not configured in Secrets (uses fallback)'}
                  </span>
                </p>
              </button>
            );
          })}
        </div>

        <label className="inline-flex items-center gap-2.5 text-xs font-medium text-[#18181B] cursor-pointer">
          <input
            type="checkbox"
            checked={settings.enableProviderFallback}
            onChange={(e) => patchSettings({ enableProviderFallback: e.target.checked })}
            className="accent-[#1B4332] w-4 h-4"
          />
          Enable automatic graceful fallback across models &amp; providers during 503 high-demand spikes
        </label>
      </section>

      {/* 2. Organizer Visibility Control */}
      <section className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
              Author Book Preview Visibility
            </h2>
            <p className="text-xs text-[#57534E] max-w-xl">
              {settings.bookMode === 'gift'
                ? `Because this book is being created for ${settings.authorName}, you can keep Book Preview hidden from the author while gathering stories—or turn it ON anytime.`
                : 'Control whether Book Preview appears in the storyteller’s simplified view.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              patchSettings({ authorPreviewEnabled: !settings.authorPreviewEnabled })
            }
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 cursor-pointer ${
              settings.authorPreviewEnabled
                ? 'bg-[#1B4332] text-white border-[#1B4332]'
                : 'bg-[#FAF9F6] text-[#18181B] border-[#E4E2DD]'
            }`}
          >
            {settings.authorPreviewEnabled ? (
              <>
                <Eye className="w-4 h-4" />
                Book Preview for Author: ON
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" />
                Book Preview for Author: OFF
              </>
            )}
          </button>
        </div>

        {activeRole === 'author' && !settings.authorPreviewEnabled && (
          <p className="text-xs text-[#57534E]">
            Note: In Author view, the Book Preview tab is currently hidden until turned ON by the
            organizer.
          </p>
        )}
      </section>

      {/* 3. Book Metadata & Founder's Coaching Guide */}
      <form
        onSubmit={handleSaveBookDetails}
        className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-5"
      >
        <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
          Book Details &amp; Founder’s Coaching Guide
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">Book Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">Subtitle</label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">
              Storyteller (Author)
            </label>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">Organizer</label>
            <input
              type="text"
              value={organizerName}
              onChange={(e) => setOrganizerName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#57534E] mb-1">Dedication</label>
          <input
            type="text"
            value={dedication}
            onChange={(e) => setDedication(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#57534E] mb-1">
            Default Prompt Schedule
          </label>
          <select
            value={settings.promptCadence}
            onChange={(e) => patchSettings({ promptCadence: e.target.value as PromptCadence })}
            className="px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="on-demand">On-Demand (Anytime)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#57534E] mb-1">
            Founder’s Book-Writing Method (Guides AI Question &amp; Story Generation)
          </label>
          <textarea
            rows={4}
            value={founderGuide}
            onChange={(e) => setFounderGuide(e.target.value)}
            className="w-full p-3 text-xs leading-relaxed bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
          >
            Save Book &amp; Guide Settings
          </button>
        </div>
      </form>

      {/* 4. Human Editing Requests Queue */}
      <section className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Edit3 className="w-4 h-4 text-[#1B4332]" />
          <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
            Human Editing Requests ({editingQueue.length})
          </h2>
        </div>

        {editingQueue.length === 0 ? (
          <p className="text-xs text-[#57534E]">
            No chapters are currently flagged for human editing. Storytellers can click “Request
            Editing” on any memory during review.
          </p>
        ) : (
          <div className="divide-y divide-[#E4E2DD]">
            {editingQueue.map((ch) => (
              <div
                key={ch.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-[#18181B]">
                    Chapter {ch.order}: {ch.title}
                  </p>
                  <p className="text-xs text-[#57534E]">
                    Status: {ch.editingStatus}
                    {ch.editingNote ? ` · Note: “${ch.editingNote}”` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {ch.editingStatus === 'requested' && (
                    <button
                      type="button"
                      onClick={() => handleResolveEditing(ch.id, 'in-review')}
                      className="px-3 py-1.5 text-xs font-medium bg-[#F2EFE9] rounded-md cursor-pointer"
                    >
                      Mark In Review
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleResolveEditing(ch.id, 'completed')}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-[#1B4332] rounded-md cursor-pointer"
                  >
                    Mark Completed
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 5. Book Archive Backup & Restore */}
      <section className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
            Book Archive Backup &amp; Restore
          </h2>
          <p className="text-xs text-[#57534E]">
            Export a portable JSON archive of all chapters, prompts, photos, and glossary corrections,
            or restore a previously saved archive file.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadArchive}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download Book Archive (.json)
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer">
            <Upload className="w-3.5 h-3.5 text-[#1B4332]" />
            {importingArchive ? 'Restoring Archive...' : 'Restore / Import Archive (.json)'}
            <input
              type="file"
              accept="application/json,.json"
              onChange={handleImportArchive}
              disabled={importingArchive}
              className="hidden"
            />
          </label>
        </div>

        {archiveNotice && (
          <p className="text-xs font-medium text-[#1B4332]">{archiveNotice}</p>
        )}
        {archiveError && (
          <p className="text-xs text-[#B91C1C]">{archiveError}</p>
        )}
      </section>
    </div>
  );
}
