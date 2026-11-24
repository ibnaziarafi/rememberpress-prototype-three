import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Camera,
  Check,
  ChevronRight,
  Copy,
  Eye,
  FileText,
  Heart,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Mic,
  Plus,
  Send,
  Sparkles,
  Square,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import type {
  BookSettings,
  BookWorkspaceData,
  GuidedPrompt,
  PhotoMemoryQuestionsResponse,
  PromptCadence,
  PromptCategory,
  UserRole,
} from '../types';
import {
  blobToBase64,
  compressImageFile,
  parseJsonResponse,
  pickAudioRecorderMime,
  withBookId,
} from '../utils/api';
import { ResilientImage } from './ResilientImage';

interface QuestionPoolViewProps {
  workspace: BookWorkspaceData;
  activeRole: UserRole;
  currentMemberName: string;
  onPromptsUpdated: (prompts: GuidedPrompt[]) => void;
  onSettingsUpdated: (settings: BookSettings) => void;
  onAnswerPrompt: (prompt: GuidedPrompt) => void;
  onViewChapter?: (chapterId: string) => void;
}

const CATEGORIES: PromptCategory[] = [
  'Childhood & Early Days',
  'Family & Roots',
  'Love & Companionship',
  'Craft, Work & Calling',
  'Turning Points',
  'Traditions & Table',
  'Wisdom & Legacy',
];

const CURATED_QUESTIONS: Record<PromptCategory, string[]> = {
  'Childhood & Early Days': [
    'What was your favorite room in the house you grew up in?',
    'What is your earliest childhood memory?',
    'If you were giving a tour of your hometown, what would be on the tour?',
    'What was the first major news story you remember from your childhood?',
    'Did you have any pets growing up and how did they come into your life?',
    'What did summer afternoons feel like when you were ten years old?',
  ],
  'Family & Roots': [
    'What is a good feeling you associate with your parents or grandparents?',
    'What family saying or piece of wisdom did you hear most growing up?',
    'Who in your family taught you how to work with your hands or solve problems?',
    'What story about your grandparents do you never want forgotten?',
    'What was Sunday dinner like in your home growing up?',
  ],
  'Love & Companionship': [
    'How did you and your partner first meet, and what made you notice them?',
    'What small, ordinary moment together still makes you smile?',
    'What was the hardest season you walked through together, and what saw you through?',
    'What surprised you most about becoming a parent for the first time?',
  ],
  'Craft, Work & Calling': [
    'What was your very first job, and what did you spend your first paycheck on?',
    'What project or day at work are you proudest of?',
    'Who was a mentor or boss who changed the direction of your life?',
    'What skill took you years to learn that you still love doing today?',
  ],
  'Turning Points': [
    'What was the hardest thing you had to overcome, and who helped you through it?',
    'Tell me about a leap of faith or big move that changed everything.',
    'When did you first feel truly independent?',
    'What unexpected detour turned out to be a blessing?',
  ],
  'Traditions & Table': [
    'What was your favorite meal as a child, and who cooked it?',
    'Which holiday tradition meant the most to our family?',
    'What song always brings everyone back into the kitchen or living room?',
    'Describe a trip or family gathering you wish you could relive for one afternoon.',
  ],
  'Wisdom & Legacy': [
    'What makes you genuinely happy in this chapter of your life?',
    'What values do you hope your grandchildren carry forward?',
    'What is something you used to worry about that turned out not to matter?',
    'What do you most want people to remember about the way you lived?',
  ],
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FM';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function QuestionPoolView({
  workspace,
  activeRole,
  currentMemberName,
  onPromptsUpdated,
  onSettingsUpdated,
  onAnswerPrompt,
  onViewChapter,
}: QuestionPoolViewProps) {
  const { settings, collaborators, prompts, chapters } = workspace;
  const bookId = settings.id;
  const firstName = settings.authorName.split(' ')[0] || settings.authorName;
  const isCollaborator = activeRole === 'collaborator';
  const canRecordAnswer = activeRole === 'author';
  const canManageSchedule =
    activeRole === 'organizer' || (activeRole === 'author' && settings.bookMode === 'self');

  const [poolFilter, setPoolFilter] = useState<'all' | 'inbox' | 'queued' | 'answered'>('all');
  const [viewingPrompt, setViewingPrompt] = useState<GuidedPrompt | null>(null);

  // Add Prompts Modal ("hub" | "photo" | "question" | "category" | "poll")
  const [modalOpen, setModalOpen] = useState(false);
  const [modalStep, setModalStep] = useState<'hub' | 'photo' | 'question' | 'category' | 'poll'>(
    'hub'
  );
  const [selectedCategory, setSelectedCategory] = useState<PromptCategory>('Childhood & Early Days');
  const [checkedQuestions, setCheckedQuestions] = useState<string[]>([]);

  // Composer state inside modal
  const [questionText, setQuestionText] = useState('');
  const [category, setCategory] = useState<PromptCategory>('Family & Roots');
  const [cadence, setCadence] = useState<PromptCadence>(settings.promptCadence);
  const [sendImmediately, setSendImmediately] = useState(true);

  // Photo Prompt + Keep/Remove suggested questions
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoMimeType, setPhotoMimeType] = useState('image/jpeg');
  const [photoHint, setPhotoHint] = useState('');
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);

  // Voice Prompt recording
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voicePreviewUrl, setVoicePreviewUrl] = useState<string | null>(null);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<number | null>(null);

  // AI Founder's Guide Generator
  const [lifeContext, setLifeContext] = useState('');
  const [generatingPool, setGeneratingPool] = useState(false);

  const [savingPrompt, setSavingPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
      if (voiceStreamRef.current) voiceStreamRef.current.getTracks().forEach((t) => t.stop());
      if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
    };
  }, []);

  function openModal(step: 'hub' | 'photo' | 'question' | 'category' | 'poll' = 'hub') {
    setErrorMsg(null);
    setModalStep(step);
    setModalOpen(true);
  }

  function closeModal() {
    if (isRecordingVoice) handleStopVoicePrompt();
    setModalOpen(false);
  }

  function resetComposer() {
    setQuestionText('');
    setPhotoDataUrl('');
    setPhotoHint('');
    setSuggestedQuestions([]);
    setShowVoiceRecorder(false);
    setVoiceBlob(null);
    if (voicePreviewUrl) {
      URL.revokeObjectURL(voicePreviewUrl);
      setVoicePreviewUrl(null);
    }
    setVoiceSeconds(0);
    setCheckedQuestions([]);
  }

  async function handleCopyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedState(label);
      window.setTimeout(() => setCopiedState(null), 2200);
    } catch {
      // Clipboard fallback ignored
    }
  }

  async function handleCadenceChange(next: PromptCadence) {
    setCadence(next);
    const updated = { ...settings, promptCadence: next };
    onSettingsUpdated(updated);
    await fetch(withBookId('/api/book/settings', bookId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptCadence: next }),
    });
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const { dataUrl, mimeType } = await compressImageFile(file);
      setPhotoDataUrl(dataUrl);
      setPhotoMimeType(mimeType);
      if (!questionText.trim()) {
        setQuestionText('What was happening in this photo?');
      }
      setSuggestedQuestions([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load image.');
    }
  }

  async function handleAnalyzePhotoQuestions() {
    if (!photoDataUrl) return;
    setAnalyzingPhoto(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId('/api/ai/photo-memory-questions', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: photoDataUrl,
          mimeType: photoMimeType,
          memoryHint: photoHint || questionText,
        }),
      });
      const data = await parseJsonResponse<PhotoMemoryQuestionsResponse>(
        res,
        'Could not analyze photograph'
      );
      if (data.observationLead && !questionText.trim()) {
        setQuestionText(data.observationLead);
      }
      setSuggestedQuestions(data.questions || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to analyze photo.');
    } finally {
      setAnalyzingPhoto(false);
    }
  }

  async function handleStartVoicePrompt() {
    setErrorMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      voiceChunksRef.current = [];
      const mime = pickAudioRecorderMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      voiceRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) voiceChunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || mime || 'audio/mp4',
        });
        setVoiceBlob(blob);
        if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl);
        setVoicePreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(250);
      setIsRecordingVoice(true);
      setVoiceSeconds(0);
      setVoiceBlob(null);
      if (voiceTimerRef.current) window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = window.setInterval(() => {
        setVoiceSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setErrorMsg('Microphone permission unavailable for voice prompt recording.');
    }
  }

  function handleStopVoicePrompt() {
    if (voiceTimerRef.current) {
      window.clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
    if (voiceRecorderRef.current && voiceRecorderRef.current.state !== 'inactive') {
      voiceRecorderRef.current.stop();
    }
    setIsRecordingVoice(false);
  }

  async function handleCreateSinglePrompt(e: React.FormEvent, mode: 'photo' | 'question') {
    e.preventDefault();
    if (!questionText.trim() && !voiceBlob && !photoDataUrl) return;
    setErrorMsg(null);
    setSavingPrompt(true);

    try {
      let voicePromptBase64: string | undefined;
      let voicePromptMimeType: string | undefined;
      if (voiceBlob) {
        voicePromptBase64 = await blobToBase64(voiceBlob);
        voicePromptMimeType = voiceBlob.type || 'audio/webm';
      }

      const res = await fetch(withBookId('/api/prompts/collaborator', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          question: questionText.trim() || 'Listen to my voice question for this memory',
          memoryTriggers: suggestedQuestions,
          createdBy: currentMemberName || settings.organizerName || 'Family',
          cadence,
          status: sendImmediately ? 'inbox' : 'queued',
          photoBase64: mode === 'photo' && photoDataUrl ? photoDataUrl : undefined,
          photoMimeType: mode === 'photo' ? photoMimeType : undefined,
          voicePromptBase64,
          voicePromptMimeType,
          voicePromptDurationSeconds: voiceSeconds,
        }),
      });
      const created = await parseJsonResponse<GuidedPrompt>(
        res,
        'Could not add prompt to pool'
      );
      onPromptsUpdated([created, ...prompts]);
      resetComposer();
      closeModal();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save prompt.');
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleAddCuratedQuestions() {
    if (checkedQuestions.length === 0) return;
    setSavingPrompt(true);
    setErrorMsg(null);
    try {
      const createdList: GuidedPrompt[] = [];
      for (const q of checkedQuestions) {
        const res = await fetch(withBookId('/api/prompts/collaborator', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: selectedCategory,
            question: q,
            memoryTriggers: [],
            createdBy: currentMemberName || settings.organizerName || 'Family',
            cadence,
            status: sendImmediately ? 'inbox' : 'queued',
          }),
        });
        const created = await parseJsonResponse<GuidedPrompt>(res, 'Could not add prompt');
        createdList.push(created);
      }
      onPromptsUpdated([...createdList, ...prompts]);
      resetComposer();
      closeModal();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save selected prompts.');
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleGenerateFounderPrompts() {
    setGeneratingPool(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId('/api/ai/guided-prompts', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          lifeContext,
          existingTitles: chapters.map((c) => c.title),
          createdBy: `${currentMemberName} (Founder’s Guide)`,
          cadence,
          status: sendImmediately ? 'inbox' : 'queued',
        }),
      });
      const data = await parseJsonResponse<{ prompts: GuidedPrompt[] }>(
        res,
        'Could not generate prompts'
      );
      onPromptsUpdated([...data.prompts, ...prompts]);
      setLifeContext('');
      closeModal();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Prompt generation failed.');
    } finally {
      setGeneratingPool(false);
    }
  }

  async function handleUpdatePromptStatus(id: string, status: 'inbox' | 'queued') {
    const res = await fetch(withBookId(`/api/prompts/${id}`, bookId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const updated = (await res.json()) as GuidedPrompt;
      onPromptsUpdated(prompts.map((p) => (p.id === id ? updated : p)));
    }
  }

  async function handleDeletePrompt(id: string) {
    const res = await fetch(withBookId(`/api/prompts/${id}`, bookId), { method: 'DELETE' });
    if (res.ok) {
      onPromptsUpdated(prompts.filter((p) => p.id !== id));
    }
  }

  async function handleToggleVote(id: string) {
    const voter = currentMemberName || settings.organizerName || 'Family';
    const res = await fetch(withBookId(`/api/prompts/${id}/vote`, bookId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberName: voter }),
    });
    if (res.ok) {
      const updated = (await res.json()) as GuidedPrompt;
      onPromptsUpdated(prompts.map((p) => (p.id === id ? updated : p)));
    }
  }

  const filteredPrompts = prompts.filter((p) => {
    if (poolFilter === 'all') return true;
    return p.status === poolFilter;
  });

  const inviteLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?invite=${encodeURIComponent(settings.inviteCode)}&role=collaborator`
      : `?invite=${settings.inviteCode}&role=collaborator`;

  const storytellerLink =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?invite=${encodeURIComponent(settings.inviteCode)}&role=author`
      : `?invite=${settings.inviteCode}&role=author`;

  function buildEmailHref(url: string, promptQuestion?: string) {
    const subject = encodeURIComponent(
      promptQuestion
        ? `Memory question for "${settings.title}"`
        : `Your recording link for "${settings.title}"`
    );
    const body = encodeURIComponent(
      promptQuestion
        ? `Hi ${firstName},\n\nWhenever you have a quiet moment, we'd love to hear your story on this question:\n\n"${promptQuestion}"\n\nJust tap this link and press Record (no password needed):\n${url}\n\nLove,\n${settings.organizerName}`
        : `Hi ${firstName},\n\nHere is your recording link for "${settings.title}"—just tap the link and press Record whenever you're ready:\n\n${url}\n\nLove,\n${settings.organizerName}`
    );
    return `mailto:?subject=${subject}&body=${body}`;
  }

  function buildSmsHref(url: string, promptQuestion?: string) {
    const body = encodeURIComponent(
      promptQuestion
        ? `Hi ${firstName}, we sent a memory prompt for "${settings.title}": "${promptQuestion}" — tap here to record: ${url}`
        : `Hi ${firstName}, here is your recording link for "${settings.title}" (no login needed): ${url}`
    );
    return `sms:?&body=${body}`;
  }

  return (
    <div className="max-w-[1160px] mx-auto px-5 sm:px-8 py-8 space-y-7">
      {/* Header matching Screenshot 10 & 13: Title + Collaborator Avatars + Invite + Add prompts */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E4E2DD] pb-5">
        <div className="space-y-1">
          <h1 className="font-editorial text-3xl font-semibold text-[#18181B]">Prompts</h1>
          <p className="text-xs text-[#57534E]">
            Queue questions, photo memories, or voice messages for {firstName}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Collaborator initials stack */}
          <div className="hidden sm:flex items-center -space-x-2 mr-1">
            {collaborators.slice(0, 4).map((c) => (
              <div
                key={c.id}
                title={`${c.name} (${c.relationship})`}
                className="w-8 h-8 rounded-full bg-[#E8F09C] border-2 border-[#FAF9F6] text-[#142E26] text-[11px] font-semibold flex items-center justify-center"
              >
                {getInitials(c.name)}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => openModal('poll')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-[#1B4332]" />
            Invite
          </button>

          <button
            type="button"
            onClick={() => openModal('hub')}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add prompts
          </button>
        </div>
      </div>

      {/* Filter & Cadence Control Strip */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-[#EFECE6] rounded-lg w-fit">
          {(
            [
              { id: 'all', label: `All (${prompts.length})` },
              {
                id: 'inbox',
                label: `Waiting for ${firstName} (${prompts.filter((p) => p.status === 'inbox').length})`,
              },
              {
                id: 'queued',
                label: `To be sent (${prompts.filter((p) => p.status === 'queued').length})`,
              },
              {
                id: 'answered',
                label: `Answered (${prompts.filter((p) => p.status === 'answered').length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPoolFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                poolFilter === tab.id
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-xs text-[#57534E]">Prompt Rhythm:</span>
          {canManageSchedule ? (
            <div className="inline-flex items-center gap-1 p-1 bg-[#EFECE6] rounded-lg">
              {(['daily', 'weekly', 'on-demand'] as PromptCadence[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleCadenceChange(c)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                    settings.promptCadence === c
                      ? 'bg-white text-[#18181B] shadow-xs'
                      : 'text-[#57534E] hover:text-[#18181B]'
                  }`}
                >
                  {c === 'on-demand' ? 'Anytime' : c}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-xs font-medium text-[#18181B] capitalize">
              {settings.promptCadence === 'on-demand' ? 'Anytime' : settings.promptCadence}
            </span>
          )}
        </div>
      </div>

      {/* Prompt Rows List (Screenshot 10) or Calm Empty State (Screenshot 13) */}
      {filteredPrompts.length === 0 ? (
        <div className="border border-[#E4E2DD] rounded-2xl bg-white p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-[#F2EFE9] text-[#1B4332] flex items-center justify-center mx-auto">
            <FileText className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <p className="font-editorial text-xl font-semibold text-[#18181B]">
              Stories start with prompts
            </p>
            <p className="text-sm text-[#57534E]">
              Add your first photo, custom question, or curated category prompt for {firstName}.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openModal('hub')}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 min-h-[44px] text-xs font-semibold text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[#1B4332]" />
            Add prompts
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPrompts.map((prompt) => {
            const directLink =
              typeof window !== 'undefined'
                ? `${window.location.origin}/?invite=${encodeURIComponent(
                    settings.inviteCode
                  )}&prompt=${encodeURIComponent(prompt.id)}`
                : '';
            const voterName = currentMemberName || settings.organizerName || 'Family';
            const hasVoted = Boolean(prompt.votedBy?.includes(voterName));
            const voteCount = prompt.votes || 0;

            return (
              <article
                key={prompt.id}
                className="border border-[#E4E2DD] rounded-xl bg-white p-4 sm:p-5 hover:border-[#1B4332]/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  {prompt.photoUrl ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-[#E4E2DD] shrink-0 bg-[#EFECE6]">
                      <ResilientImage
                        src={prompt.photoUrl}
                        alt="Prompt photo"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[#F2EFE9] text-[#57534E] flex items-center justify-center shrink-0">
                      {prompt.voicePromptUrl ? (
                        <Volume2 className="w-5 h-5 text-[#1B4332]" />
                      ) : (
                        <FileText className="w-5 h-5 text-[#57534E]" />
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5 min-w-0 flex-1">
                    <p className="font-editorial text-lg font-medium text-[#18181B] leading-snug">
                      {prompt.question}
                    </p>
                    <p className="text-xs text-[#57534E]">
                      By {prompt.createdBy} · {prompt.category} ·{' '}
                      {prompt.status === 'inbox'
                        ? `Waiting in ${firstName}’s Inbox`
                        : prompt.status === 'answered'
                          ? 'Answered'
                          : 'To be sent'}
                    </p>
                    {prompt.voicePromptUrl && (
                      <audio controls src={prompt.voicePromptUrl} className="w-full max-w-xs h-8 pt-1" />
                    )}
                    {prompt.memoryTriggers.length > 0 && (
                      <p className="text-xs text-[#57534E] truncate">
                        Cues: {prompt.memoryTriggers.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right-side compact row actions */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleToggleVote(prompt.id)}
                    title="Vote for this prompt"
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[38px] text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                      hasVoted
                        ? 'bg-[#1B4332]/10 text-[#1B4332] border-[#1B4332]/40'
                        : 'bg-[#FAF9F6] text-[#57534E] border-[#E4E2DD] hover:text-[#18181B]'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${hasVoted ? 'fill-[#1B4332]' : ''}`} />
                    <span className="tabular-nums">{voteCount}</span>
                  </button>

                  {canRecordAnswer && prompt.status !== 'answered' && (
                    <button
                      type="button"
                      onClick={() => onAnswerPrompt(prompt)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[38px] text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      Record
                    </button>
                  )}

                  {canManageSchedule && prompt.status === 'queued' && (
                    <button
                      type="button"
                      onClick={() => handleUpdatePromptStatus(prompt.id, 'inbox')}
                      className="px-3.5 py-2 min-h-[38px] text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
                    >
                      Send now
                    </button>
                  )}

                  {canManageSchedule && prompt.status === 'inbox' && (
                    <button
                      type="button"
                      onClick={() => handleUpdatePromptStatus(prompt.id, 'queued')}
                      className="px-3 py-2 min-h-[38px] text-xs text-[#57534E] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:text-[#18181B] cursor-pointer"
                    >
                      Queue
                    </button>
                  )}

                  {!isCollaborator && prompt.status === 'queued' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleCopyText(directLink, prompt.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs text-[#57534E] hover:text-[#18181B] cursor-pointer"
                        title="Copy direct recording link"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {copiedState === prompt.id ? 'Copied' : 'Link'}
                      </button>
                      <a
                        href={buildEmailHref(directLink, prompt.question)}
                        className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs text-[#57534E] hover:text-[#18181B]"
                        title="Send via Email"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Email
                      </a>
                      <a
                        href={buildSmsHref(directLink, prompt.question)}
                        className="inline-flex items-center gap-1 px-2.5 py-2 min-h-[38px] text-xs text-[#57534E] hover:text-[#18181B]"
                        title="Send via Text"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Text
                      </a>
                    </>
                  )}

                  {(prompt.status === 'inbox' || prompt.status === 'answered') && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          prompt.status === 'answered' &&
                          prompt.answeredChapterId &&
                          onViewChapter
                        ) {
                          onViewChapter(prompt.answeredChapterId);
                        } else {
                          setViewingPrompt(prompt);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-[#1B4332]" />
                      View
                    </button>
                  )}

                  {canManageSchedule && (
                    <button
                      type="button"
                      aria-label="Remove prompt"
                      onClick={() => handleDeletePrompt(prompt.id)}
                      className="p-2 min-h-[38px] text-[#57534E] hover:text-[#B91C1C] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ADD PROMPTS MODAL (Screenshots 8, 11, 12) */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#18181B]/45 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#FAF9F6] border border-[#E4E2DD] shadow-xl">
            {/* Modal Top Bar */}
            <div className="px-6 py-4 bg-white border-b border-[#E4E2DD] flex items-center justify-between sticky top-0 z-10">
              <div className="flex items-center gap-2">
                {modalStep !== 'hub' && (
                  <button
                    type="button"
                    onClick={() =>
                      setModalStep(modalStep === 'category' ? 'question' : 'hub')
                    }
                    className="p-1.5 rounded-lg text-[#57534E] hover:text-[#18181B] hover:bg-[#F2EFE9] cursor-pointer"
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <h2 className="font-editorial text-lg font-semibold text-[#18181B]">
                  {modalStep === 'hub'
                    ? 'Add prompts'
                    : modalStep === 'photo'
                      ? 'Upload a photo prompt'
                      : modalStep === 'question'
                        ? 'Ask a question'
                        : modalStep === 'category'
                          ? selectedCategory
                          : 'Share & invite family'}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="p-1.5 rounded-lg text-[#57534E] hover:text-[#18181B] hover:bg-[#F2EFE9] cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* MODAL STEP: HUB (Screenshot 8: Upload a photo / Add a question / Poll family) */}
              {modalStep === 'hub' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    type="button"
                    onClick={() => setModalStep('photo')}
                    className="rounded-xl border border-[#E4E2DD] bg-white hover:border-[#1B4332] transition-colors p-5 text-center space-y-4 cursor-pointer flex flex-col items-center justify-between"
                  >
                    <div className="w-full h-28 rounded-lg bg-[#F2EFE9] flex items-center justify-center">
                      <Camera className="w-9 h-9 text-[#1B4332]" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#18181B]">Upload a photo</p>
                      <p className="text-xs text-[#57534E]">
                        Add a photo to inspire a story.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalStep('question')}
                    className="rounded-xl border border-[#E4E2DD] bg-white hover:border-[#1B4332] transition-colors p-5 text-center space-y-4 cursor-pointer flex flex-col items-center justify-between"
                  >
                    <div className="w-full h-28 rounded-lg bg-[#F2EFE9] flex items-center justify-center px-3">
                      <div className="bg-white border border-[#E4E2DD] rounded-md p-2.5 text-left w-full shadow-xs">
                        <p className="text-[10px] text-[#57534E]">Childhood</p>
                        <p className="text-xs font-editorial text-[#18181B] leading-tight mt-0.5">
                          What was your favorite meal as a child?
                        </p>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#18181B]">Add a question</p>
                      <p className="text-xs text-[#57534E]">
                        Write your own, record voice, or browse expert categories.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModalStep('poll')}
                    className="rounded-xl border border-[#E4E2DD] bg-white hover:border-[#1B4332] transition-colors p-5 text-center space-y-4 cursor-pointer flex flex-col items-center justify-between"
                  >
                    <div className="w-full h-28 rounded-lg bg-[#F2EFE9] flex items-center justify-center">
                      <div className="w-16 h-16 rounded-xl bg-[#17362D] text-[#E8F09C] flex items-center justify-center">
                        <BarChart3 className="w-8 h-8" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-[#18181B]">
                        Poll your friends &amp; family
                      </p>
                      <p className="text-xs text-[#57534E]">
                        Invite others to suggest &amp; vote on the next prompt.
                      </p>
                    </div>
                  </button>
                </div>
              )}

              {/* MODAL STEP: PHOTO PROMPT */}
              {modalStep === 'photo' && (
                <form
                  onSubmit={(e) => handleCreateSinglePrompt(e, 'photo')}
                  className="space-y-4 bg-white border border-[#E4E2DD] rounded-xl p-5"
                >
                  {photoDataUrl ? (
                    <div className="space-y-2.5">
                      <div className="aspect-[4/3] max-h-64 mx-auto rounded-lg overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
                        <ResilientImage
                          src={photoDataUrl}
                          alt="Uploaded prompt photo"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="text-xs font-medium text-[#1B4332] hover:underline cursor-pointer">
                          Change photo
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleAnalyzePhotoQuestions}
                          disabled={analyzingPhoto}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                        >
                          {analyzingPhoto ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Analyzing...
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" />
                              Suggest Follow-Up Questions
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center p-8 border border-dashed border-[#D6D3CD] rounded-xl bg-[#FAF9F6] hover:border-[#1B4332] cursor-pointer text-center space-y-2">
                      <Camera className="w-7 h-7 text-[#1B4332]" />
                      <span className="text-xs font-medium text-[#18181B]">
                        Upload a photograph to ask “What was happening in this photo?”
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                  )}

                  <input
                    type="text"
                    value={photoHint}
                    onChange={(e) => setPhotoHint(e.target.value)}
                    placeholder="Optional hint for AI (e.g., Grandma's wedding, 1984)"
                    className="w-full px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                  />

                  {suggestedQuestions.length > 0 && (
                    <div className="p-3.5 rounded-lg bg-[#F2EFE9] space-y-2">
                      <p className="text-xs font-semibold text-[#1B4332]">
                        Suggested Follow-Ups (Keep or Remove)
                      </p>
                      <ul className="space-y-1.5">
                        {suggestedQuestions.map((q, idx) => (
                          <li
                            key={idx}
                            className="flex items-start justify-between gap-2 p-2 rounded-md bg-white border border-[#E4E2DD] text-xs text-[#18181B]"
                          >
                            <span>{q}</span>
                            <button
                              type="button"
                              onClick={() =>
                                setSuggestedQuestions((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-[#57534E] hover:text-[#B91C1C] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Question for {firstName}
                    </label>
                    <input
                      type="text"
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                      placeholder="What was happening in this photo?"
                      className="w-full px-3 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as PromptCategory)}
                      className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={sendImmediately ? 'inbox' : 'queued'}
                      onChange={(e) => setSendImmediately(e.target.value === 'inbox')}
                      className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                    >
                      <option value="inbox">Send to Inbox Now</option>
                      <option value="queued">Save in Queue</option>
                    </select>
                  </div>

                  {errorMsg && <p className="text-xs text-[#B91C1C]">{errorMsg}</p>}

                  <button
                    type="submit"
                    disabled={savingPrompt || !photoDataUrl}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {savingPrompt ? 'Saving...' : 'Send Photo Prompt'}
                  </button>
                </form>
              )}

              {/* MODAL STEP: ASK A QUESTION + CATEGORY BROWSER (Screenshot 12) */}
              {modalStep === 'question' && (
                <div className="space-y-6">
                  <form
                    onSubmit={(e) => handleCreateSinglePrompt(e, 'question')}
                    className="bg-white border border-[#E4E2DD] rounded-xl p-5 space-y-4"
                  >
                    <div className="space-y-1.5">
                      <textarea
                        rows={3}
                        maxLength={160}
                        value={questionText}
                        onChange={(e) => setQuestionText(e.target.value)}
                        placeholder={`Ask ${firstName} a question...`}
                        className="w-full p-3 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E]">
                        <button
                          type="button"
                          onClick={() => setShowVoiceRecorder((v) => !v)}
                          className="inline-flex items-center gap-1.5 font-medium text-[#1B4332] hover:underline cursor-pointer"
                        >
                          <Mic className="w-3.5 h-3.5" />
                          {showVoiceRecorder ? 'Hide voice message' : 'Record voice question too'}
                        </button>
                        <span className="tabular-nums">{questionText.length}/160</span>
                      </div>
                    </div>

                    {showVoiceRecorder && (
                      <div className="p-3.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] space-y-2.5">
                        <div className="flex items-center justify-between gap-3">
                          {!isRecordingVoice ? (
                            <button
                              type="button"
                              onClick={handleStartVoicePrompt}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg cursor-pointer"
                            >
                              <Mic className="w-3.5 h-3.5" />
                              {voiceBlob ? 'Re-record Voice' : 'Record Voice Prompt'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handleStopVoicePrompt}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#B91C1C] rounded-lg cursor-pointer"
                            >
                              <Square className="w-3.5 h-3.5" />
                              Stop ({voiceSeconds}s)
                            </button>
                          )}
                          <span className="font-mono text-xs text-[#57534E] tabular-nums">
                            {isRecordingVoice ? 'Recording...' : voiceBlob ? `${voiceSeconds}s ready` : ''}
                          </span>
                        </div>
                        {voicePreviewUrl && !isRecordingVoice && (
                          <audio controls src={voicePreviewUrl} className="w-full h-9" />
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value as PromptCategory)}
                          className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <select
                          value={sendImmediately ? 'inbox' : 'queued'}
                          onChange={(e) => setSendImmediately(e.target.value === 'inbox')}
                          className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                        >
                          <option value="inbox">Send to Inbox Now</option>
                          <option value="queued">Save in Queue</option>
                        </select>
                      </div>

                      <button
                        type="submit"
                        disabled={savingPrompt || isRecordingVoice || (!questionText.trim() && !voiceBlob)}
                        className="px-5 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-45"
                      >
                        {savingPrompt ? 'Adding...' : 'Add question'}
                      </button>
                    </div>
                  </form>

                  {/* Browse Questions by Category Grid (Screenshot 12) */}
                  <div className="space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#57534E]">
                      Browse Questions by Category
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CATEGORIES.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            setSelectedCategory(cat);
                            setCheckedQuestions([]);
                            setModalStep('category');
                          }}
                          className="p-4 rounded-xl bg-white border border-[#E4E2DD] hover:border-[#1B4332] text-left flex items-center justify-between gap-3 transition-colors cursor-pointer"
                        >
                          <div>
                            <p className="text-sm font-semibold text-[#18181B]">{cat}</p>
                            <p className="text-xs text-[#57534E] tabular-nums">
                              {CURATED_QUESTIONS[cat].length} guided questions
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-[#57534E]" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* AI Founder's Guide Generator */}
                  <div className="p-5 rounded-xl bg-white border border-[#E4E2DD] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-[#1B4332]">
                        Generate Personalized Prompts with AI (Founder’s Guide)
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={lifeContext}
                        onChange={(e) => setLifeContext(e.target.value)}
                        placeholder={`e.g., ${firstName} grew up near a shipyard, loved woodworking...`}
                        className="flex-1 min-w-0 px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateFounderPrompts}
                        disabled={generatingPool}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-[#18181B] bg-[#F2EFE9] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-[#1B4332]" />
                        {generatingPool ? 'Crafting...' : `Generate 3 (${category.split(' ')[0]})`}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MODAL STEP: CURATED CATEGORY CHECKLIST (Screenshot 11) */}
              {modalStep === 'category' && (
                <div className="bg-white border border-[#E4E2DD] rounded-xl p-6 space-y-5">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-wider text-[#57534E]">
                      Questions About
                    </p>
                    <h3 className="font-editorial text-2xl font-semibold text-[#18181B]">
                      {selectedCategory}
                    </h3>
                  </div>

                  <div className="divide-y divide-[#EFECE6] border-y border-[#EFECE6]">
                    {CURATED_QUESTIONS[selectedCategory].map((q) => {
                      const checked = checkedQuestions.includes(q);
                      return (
                        <label
                          key={q}
                          className={`flex items-start gap-3 py-3.5 px-3 cursor-pointer transition-colors ${
                            checked ? 'bg-[#F2EFE9]/70' : 'hover:bg-[#FAF9F6]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setCheckedQuestions((prev) =>
                                prev.includes(q) ? prev.filter((item) => item !== q) : [...prev, q]
                              )
                            }
                            className="mt-0.5 w-4 h-4 accent-[#1B4332] shrink-0"
                          />
                          <span className="text-sm text-[#18181B]">{q}</span>
                        </label>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[#18181B] tabular-nums">
                      {checkedQuestions.length}{' '}
                      {checkedQuestions.length === 1 ? 'question' : 'questions'} selected
                    </span>

                    <div className="flex items-center gap-2.5">
                      <select
                        value={sendImmediately ? 'inbox' : 'queued'}
                        onChange={(e) => setSendImmediately(e.target.value === 'inbox')}
                        className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                      >
                        <option value="inbox">Send to Inbox Now</option>
                        <option value="queued">Save in Queue</option>
                      </select>
                      <button
                        type="button"
                        disabled={checkedQuestions.length === 0 || savingPrompt}
                        onClick={handleAddCuratedQuestions}
                        className="px-6 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-45"
                      >
                        {savingPrompt ? 'Adding...' : 'Add selected'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MODAL STEP: INVITE / POLL FAMILY & STORYTELLER LINKS */}
              {modalStep === 'poll' && (
                <div className="space-y-5">
                  <div className="p-5 rounded-xl bg-white border border-[#E4E2DD] space-y-3">
                    <p className="text-sm font-semibold text-[#18181B]">
                      Invite Family to Suggest &amp; Vote on Prompts
                    </p>
                    <p className="text-xs text-[#57534E]">
                      Share this link or invite code ({settings.inviteCode}) with siblings and
                      grandkids so they can add questions and upvote favorites.
                    </p>
                    <div className="p-2.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] font-mono text-xs truncate">
                      {inviteLink}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleCopyText(inviteLink, 'modal-invite')}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[42px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
                    >
                      {copiedState === 'modal-invite' ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Collaborator Link Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          Copy Family Invite Link
                        </>
                      )}
                    </button>
                  </div>

                  {!isCollaborator && (
                    <div className="p-5 rounded-xl bg-white border border-[#E4E2DD] space-y-3">
                      <p className="text-sm font-semibold text-[#18181B]">
                        Send Recording Link Directly to {firstName}
                      </p>
                      <div className="p-2.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] font-mono text-xs truncate">
                        {storytellerLink}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyText(storytellerLink, 'modal-storyteller')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedState === 'modal-storyteller' ? 'Copied' : 'Copy Storyteller Link'}
                        </button>
                        <a
                          href={buildEmailHref(storytellerLink)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332]"
                        >
                          <Mail className="w-3.5 h-3.5 text-[#1B4332]" />
                          Send via Email
                        </a>
                        <a
                          href={buildSmsHref(storytellerLink)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332]"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#1B4332]" />
                          Send via Text
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW PROMPT DETAIL MODAL */}
      {viewingPrompt && (
        <div
          className="fixed inset-0 z-50 bg-[#18181B]/45 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white border border-[#E4E2DD] shadow-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E4E2DD] flex items-center justify-between">
              <div>
                <p className="text-xs text-[#57534E]">
                  {viewingPrompt.category} ·{' '}
                  {viewingPrompt.status === 'answered'
                    ? 'Answered'
                    : viewingPrompt.status === 'inbox'
                      ? `Waiting in ${firstName}’s Inbox`
                      : 'To be sent'}
                </p>
                <h2 className="font-editorial text-lg font-semibold text-[#18181B]">
                  Prompt Details
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setViewingPrompt(null)}
                className="p-1.5 rounded-lg text-[#57534E] hover:text-[#18181B] hover:bg-[#F2EFE9] cursor-pointer"
                aria-label="Close prompt details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {viewingPrompt.photoUrl && (
                <div className="aspect-[4/3] rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
                  <ResilientImage
                    src={viewingPrompt.photoUrl}
                    alt="Prompt photo"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <p className="font-editorial text-xl text-[#18181B] leading-snug">
                {viewingPrompt.question}
              </p>

              <p className="text-xs text-[#57534E]">Asked by {viewingPrompt.createdBy}</p>

              {viewingPrompt.voicePromptUrl && (
                <div className="p-3 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] space-y-1.5">
                  <p className="text-xs font-medium text-[#1B4332]">Attached Voice Prompt</p>
                  <audio controls src={viewingPrompt.voicePromptUrl} className="w-full h-9" />
                </div>
              )}

              {viewingPrompt.memoryTriggers.length > 0 && (
                <div className="p-3.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] space-y-1.5">
                  <p className="text-xs font-semibold text-[#18181B]">Memory Cues</p>
                  <ul className="space-y-1 text-xs text-[#57534E]">
                    {viewingPrompt.memoryTriggers.map((cue, idx) => (
                      <li key={idx}>• {cue}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="pt-2 flex items-center justify-end gap-2">
                {viewingPrompt.status === 'answered' &&
                  viewingPrompt.answeredChapterId &&
                  onViewChapter && (
                    <button
                      type="button"
                      onClick={() => {
                        const chId = viewingPrompt.answeredChapterId!;
                        setViewingPrompt(null);
                        onViewChapter(chId);
                      }}
                      className="px-4 py-2 min-h-[40px] text-xs font-semibold text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
                    >
                      Open Story Chapter
                    </button>
                  )}
                <button
                  type="button"
                  onClick={() => setViewingPrompt(null)}
                  className="px-4 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-[#F2EFE9] rounded-lg hover:bg-[#E4E2DD] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
