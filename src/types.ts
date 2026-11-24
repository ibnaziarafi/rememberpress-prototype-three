export type CoverTheme = 'linen-forest' | 'ivory-botanical' | 'slate-cloth' | 'charcoal-foil';

export type TrimSize = '6x9' | '5.5x8.5' | '8x10';

export type InteriorColorMode = 'color' | 'grayscale';

export type FontScale = 'compact' | 'classic' | 'large-print';

export type WritingTone =
  | 'Warm Memoir'
  | 'Preserve Spoken Voice'
  | 'Crisp Literary'
  | 'Legacy Biography';

export type AiEditLevel = 'raw' | 'light' | 'balanced' | 'full';

export type ToneStrength = 'slight' | 'stronger';

export type NarrativePerspective = 'verbatim' | 'first-person' | 'third-person';

export type StoryLength = 'concise' | 'balanced' | 'detailed';

export type AiVoiceProvider = 'gemini' | 'gemini-lite' | 'groq';

export type CorrectionCategory = 'name' | 'place' | 'address';

export interface SpellingCorrection {
  id: string;
  category: CorrectionCategory;
  wrong: string;
  correct: string;
}

export type BookMode = 'self' | 'gift';

export type UserRole = 'author' | 'organizer' | 'collaborator';

export type PromptCadence = 'daily' | 'weekly' | 'on-demand';

export type EditingStatus = 'none' | 'requested' | 'in-review' | 'completed';

export type PhotoPlacement =
  | 'chapter-opener'
  | 'framed-figure'
  | 'full-width'
  | 'side-by-side';

export type PromptCategory =
  | 'Childhood & Early Days'
  | 'Family & Roots'
  | 'Love & Companionship'
  | 'Craft, Work & Calling'
  | 'Turning Points'
  | 'Traditions & Table'
  | 'Wisdom & Legacy';

export interface Collaborator {
  id: string;
  name: string;
  role: UserRole;
  relationship: string;
  joinedAt: string;
}

export interface BookSettings {
  id: string;
  inviteCode: string;
  bookMode: BookMode;
  title: string;
  subtitle: string;
  authorName: string;
  organizerName: string;
  dedication: string;
  coverTheme: CoverTheme;
  coverImageUrl: string;
  trimSize: TrimSize;
  interiorColorMode: InteriorColorMode;
  fontScale: FontScale;
  includeQrAudioArchive: boolean;
  includeDropCaps: boolean;
  editionYear: string;
  authorPreviewEnabled: boolean;
  promptCadence: PromptCadence;
  preferredAiProvider: AiVoiceProvider;
  enableProviderFallback: boolean;
  founderGuidePrompt: string;
  spellingGlossary?: SpellingCorrection[];
}

export interface MemoryPhoto {
  id: string;
  chapterId: string | null;
  imageUrl: string;
  caption: string;
  storyNarrative: string;
  memoryHint: string;
  yearLabel: string;
  locationLabel: string;
  placement: PhotoPlacement;
  followUpQuestions: string[];
  createdAt: string;
}

export interface ChapterComment {
  id: string;
  authorName: string;
  relationship: string;
  text: string;
  createdAt: string;
}

export interface Chapter {
  id: string;
  order: number;
  title: string;
  subtitle: string;
  promptQuestion: string;
  epigraph: string;
  pullQuote: string;
  body: string;
  transcript: string;
  audioUrl: string | null;
  videoUrl?: string | null;
  audioDurationSeconds: number;
  writingTone: WritingTone;
  aiEditLevel: AiEditLevel;
  toneStrength: ToneStrength;
  perspective?: NarrativePerspective;
  lengthPreference?: StoryLength;
  providerUsed?: string;
  isPrivate: boolean;
  editingStatus: EditingStatus;
  editingNote: string;
  eraLabel: string;
  followUpQuestions: string[];
  comments?: ChapterComment[];
  updatedAt: string;
}

export interface GuidedPrompt {
  id: string;
  category: PromptCategory;
  question: string;
  memoryTriggers: string[];
  coachingTip: string;
  estimatedMinutes: number;
  isCustom: boolean;
  createdBy: string;
  cadence: PromptCadence;
  status: 'inbox' | 'queued' | 'answered';
  photoUrl?: string | null;
  voicePromptUrl?: string | null;
  voicePromptDurationSeconds?: number;
  votes?: number;
  votedBy?: string[];
  answeredChapterId: string | null;
  createdAt: string;
}

export interface BookWorkspaceData {
  settings: BookSettings;
  collaborators: Collaborator[];
  chapters: Chapter[];
  photos: MemoryPhoto[];
  prompts: GuidedPrompt[];
}

export interface TranscribeAndDraftResponse {
  transcript: string;
  chapter: {
    title: string;
    subtitle: string;
    epigraph: string;
    pullQuote: string;
    body: string;
    eraLabel: string;
    followUpQuestions: string[];
  };
  audioUrl: string | null;
  videoUrl?: string | null;
  providerUsed: string;
  fallbackNotice?: string;
}

export interface RewriteMemoryResponse {
  title: string;
  subtitle: string;
  epigraph: string;
  pullQuote: string;
  body: string;
  providerUsed: string;
  fallbackNotice?: string;
}

export interface SequenceBookResponse {
  chapters: Chapter[];
  rationale: string;
  providerUsed: string;
}

export interface DescribePhotoResponse {
  caption: string;
  storyNarrative: string;
  yearLabel: string;
  memoryQuestions: string[];
}

export interface PhotoMemoryQuestionsResponse {
  observationLead: string;
  questions: string[];
  providerUsed?: string;
}

export interface PhotoExplanationStoryResponse {
  transcript: string;
  caption: string;
  storyNarrative: string;
  yearLabel: string;
  chapterTitle: string;
  chapterSubtitle: string;
  memoryQuestions: string[];
  audioUrl: string | null;
  videoUrl?: string | null;
  providerUsed?: string;
  fallbackNotice?: string;
}

export interface GeneratedPromptsResponse {
  prompts: Array<{
    question: string;
    memoryTriggers: string[];
    coachingTip: string;
    estimatedMinutes: number;
  }>;
  providerUsed?: string;
}
