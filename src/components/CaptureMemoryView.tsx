import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Edit3,
  FileAudio,
  Lightbulb,
  Loader2,
  Lock,
  MessageCircleQuestion,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
} from 'lucide-react';
import type {
  AiEditLevel,
  BookSettings,
  BookWorkspaceData,
  Chapter,
  CorrectionCategory,
  GuidedPrompt,
  MemoryPhoto,
  PhotoExplanationStoryResponse,
  PhotoMemoryQuestionsResponse,
  SpellingCorrection,
  ToneStrength,
  TranscribeAndDraftResponse,
  WritingTone,
} from '../types';
import {
  blobToBase64,
  compressImageFile,
  ensureImageDataUrl,
  parseJsonResponse,
  pickAudioRecorderMime,
  withBookId,
} from '../utils/api';
import { applyGlossaryToFields, groupGlossaryByCategory } from '../utils/spelling';
import { ResilientImage } from './ResilientImage';

interface CaptureMemoryViewProps {
  workspace: BookWorkspaceData;
  activePrompt: GuidedPrompt | null;
  onBackHome: () => void;
  onChapterSaved: (chapter: Chapter) => void;
  onPhotoSaved: (photo: MemoryPhoto) => void;
  onSettingsUpdated?: (settings: BookSettings) => void;
  onGoToReview: (chapterId: string) => void;
}

const AI_LEVELS: Array<{ id: AiEditLevel; label: string; hint: string }> = [
  { id: 'raw', label: 'Raw Transcript', hint: 'Exact spoken words, punctuation only' },
  { id: 'light', label: 'Light Cleanup', hint: 'Fixes filler words, keeps 95%+ phrasing' },
  { id: 'balanced', label: 'Balanced Polish', hint: 'Smooth flow, authentic voice intact' },
  { id: 'full', label: 'Full Rewrite', hint: 'Rich memoir prose, truthful to facts' },
];

const WRITING_TONES: WritingTone[] = [
  'Warm Memoir',
  'Preserve Spoken Voice',
  'Crisp Literary',
  'Legacy Biography',
];

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function CaptureMemoryView({
  workspace,
  activePrompt,
  onBackHome,
  onChapterSaved,
  onPhotoSaved,
  onSettingsUpdated,
  onGoToReview,
}: CaptureMemoryViewProps) {
  const bookId = workspace.settings.id;
  const initialGrouped = groupGlossaryByCategory(workspace.settings.spellingGlossary);

  // Capture mode: Speak, Photo & Explain, or Write
  const [captureMode, setCaptureMode] = useState<'speak' | 'photo' | 'write'>(
    activePrompt?.photoUrl ? 'photo' : 'speak'
  );

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [uploadedAudioName, setUploadedAudioName] = useState('');

  // Pre-recording Name, Place & Address Spelling Helper
  const [showSpellingHelper, setShowSpellingHelper] = useState(false);
  const [knownNames, setKnownNames] = useState(initialGrouped.names);
  const [knownPlaces, setKnownPlaces] = useState(initialGrouped.places);
  const [knownAddresses, setKnownAddresses] = useState(initialGrouped.addresses);

  // Photo state (supports prompt photo or newly uploaded photo)
  const [photoSrc, setPhotoSrc] = useState<string>(activePrompt?.photoUrl || '');
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [photoHint, setPhotoHint] = useState('');
  const [photoLead, setPhotoLead] = useState('');
  const [photoQuestions, setPhotoQuestions] = useState<string[]>(
    activePrompt?.photoUrl ? activePrompt.memoryTriggers : []
  );
  const [askingPhotoQuestions, setAskingPhotoQuestions] = useState(false);

  // Written notes state
  const [writtenText, setWrittenText] = useState('');

  // AI Control ("Helper, Not Replacement")
  const [aiEditLevel, setAiEditLevel] = useState<AiEditLevel>('balanced');
  const [toneStrength, setToneStrength] = useState<ToneStrength>('slight');
  const [writingTone, setWritingTone] = useState<WritingTone>('Warm Memoir');

  // Processing & Source-Checked Review Draft
  const [isProcessing, setIsProcessing] = useState(false);
  const [isReshaping, setIsReshaping] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);

  const [hasDraft, setHasDraft] = useState(false);
  const [rawTranscript, setRawTranscript] = useState('');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftEraLabel, setDraftEraLabel] = useState('');
  const [draftEpigraph, setDraftEpigraph] = useState('');
  const [draftPullQuote, setDraftPullQuote] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [followUps, setFollowUps] = useState<string[]>([]);

  // Post-recording Name, Place & Address Fixer
  const [fixCategory, setFixCategory] = useState<CorrectionCategory>('name');
  const [fixWrong, setFixWrong] = useState('');
  const [fixCorrect, setFixCorrect] = useState('');
  const [rememberFix, setRememberFix] = useState(true);
  const [fixFeedback, setFixFeedback] = useState<string | null>(null);

  // Privacy & Human Editing Flags
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingRequested, setEditingRequested] = useState(false);
  const [editingNote, setEditingNote] = useState('');

  // Save state
  const [saving, setSaving] = useState(false);
  const [savedChapterId, setSavedChapterId] = useState<string | null>(null);

  // MediaRecorder & Waveform refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (activePrompt?.photoUrl) {
      setPhotoSrc(activePrompt.photoUrl);
      setPhotoQuestions(activePrompt.memoryTriggers || []);
      setCaptureMode('photo');
    }
  }, [activePrompt?.id]);

  useEffect(() => {
    return () => {
      stopVisualizer();
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    };
  }, []);

  function stopVisualizer() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }

  function startVisualizer(stream: MediaStream) {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const draw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const c = canvas.getContext('2d');
        if (!c) return;
        analyser.getByteTimeDomainData(data);
        c.clearRect(0, 0, canvas.width, canvas.height);
        c.fillStyle = '#F2EFE9';
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.lineWidth = 2;
        c.strokeStyle = '#1B4332';
        c.beginPath();
        const slice = canvas.width / data.length;
        let x = 0;
        for (let i = 0; i < data.length; i++) {
          const y = ((data[i] / 128.0) * canvas.height) / 2;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
          x += slice;
        }
        c.lineTo(canvas.width, canvas.height / 2);
        c.stroke();
        animRef.current = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      // Progressive enhancement
    }
  }

  async function handleStartRecording() {
    setErrorMsg(null);
    setSavedChapterId(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredMime = pickAudioRecorderMime();

      let recorder: MediaRecorder;
      try {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime, audioBitsPerSecond: 64000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      } catch {
        recorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);
      }

      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const resolved = recorder.mimeType || preferredMime || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type: resolved });
        setAudioBlob(blob);
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        stopVisualizer();
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(250);
      startVisualizer(stream);
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);
      setAudioBlob(null);
      setUploadedAudioName('');
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMsg(
        'Microphone access was blocked or unavailable. You can switch to Write or upload an audio file instead.'
      );
    }
  }

  function handlePauseResume() {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (isPaused) {
      rec.resume();
      setIsPaused(false);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      rec.pause();
      setIsPaused(true);
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }

  function handleStopRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setIsPaused(false);
  }

  function handleResetAudio() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setAudioBlob(null);
    setUploadedAudioName('');
    if (audioPreviewUrl) {
      URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl(null);
    }
  }

  function handleAudioUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    if (file.size > 20 * 1024 * 1024) {
      setErrorMsg('Please choose an audio clip smaller than 20 MB.');
      return;
    }
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioBlob(file);
    setUploadedAudioName(file.name);
    setAudioPreviewUrl(URL.createObjectURL(file));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const { dataUrl, mimeType } = await compressImageFile(file);
      setPhotoSrc(dataUrl);
      setPhotoMime(mimeType);
      setPhotoLead('');
      setPhotoQuestions([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not read photograph.');
    }
  }

  async function handleAskPhotoQuestions() {
    if (!photoSrc) return;
    setAskingPhotoQuestions(true);
    setErrorMsg(null);
    try {
      const { dataUrl, mimeType } = await ensureImageDataUrl(photoSrc, photoMime);
      const res = await fetch(withBookId('/api/ai/photo-memory-questions', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: dataUrl,
          mimeType,
          memoryHint: photoHint,
        }),
      });
      const data = await parseJsonResponse<PhotoMemoryQuestionsResponse>(
        res,
        'Could not suggest photo questions'
      );
      setPhotoLead(data.observationLead || '');
      setPhotoQuestions(data.questions || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not inspect photograph.');
    } finally {
      setAskingPhotoQuestions(false);
    }
  }

  async function handleTurnIntoStory() {
    setErrorMsg(null);
    setProviderNotice(null);
    setSavedChapterId(null);
    setIsProcessing(true);

    try {
      if (captureMode === 'photo' && photoSrc) {
        if (!audioBlob && !writtenText.trim()) {
          throw new Error(
            'Record a voice explanation or type what this photograph helps you remember.'
          );
        }
        const { dataUrl, mimeType } = await ensureImageDataUrl(photoSrc, photoMime);
        let audioBase64: string | undefined;
        let audioMimeType: string | undefined;
        if (audioBlob) {
          audioBase64 = await blobToBase64(audioBlob);
          audioMimeType = audioBlob.type || 'audio/webm';
        }
        const res = await fetch(withBookId('/api/ai/photo-explanation-story', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageBase64: dataUrl,
            mimeType,
            audioBase64,
            audioMimeType,
            writtenExplanation: writtenText.trim() || undefined,
            askedQuestions: [activePrompt?.question, ...photoQuestions].filter(Boolean),
            storytellerName: workspace.settings.authorName,
            memoryHint: photoHint,
            writingTone,
            aiEditLevel,
            toneStrength,
            spellingHints: {
              names: knownNames,
              places: knownPlaces,
              addresses: knownAddresses,
            },
          }),
        });
        const data = await parseJsonResponse<PhotoExplanationStoryResponse>(
          res,
          'Could not create story from photo explanation'
        );
        setRawTranscript(data.transcript);
        setSavedAudioUrl(data.audioUrl);
        setDraftTitle(data.chapterTitle || data.caption || 'A Moment Remembered');
        setDraftSubtitle(data.chapterSubtitle || data.yearLabel || '');
        setDraftEraLabel(data.yearLabel || '');
        setDraftEpigraph('');
        setDraftPullQuote(data.caption || '');
        setDraftBody(data.storyNarrative || data.transcript);
        setFollowUps(data.memoryQuestions || []);
        setHasDraft(true);
        setFixFeedback(null);
        if (data.fallbackNotice || data.providerUsed) {
          setProviderNotice(
            data.fallbackNotice || `Processed with ${data.providerUsed}`
          );
        }
      } else {
        if (captureMode === 'speak' && !audioBlob && !writtenText.trim()) {
          throw new Error('Record your voice story or upload an audio file first.');
        }
        if (captureMode === 'write' && !writtenText.trim()) {
          throw new Error('Write your memory notes first.');
        }

        let audioBase64: string | undefined;
        let mimeType: string | undefined;
        if (audioBlob && captureMode === 'speak') {
          audioBase64 = await blobToBase64(audioBlob);
          mimeType = audioBlob.type || 'audio/webm';
        }

        const res = await fetch(withBookId('/api/ai/transcribe-and-draft', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType,
            transcriptOverride: captureMode === 'write' ? writtenText.trim() : undefined,
            promptQuestion: activePrompt?.question || '',
            storytellerName: workspace.settings.authorName,
            writingTone,
            aiEditLevel,
            toneStrength,
            spellingHints: {
              names: knownNames,
              places: knownPlaces,
              addresses: knownAddresses,
            },
          }),
        });
        const data = await parseJsonResponse<TranscribeAndDraftResponse>(
          res,
          'Could not process memory'
        );
        setRawTranscript(data.transcript);
        setSavedAudioUrl(data.audioUrl);
        setDraftTitle(data.chapter.title);
        setDraftSubtitle(data.chapter.subtitle);
        setDraftEraLabel(data.chapter.eraLabel || '');
        setDraftEpigraph(data.chapter.epigraph);
        setDraftPullQuote(data.chapter.pullQuote);
        setDraftBody(data.chapter.body);
        setFollowUps(data.chapter.followUpQuestions || []);
        setHasDraft(true);
        setFixFeedback(null);
        setProviderNotice(
          data.fallbackNotice || `Processed with ${data.providerUsed}`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleApplyTermFix(e: React.FormEvent) {
    e.preventDefault();
    const wrong = fixWrong.trim();
    const correct = fixCorrect.trim();
    if (!wrong || !correct) return;

    const { next, totalCount } = applyGlossaryToFields(
      {
        transcript: rawTranscript,
        title: draftTitle,
        subtitle: draftSubtitle,
        eraLabel: draftEraLabel,
        pullQuote: draftPullQuote,
        body: draftBody,
      },
      wrong,
      correct
    );

    setRawTranscript(next.transcript);
    setDraftTitle(next.title);
    setDraftSubtitle(next.subtitle);
    setDraftEraLabel(next.eraLabel);
    setDraftPullQuote(next.pullQuote);
    setDraftBody(next.body);

    if (rememberFix) {
      const currentGlossary = workspace.settings.spellingGlossary || [];
      const alreadyExists = currentGlossary.some(
        (g) =>
          g.wrong.toLowerCase() === wrong.toLowerCase() &&
          g.correct.toLowerCase() === correct.toLowerCase()
      );
      if (!alreadyExists) {
        const entry: SpellingCorrection = {
          id: `gloss-${Date.now().toString(36)}`,
          category: fixCategory,
          wrong,
          correct,
        };
        const nextGlossary = [entry, ...currentGlossary];
        const nextSettings = { ...workspace.settings, spellingGlossary: nextGlossary };
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
        ? `Replaced ${totalCount} occurrence${totalCount === 1 ? '' : 's'} of “${wrong}” with “${correct}” across transcript and draft.`
        : `No exact match for “${wrong}” in current text${rememberFix ? ' — saved spelling for future recordings.' : '.'}`
    );
    setFixWrong('');
    setFixCorrect('');
  }

  function handleApplySavedGlossary() {
    const glossary = workspace.settings.spellingGlossary || [];
    let fields = {
      transcript: rawTranscript,
      title: draftTitle,
      subtitle: draftSubtitle,
      eraLabel: draftEraLabel,
      pullQuote: draftPullQuote,
      body: draftBody,
    };
    let grandTotal = 0;
    for (const item of glossary) {
      if (!item.wrong.trim() || !item.correct.trim()) continue;
      const res = applyGlossaryToFields(fields, item.wrong, item.correct);
      fields = res.next;
      grandTotal += res.totalCount;
    }
    setRawTranscript(fields.transcript);
    setDraftTitle(fields.title);
    setDraftSubtitle(fields.subtitle);
    setDraftEraLabel(fields.eraLabel);
    setDraftPullQuote(fields.pullQuote);
    setDraftBody(fields.body);
    setFixFeedback(
      grandTotal > 0
        ? `Applied book spelling glossary (${grandTotal} correction${grandTotal === 1 ? '' : 's'}).`
        : 'All saved spellings already match.'
    );
  }

  async function handleReshapeLevel(
    nextLevel: AiEditLevel,
    nextStrength: ToneStrength = toneStrength,
    nextTone: WritingTone = writingTone
  ) {
    setAiEditLevel(nextLevel);
    setToneStrength(nextStrength);
    setWritingTone(nextTone);
    if (!hasDraft || !rawTranscript.trim()) return;

    setIsReshaping(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId('/api/ai/rewrite-memory', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: rawTranscript,
          currentTitle: draftTitle,
          currentSubtitle: draftSubtitle,
          writingTone: nextTone,
          aiEditLevel: nextLevel,
          toneStrength: nextStrength,
        }),
      });
      const data = await parseJsonResponse<{
        title: string;
        subtitle: string;
        epigraph: string;
        pullQuote: string;
        body: string;
        providerUsed: string;
        fallbackNotice?: string;
      }>(res, 'Could not adjust AI edit level');
      if (data.title) setDraftTitle(data.title);
      if (data.subtitle) setDraftSubtitle(data.subtitle);
      if (data.epigraph) setDraftEpigraph(data.epigraph);
      if (data.pullQuote) setDraftPullQuote(data.pullQuote);
      setDraftBody(data.body);
      setProviderNotice(data.fallbackNotice || `Updated via ${data.providerUsed}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to adjust polish level.');
    } finally {
      setIsReshaping(false);
    }
  }

  async function handleSaveMemory() {
    if (!draftBody.trim() && !rawTranscript.trim()) return;
    setSaving(true);
    setErrorMsg(null);

    try {
      const res = await fetch(withBookId('/api/chapters', bookId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draftTitle.trim() || 'Untitled Memory',
          subtitle: draftSubtitle.trim(),
          eraLabel: draftEraLabel.trim() || draftSubtitle.trim(),
          promptQuestion: activePrompt?.question || 'Spontaneous memory',
          epigraph: draftEpigraph.trim(),
          pullQuote: draftPullQuote.trim(),
          body: draftBody.trim() || rawTranscript.trim(),
          transcript: rawTranscript.trim(),
          audioUrl: savedAudioUrl,
          audioDurationSeconds: elapsedSeconds,
          writingTone,
          aiEditLevel,
          toneStrength,
          isPrivate,
          editingStatus: editingRequested ? 'requested' : 'none',
          editingNote: editingRequested ? editingNote.trim() : '',
          followUpQuestions: followUps,
          promptId: activePrompt?.id,
        }),
      });
      const createdChapter = await parseJsonResponse<Chapter>(
        res,
        'Could not save memory to book'
      );
      onChapterSaved(createdChapter);

      if (photoSrc) {
        const photoPayload = photoSrc.startsWith('data:')
          ? { imageBase64: photoSrc, mimeType: photoMime }
          : { imageUrl: photoSrc };
        const pRes = await fetch(withBookId('/api/photos', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...photoPayload,
            chapterId: createdChapter.id,
            caption: draftPullQuote || createdChapter.title,
            storyNarrative: createdChapter.body,
            memoryHint: photoHint,
            yearLabel: draftEraLabel,
            placement: 'chapter-opener',
            followUpQuestions: photoQuestions,
          }),
        });
        if (pRes.ok) {
          const createdPhoto = (await pRes.json()) as MemoryPhoto;
          onPhotoSaved(createdPhoto);
        }
      }

      setSavedChapterId(createdChapter.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save chapter.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-[1160px] mx-auto px-6 py-8 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackHome}
          className="inline-flex items-center gap-1.5 text-sm text-[#57534E] hover:text-[#18181B] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </button>
        <span className="text-xs text-[#57534E]">
          AI Engine:{' '}
          <strong className="font-medium text-[#18181B]">
            {workspace.settings.preferredAiProvider === 'groq'
              ? 'Groq Whisper v3 Turbo + Qwen 3.8'
              : workspace.settings.preferredAiProvider === 'gemini'
                ? 'Gemini 4 Hydrogen'
                : 'Gemini 3.1 Flash Lite'}
          </strong>
        </span>
      </div>

      {/* Prompt Context Card (when answering from Inbox) */}
      {activePrompt ? (
        <div className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
            <span>From {activePrompt.createdBy}</span>
            <span aria-hidden="true">·</span>
            <span>{activePrompt.category}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">~{activePrompt.estimatedMinutes} min</span>
          </div>
          <h1 className="font-editorial text-2xl md:text-3xl font-semibold text-[#18181B] leading-snug">
            {activePrompt.question}
          </h1>

          {activePrompt.voicePromptUrl && (
            <div className="p-4 rounded-lg bg-[#F2EFE9] space-y-1.5 max-w-lg">
              <p className="text-xs font-medium text-[#1B4332]">
                Voice message from {activePrompt.createdBy}
              </p>
              <audio controls src={activePrompt.voicePromptUrl} className="w-full h-9" />
            </div>
          )}

          {activePrompt.coachingTip && (
            <p className="text-xs text-[#57534E] flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-[#1B4332] shrink-0 mt-0.5" />
              <span>{activePrompt.coachingTip}</span>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#1B4332]">Spontaneous Story Capture</p>
          <h1 className="font-editorial text-3xl font-semibold text-[#18181B]">
            Add a Memory in Your Own Words
          </h1>
          <p className="text-sm text-[#57534E]">
            Share by voice, around a family photograph, or in writing—we will help organize where
            it belongs in the book.
          </p>
        </div>
      )}

      {/* Capture Mode Tabs + Capture Box */}
      <div className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#EFECE6] pb-4">
          <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-lg">
            <button
              type="button"
              onClick={() => setCaptureMode('speak')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                captureMode === 'speak'
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Speak Story
            </button>
            <button
              type="button"
              onClick={() => setCaptureMode('photo')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                captureMode === 'photo'
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Photo &amp; Explain
            </button>
            <button
              type="button"
              onClick={() => setCaptureMode('write')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                captureMode === 'write'
                  ? 'bg-white text-[#18181B] shadow-xs'
                  : 'text-[#57534E] hover:text-[#18181B]'
              }`}
            >
              Write Notes
            </button>
          </div>

          <span className="text-xs text-[#57534E]">
            Original audio &amp; transcript are always preserved
          </span>
        </div>

        {/* Photo Upload / Preview Area (when in Photo mode) */}
        {captureMode === 'photo' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start pb-4 border-b border-[#EFECE6]">
            <div className="md:col-span-5 space-y-3">
              {photoSrc ? (
                <div className="space-y-2.5">
                  <div className="aspect-[4/3] rounded-lg overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
                    <ResilientImage
                      src={photoSrc}
                      alt="Memory photograph"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1B4332] hover:underline cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    Choose another photo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center aspect-[4/3] p-6 border border-dashed border-[#D6D3CD] rounded-lg bg-[#FAF9F6] hover:border-[#1B4332] transition-colors cursor-pointer text-center space-y-2">
                  <Camera className="w-7 h-7 text-[#1B4332]" />
                  <span className="text-sm font-medium text-[#18181B]">
                    Upload a family photograph
                  </span>
                  <span className="text-xs text-[#57534E]">
                    Then speak or write what this photo helps you remember
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoUpload}
                    className="hidden"
                  />
                </label>
              )}
            </div>

            <div className="md:col-span-7 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Quick Note (Optional: Who or Where)
                </label>
                <input
                  type="text"
                  value={photoHint}
                  onChange={(e) => setPhotoHint(e.target.value)}
                  placeholder="e.g., My sister and me at Lake Cedar, 1974"
                  className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>

              <div className="p-4 rounded-lg bg-[#F2EFE9] space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#1B4332] inline-flex items-center gap-1.5">
                    <MessageCircleQuestion className="w-4 h-4" />
                    What does this photo help you remember?
                  </span>
                  <button
                    type="button"
                    onClick={handleAskPhotoQuestions}
                    disabled={askingPhotoQuestions || !photoSrc}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B4332] bg-white border border-[#E4E2DD] rounded-md hover:border-[#1B4332] cursor-pointer disabled:opacity-50"
                  >
                    {askingPhotoQuestions ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Looking at photo...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3.5 h-3.5" />
                        Ask Memory Questions
                      </>
                    )}
                  </button>
                </div>

                {photoLead && (
                  <p className="font-editorial italic text-sm text-[#18181B]">“{photoLead}”</p>
                )}
                {photoQuestions.length > 0 && (
                  <ul className="space-y-1.5 text-xs text-[#18181B]">
                    {photoQuestions.map((q, i) => (
                      <li key={i}>• {q}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Voice Recorder (Available in Speak AND Photo modes) */}
        {(captureMode === 'speak' || captureMode === 'photo') && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={handleStartRecording}
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    {audioBlob
                      ? 'Record Again'
                      : captureMode === 'photo'
                        ? 'Speak Photo Memory'
                        : 'Start Recording'}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handlePauseResume}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#18181B] bg-[#F2EFE9] rounded-lg hover:bg-[#E4E2DD] cursor-pointer"
                    >
                      {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                      {isPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={handleStopRecording}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#B91C1C] rounded-lg hover:bg-[#991B1B] cursor-pointer"
                    >
                      <Square className="w-4 h-4" />
                      Finish Recording
                    </button>
                  </>
                )}

                <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer">
                  <FileAudio className="w-3.5 h-3.5 text-[#1B4332]" />
                  Upload Audio
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    className="hidden"
                  />
                </label>

                {audioBlob && !isRecording && (
                  <button
                    type="button"
                    onClick={handleResetAudio}
                    className="inline-flex items-center gap-1 text-xs text-[#57534E] hover:text-[#18181B] cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Clear
                  </button>
                )}
              </div>

              <span className="font-mono text-sm text-[#18181B] tabular-nums">
                {isRecording
                  ? `${isPaused ? 'Paused' : 'Recording'} · ${formatDuration(elapsedSeconds)}`
                  : audioBlob
                    ? `Ready · ${uploadedAudioName || formatDuration(elapsedSeconds)}`
                    : '00:00'}
              </span>
            </div>

            <canvas
              ref={canvasRef}
              width={800}
              height={64}
              className="w-full h-14 rounded-lg bg-[#F2EFE9] border border-[#E4E2DD]"
            />

            {audioPreviewUrl && !isRecording && (
              <audio controls src={audioPreviewUrl} className="w-full h-10" />
            )}

            {captureMode === 'photo' && (
              <div className="pt-1">
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Or type what this photograph reminds you of (if you prefer not to speak)
                </label>
                <textarea
                  rows={3}
                  value={writtenText}
                  onChange={(e) => setWrittenText(e.target.value)}
                  placeholder="Share the names, the story behind the moment, or why it stayed with you..."
                  className="w-full p-3 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
            )}
          </div>
        )}

        {/* Write Mode */}
        {captureMode === 'write' && (
          <div>
            <textarea
              rows={6}
              value={writtenText}
              onChange={(e) => setWrittenText(e.target.value)}
              placeholder="Write naturally just like you’d tell a grandchild across the table. We can keep your exact words or gently polish them."
              className="w-full p-4 text-sm leading-relaxed bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
            />
          </div>
        )}

        {/* Pre-Recording Proper Noun Spelling Helper (Names, Places, Addresses) */}
        <div className="pt-3 border-t border-[#EFECE6] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowSpellingHelper((v) => !v)}
              className="text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
            >
              {showSpellingHelper
                ? 'Hide Name, Place & Address Spelling Helper'
                : '+ Add Specific Names, Places, or Addresses Before Transcribing'}
            </button>
            <span className="text-xs text-[#57534E]">
              Helps speech-to-text spell family names, towns &amp; street addresses accurately
            </span>
          </div>

          {showSpellingHelper && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-4 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD]">
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  People’s Names (comma-separated)
                </label>
                <input
                  type="text"
                  value={knownNames}
                  onChange={(e) => setKnownNames(e.target.value)}
                  placeholder="e.g., Clara Vance, Aunt Małgosia"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Places &amp; Landmarks
                </label>
                <input
                  type="text"
                  value={knownPlaces}
                  onChange={(e) => setKnownPlaces(e.target.value)}
                  placeholder="e.g., Cedar Cove, Heron Creek"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Street Addresses &amp; Cities
                </label>
                <input
                  type="text"
                  value={knownAddresses}
                  onChange={(e) => setKnownAddresses(e.target.value)}
                  placeholder="e.g., 412 Elm Street, Portland, OR"
                  className="w-full px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Controllable AI Level Selector BEFORE generating */}
        <div className="pt-4 border-t border-[#EFECE6] space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#18181B]">
                AI Writing Helper Level (Always Keeps Original Audio &amp; Transcript)
              </p>
              <p className="text-xs text-[#57534E]">
                Choose how lightly or deeply AI helps shape your words—you can change this anytime
                below.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={writingTone}
                onChange={(e) => setWritingTone(e.target.value as WritingTone)}
                className="px-3 py-1.5 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
              >
                {WRITING_TONES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-lg">
                {(['slight', 'stronger'] as ToneStrength[]).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setToneStrength(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                      toneStrength === st
                        ? 'bg-white text-[#18181B] shadow-xs'
                        : 'text-[#57534E]'
                    }`}
                  >
                    {st} tone
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {AI_LEVELS.map((lvl) => (
              <button
                key={lvl.id}
                type="button"
                onClick={() => setAiEditLevel(lvl.id)}
                className={`p-3 text-left rounded-lg border transition-colors cursor-pointer ${
                  aiEditLevel === lvl.id
                    ? 'border-[#1B4332] bg-[#1B4332]/5'
                    : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                }`}
              >
                <p className="text-xs font-semibold text-[#18181B]">{lvl.label}</p>
                <p className="text-xs text-[#57534E] mt-0.5">{lvl.hint}</p>
              </button>
            ))}
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <span className="text-xs text-[#57534E]">
              {providerNotice || 'Ready whenever you are.'}
            </span>
            <button
              type="button"
              onClick={handleTurnIntoStory}
              disabled={isProcessing || isRecording}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Transcribing &amp; Preparing Review...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  {hasDraft ? 'Re-Run Transcription & Draft' : 'Prepare Source-Checked Draft'}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Source-Checked Review Panel */}
      {hasDraft && (
        <div className="border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EFECE6] pb-4">
            <div>
              <p className="text-xs font-semibold text-[#1B4332]">Source-Checked Review</p>
              <h2 className="font-editorial text-2xl font-semibold text-[#18181B]">
                Compare Your Original Words Beside the Draft
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {AI_LEVELS.map((lvl) => (
                <button
                  key={lvl.id}
                  type="button"
                  disabled={isReshaping}
                  onClick={() => handleReshapeLevel(lvl.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    aiEditLevel === lvl.id
                      ? 'bg-[#1B4332] text-white border-[#1B4332]'
                      : 'bg-[#FAF9F6] text-[#18181B] border-[#E4E2DD] hover:border-[#1B4332]'
                  }`}
                >
                  {lvl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name, Place & Address Correction Bar */}
          <form
            onSubmit={handleApplyTermFix}
            className="p-4 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#18181B]">
                Correct Misheard Names, Places &amp; Addresses
              </p>
              {(workspace.settings.spellingGlossary?.length || 0) > 0 && (
                <button
                  type="button"
                  onClick={handleApplySavedGlossary}
                  className="text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
                >
                  Apply Saved Book Spellings ({workspace.settings.spellingGlossary?.length})
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
              <select
                value={fixCategory}
                onChange={(e) => setFixCategory(e.target.value as CorrectionCategory)}
                className="sm:col-span-2 px-2.5 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg"
              >
                <option value="name">Name</option>
                <option value="place">Place</option>
                <option value="address">Address</option>
              </select>
              <input
                type="text"
                value={fixWrong}
                onChange={(e) => setFixWrong(e.target.value)}
                placeholder="Misheard (e.g., Klara or Helm St)"
                className="sm:col-span-4 px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
              />
              <input
                type="text"
                value={fixCorrect}
                onChange={(e) => setFixCorrect(e.target.value)}
                placeholder="Correct spelling (e.g., Clara or 412 Elm St)"
                className="sm:col-span-4 px-3 py-1.5 text-xs bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
              />
              <button
                type="submit"
                disabled={!fixWrong.trim() || !fixCorrect.trim()}
                className="sm:col-span-2 px-3 py-1.5 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
              >
                Fix in Story
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#57534E]">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberFix}
                  onChange={(e) => setRememberFix(e.target.checked)}
                  className="accent-[#1B4332] w-3.5 h-3.5"
                />
                Remember this spelling for future recordings in this book
              </label>
              {fixFeedback && <span className="text-[#1B4332] font-medium">{fixFeedback}</span>}
            </div>
          </form>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Original Source */}
            <div className="lg:col-span-5 space-y-3 p-4 rounded-lg bg-[#F2EFE9]">
              <p className="text-xs font-semibold text-[#18181B]">
                Original Spoken Source (Preserved)
              </p>
              {(audioPreviewUrl || savedAudioUrl) && (
                <audio
                  controls
                  src={audioPreviewUrl || savedAudioUrl || undefined}
                  className="w-full h-9"
                />
              )}
              <textarea
                rows={10}
                value={rawTranscript}
                onChange={(e) => setRawTranscript(e.target.value)}
                className="w-full p-3 text-xs leading-relaxed bg-white border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
              />
              <p className="text-xs text-[#57534E]">
                Switching AI Helper Level above always re-reads from this original source so nothing
                is lost.
              </p>
            </div>

            {/* Right: Editable Story Draft */}
            <div className="lg:col-span-7 space-y-4">
              {isReshaping && (
                <div className="flex items-center gap-2 text-xs text-[#1B4332]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Adjusting AI level from your original transcript...
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#57534E] mb-1">
                    Chapter Title
                  </label>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-editorial font-semibold bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#57534E] mb-1">
                    Era / Setting Subtitle
                  </label>
                  <input
                    type="text"
                    value={draftSubtitle}
                    onChange={(e) => setDraftSubtitle(e.target.value)}
                    placeholder="e.g., Summer 1974 · Cedar Cove"
                    className="w-full px-3 py-2 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#57534E] mb-1">
                  Story Draft
                </label>
                <textarea
                  rows={10}
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="w-full p-3.5 text-sm leading-relaxed bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                />
              </div>

              {/* Privacy + Human Editing Controls */}
              <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#EFECE6]">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#18181B] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                      className="accent-[#1B4332] w-4 h-4"
                    />
                    <Lock className="w-3.5 h-3.5 text-[#57534E]" />
                    Keep Private (exclude from book preview)
                  </label>

                  <button
                    type="button"
                    onClick={() => setEditingRequested((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                      editingRequested
                        ? 'bg-[#B45309]/10 text-[#92400E] border-[#B45309]/40'
                        : 'bg-white text-[#18181B] border-[#E4E2DD] hover:border-[#1B4332]'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    {editingRequested ? 'Editing Requested ✓' : 'Request Editing'}
                  </button>
                </div>

                {savedChapterId ? (
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332]">
                      <Check className="w-4 h-4" />
                      Saved to Book
                    </span>
                    <button
                      type="button"
                      onClick={() => onGoToReview(savedChapterId)}
                      className="px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg cursor-pointer"
                    >
                      Open in Stories &amp; Review
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleSaveMemory}
                    disabled={saving}
                    className="px-6 py-2.5 text-sm font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                  >
                    {saving ? 'Saving Memory...' : 'Approve & Save to Book'}
                  </button>
                )}
              </div>

              {editingRequested && (
                <div>
                  <input
                    type="text"
                    value={editingNote}
                    onChange={(e) => setEditingNote(e.target.value)}
                    placeholder="Optional note for human editor (e.g., check uncle's spelling or smooth middle paragraph)..."
                    className="w-full px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
