import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Edit3,
  FileAudio,
  Loader2,
  Lock,
  MapPin,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Square,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type {
  BookSettings,
  BookWorkspaceData,
  Chapter,
  CorrectionCategory,
  GuidedPrompt,
  MemoryPhoto,
  PhotoExplanationStoryResponse,
  PhotoMemoryQuestionsResponse,
  SpellingCorrection,
  TranscribeAndDraftResponse,
} from '../types';
import {
  blobToBase64,
  compressImageFile,
  ensureImageDataUrl,
  parseJsonResponse,
  pickAudioRecorderMime,
  pickVideoRecorderMime,
  withBookId,
} from '../utils/api';
import { applyGlossaryToFields, groupGlossaryByCategory } from '../utils/spelling';
import { ResilientImage } from './ResilientImage';

interface StorytellerStudioViewProps {
  workspace: BookWorkspaceData;
  initialPrompt: GuidedPrompt | null;
  onChapterSaved: (chapter: Chapter, answeredPromptId?: string) => void;
  onPhotoSaved: (photo: MemoryPhoto) => void;
  onSettingsUpdated: (settings: BookSettings) => void;
  onOpenMyStories: (chapterId?: string) => void;
}

type StudioStep = 'welcome' | 'choose-mode' | 'record' | 'write' | 'review' | 'celebrate';

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getGreetingPrefix(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function splitTotalTime(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return {
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
  };
}

export function StorytellerStudioView({
  workspace,
  initialPrompt,
  onChapterSaved,
  onPhotoSaved,
  onSettingsUpdated,
  onOpenMyStories,
}: StorytellerStudioViewProps) {
  const { settings, prompts, chapters } = workspace;
  const bookId = settings.id;
  const firstName = settings.authorName.split(' ')[0] || settings.authorName;
  const inboxPrompts = prompts.filter((p) => p.status === 'inbox' && !p.answeredChapterId);

  const [step, setStep] = useState<StudioStep>(() => (initialPrompt ? 'choose-mode' : 'welcome'));
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(() => {
    if (initialPrompt) return initialPrompt.id;
    return inboxPrompts[0]?.id || null;
  });

  useEffect(() => {
    if (initialPrompt) {
      setSelectedPromptId(initialPrompt.id);
      setStep('choose-mode');
    }
  }, [initialPrompt?.id]);

  const activePrompt =
    (selectedPromptId ? prompts.find((p) => p.id === selectedPromptId) : null) || null;

  // Audio / Video recording state
  const [captureMode, setCaptureMode] = useState<'audio' | 'video'>('video');
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [recordedIsVideo, setRecordedIsVideo] = useState(false);
  const [uploadedAudioName, setUploadedAudioName] = useState('');
  const [cameraPreviewActive, setCameraPreviewActive] = useState(false);

  // Optional photo & written input
  const [showPhotoBox, setShowPhotoBox] = useState(Boolean(activePrompt?.photoUrl));
  const [photoSrc, setPhotoSrc] = useState<string>(activePrompt?.photoUrl || '');
  const [photoMime, setPhotoMime] = useState<string>('image/jpeg');
  const [photoHint, setPhotoHint] = useState('');
  const [photoQuestions, setPhotoQuestions] = useState<string[]>(
    activePrompt?.photoUrl ? activePrompt.memoryTriggers : []
  );
  const [askingPhotoQuestions, setAskingPhotoQuestions] = useState(false);
  const [writtenText, setWrittenText] = useState('');

  // Names, Places & Addresses helper drawer
  const [showGlossaryPanel, setShowGlossaryPanel] = useState(false);
  const [glossaryCategory, setGlossaryCategory] = useState<CorrectionCategory>('name');
  const [glossaryInput, setGlossaryInput] = useState('');
  const [glossaryStatus, setGlossaryStatus] = useState<string | null>(null);

  // Transcription & Calm Review
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [rawTranscript, setRawTranscript] = useState('');
  const [savedAudioUrl, setSavedAudioUrl] = useState<string | null>(null);
  const [savedVideoUrl, setSavedVideoUrl] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSubtitle, setDraftSubtitle] = useState('');
  const [draftEraLabel, setDraftEraLabel] = useState('');
  const [draftEpigraph, setDraftEpigraph] = useState('');
  const [draftPullQuote, setDraftPullQuote] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [followUps, setFollowUps] = useState<string[]>([]);

  // Post-recording instant follow-up answer
  const [activeFollowUpQuestion, setActiveFollowUpQuestion] = useState<string | null>(null);
  const [isRecordingFollowUp, setIsRecordingFollowUp] = useState(false);
  const [followUpSeconds, setFollowUpSeconds] = useState(0);
  const [appendingFollowUp, setAppendingFollowUp] = useState(false);
  const [followUpFeedback, setFollowUpFeedback] = useState<string | null>(null);

  // Post-recording quick spelling fix
  const [fixWrong, setFixWrong] = useState('');
  const [fixCorrect, setFixCorrect] = useState('');
  const [fixCategory, setFixCategory] = useState<CorrectionCategory>('name');
  const [fixFeedback, setFixFeedback] = useState<string | null>(null);

  // Save state
  const [isPrivate, setIsPrivate] = useState(false);
  const [editingRequested, setEditingRequested] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedChapterId, setSavedChapterId] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const animRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);

  const followUpRecorderRef = useRef<MediaRecorder | null>(null);
  const followUpStreamRef = useRef<MediaStream | null>(null);
  const followUpChunksRef = useRef<Blob[]>([]);
  const followUpTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (activePrompt?.photoUrl) {
      setPhotoSrc(activePrompt.photoUrl);
      setShowPhotoBox(true);
      setPhotoQuestions(activePrompt.memoryTriggers || []);
    } else if (activePrompt) {
      setPhotoSrc('');
      setShowPhotoBox(false);
      setPhotoQuestions([]);
    }
  }, [activePrompt?.id]);

  // Manage subtle live camera PiP preview when in Video record stage
  useEffect(() => {
    let cancelled = false;
    async function startPreviewCamera() {
      if (step !== 'record' || captureMode !== 'video' || isRecording || audioBlob) {
        stopPreviewCamera();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        previewStreamRef.current = stream;
        setCameraPreviewActive(true);
        window.setTimeout(() => {
          if (pipVideoRef.current) {
            pipVideoRef.current.srcObject = stream;
            pipVideoRef.current.play().catch(() => {});
          }
        }, 40);
      } catch {
        setCameraPreviewActive(false);
      }
    }
    startPreviewCamera();
    return () => {
      cancelled = true;
      stopPreviewCamera();
    };
  }, [step, captureMode, isRecording, audioBlob]);

  useEffect(() => {
    return () => {
      stopVisualizer();
      stopPreviewCamera();
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (followUpTimerRef.current) window.clearInterval(followUpTimerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (followUpStreamRef.current) followUpStreamRef.current.getTracks().forEach((t) => t.stop());
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    };
  }, []);

  function stopPreviewCamera() {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    if (pipVideoRef.current) {
      pipVideoRef.current.srcObject = null;
    }
    setCameraPreviewActive(false);
  }

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
      // Optional waveform
    }
  }

  async function handleStartRecording() {
    setErrorMsg(null);
    setSavedChapterId(null);
    stopPreviewCamera();
    const wantsVideo = captureMode === 'video';
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        wantsVideo
          ? { audio: true, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { audio: true }
      );
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredMime = wantsVideo ? pickVideoRecorderMime() : pickAudioRecorderMime();

      let recorder: MediaRecorder;
      try {
        recorder = preferredMime
          ? new MediaRecorder(
              stream,
              wantsVideo
                ? { mimeType: preferredMime, videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 }
                : { mimeType: preferredMime, audioBitsPerSecond: 64000 }
            )
          : new MediaRecorder(stream);
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
        const resolved = recorder.mimeType || preferredMime || (wantsVideo ? 'video/webm' : 'audio/mp4');
        const blob = new Blob(chunksRef.current, { type: resolved });
        setAudioBlob(blob);
        setRecordedIsVideo(wantsVideo || resolved.startsWith('video/'));
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = null;
        }
        stopVisualizer();
        stream.getTracks().forEach((t) => t.stop());
      };

      recorder.start(250);
      if (!wantsVideo) {
        startVisualizer(stream);
      } else {
        window.setTimeout(() => {
          if (liveVideoRef.current) {
            liveVideoRef.current.srcObject = stream;
            liveVideoRef.current.play().catch(() => {});
          }
        }, 60);
      }
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);
      setAudioBlob(null);
      setRecordedIsVideo(wantsVideo);
      setUploadedAudioName('');
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch {
      setErrorMsg(
        wantsVideo
          ? 'Camera or microphone permission is blocked. Allow access or switch to Audio Only.'
          : 'Microphone access is blocked. Allow microphone permission in your browser, or switch to Write.'
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

  function handleClearRecording() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setAudioBlob(null);
    setRecordedIsVideo(false);
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
      setErrorMsg('Please pick an audio or video file smaller than 20 MB.');
      return;
    }
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    setAudioBlob(file);
    setRecordedIsVideo(file.type.startsWith('video/'));
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
      setShowPhotoBox(true);
      setPhotoQuestions([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not load photo.');
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
        'Could not inspect photograph'
      );
      setPhotoQuestions(data.questions || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not inspect photo.');
    } finally {
      setAskingPhotoQuestions(false);
    }
  }

  async function persistGlossary(nextGlossary: SpellingCorrection[]) {
    const nextSettings = { ...settings, spellingGlossary: nextGlossary };
    onSettingsUpdated(nextSettings);
    try {
      await fetch(withBookId('/api/book/settings', bookId), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spellingGlossary: nextGlossary }),
      });
    } catch {
      // Optimistic local state retained
    }
  }

  async function handleAddGlossaryItem(e: React.FormEvent) {
    e.preventDefault();
    const val = glossaryInput.trim();
    if (!val) return;
    const current = settings.spellingGlossary || [];
    const exists = current.some(
      (g) => g.category === glossaryCategory && g.correct.toLowerCase() === val.toLowerCase()
    );
    if (!exists) {
      const entry: SpellingCorrection = {
        id: `gloss-${Date.now().toString(36)}`,
        category: glossaryCategory,
        wrong: '',
        correct: val,
      };
      await persistGlossary([entry, ...current]);
    }
    setGlossaryInput('');
    setGlossaryStatus(`Saved “${val}” to help spell future recordings accurately.`);
    window.setTimeout(() => setGlossaryStatus(null), 2600);
  }

  async function handleRemoveGlossaryItem(id: string) {
    const current = settings.spellingGlossary || [];
    await persistGlossary(current.filter((item) => item.id !== id));
  }

  async function handleTurnIntoStory() {
    setErrorMsg(null);
    setSavedChapterId(null);
    setIsProcessing(true);

    const groupedHints = groupGlossaryByCategory(settings.spellingGlossary);

    try {
      if (photoSrc) {
        if (!audioBlob && !writtenText.trim()) {
          throw new Error('Record or write your memory of this photo first.');
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
            storytellerName: settings.authorName,
            memoryHint: photoHint,
            writingTone: 'Warm Memoir',
            aiEditLevel: 'balanced',
            toneStrength: 'slight',
            spellingHints: groupedHints,
          }),
        });
        const data = await parseJsonResponse<PhotoExplanationStoryResponse>(
          res,
          'Could not create story from recording'
        );
        setRawTranscript(data.transcript);
        setSavedAudioUrl(data.audioUrl);
        setSavedVideoUrl(data.videoUrl || null);
        setDraftTitle(data.chapterTitle || data.caption || 'A Moment Remembered');
        setDraftSubtitle(data.chapterSubtitle || data.yearLabel || '');
        setDraftEraLabel(data.yearLabel || '');
        setDraftEpigraph('');
        setDraftPullQuote(data.caption || '');
        setDraftBody(data.storyNarrative || data.transcript);
        setFollowUps(data.memoryQuestions || []);
        setStep('review');
        setFixFeedback(null);
        setFollowUpFeedback(null);
      } else {
        if (!audioBlob && !writtenText.trim()) {
          throw new Error('Record your voice or write your memory first.');
        }
        let audioBase64: string | undefined;
        let mimeType: string | undefined;
        if (audioBlob) {
          audioBase64 = await blobToBase64(audioBlob);
          mimeType = audioBlob.type || 'audio/webm';
        }
        const res = await fetch(withBookId('/api/ai/transcribe-and-draft', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64,
            mimeType,
            transcriptOverride: !audioBlob ? writtenText.trim() : undefined,
            promptQuestion: activePrompt?.question || '',
            storytellerName: settings.authorName,
            writingTone: 'Warm Memoir',
            aiEditLevel: 'balanced',
            toneStrength: 'slight',
            spellingHints: groupedHints,
          }),
        });
        const data = await parseJsonResponse<TranscribeAndDraftResponse>(
          res,
          'Could not transcribe recording'
        );
        setRawTranscript(data.transcript);
        setSavedAudioUrl(data.audioUrl);
        setSavedVideoUrl(data.videoUrl || null);
        setDraftTitle(data.chapter.title);
        setDraftSubtitle(data.chapter.subtitle);
        setDraftEraLabel(data.chapter.eraLabel || '');
        setDraftEpigraph(data.chapter.epigraph || '');
        setDraftPullQuote(data.chapter.pullQuote || '');
        setDraftBody(data.chapter.body);
        setFollowUps(data.chapter.followUpQuestions || []);
        setStep('review');
        setFixFeedback(null);
        setFollowUpFeedback(null);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Something went wrong while preparing your story.'
      );
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleStartFollowUpRecording(questionText: string) {
    setErrorMsg(null);
    setFollowUpFeedback(null);
    setActiveFollowUpQuestion(questionText);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      followUpStreamRef.current = stream;
      followUpChunksRef.current = [];
      const mime = pickAudioRecorderMime();
      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 })
        : new MediaRecorder(stream, { audioBitsPerSecond: 64000 });
      followUpRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) followUpChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const resolved = recorder.mimeType || mime || 'audio/mp4';
        const blob = new Blob(followUpChunksRef.current, { type: resolved });
        setAppendingFollowUp(true);
        try {
          const audioBase64 = await blobToBase64(blob);
          const res = await fetch(withBookId('/api/ai/transcribe-and-draft', bookId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: resolved,
              promptQuestion: questionText,
              storytellerName: settings.authorName,
              writingTone: 'Preserve Spoken Voice',
              aiEditLevel: 'light',
              toneStrength: 'slight',
              spellingHints: groupGlossaryByCategory(settings.spellingGlossary),
            }),
          });
          const data = await parseJsonResponse<TranscribeAndDraftResponse>(
            res,
            'Could not transcribe follow-up answer'
          );
          const extraText = (data.chapter.body || data.transcript || '').trim();
          const extraTranscript = (data.transcript || '').trim();
          if (extraTranscript) {
            setRawTranscript((prev) =>
              prev
                ? `${prev.trim()}\n\n[Follow-up: ${questionText}]\n${extraTranscript}`
                : extraTranscript
            );
          }
          if (extraText) {
            setDraftBody((prev) => (prev ? `${prev.trim()}\n\n${extraText}` : extraText));
          }
          setFollowUps((prev) => prev.filter((q) => q !== questionText));
          setFollowUpFeedback('Added your follow-up detail into the story.');
          setActiveFollowUpQuestion(null);
        } catch (err) {
          setErrorMsg(
            err instanceof Error ? err.message : 'Could not append your follow-up detail.'
          );
        } finally {
          setAppendingFollowUp(false);
        }
      };
      recorder.start(250);
      setIsRecordingFollowUp(true);
      setFollowUpSeconds(0);
      if (followUpTimerRef.current) window.clearInterval(followUpTimerRef.current);
      followUpTimerRef.current = window.setInterval(() => {
        setFollowUpSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setActiveFollowUpQuestion(null);
      setErrorMsg('Microphone permission is required to record a follow-up answer.');
    }
  }

  function handleStopFollowUpRecording() {
    if (followUpTimerRef.current) {
      window.clearInterval(followUpTimerRef.current);
      followUpTimerRef.current = null;
    }
    if (followUpRecorderRef.current && followUpRecorderRef.current.state !== 'inactive') {
      followUpRecorderRef.current.stop();
    }
    setIsRecordingFollowUp(false);
  }

  async function handleFixWordInStory(e: React.FormEvent) {
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

    const current = settings.spellingGlossary || [];
    const exists = current.some(
      (g) =>
        g.wrong.toLowerCase() === wrong.toLowerCase() &&
        g.correct.toLowerCase() === correct.toLowerCase()
    );
    if (!exists) {
      await persistGlossary([
        {
          id: `gloss-${Date.now().toString(36)}`,
          category: fixCategory,
          wrong,
          correct,
        },
        ...current,
      ]);
    }

    setFixFeedback(
      totalCount > 0
        ? `Fixed ${totalCount} place${totalCount === 1 ? '' : 's'} to “${correct}” and saved for future stories.`
        : `Saved “${correct}” so future recordings spell it right.`
    );
    setFixWrong('');
    setFixCorrect('');
  }

  async function handleSaveStory() {
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
          videoUrl: savedVideoUrl,
          audioDurationSeconds: elapsedSeconds,
          writingTone: 'Warm Memoir',
          aiEditLevel: 'balanced',
          toneStrength: 'slight',
          isPrivate,
          editingStatus: editingRequested ? 'requested' : 'none',
          editingNote: editingRequested ? 'Storyteller asked for light editing review.' : '',
          followUpQuestions: followUps,
          promptId: activePrompt?.id,
        }),
      });
      const created = await parseJsonResponse<Chapter>(res, 'Could not save story');
      onChapterSaved(created, activePrompt?.id);

      if (photoSrc) {
        const photoPayload = photoSrc.startsWith('data:')
          ? { imageBase64: photoSrc, mimeType: photoMime }
          : { imageUrl: photoSrc };
        const pRes = await fetch(withBookId('/api/photos', bookId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...photoPayload,
            chapterId: created.id,
            caption: draftPullQuote || created.title,
            storyNarrative: created.body,
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

      setSavedChapterId(created.id);
      setStep('celebrate');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save story.');
    } finally {
      setSaving(false);
    }
  }

  function handleStartAnother() {
    handleClearRecording();
    setRawTranscript('');
    setSavedAudioUrl(null);
    setSavedVideoUrl(null);
    setDraftTitle('');
    setDraftSubtitle('');
    setDraftEraLabel('');
    setDraftEpigraph('');
    setDraftPullQuote('');
    setDraftBody('');
    setWrittenText('');
    setSavedChapterId(null);
    setErrorMsg(null);
    setFixFeedback(null);
    setFollowUpFeedback(null);
    setActiveFollowUpQuestion(null);
    const remainingInbox = inboxPrompts.filter((p) => p.id !== activePrompt?.id);
    setSelectedPromptId(remainingInbox[0]?.id || null);
    setStep('choose-mode');
  }

  function handleCyclePrompt() {
    if (inboxPrompts.length === 0) return;
    if (!activePrompt) {
      setSelectedPromptId(inboxPrompts[0].id);
      return;
    }
    const idx = inboxPrompts.findIndex((p) => p.id === activePrompt.id);
    const next = inboxPrompts[(idx + 1) % inboxPrompts.length];
    setSelectedPromptId(next.id);
  }

  const savedGlossary = (settings.spellingGlossary || []).filter((g) => g.correct.trim());
  const promptIndex = activePrompt
    ? inboxPrompts.findIndex((p) => p.id === activePrompt.id)
    : -1;

  const totalSharedSeconds = chapters.reduce(
    (sum, ch) => sum + (ch.audioDurationSeconds || 0),
    0
  );
  const cumulative = splitTotalTime(totalSharedSeconds);

  // STEP 1: Calm Forest-Green Mobile & Desktop Welcome Screen
  if (step === 'welcome') {
    return (
      <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="rounded-2xl bg-[#17362D] text-[#FAF9F6] p-8 sm:p-12 md:p-16 min-h-[540px] flex flex-col justify-between shadow-sm">
          <div className="flex items-center justify-between gap-4 text-xs text-[#FAF9F6]/75">
            <span>{settings.title}</span>
            <span className="tabular-nums">
              {chapters.length} {chapters.length === 1 ? 'story' : 'stories'} shared
            </span>
          </div>

          <div className="my-10 space-y-5 max-w-xl">
            <h1
              className="font-editorial text-[clamp(2.1rem,5vw,3.35rem)] leading-[1.12] font-normal text-[#FAF9F6]"
              style={{ textWrap: 'balance' }}
            >
              {getGreetingPrefix()}, {firstName}. It’s time to share another story.
            </h1>
            {activePrompt ? (
              <p className="text-sm sm:text-base text-[#FAF9F6]/80 leading-relaxed">
                Next up from {activePrompt.createdBy}: “{activePrompt.question}”
              </p>
            ) : (
              <p className="text-sm sm:text-base text-[#FAF9F6]/80 leading-relaxed">
                Take a quiet moment whenever you are ready—speak naturally or type a note in your
                own words.
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <button
              type="button"
              onClick={() => setStep('choose-mode')}
              className="w-full sm:w-auto min-h-[52px] px-8 py-3.5 rounded-xl bg-[#E8F09C] text-[#142E26] font-semibold text-sm sm:text-base hover:bg-[#DDE784] transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" />
            </button>

            {chapters.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenMyStories()}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-[#E8F09C] hover:underline cursor-pointer"
              >
                View my stories ({chapters.length})
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // STEP 5: Post-Recording Forest-Green Celebration Screen
  if (step === 'celebrate') {
    return (
      <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="rounded-2xl bg-[#17362D] text-[#FAF9F6] p-8 sm:p-12 md:p-16 min-h-[540px] flex flex-col items-center justify-between text-center shadow-sm">
          <div className="text-xs text-[#FAF9F6]/75">Story saved to {settings.title}</div>

          <div className="space-y-6 my-8">
            <p className="text-base sm:text-lg text-[#FAF9F6]/85">You’ve now shared...</p>

            {totalSharedSeconds > 0 ? (
              <div className="grid grid-cols-3 gap-6 sm:gap-10 max-w-md mx-auto">
                <div className="space-y-1">
                  <p className="font-sans text-[clamp(2.25rem,6vw,3.5rem)] font-bold tracking-tight text-white tabular-nums leading-none">
                    {cumulative.hours}
                  </p>
                  <p className="text-[11px] tracking-[0.14em] uppercase text-[#FAF9F6]/70">
                    Hours
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-sans text-[clamp(2.25rem,6vw,3.5rem)] font-bold tracking-tight text-white tabular-nums leading-none">
                    {cumulative.minutes}
                  </p>
                  <p className="text-[11px] tracking-[0.14em] uppercase text-[#FAF9F6]/70">
                    Minutes
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="font-sans text-[clamp(2.25rem,6vw,3.5rem)] font-bold tracking-tight text-white tabular-nums leading-none">
                    {cumulative.seconds}
                  </p>
                  <p className="text-[11px] tracking-[0.14em] uppercase text-[#FAF9F6]/70">
                    Seconds
                  </p>
                </div>
              </div>
            ) : (
              <p className="font-editorial text-4xl font-semibold text-white tabular-nums">
                {chapters.length} {chapters.length === 1 ? 'Story' : 'Stories'}
              </p>
            )}

            <p className="text-xs text-[#FAF9F6]/75 tabular-nums">
              {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} preserved for your
              family
            </p>
          </div>

          <div className="w-full max-w-sm space-y-3">
            <button
              type="button"
              onClick={handleStartAnother}
              className="w-full min-h-[52px] px-6 py-3.5 rounded-xl bg-[#E8F09C] text-[#142E26] font-semibold text-sm sm:text-base hover:bg-[#DDE784] transition-colors cursor-pointer"
            >
              Record another story
            </button>
            <button
              type="button"
              onClick={() => onOpenMyStories(savedChapterId || undefined)}
              className="w-full min-h-[44px] py-2 text-sm font-medium text-[#E8F09C] hover:underline cursor-pointer"
            >
              View my stories
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 2: Prompt Card + Audio / Video (Recommended) / Write Choice
  if (step === 'choose-mode') {
    return (
      <div className="max-w-[780px] mx-auto px-5 sm:px-6 py-8 space-y-7">
        <div className="flex items-center justify-between gap-3 text-xs text-[#57534E]">
          <button
            type="button"
            onClick={() => setStep('welcome')}
            className="inline-flex items-center gap-1.5 min-h-[40px] hover:text-[#18181B] cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
          {inboxPrompts.length > 0 && (
            <div className="flex items-center gap-4">
              {inboxPrompts.length > 1 && (
                <button
                  type="button"
                  onClick={handleCyclePrompt}
                  className="inline-flex items-center gap-1 font-medium text-[#1B4332] hover:underline cursor-pointer"
                >
                  Next question
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
              {activePrompt ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPromptId(null);
                    setPhotoSrc('');
                    setShowPhotoBox(false);
                  }}
                  className="hover:text-[#18181B] hover:underline cursor-pointer"
                >
                  Tell my own story
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSelectedPromptId(inboxPrompts[0].id)}
                  className="font-medium text-[#1B4332] hover:underline cursor-pointer"
                >
                  Answer waiting question ({inboxPrompts.length})
                </button>
              )}
            </div>
          )}
        </div>

        <div className="border border-[#E4E2DD] rounded-2xl bg-white p-6 sm:p-8 space-y-6">
          {(activePrompt?.photoUrl || photoSrc) && (
            <div className="aspect-[4/3] max-w-lg mx-auto rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
              <ResilientImage
                src={activePrompt?.photoUrl || photoSrc}
                alt="Prompt photograph"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="space-y-2.5 max-w-xl mx-auto text-center sm:text-left">
            {activePrompt ? (
              <p className="text-xs text-[#57534E] tabular-nums">
                Question {promptIndex >= 0 ? promptIndex + 1 : 1} of {Math.max(1, inboxPrompts.length)}{' '}
                · Asked by {activePrompt.createdBy}
              </p>
            ) : (
              <p className="text-xs text-[#57534E]">Freeform Memory</p>
            )}

            <h1
              className="font-editorial text-[clamp(1.65rem,3.4vw,2.25rem)] leading-[1.2] font-normal text-[#18181B]"
              style={{ textWrap: 'balance' }}
            >
              {activePrompt?.photoUrl
                ? `${activePrompt.createdBy} wants to hear your memory of this photo. How would you like to share?`
                : activePrompt
                  ? `${activePrompt.question}`
                  : 'What memory feels ready to share today?'}
            </h1>

            {activePrompt?.photoUrl && activePrompt.question && (
              <p className="text-sm text-[#57534E]">“{activePrompt.question}”</p>
            )}

            {activePrompt?.voicePromptUrl && (
              <div className="p-3.5 rounded-xl bg-[#F2EFE9] space-y-1.5 text-left">
                <p className="text-xs font-medium text-[#1B4332]">
                  Voice message from {activePrompt.createdBy}
                </p>
                <audio controls src={activePrompt.voicePromptUrl} className="w-full h-9" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto">
            <button
              type="button"
              onClick={() => {
                setCaptureMode('audio');
                setStep('record');
              }}
              className="min-h-[100px] p-5 rounded-xl border border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#1B4332] hover:bg-white transition-colors flex flex-col items-start justify-between text-left cursor-pointer"
            >
              <Mic className="w-5 h-5 text-[#1B4332]" />
              <div>
                <p className="text-sm font-semibold text-[#18181B]">Audio</p>
                <p className="text-xs text-[#57534E] mt-0.5">Voice only, relaxed</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setCaptureMode('video');
                setStep('record');
              }}
              className="relative min-h-[100px] p-5 rounded-xl border border-[#1B4332]/45 bg-[#FAF9F6] hover:border-[#1B4332] hover:bg-white transition-colors flex flex-col items-start justify-between text-left cursor-pointer overflow-hidden"
            >
              <span className="absolute top-0 right-0 px-2.5 py-1 bg-[#1B4332] text-white text-[11px] font-medium rounded-bl-lg">
                Recommended
              </span>
              <Video className="w-5 h-5 text-[#1B4332]" />
              <div>
                <p className="text-sm font-semibold text-[#18181B]">Video</p>
                <p className="text-xs text-[#57534E] mt-0.5">Video + voice keepsake</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setStep('write')}
              className="min-h-[100px] p-5 rounded-xl border border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#1B4332] hover:bg-white transition-colors flex flex-col items-start justify-between text-left cursor-pointer"
            >
              <Type className="w-5 h-5 text-[#1B4332]" />
              <div>
                <p className="text-sm font-semibold text-[#18181B]">Write</p>
                <p className="text-xs text-[#57534E] mt-0.5">Type your story directly</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // STEP 3A: Distraction-Free Writer Canvas (Screenshot 15: DISCARD DRAFT / SAVE + Photo)
  if (step === 'write') {
    return (
      <div className="max-w-[920px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <div className="border border-[#E4E2DD] rounded-2xl bg-white overflow-hidden">
          <div className="px-5 sm:px-7 py-4 border-b border-[#E4E2DD] flex flex-wrap items-center justify-between gap-3">
            <p className="font-editorial text-lg font-semibold text-[#18181B] truncate max-w-md">
              {activePrompt ? activePrompt.question : 'Write Your Story'}
            </p>
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setStep('choose-mode')}
                className="px-4 py-2 min-h-[40px] text-xs font-semibold uppercase tracking-wide text-[#1B4332] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
              >
                Discard Draft
              </button>
              <button
                type="button"
                onClick={handleTurnIntoStory}
                disabled={isProcessing || !writtenText.trim()}
                className="px-5 py-2 min-h-[40px] text-xs font-semibold uppercase tracking-wide text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-45"
              >
                {isProcessing ? 'Preparing...' : 'Continue to Save'}
              </button>
            </div>
          </div>

          <div className="px-5 sm:px-7 py-3 border-b border-[#EFECE6] bg-[#FAF9F6] flex flex-wrap items-center gap-2.5 text-xs">
            <label className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl bg-[#EBF3EF] border border-[#C6DCD0] text-[#142E26] font-medium hover:bg-[#DCEBE3] transition-colors cursor-pointer">
              <Camera className="w-3.5 h-3.5 text-[#1B4332]" />
              {photoSrc ? 'Change Photo' : 'Attach Photo'}
              <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => setShowGlossaryPanel((v) => !v)}
              className="inline-flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl bg-[#F3EFE6] border border-[#DFD8CA] text-[#18181B] font-medium hover:bg-[#EAE3D5] transition-colors cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-[#1B4332]" />
              Names &amp; Places ({savedGlossary.length})
            </button>
          </div>

          {photoSrc && (
            <div className="px-5 sm:px-7 pt-5">
              <div className="max-w-xs aspect-[4/3] rounded-lg overflow-hidden border border-[#E4E2DD]">
                <ResilientImage
                  src={photoSrc}
                  alt="Attached story photo"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          <div className="p-5 sm:p-7 space-y-4">
            <textarea
              rows={13}
              value={writtenText}
              onChange={(e) => setWrittenText(e.target.value)}
              placeholder="Write your memory just as you would tell your family..."
              className="w-full p-2 text-base sm:text-lg font-editorial leading-[1.8] bg-transparent focus:outline-none resize-y"
            />
            {errorMsg && (
              <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
                {errorMsg}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // STEP 3B: Clean Mobile & Desktop Recording Stage (Screenshot 7: Photo + Prompt + PiP + Press to Record)
  if (step === 'record') {
    return (
      <div className="max-w-[780px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-28 sm:pb-10">
        {/* Minimal Stage Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (!isRecording) setStep('choose-mode');
            }}
            disabled={isRecording}
            className="inline-flex items-center gap-1.5 min-h-[44px] text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer disabled:opacity-40"
          >
            <ArrowLeft className="w-4 h-4" />
            Options
          </button>

          <div className="flex items-center gap-2">
            {!isRecording && (
              <div className="inline-flex items-center gap-1 p-1 bg-[#EFECE6] rounded-lg">
                <button
                  type="button"
                  onClick={() => setCaptureMode('audio')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    captureMode === 'audio' ? 'bg-white text-[#18181B] shadow-xs' : 'text-[#57534E]'
                  }`}
                >
                  Audio
                </button>
                <button
                  type="button"
                  onClick={() => setCaptureMode('video')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                    captureMode === 'video' ? 'bg-white text-[#18181B] shadow-xs' : 'text-[#57534E]'
                  }`}
                >
                  Video
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGlossaryPanel((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-[#1B4332]" />
              Names &amp; Places
            </button>
          </div>
        </div>

        {/* Prompt + Optional Photo Display */}
        <section className="border border-[#E4E2DD] rounded-2xl bg-white p-6 sm:p-8 space-y-5">
          {photoSrc && (
            <div className="aspect-[4/3] max-w-lg mx-auto rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
              <ResilientImage
                src={photoSrc}
                alt="Memory prompt photograph"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-[#57534E] tabular-nums">
              {activePrompt
                ? `Question ${promptIndex >= 0 ? promptIndex + 1 : 1} of ${Math.max(
                    1,
                    inboxPrompts.length
                  )}`
                : 'Freeform Story'}
            </p>
            <h1
              className="font-editorial text-[clamp(1.65rem,3.5vw,2.3rem)] leading-[1.2] font-normal text-[#18181B]"
              style={{ textWrap: 'balance' }}
            >
              {activePrompt ? activePrompt.question : 'What memory feels ready to share today?'}
            </h1>
          </div>

          {activePrompt?.voicePromptUrl && (
            <div className="p-3.5 rounded-xl bg-[#F2EFE9] space-y-1.5 max-w-md">
              <p className="text-xs font-medium text-[#1B4332]">
                Listen to {activePrompt.createdBy}:
              </p>
              <audio controls src={activePrompt.voicePromptUrl} className="w-full h-9" />
            </div>
          )}

          {activePrompt && activePrompt.memoryTriggers.length > 0 && (
            <ul className="text-xs text-[#57534E] space-y-1">
              {activePrompt.memoryTriggers.slice(0, 3).map((cue, idx) => (
                <li key={idx}>• {cue}</li>
              ))}
            </ul>
          )}

          {/* Active Recording Live Canvas / Video Feed */}
          {isRecording && (
            <div className="pt-2 space-y-4">
              {captureMode === 'video' ? (
                <div className="w-full aspect-video rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#18181B]">
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <canvas
                  ref={canvasRef}
                  width={680}
                  height={56}
                  className="w-full h-14 rounded-lg bg-[#F2EFE9] border border-[#E4E2DD]"
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-mono text-base font-semibold text-[#C8102E] tabular-nums">
                  {isPaused ? 'Paused' : 'Recording'} · {formatDuration(elapsedSeconds)}
                </span>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handlePauseResume}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-[#F2EFE9] rounded-xl cursor-pointer"
                  >
                    {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[44px] text-xs font-semibold text-white bg-[#18181B] rounded-xl cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    Stop Recording
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Recorded Playback Preview */}
          {audioBlob && !isRecording && (
            <div className="pt-2 space-y-4 border-t border-[#EFECE6]">
              <div className="flex items-center justify-between text-xs text-[#57534E]">
                <span className="font-medium text-[#1B4332]">
                  {recordedIsVideo ? 'Video recording ready' : 'Voice recording ready'} (
                  {uploadedAudioName || formatDuration(elapsedSeconds)})
                </span>
                <button
                  type="button"
                  onClick={handleClearRecording}
                  className="inline-flex items-center gap-1 hover:text-[#18181B] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Re-record
                </button>
              </div>
              {audioPreviewUrl &&
                (recordedIsVideo ? (
                  <video
                    controls
                    playsInline
                    src={audioPreviewUrl}
                    className="w-full max-h-72 rounded-xl bg-[#18181B]"
                  />
                ) : (
                  <audio controls src={audioPreviewUrl} className="w-full h-10" />
                ))}

              <button
                type="button"
                onClick={handleTurnIntoStory}
                disabled={isProcessing}
                className="w-full min-h-[52px] inline-flex items-center justify-center gap-2.5 px-6 py-3.5 text-sm sm:text-base font-semibold text-white bg-[#1B4332] rounded-xl hover:bg-[#143326] transition-colors cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Turning Recording Into Your Story...
                  </>
                ) : (
                  <>
                    <span>Turn Recording Into Story</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          )}

          {/* Bottom Capture Dock (Matches Screenshot 7: PiP Thumbnail + Press to Record) */}
          {!isRecording && !audioBlob && (
            <div className="pt-3 space-y-4">
              <div className="flex items-center gap-3.5">
                {captureMode === 'video' && (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#18181B] shrink-0 flex items-center justify-center">
                    {cameraPreviewActive ? (
                      <video
                        ref={pipVideoRef}
                        autoPlay
                        playsInline
                        muted
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Video className="w-5 h-5 text-white/70" />
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleStartRecording}
                  className="flex-1 min-h-[60px] px-6 py-4 rounded-xl bg-[#C8102E] hover:bg-[#A60D26] active:scale-[0.99] text-white font-semibold text-base inline-flex items-center justify-center gap-2.5 shadow-sm transition-all cursor-pointer"
                >
                  <span className="w-4 h-4 rounded-full border-2 border-white flex items-center justify-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  </span>
                  <span>Press to Record</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowPhotoBox((v) => !v)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#EBF3EF] border border-[#C6DCD0] text-[#142E26] text-xs sm:text-sm font-medium hover:bg-[#DCEBE3] transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-[#1B4332]" />
                    {photoSrc ? 'Photo attached' : 'Add a photo'}
                  </button>
                  <label className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#EBF3EF] border border-[#C6DCD0] text-[#142E26] text-xs sm:text-sm font-medium hover:bg-[#DCEBE3] transition-colors cursor-pointer">
                    <FileAudio className="w-4 h-4 text-[#1B4332]" />
                    Upload audio / video
                    <input
                      type="file"
                      accept="audio/*,video/*"
                      onChange={handleAudioUpload}
                      className="hidden"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('write')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-[#F3EFE6] border border-[#DFD8CA] text-[#18181B] text-xs sm:text-sm font-medium hover:bg-[#EAE3D5] transition-colors cursor-pointer"
                >
                  <Type className="w-4 h-4 text-[#1B4332]" />
                  Write instead
                </button>
              </div>
            </div>
          )}

          {/* Expandable Add Photo Box */}
          {showPhotoBox && !activePrompt?.photoUrl && (
            <div className="pt-4 border-t border-[#EFECE6] space-y-3">
              {photoSrc ? (
                <div className="flex flex-col sm:flex-row gap-4 items-start">
                  <div className="flex-1 space-y-2 w-full">
                    <input
                      type="text"
                      value={photoHint}
                      onChange={(e) => setPhotoHint(e.target.value)}
                      placeholder="Optional note: Who or where is in this photo?"
                      className="w-full px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                    />
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <button
                        type="button"
                        onClick={handleAskPhotoQuestions}
                        disabled={askingPhotoQuestions}
                        className="px-3.5 py-2 min-h-[38px] rounded-lg bg-[#EBF3EF] border border-[#C6DCD0] font-medium text-[#142E26] hover:bg-[#DCEBE3] cursor-pointer"
                      >
                        {askingPhotoQuestions
                          ? 'Looking at photo...'
                          : 'Suggest photo memory questions'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoSrc('');
                          setPhotoQuestions([]);
                        }}
                        className="px-3.5 py-2 min-h-[38px] rounded-lg bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] font-medium hover:bg-[#FEE2E2] cursor-pointer"
                      >
                        Remove photo
                      </button>
                    </div>
                    {photoQuestions.length > 0 && (
                      <ul className="text-xs text-[#57534E] space-y-1">
                        {photoQuestions.map((q, idx) => (
                          <li key={idx}>• {q}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center p-5 border border-dashed border-[#D6D3CD] rounded-xl bg-[#FAF9F6] hover:border-[#1B4332] cursor-pointer text-center space-y-1">
                  <Camera className="w-5 h-5 text-[#1B4332]" />
                  <span className="text-xs font-medium text-[#18181B]">
                    Upload a photo to talk about
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
          )}

          {/* Expandable Names, Places & Addresses Quick-Add Drawer */}
          {showGlossaryPanel && (
            <div className="pt-4 border-t border-[#EFECE6] space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-[#18181B]">
                  Add Names, Places &amp; Addresses
                </p>
                <p className="text-xs text-[#57534E]">
                  Save names or addresses mentioned in your story so spelling stays accurate.
                </p>
              </div>
              <form
                onSubmit={handleAddGlossaryItem}
                className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center"
              >
                <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-lg shrink-0">
                  {(['name', 'place', 'address'] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setGlossaryCategory(cat)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                        glossaryCategory === cat
                          ? 'bg-white text-[#18181B] shadow-xs'
                          : 'text-[#57534E]'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={glossaryInput}
                  onChange={(e) => setGlossaryInput(e.target.value)}
                  placeholder={
                    glossaryCategory === 'name'
                      ? 'e.g., Aunt Małgosia'
                      : glossaryCategory === 'place'
                        ? 'e.g., Cedar Cove'
                        : 'e.g., 412 Elm Street'
                  }
                  className="flex-1 min-w-0 px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                />
                <button
                  type="submit"
                  disabled={!glossaryInput.trim()}
                  className="inline-flex items-center justify-center gap-1 px-3.5 py-2 text-xs font-medium text-[#1B4332] bg-[#F2EFE9] border border-[#E4E2DD] rounded-lg cursor-pointer disabled:opacity-45"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </form>
              {glossaryStatus && <p className="text-xs text-[#1B4332] font-medium">{glossaryStatus}</p>}
              {savedGlossary.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {savedGlossary.map((item) => (
                    <div
                      key={item.id}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#FAF9F6] border border-[#E4E2DD] text-xs"
                    >
                      <span className="text-[#57534E] capitalize">{item.category}:</span>
                      <span className="font-medium text-[#18181B]">{item.correct}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${item.correct}`}
                        onClick={() => handleRemoveGlossaryItem(item.id)}
                        className="text-[#57534E] hover:text-[#B91C1C] cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
              {errorMsg}
            </div>
          )}
        </section>
      </div>
    );
  }

  // STEP 4: Calm Review & Instant Follow-Up Capture
  return (
    <div className="max-w-[780px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      <section className="border border-[#E4E2DD] rounded-2xl bg-white p-6 md:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EFECE6] pb-4">
          <div>
            <p className="text-xs font-medium text-[#1B4332]">Review Your Story</p>
            <h2 className="font-editorial text-2xl font-semibold text-[#18181B]">
              Read &amp; Save When Ready
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setStep('record')}
            className="text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
          >
            Back to Recorder
          </button>
        </div>

        {(audioPreviewUrl || savedVideoUrl || savedAudioUrl) && (
          <div className="p-4 rounded-xl bg-[#F2EFE9] space-y-2">
            <p className="text-xs font-medium text-[#18181B]">
              {savedVideoUrl || recordedIsVideo
                ? 'Your Original Video Recording'
                : 'Your Original Voice Recording'}
            </p>
            {savedVideoUrl || recordedIsVideo ? (
              <video
                controls
                playsInline
                src={savedVideoUrl || audioPreviewUrl || undefined}
                className="w-full max-h-64 rounded-lg bg-[#18181B]"
              />
            ) : (
              <audio
                controls
                src={audioPreviewUrl || savedAudioUrl || undefined}
                className="w-full h-10"
              />
            )}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">Story Title</label>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 text-lg font-editorial font-semibold bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#57534E] mb-1">Your Story</label>
            <textarea
              rows={10}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              className="w-full p-4 text-base leading-relaxed bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
            />
          </div>
        </div>

        {/* Post-Recording Instant Follow-Up Detail Capture */}
        {(followUps.length > 0 || !savedChapterId) && (
          <div className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E4E2DD] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#18181B]">
                Want to add one more detail before saving?
              </p>
              {followUpFeedback && (
                <span className="text-xs font-medium text-[#1B4332]">{followUpFeedback}</span>
              )}
            </div>

            {isRecordingFollowUp ? (
              <div className="p-3.5 rounded-lg bg-white border border-[#E4E2DD] flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-[#18181B]">{activeFollowUpQuestion}</p>
                  <p className="font-mono text-xs text-[#B91C1C] tabular-nums">
                    Recording follow-up · {formatDuration(followUpSeconds)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleStopFollowUpRecording}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#B91C1C] rounded-lg hover:bg-[#991B1B] cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  Stop &amp; Add to Story
                </button>
              </div>
            ) : appendingFollowUp ? (
              <div className="flex items-center gap-2 text-xs text-[#1B4332]">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Adding your follow-up detail into the story...</span>
              </div>
            ) : (
              <div className="space-y-2">
                {followUps.slice(0, 2).map((q, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-white border border-[#E4E2DD]"
                  >
                    <span className="text-xs text-[#18181B]">{q}</span>
                    <button
                      type="button"
                      onClick={() => handleStartFollowUpRecording(q)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1B4332] bg-[#F2EFE9] rounded-md hover:bg-[#E4E2DD] whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Mic className="w-3.5 h-3.5" />
                      Answer This Detail
                    </button>
                  </div>
                ))}
                <div>
                  <button
                    type="button"
                    onClick={() =>
                      handleStartFollowUpRecording('Add any extra name, date, or detail to this story')
                    }
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Record another quick detail
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Name / Address Correction */}
        <form
          onSubmit={handleFixWordInStory}
          className="p-4 rounded-xl bg-[#FAF9F6] border border-[#E4E2DD] space-y-3"
        >
          <p className="text-xs font-semibold text-[#18181B]">
            See a misspelled name, place, or address? Fix it once here:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
            <select
              value={fixCategory}
              onChange={(e) => setFixCategory(e.target.value as CorrectionCategory)}
              className="sm:col-span-2 px-2.5 py-2 text-xs bg-white border border-[#E4E2DD] rounded-lg"
            >
              <option value="name">Name</option>
              <option value="place">Place</option>
              <option value="address">Address</option>
            </select>
            <input
              type="text"
              value={fixWrong}
              onChange={(e) => setFixWrong(e.target.value)}
              placeholder="Misspelled word"
              className="sm:col-span-4 px-3 py-2 text-xs bg-white border border-[#E4E2DD] rounded-lg"
            />
            <input
              type="text"
              value={fixCorrect}
              onChange={(e) => setFixCorrect(e.target.value)}
              placeholder="Correct spelling"
              className="sm:col-span-4 px-3 py-2 text-xs bg-white border border-[#E4E2DD] rounded-lg"
            />
            <button
              type="submit"
              disabled={!fixWrong.trim() || !fixCorrect.trim()}
              className="sm:col-span-2 px-3 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-45"
            >
              Fix
            </button>
          </div>
          {fixFeedback && <p className="text-xs text-[#1B4332] font-medium">{fixFeedback}</p>}
        </form>

        {errorMsg && (
          <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
            {errorMsg}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#EFECE6]">
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#57534E]">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="accent-[#1B4332] w-4 h-4"
              />
              <Lock className="w-3.5 h-3.5" />
              Keep private for now
            </label>

            <button
              type="button"
              onClick={() => setEditingRequested((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border cursor-pointer ${
                editingRequested
                  ? 'bg-[#B45309]/10 text-[#92400E] border-[#B45309]/40'
                  : 'bg-white text-[#18181B] border-[#E4E2DD]'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              {editingRequested ? 'Editing Requested' : 'Request Editing'}
            </button>
          </div>

          <button
            type="button"
            onClick={handleSaveStory}
            disabled={saving}
            className="min-h-[48px] px-6 py-3 text-sm font-medium text-white bg-[#1B4332] rounded-xl hover:bg-[#143326] inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            {saving ? 'Saving Story...' : 'Save Story to Book'}
          </button>
        </div>
      </section>
    </div>
  );
}
