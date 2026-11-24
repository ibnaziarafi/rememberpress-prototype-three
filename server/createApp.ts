import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type, type Schema } from '@google/genai';
import Groq, { toFile } from 'groq-sdk';
import type {
  AiEditLevel,
  AiVoiceProvider,
  BookMode,
  BookWorkspaceData,
  Chapter,
  ChapterComment,
  GuidedPrompt,
  MemoryPhoto,
  NarrativePerspective,
  PromptCadence,
  PromptCategory,
  StoryLength,
  ToneStrength,
  UserRole,
  WritingTone,
} from '../src/types.ts';

const IS_VERCEL = Boolean(process.env.VERCEL);

const DEFAULT_FOUNDER_GUIDE =
  'Founder’s Method (Who · What · Why · Sensory Details): Always anchor the memory in one real place and one ordinary day rather than summarizing an entire decade. Ask who was in the room, what small sounds or smells stood out, what went unexpectedly, and why that moment still matters to the people reading this book.';

function resolveDataDir(): string {
  if (process.env.DATA_DIR?.trim()) {
    const customDir = path.resolve(process.env.DATA_DIR.trim());
    try {
      fs.mkdirSync(customDir, { recursive: true });
      return customDir;
    } catch {
      // Fall through to default local/tmp dir
    }
  }
  if (IS_VERCEL) {
    return path.join(os.tmpdir(), 'rememberpress-data');
  }
  const localDir = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(localDir, { recursive: true });
    return localDir;
  } catch {
    return path.join(os.tmpdir(), 'rememberpress-data');
  }
}

const DATA_DIR = resolveDataDir();
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'rememberpress-books-db.json');

try {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
} catch {
  // Fallback handled by in-memory store if disk is unavailable
}

interface MultiBookStore {
  defaultBookId: string;
  books: Record<string, BookWorkspaceData>;
}

let memoryStoreCache: MultiBookStore | null = null;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatApiError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const raw = error.message || fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return parsed.error.message;
  } catch {
    // Raw message is already plain text
  }
  return raw;
}

export function buildSeedWorkspace(): BookWorkspaceData {
  const now = new Date().toISOString();
  return {
    settings: {
      id: 'book-cedar-cove',
      inviteCode: 'CEDAR-1974',
      bookMode: 'gift',
      title: 'The Years Between',
      subtitle: 'Stories of Cedar Cove, Family Tables & Second Acts',
      authorName: 'Clara Vance',
      organizerName: 'Maya Vance',
      dedication:
        'For Leo, Maya, and every grandchild who asks what the lake looked like before the highway arrived.',
      coverTheme: 'linen-forest',
      coverImageUrl: '/src/assets/images/sample_book_cover_1794804939349.jpg',
      trimSize: '6x9',
      interiorColorMode: 'color',
      fontScale: 'classic',
      includeQrAudioArchive: true,
      includeDropCaps: true,
      editionYear: '2026',
      authorPreviewEnabled: true,
      promptCadence: 'weekly',
      preferredAiProvider: process.env.GROQ_API_KEY ? 'groq' : 'gemini-lite',
      enableProviderFallback: true,
      founderGuidePrompt: DEFAULT_FOUNDER_GUIDE,
      spellingGlossary: [
        { id: 'gloss-01', category: 'name', wrong: 'Klara', correct: 'Clara Vance' },
        { id: 'gloss-02', category: 'place', wrong: 'Cedar Grove', correct: 'Cedar Cove' },
        { id: 'gloss-03', category: 'address', wrong: 'Helm Street', correct: 'Elm Street, Portland' },
      ],
    },
    collaborators: [
      {
        id: 'collab-01',
        name: 'Clara Vance',
        role: 'author',
        relationship: 'Storyteller',
        joinedAt: now,
      },
      {
        id: 'collab-02',
        name: 'Maya Vance',
        role: 'organizer',
        relationship: 'Daughter & Organizer',
        joinedAt: now,
      },
      {
        id: 'collab-03',
        name: 'Leo Vance',
        role: 'collaborator',
        relationship: 'Brother',
        joinedAt: now,
      },
    ],
    chapters: [
      {
        id: 'chap-01',
        order: 1,
        title: 'Cedar Dock at Seven O’Clock',
        subtitle: 'Summers on the northern shore, 1972–1976',
        promptQuestion:
          'What is a childhood place whose smells, light, or sounds you can still recall immediately?',
        epigraph:
          'We measured August not by the calendar, but by how warm the weathered planks stayed after sunset.',
        pullQuote:
          'My brother Leo always claimed he could hear the ferry whistle twenty minutes before anyone else on the point.',
        body: `Before the highway widened past Heron Creek, getting to my grandfather’s cabin meant an hour on gravel roads with the windows rolled halfway down. Even now, if I catch the scent of sun-warmed cedar and pine resin at the end of a long day, I am eight years old again, sitting barefoot at the end of the dock with my brother Leo.

Our grandfather built that dock in the spring of 1959 out of salvaged barn timbers. By the time we were old enough to dangle our heels in the shallows, the wood had bleached to a silver-gray that held the afternoon heat long after the sun dropped behind the spruce line. Leo was eleven—old enough to be trusted with the brass tackle box, though rarely patient enough to wait for a bite.

At seven o’clock each evening, the lake turned completely still, like dark tea cooling in a saucer. My grandmother would ring a cast-iron bell from the porch, twice for supper, once if she only wanted help shelling peas. We always waited until the second ring faded across the water before standing up, reluctant to trade the golden hour for indoor lamplight.`,
        transcript:
          'Well, if I close my eyes and think back to being eight years old, it’s always the dock at Cedar Cove. We drove up on gravel roads with the windows down. My grandfather built that dock in 1959 from barn timbers, bleached silver-gray. Leo was eleven, always holding the brass tackle box. At seven o’clock the lake went completely flat, and Grandma rang the cast-iron bell from the porch—twice for supper, once for shelling peas.',
        audioUrl: null,
        audioDurationSeconds: 164,
        writingTone: 'Warm Memoir',
        aiEditLevel: 'balanced',
        toneStrength: 'slight',
        providerUsed: 'gemini',
        isPrivate: false,
        editingStatus: 'none',
        editingNote: '',
        eraLabel: '1972–1976 · Childhood',
        followUpQuestions: [
          'What was usually on the supper table when your grandmother rang the bell twice?',
          'Did you and Leo ever take the rowboat out past the point without telling anyone?',
        ],
        updatedAt: now,
      },
      {
        id: 'chap-02',
        order: 2,
        title: 'Flour on the Apron, Yeast in the Morning',
        subtitle: 'Saturday loaves in my grandmother’s kitchen',
        promptQuestion:
          'Describe someone who taught you a craft, recipe, or habit with their hands rather than a lecture.',
        epigraph:
          'She never owned a kitchen scale; she judged dough by how willingly it answered the heel of her palm.',
        pullQuote:
          'When you rush bread, she used to say, all you bake is impatience.',
        body: `Every Saturday morning from October through April, my grandmother’s kitchen was the warmest room in the county. Long before the rest of the house woke, she would light the pilot on the cast-iron range and set a chipped ceramic bowl beside the south window where the pale winter sun fell across the oak table.

She taught me to knead without ever giving a speech about measurements. Instead, she placed my small hands directly over hers so I could feel the rhythm: fold, press with the heel, quarter-turn, repeat. Flour drifted into the creases of my sleeves and settled on the bridge of my nose, while she hummed old radio waltzes under her breath.

Years later, when I opened my own small neighborhood bakery on Elm Street, I hung her flour-dusted calico apron beside the proofing rack. Even on mornings when thirty orders sat on the counter, pressing my palms into cool dough still brought her voice right back beside me.`,
        transcript:
          'Every Saturday morning in winter Grandma’s kitchen was the warmest room around. She never used a scale—she just put my hands on top of hers on the oak table so I’d feel how to fold, press, and turn the dough. Flour got everywhere. She used to say when you rush bread you just bake impatience. Later when I opened my Elm Street bakery I kept her apron by the rack.',
        audioUrl: null,
        audioDurationSeconds: 198,
        writingTone: 'Preserve Spoken Voice',
        aiEditLevel: 'light',
        toneStrength: 'slight',
        providerUsed: 'gemini',
        isPrivate: false,
        editingStatus: 'none',
        editingNote: '',
        eraLabel: '1976 · Family Table',
        followUpQuestions: [
          'What happened the very first time you baked a loaf completely on your own?',
          'Which customer at your Elm Street bakery reminded you most of her?',
        ],
        updatedAt: now,
      },
      {
        id: 'chap-03',
        order: 3,
        title: 'The Letter That Waited Six Months',
        subtitle: 'Choosing a different coast in the autumn of 1983',
        promptQuestion:
          'Tell the story of a crossroads moment—a decision that quietly changed the direction of your entire life.',
        epigraph:
          'Some doors do not slam shut; they simply stay propped open until you find the courage to step through.',
        pullQuote:
          'I kept the postmarked envelope in my coat pocket through three weeks of rain before opening it a second time.',
        body: `In October of 1983, I had a steady bookkeeping job in Portland, a reliable green Volvo with ninety thousand miles, and a growing suspicion that I was living someone else’s carefully drafted itinerary. On a Tuesday afternoon, a thick cream envelope arrived from a cousin in Monterey asking if I would help restore an old coastal inn’s ledger—and stay through the winter if the ocean suited me.

I told myself I needed a month to weigh the numbers. In truth, I knew the answer the evening I walked past the harbor and watched the fog roll under the bridge cables. Two weeks later I packed two suitcases, a box of family photographs, and my grandmother’s brass kettle into the Volvo and pointed the hood south along Highway 101.

That winter turned into twelve years, a marriage, and the life our children know today. Whenever Maya asks how you recognize a turning point while you are standing inside it, I tell her it rarely announces itself with trumpets—usually it arrives in a cream envelope on an ordinary Tuesday.`,
        transcript:
          'October 1983, I was doing bookkeeping in Portland, driving an old green Volvo. Then my cousin in Monterey wrote asking if I’d come down for the winter to help straighten out the books at a coastal inn. I kept the envelope in my coat pocket for weeks, then packed two suitcases, family photos, and Grandma’s kettle and drove south on 101. Stayed twelve years.',
        audioUrl: null,
        audioDurationSeconds: 142,
        writingTone: 'Warm Memoir',
        aiEditLevel: 'balanced',
        toneStrength: 'slight',
        providerUsed: 'gemini',
        isPrivate: false,
        editingStatus: 'none',
        editingNote: '',
        eraLabel: '1983 · Turning Point',
        followUpQuestions: [
          'What was the very first sight you saw when you pulled into Monterey at the end of that drive?',
          'Who in Portland tried to talk you out of going, and what did you say to them?',
        ],
        updatedAt: now,
      },
    ],
    photos: [
      {
        id: 'photo-01',
        chapterId: 'chap-01',
        imageUrl: '/src/assets/images/sample_childhood_summer_1794804938197.jpg',
        caption: 'Figure 1.1 — Leo and Clara on the Cedar Cove dock, late August 1974.',
        storyNarrative:
          'Captured just before the seven o’clock supper bell, Leo and Clara sit shoulder-to-shoulder on the bleached barn-timber planks as the sunset turns the northern cove to copper.',
        memoryHint: 'My brother Leo and me sitting on Grandpa’s cedar dock at sunset around 1974.',
        yearLabel: 'August 1974',
        locationLabel: 'Cedar Cove, Northern Shore',
        placement: 'framed-figure',
        followUpQuestions: [
          'Who was standing behind the camera taking this picture on the shoreline?',
        ],
        createdAt: now,
      },
      {
        id: 'photo-02',
        chapterId: 'chap-02',
        imageUrl: '/src/assets/images/sample_bakery_kitchen_1794804938875.jpg',
        caption: 'Figure 2.1 — Saturday morning sourdough by the south kitchen window.',
        storyNarrative:
          'Sunlight filters through the mullioned glass onto a well-worn oak tabletop dusted generously with stone-ground flour.',
        memoryHint: 'Baking Saturday bread with Grandma in her sunlit kitchen.',
        yearLabel: 'Spring 1976',
        locationLabel: 'Elm Hollow Farmhouse',
        placement: 'chapter-opener',
        followUpQuestions: [
          'What song did your grandmother usually hum while the bread rested?',
        ],
        createdAt: now,
      },
    ],
    prompts: [
      {
        id: 'prompt-04',
        category: 'Family & Roots',
        question:
          'What did your parents or grandparents never say out loud, yet showed every single week through their actions?',
        memoryTriggers: [
          'Think about Sunday mornings, paydays, or how guests were welcomed at the door.',
          'Recall a quiet repair, saved envelope, or gesture of care you noticed only years later.',
        ],
        coachingTip:
          'Focus on one concrete Tuesday or Saturday memory rather than trying to summarize their whole personality.',
        estimatedMinutes: 4,
        isCustom: false,
        createdBy: 'Maya Vance',
        cadence: 'weekly',
        status: 'inbox',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: 'prompt-photo-01',
        category: 'Childhood & Early Days',
        question:
          'Mom, what does this dock photo from 1974 help you remember about that whole summer?',
        memoryTriggers: [
          'Who took this photo from the shore while you and Leo sat there?',
          'What did Leo whisper right before you laughed?',
          'What was waiting inside on the porch table?',
        ],
        coachingTip:
          'Just talk like you are showing this snapshot to Maya across the kitchen table.',
        estimatedMinutes: 4,
        isCustom: true,
        createdBy: 'Leo Vance',
        cadence: 'on-demand',
        status: 'inbox',
        photoUrl: '/src/assets/images/sample_childhood_summer_1794804938197.jpg',
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: 'prompt-05',
        category: 'Love & Companionship',
        question:
          'Tell the story of an ordinary day with someone you love that captures your bond better than any anniversary.',
        memoryTriggers: [
          'Think of a long drive, a rainy errand, or fixing dinner when plans fell through.',
          'Recall a shared joke or small ritual nobody else would understand.',
        ],
        coachingTip:
          'Ordinary days carry the truest dialogue—include the small disagreements or laughter you remember.',
        estimatedMinutes: 4,
        isCustom: false,
        createdBy: 'Maya Vance',
        cadence: 'weekly',
        status: 'inbox',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: 'prompt-06',
        category: 'Craft, Work & Calling',
        question:
          'What was the hardest season of your work life, and who stood beside you while you figured it out?',
        memoryTriggers: [
          'Remember the earliest morning you ever woke up for that job or venture.',
          'Recall the first paycheck, first customer, or first mistake you survived.',
        ],
        coachingTip:
          'Tell the messy middle honestly—readers connect deepest with how resilience felt before the outcome was clear.',
        estimatedMinutes: 5,
        isCustom: false,
        createdBy: 'RememberPress Guide',
        cadence: 'weekly',
        status: 'queued',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: 'prompt-01',
        category: 'Childhood & Early Days',
        question:
          'What is a childhood place whose smells, light, or sounds you can still recall immediately?',
        memoryTriggers: [
          'Recall the season and time of day you usually arrived there.',
          'Name one small object you always carried in your pocket or hand.',
        ],
        coachingTip:
          'Start with one physical sense—the creak of a screen door, cedar heat, or gravel crunching.',
        estimatedMinutes: 4,
        isCustom: false,
        createdBy: 'RememberPress Guide',
        cadence: 'weekly',
        status: 'answered',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: 'chap-01',
        createdAt: now,
      },
      {
        id: 'prompt-02',
        category: 'Traditions & Table',
        question:
          'Describe someone who taught you a craft, recipe, or habit with their hands rather than a lecture.',
        memoryTriggers: [
          'Picture the workspace: table surface, tools, apron, or lighting.',
          'Remember a short phrase they repeated while working.',
        ],
        coachingTip:
          'Do not worry about listing exact ingredients or steps—focus on the rhythm between the two of you.',
        estimatedMinutes: 5,
        isCustom: false,
        createdBy: 'RememberPress Guide',
        cadence: 'weekly',
        status: 'answered',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: 'chap-02',
        createdAt: now,
      },
      {
        id: 'prompt-03',
        category: 'Turning Points',
        question:
          'Tell the story of a crossroads moment—a decision that quietly changed the direction of your entire life.',
        memoryTriggers: [
          'Remember what you were doing right before the opportunity or change arrived.',
          'Recall what you packed or left behind when you said yes.',
        ],
        coachingTip:
          'Speak as if explaining that season to a grandchild who only knows who you became afterward.',
        estimatedMinutes: 5,
        isCustom: false,
        createdBy: 'RememberPress Guide',
        cadence: 'weekly',
        status: 'answered',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: 'chap-03',
        createdAt: now,
      },
    ],
  };
}

function normalizeBook(book: BookWorkspaceData): BookWorkspaceData {
  const seed = buildSeedWorkspace();
  const now = new Date().toISOString();
  return {
    settings: {
      ...seed.settings,
      ...book.settings,
      founderGuidePrompt: book.settings?.founderGuidePrompt || DEFAULT_FOUNDER_GUIDE,
      inviteCode: book.settings?.inviteCode || 'CEDAR-1974',
      preferredAiProvider:
        book.settings?.preferredAiProvider ||
        (process.env.GROQ_API_KEY ? 'groq' : 'gemini-lite'),
      enableProviderFallback:
        book.settings?.enableProviderFallback !== undefined
          ? book.settings.enableProviderFallback
          : true,
      authorPreviewEnabled:
        book.settings?.authorPreviewEnabled !== undefined
          ? book.settings.authorPreviewEnabled
          : true,
      promptCadence: book.settings?.promptCadence || 'weekly',
      bookMode: book.settings?.bookMode || 'self',
      organizerName: book.settings?.organizerName || book.settings?.authorName || 'Organizer',
      spellingGlossary: Array.isArray(book.settings?.spellingGlossary)
        ? book.settings.spellingGlossary
        : seed.settings.spellingGlossary,
    },
    collaborators: Array.isArray(book.collaborators) ? book.collaborators : [],
    chapters: (book.chapters || []).map((c, idx) => ({
      ...c,
      order: c.order || idx + 1,
      videoUrl: c.videoUrl || null,
      aiEditLevel: c.aiEditLevel || 'balanced',
      toneStrength: c.toneStrength || 'slight',
      perspective: c.perspective || 'first-person',
      lengthPreference: c.lengthPreference || 'balanced',
      isPrivate: Boolean(c.isPrivate),
      editingStatus: c.editingStatus || 'none',
      editingNote: c.editingNote || '',
      eraLabel: c.eraLabel || c.subtitle || '',
      comments: Array.isArray(c.comments) ? c.comments : [],
    })),
    photos: book.photos || [],
    prompts: (book.prompts || []).map((p) => ({
      ...p,
      createdBy: p.createdBy || 'Family Organizer',
      cadence: p.cadence || 'weekly',
      status: p.status || (p.answeredChapterId ? 'answered' : 'inbox'),
      votes: typeof p.votes === 'number' ? p.votes : 0,
      votedBy: Array.isArray(p.votedBy) ? p.votedBy : [],
      createdAt: p.createdAt || now,
    })),
  };
}

function loadStore(): MultiBookStore {
  if (memoryStoreCache) {
    return memoryStoreCache;
  }
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as MultiBookStore;
      if (parsed && parsed.books && Object.keys(parsed.books).length > 0) {
        const normalizedBooks: Record<string, BookWorkspaceData> = {};
        for (const [k, v] of Object.entries(parsed.books)) {
          normalizedBooks[k] = normalizeBook(v);
        }
        memoryStoreCache = {
          defaultBookId: parsed.defaultBookId || Object.keys(normalizedBooks)[0],
          books: normalizedBooks,
        };
        return memoryStoreCache;
      }
    }
  } catch (err) {
    console.error('Failed to read multi-book database, re-seeding:', err);
  }
  const seededBook = buildSeedWorkspace();
  const initialStore: MultiBookStore = {
    defaultBookId: seededBook.settings.id,
    books: {
      [seededBook.settings.id]: seededBook,
    },
  };
  saveStore(initialStore);
  return initialStore;
}

function saveStore(store: MultiBookStore): void {
  memoryStoreCache = store;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tempPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tempPath, DB_PATH);
  } catch (err) {
    console.warn('Persist to disk skipped (using in-memory store):', err);
  }
}

function getBookFromRequest(
  store: MultiBookStore,
  req: express.Request
): BookWorkspaceData {
  const requestedId =
    (typeof req.query.bookId === 'string' && req.query.bookId) ||
    (typeof req.headers['x-book-id'] === 'string' && req.headers['x-book-id']) ||
    (req.body && typeof req.body.bookId === 'string' && req.body.bookId) ||
    store.defaultBookId;

  if (store.books[requestedId]) {
    return store.books[requestedId];
  }
  if (typeof req.query.invite === 'string' && req.query.invite.trim()) {
    const code = req.query.invite.trim().toUpperCase();
    const matched = Object.values(store.books).find(
      (b) => b.settings.inviteCode.toUpperCase() === code
    );
    if (matched) return matched;
  }
  return store.books[store.defaultBookId] || Object.values(store.books)[0];
}

function saveBase64Media(base64Data: string, mimeType: string, prefix: string): string {
  const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const rawBase = (mimeType || '').split(';')[0].trim().toLowerCase();
  const isVideoFile = prefix.includes('video') || rawBase.startsWith('video/');
  const baseMime = isVideoFile
    ? rawBase === 'video/mp4'
      ? 'video/mp4'
      : 'video/webm'
    : cleanMimeType(mimeType, prefix === 'photo' ? 'image/jpeg' : 'audio/webm');

  if (IS_VERCEL) {
    return `data:${baseMime};base64,${cleanBase64}`;
  }

  const extMap: Record<string, string> = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const ext =
    extMap[baseMime] ||
    (baseMime.startsWith('video/') ? 'webm' : baseMime.startsWith('audio/') ? 'webm' : 'jpg');
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const fullPath = path.join(UPLOADS_DIR, filename);
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(cleanBase64, 'base64'));
    return `/uploads/${filename}`;
  } catch {
    return `data:${baseMime};base64,${cleanBase64}`;
  }
}

function extractBase64(dataUrlOrBase64: string): string {
  return dataUrlOrBase64.includes(',') ? dataUrlOrBase64.split(',')[1] : dataUrlOrBase64;
}

function cleanMimeType(mimeType: string, fallback: string): string {
  if (!mimeType) return fallback;
  const base = mimeType.split(';')[0].trim().toLowerCase();
  const aliasMap: Record<string, string> = {
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/mp3': 'audio/mpeg',
    'video/webm': 'audio/webm',
    'video/mp4': 'audio/mp4',
    'image/jpg': 'image/jpeg',
  };
  return aliasMap[base] || base;
}

function safeParseModelJson<T>(rawText: string | undefined, fallback: T): T {
  const withoutThink = (rawText || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
  const cleaned = withoutThink
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('AI response could not be parsed as structured JSON. Please try again.');
  }
}

function resolveImageInlineData(
  imageBase64OrUrl: string | undefined,
  mimeType = 'image/jpeg'
): { mimeType: string; data: string } | null {
  if (!imageBase64OrUrl) return null;
  if (imageBase64OrUrl.startsWith('data:')) {
    const header = imageBase64OrUrl.split(',')[0] || '';
    const inferredMime = header.replace('data:', '').replace(';base64', '').trim() || mimeType;
    return {
      mimeType: cleanMimeType(inferredMime, 'image/jpeg'),
      data: extractBase64(imageBase64OrUrl),
    };
  }
  if (imageBase64OrUrl.startsWith('/src/assets/')) {
    const rel = imageBase64OrUrl.replace(/^\//, '');
    const candidates = [
      path.join(process.cwd(), rel),
      path.join(process.cwd(), 'dist', rel),
    ];
    for (const assetPath of candidates) {
      if (fs.existsSync(assetPath)) {
        const ext = path.extname(assetPath).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
        return {
          mimeType: mime,
          data: fs.readFileSync(assetPath).toString('base64'),
        };
      }
    }
  }
  if (imageBase64OrUrl.startsWith('/uploads/')) {
    const uploadPath = path.join(UPLOADS_DIR, path.basename(imageBase64OrUrl));
    if (fs.existsSync(uploadPath)) {
      const ext = path.extname(uploadPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return {
        mimeType: mime,
        data: fs.readFileSync(uploadPath).toString('base64'),
      };
    }
  }
  return {
    mimeType: cleanMimeType(mimeType, 'image/jpeg'),
    data: extractBase64(imageBase64OrUrl),
  };
}

// --- Dual AI Provider Helpers (Groq Whisper v3 Turbo + Qwen 3.8 & Fast Multi-Model Gemini) ---

interface SpellingHintsInput {
  names?: string;
  places?: string;
  addresses?: string;
}

function buildSpellingPromptBlock(
  book: BookWorkspaceData,
  hints?: SpellingHintsInput
): string {
  const glossary = book.settings.spellingGlossary || [];
  const names = new Set<string>();
  const places = new Set<string>();
  const addresses = new Set<string>();

  for (const item of glossary) {
    if (!item.correct?.trim()) continue;
    if (item.category === 'name') names.add(item.correct.trim());
    if (item.category === 'place') places.add(item.correct.trim());
    if (item.category === 'address') addresses.add(item.correct.trim());
  }
  if (hints?.names?.trim()) hints.names.split(',').forEach((v) => v.trim() && names.add(v.trim()));
  if (hints?.places?.trim()) hints.places.split(',').forEach((v) => v.trim() && places.add(v.trim()));
  if (hints?.addresses?.trim())
    hints.addresses.split(',').forEach((v) => v.trim() && addresses.add(v.trim()));

  const lines: string[] = [];
  if (names.size > 0) lines.push(`- Verified People Names: ${Array.from(names).join(', ')}`);
  if (places.size > 0) lines.push(`- Verified Places & Landmarks: ${Array.from(places).join(', ')}`);
  if (addresses.size > 0)
    lines.push(`- Verified Addresses & Streets: ${Array.from(addresses).join(', ')}`);
  if (glossary.some((g) => g.wrong?.trim() && g.correct?.trim())) {
    const pairs = glossary
      .filter((g) => g.wrong?.trim() && g.correct?.trim())
      .map((g) => `"${g.wrong.trim()}" -> "${g.correct.trim()}"`);
    lines.push(`- Known Phonetic Corrections: ${pairs.join('; ')}`);
  }

  return lines.length > 0
    ? `PROPER NOUN SPELLING REFERENCE (use these exact spellings for names, places, and addresses if spoken):\n${lines.join('\n')}`
    : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded') ||
    msg.includes('deadline_exceeded')
  );
}

function withFastThinkingForGeminiModel(
  req: Parameters<GoogleGenAI['models']['generateContent']>[0]
): Parameters<GoogleGenAI['models']['generateContent']>[0] {
  if (req.model === 'gemini-4-hydrogen') {
    const existingConfig = (req.config || {}) as Record<string, unknown>;
    if (!existingConfig.thinkingConfig) {
      return {
        ...req,
        config: {
          ...req.config,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      };
    }
  }
  return req;
}

async function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s (503 high demand)`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function generateGeminiWithFallback(options: {
  preferredProvider?: AiVoiceProvider;
  enableFallback?: boolean;
  buildRequest: (model: string) => Parameters<GoogleGenAI['models']['generateContent']>[0];
}): Promise<{
  response: Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>;
  modelUsed: string;
  fallbackNotice?: string;
}> {
  const ai = getAiClient();
  const primary =
    options.preferredProvider === 'gemini'
      ? 'gemini-4-hydrogen'
      : 'gemini-3.1-flash-lite';
  const secondary =
    primary === 'gemini-3.1-flash-lite' ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';
  const hasGroqFallback = options.enableFallback !== false && Boolean(process.env.GROQ_API_KEY);
  const timeoutMs = hasGroqFallback ? 5000 : options.enableFallback !== false ? 9000 : 25000;

  try {
    const response = await raceWithTimeout(
      ai.models.generateContent(withFastThinkingForGeminiModel(options.buildRequest(primary))),
      timeoutMs,
      primary
    );
    return { response, modelUsed: primary };
  } catch (firstErr) {
    if (!isTransientAiError(firstErr) || options.enableFallback === false) {
      throw firstErr;
    }

    // When primary is already Flash Lite and Groq is available, let caller fail over directly to Groq (~0.4s)
    if (primary === 'gemini-3.1-flash-lite' && hasGroqFallback) {
      throw firstErr;
    }

    if (primary === 'gemini-4-hydrogen') {
      // Switch once to low-demand Flash Lite
      const response = await raceWithTimeout(
        ai.models.generateContent(
          withFastThinkingForGeminiModel(options.buildRequest(secondary))
        ),
        timeoutMs,
        secondary
      );
      return {
        response,
        modelUsed: secondary,
        fallbackNotice: `${primary} was busy; processed cleanly with ${secondary}.`,
      };
    }

    await sleep(250);
    const response = await raceWithTimeout(
      ai.models.generateContent(withFastThinkingForGeminiModel(options.buildRequest(secondary))),
      timeoutMs,
      secondary
    );
    return {
      response,
      modelUsed: secondary,
      fallbackNotice: `${primary} experienced high demand; processed with ${secondary}.`,
    };
  }
}

function getGroqClient(): Groq {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }
  return new Groq({ apiKey: groqKey });
}

async function callGroqWhisper(
  rawBase64: string,
  mimeType: string,
  spellingBlock = ''
): Promise<string> {
  const groq = getGroqClient();
  const extMap: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
  };
  const ext = extMap[mimeType] || 'webm';
  const buffer = Buffer.from(rawBase64, 'base64');
  const audioFile = await toFile(buffer, `story.${ext}`, { type: mimeType });

  const transcription = await groq.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-large-v3-turbo',
    temperature: 0,
    response_format: 'verbose_json',
    prompt: `Verbatim personal family memoir recording. Preserve speaker phrasing, names, places, addresses, and dates.${
      spellingBlock ? ` ${spellingBlock.replace(/\n/g, ' ')}` : ''
    }`.slice(0, 800),
  });

  const text = (transcription.text || '').trim();
  if (!text) {
    throw new Error('Groq Whisper v3 Turbo returned an empty transcript.');
  }
  return text;
}

async function callGeminiAudioTranscribe(
  rawBase64: string,
  mimeType: string,
  preferredProvider: AiVoiceProvider = 'gemini-lite',
  enableFallback = true,
  spellingBlock = ''
): Promise<{ transcript: string; modelUsed: string; fallbackNotice?: string }> {
  const ai = getAiClient();
  const audioParts = [
    {
      inlineData: {
        mimeType,
        data: rawBase64,
      },
    },
    {
      text: `Transcribe this spoken personal memory recording accurately into clean, readable paragraphs. Preserve the speaker’s authentic phrasing, names, places, addresses, expressions, and emotional cadence. Output only the verbatim transcript text.${
        spellingBlock ? `\n\n${spellingBlock}` : ''
      }`,
    },
  ];

  // Try dedicated low-latency gemini-3.5-transcribe first, then gemini-3.1-flash-lite
  const audioModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'];
  let lastErr: unknown;

  for (let i = 0; i < audioModels.length; i++) {
    const model = audioModels[i];
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: audioParts },
      });
      const text = (response.text || '').trim();
      if (!text) {
        throw new Error(
          'Audio transcription returned empty text. Please check microphone audio or speak clearly.'
        );
      }
      return {
        transcript: text,
        modelUsed: model,
        fallbackNotice: i > 0 ? `Processed audio with fast fallback model ${model}.` : undefined,
      };
    } catch (err) {
      lastErr = err;
      if (!enableFallback && i === 0) break;
    }
  }

  // Final Gemini fallback via standard generator if needed
  if (enableFallback) {
    const { response, modelUsed, fallbackNotice } = await generateGeminiWithFallback({
      preferredProvider,
      enableFallback,
      buildRequest: (model) => ({
        model,
        contents: { parts: audioParts },
      }),
    });
    const text = (response.text || '').trim();
    if (text) return { transcript: text, modelUsed, fallbackNotice };
  }

  throw lastErr instanceof Error ? lastErr : new Error('Audio transcription failed.');
}

async function transcribeAudioWithDualProvider(
  rawBase64: string,
  mimeType: string,
  preferredProvider: AiVoiceProvider,
  enableFallback: boolean,
  spellingBlock = ''
): Promise<{ transcript: string; providerUsed: string; fallbackNotice?: string }> {
  if (preferredProvider === 'groq') {
    try {
      const transcript = await callGroqWhisper(rawBase64, mimeType, spellingBlock);
      return { transcript, providerUsed: 'groq-whisper-v3-turbo' };
    } catch (groqErr) {
      if (!enableFallback) throw groqErr;
      const reason = formatApiError(groqErr, 'Groq unavailable');
      const gem = await callGeminiAudioTranscribe(
        rawBase64,
        mimeType,
        'gemini-lite',
        true,
        spellingBlock
      );
      return {
        transcript: gem.transcript,
        providerUsed: gem.modelUsed,
        fallbackNotice: `Switched to ${gem.modelUsed} (${reason})`,
      };
    }
  }

  try {
    const gem = await callGeminiAudioTranscribe(
      rawBase64,
      mimeType,
      preferredProvider,
      enableFallback,
      spellingBlock
    );
    return {
      transcript: gem.transcript,
      providerUsed: gem.modelUsed,
      fallbackNotice: gem.fallbackNotice,
    };
  } catch (geminiErr) {
    if (!enableFallback || !process.env.GROQ_API_KEY) throw geminiErr;
    const reason = formatApiError(geminiErr, 'Gemini unavailable');
    const transcript = await callGroqWhisper(rawBase64, mimeType, spellingBlock);
    return {
      transcript,
      providerUsed: 'groq-whisper-v3-turbo',
      fallbackNotice: `Switched to Groq Whisper v3 Turbo (${reason})`,
    };
  }
}

let groqModelsCache: { fetchedAt: number; ids: string[] } | null = null;

async function listGroqChatModels(groqKey: string): Promise<string[]> {
  if (groqModelsCache && Date.now() - groqModelsCache.fetchedAt < 5 * 60 * 1000) {
    return groqModelsCache.ids;
  }
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = (data.data || [])
      .map((m) => m.id || '')
      .filter(
        (id) =>
          id &&
          !id.includes('whisper') &&
          !id.includes('guard') &&
          !id.includes('tts') &&
          !id.includes('orpheus') &&
          !id.includes('playai')
      );
    groqModelsCache = { fetchedAt: Date.now(), ids };
    return ids;
  } catch {
    return [];
  }
}

async function callGroqQwenJson<T>(
  prompt: string,
  systemInstruction: string,
  fallback: T
): Promise<{ data: T; modelUsed: string }> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    throw new Error('GROQ_API_KEY is not configured.');
  }
  const groq = getGroqClient();

  const preferredCandidates = [
    'qwen/qwen3.8-27b',
    'llama-3.1-8b-instant',
    'llama-3.3-70b-versatile',
  ];

  const attemptModel = async (
    model: string,
    useJsonMode = true,
    effort: 'none' | 'default' | 'omit' = model.includes('qwen') ? 'none' : 'omit'
  ): Promise<{ data: T; modelUsed: string }> => {
    const payload: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: `${systemInstruction}\nAlways output valid JSON only.` },
        { role: 'user', content: prompt },
      ],
      temperature: 0.6,
      max_completion_tokens: 2048,
      top_p: 0.95,
      stream: true,
      stop: null,
    };
    if (effort !== 'omit') {
      payload.reasoning_effort = effort;
    }
    if (useJsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    try {
      const stream = (await groq.chat.completions.create(
        payload as unknown as Parameters<typeof groq.chat.completions.create>[0]
      )) as unknown as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string } }>;
      }>;

      let content = '';
      for await (const chunk of stream) {
        content += chunk.choices?.[0]?.delta?.content || '';
      }
      return {
        data: safeParseModelJson<T>(content, fallback),
        modelUsed: model,
      };
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: number }).status
          : undefined;
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

      if (status === 400 && effort === 'none' && msg.includes('reasoning')) {
        return attemptModel(model, useJsonMode, 'default');
      }
      if (status === 400 && useJsonMode && msg.includes('json')) {
        return attemptModel(model, false, effort);
      }
      throw err;
    }
  };

  let lastErr: unknown;
  for (const model of preferredCandidates) {
    try {
      return await attemptModel(model);
    } catch (err) {
      lastErr = err;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: number }).status
          : undefined;
      if (status !== 404 && status !== 400 && status !== 429 && status !== 503) {
        throw err;
      }
    }
  }

  // Final dynamic discovery via Groq /openai/v1/models
  const liveModels = await listGroqChatModels(groqKey);
  const dynamicPick =
    liveModels.find((id) => id.toLowerCase().includes('qwen')) ||
    liveModels.find((id) => id.toLowerCase().includes('llama-3.1-8b')) ||
    liveModels.find((id) => id.toLowerCase().includes('llama')) ||
    liveModels[0];

  if (dynamicPick && !preferredCandidates.includes(dynamicPick)) {
    return await attemptModel(dynamicPick, true, 'omit');
  }

  throw lastErr instanceof Error ? lastErr : new Error('Groq text generation failed.');
}

async function generateStructuredJsonWithDualProvider<T>(params: {
  prompt: string;
  systemInstruction: string;
  preferredProvider: AiVoiceProvider;
  enableFallback: boolean;
  geminiSchema: Schema;
  fallbackObj: T;
}): Promise<{ data: T; providerUsed: string; fallbackNotice?: string }> {
  const {
    prompt,
    systemInstruction,
    preferredProvider,
    enableFallback,
    geminiSchema,
    fallbackObj,
  } = params;

  const runGemini = async (pref: AiVoiceProvider) => {
    const { response, modelUsed, fallbackNotice } = await generateGeminiWithFallback({
      preferredProvider: pref,
      enableFallback,
      buildRequest: (model) => ({
        model,
        contents: prompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: geminiSchema,
        },
      }),
    });
    return {
      data: safeParseModelJson<T>(response.text, fallbackObj),
      modelUsed,
      fallbackNotice,
    };
  };

  if (preferredProvider === 'groq') {
    try {
      const res = await callGroqQwenJson<T>(prompt, systemInstruction, fallbackObj);
      return { data: res.data, providerUsed: `groq-${res.modelUsed}` };
    } catch (groqErr) {
      if (!enableFallback) throw groqErr;
      const reason = formatApiError(groqErr, 'Groq unavailable');
      const gem = await runGemini('gemini-lite');
      return {
        data: gem.data,
        providerUsed: gem.modelUsed,
        fallbackNotice: `Switched to ${gem.modelUsed} (${reason})`,
      };
    }
  }

  try {
    const gem = await runGemini(preferredProvider);
    return {
      data: gem.data,
      providerUsed: gem.modelUsed,
      fallbackNotice: gem.fallbackNotice,
    };
  } catch (geminiErr) {
    if (!enableFallback || !process.env.GROQ_API_KEY) throw geminiErr;
    const reason = formatApiError(geminiErr, 'Gemini unavailable');
    const res = await callGroqQwenJson<T>(prompt, systemInstruction, fallbackObj);
    return {
      data: res.data,
      providerUsed: `groq-${res.modelUsed}`,
      fallbackNotice: `Switched to Groq ${res.modelUsed} (${reason})`,
    };
  }
}

function buildEditLevelInstruction(
  aiLevel: AiEditLevel,
  toneStrength: ToneStrength,
  writingTone: WritingTone,
  perspective: NarrativePerspective = 'first-person',
  lengthPreference: StoryLength = 'balanced',
  storytellerName = 'the storyteller'
): string {
  const levelGuide: Record<AiEditLevel, string> = {
    raw: 'LEVEL: RAW TRANSCRIPT — Keep the exact spoken words and sentences nearly verbatim. Only fix obvious punctuation, paragraph spacing, and remove pure filler sounds ("um", "uh"). Do NOT rewrite or embellish.',
    light:
      'LEVEL: LIGHT CLEANUP — Preserve 95%+ of the storyteller’s original wording, sentence rhythm, humor, and idioms. Smooth awkward false starts and organize into readable paragraphs without changing their voice.',
    balanced:
      'LEVEL: BALANCED POLISH — Keep every factual detail, idiom, and emotional tone authentic to the speaker while smoothing transitions, sensory flow, and opening/closing lines so it reads naturally in a family book.',
    full: 'LEVEL: FULL REWRITE — Shape the spoken story into richly paced literary memoir prose while remaining 100% faithful to every fact, person, and feeling from the transcript—never invent names or events.',
  };

  const strengthGuide =
    toneStrength === 'slight'
      ? 'TONE INTENSITY: SLIGHT — Apply the requested tone gently so it still sounds unmistakably like the storyteller talking at the kitchen table.'
      : 'TONE INTENSITY: STRONGER — Lean clearly into the chosen editorial voice while keeping the heart and facts intact.';

  const perspectiveGuide: Record<NarrativePerspective, string> = {
    verbatim:
      'PERSPECTIVE: CLEANED TRANSCRIPT ("I" AS SPOKEN) — Preserve spoken phrasing and natural sentence cadence with minimal structural changes.',
    'first-person':
      'PERSPECTIVE: FIRST-PERSON MEMOIR ("I / WE") — Write as a warm first-person story told in the storyteller’s own voice.',
    'third-person': `PERSPECTIVE: THIRD-PERSON BIOGRAPHY ("${storytellerName} / He / She / They") — Write as an intimate third-person family biography about ${storytellerName}, preserving all spoken anecdotes and sensory details.`,
  };

  const lengthGuide: Record<StoryLength, string> = {
    concise:
      'LENGTH: CONCISE — Trim repetition and deliver a crisp, vivid 1-to-2 paragraph memory.',
    balanced:
      'LENGTH: BALANCED — Deliver a complete 2-to-4 paragraph narrative with room for scene-setting and emotion.',
    detailed:
      'LENGTH: DETAILED — Preserve every spoken aside, sensory observation, and reflection across rich, unhurried paragraphs.',
  };

  return `${levelGuide[aiLevel]}\n${strengthGuide}\n${perspectiveGuide[perspective]}\n${lengthGuide[lengthPreference]}\nVOICE STYLE: ${writingTone}`;
}

export function createApiApp(): express.Express {
  const app = express();

  const dotnetBackendUrl = process.env.DOTNET_BACKEND_URL?.trim().replace(/\/+$/, '');
  if (dotnetBackendUrl) {
    const forwardToDotnet: express.RequestHandler = async (req, res) => {
      try {
        const targetUrl = `${dotnetBackendUrl}${req.originalUrl}`;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (
            !value ||
            key.toLowerCase() === 'host' ||
            key.toLowerCase() === 'content-length' ||
            key.toLowerCase() === 'connection'
          ) {
            continue;
          }
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }

        let body: Buffer | undefined;
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          if (chunks.length > 0) {
            body = Buffer.concat(chunks);
          }
        }

        const upstream = await fetch(targetUrl, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        });

        res.status(upstream.status);
        const contentType = upstream.headers.get('content-type');
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        const arrayBuf = await upstream.arrayBuffer();
        res.send(Buffer.from(arrayBuf));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to reach .NET backend.';
        res.status(502).json({ error: `.NET backend proxy error (${dotnetBackendUrl}): ${message}` });
      }
    };

    app.use('/api', forwardToDotnet);
    app.use('/uploads', forwardToDotnet);
    return app;
  }

  app.use(express.json({ limit: '50mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api', (_req, res) => {
    res.json({ ok: true, service: 'remember-press-api' });
  });

  app.get('/api/ai/status', (_req, res) => {
    res.json({
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      groqConfigured: Boolean(process.env.GROQ_API_KEY),
    });
  });

  // --- Multi-Book & Onboarding Routes ---
  app.get('/api/books', (_req, res) => {
    const store = loadStore();
    const books = Object.values(store.books).map((book) => ({
      id: book.settings.id,
      title: book.settings.title,
      authorName: book.settings.authorName,
      organizerName: book.settings.organizerName,
      inviteCode: book.settings.inviteCode,
      bookMode: book.settings.bookMode,
      chapterCount: book.chapters.length,
    }));
    res.json({ books });
  });

  app.get('/api/book', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    book.chapters.sort((a, b) => a.order - b.order);
    res.json(book);
  });

  app.post('/api/books', (req, res) => {
    const {
      bookMode = 'self',
      title,
      subtitle = 'Family Stories, Photographs & Memories',
      authorName,
      organizerName,
      promptCadence = 'weekly',
    } = req.body as {
      bookMode?: BookMode;
      title?: string;
      subtitle?: string;
      authorName?: string;
      organizerName?: string;
      promptCadence?: PromptCadence;
    };

    const cleanAuthor = (authorName || '').trim() || 'Our Storyteller';
    const cleanOrganizer =
      bookMode === 'self' ? cleanAuthor : (organizerName || '').trim() || 'Family Organizer';
    const bookTitle = (title || '').trim() || `${cleanAuthor.split(' ')[0]}’s Stories`;
    const inviteCode = `MEM-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const bookId = `book-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();

    const freshPrompts: GuidedPrompt[] = [
      {
        id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
        category: 'Childhood & Early Days',
        question: 'Tell me about a home, porch, or street from childhood you still picture clearly.',
        memoryTriggers: [
          'What time of day did you feel happiest there?',
          'Who else was usually around, and what sound do you remember first?',
        ],
        coachingTip: 'Speak as if showing a grandchild around that room for the first time.',
        estimatedMinutes: 4,
        isCustom: false,
        createdBy: cleanOrganizer,
        cadence: promptCadence,
        status: 'inbox',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
        category: 'Traditions & Table',
        question: 'What family meal, holiday, or Saturday routine always brought everyone to the table?',
        memoryTriggers: [
          'What was cooking or sitting on the table?',
          'Did someone always tell the same joke or make the same dish?',
        ],
        coachingTip: 'Focus on one concrete gathering you still smile remembering.',
        estimatedMinutes: 4,
        isCustom: false,
        createdBy: cleanOrganizer,
        cadence: promptCadence,
        status: 'inbox',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
      {
        id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
        category: 'Wisdom & Legacy',
        question: 'Looking back, what small decision ended up changing your life more than you expected?',
        memoryTriggers: [
          'What made you hesitate or feel nervous right before choosing?',
          'Who encouraged you to take that step?',
        ],
        coachingTip: 'Share the turning point honestly—every detail helps family feel like they were there.',
        estimatedMinutes: 5,
        isCustom: false,
        createdBy: cleanOrganizer,
        cadence: promptCadence,
        status: 'queued',
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      },
    ];

    const newBook: BookWorkspaceData = {
      settings: {
        id: bookId,
        inviteCode,
        bookMode,
        title: bookTitle,
        subtitle,
        authorName: cleanAuthor,
        organizerName: cleanOrganizer,
        dedication: `Collected with love for the family of ${cleanAuthor}.`,
        coverTheme: 'linen-forest',
        coverImageUrl: '/src/assets/images/sample_book_cover_1794804939349.jpg',
        trimSize: '6x9',
        interiorColorMode: 'color',
        fontScale: 'classic',
        includeQrAudioArchive: true,
        includeDropCaps: true,
        editionYear: String(new Date().getFullYear()),
        authorPreviewEnabled: bookMode === 'self',
        promptCadence,
        preferredAiProvider: process.env.GROQ_API_KEY ? 'groq' : 'gemini-lite',
        enableProviderFallback: true,
        founderGuidePrompt: DEFAULT_FOUNDER_GUIDE,
        spellingGlossary: [],
      },
      collaborators:
        bookMode === 'self'
          ? [
              {
                id: `collab-${crypto.randomUUID().slice(0, 6)}`,
                name: cleanAuthor,
                role: 'author',
                relationship: 'Author & Organizer',
                joinedAt: now,
              },
            ]
          : [
              {
                id: `collab-${crypto.randomUUID().slice(0, 6)}`,
                name: cleanOrganizer,
                role: 'organizer',
                relationship: 'Book Organizer',
                joinedAt: now,
              },
              {
                id: `collab-${crypto.randomUUID().slice(0, 6)}`,
                name: cleanAuthor,
                role: 'author',
                relationship: 'Storyteller',
                joinedAt: now,
              },
            ],
      chapters: [],
      photos: [],
      prompts: freshPrompts,
    };

    const store = loadStore();
    store.books[bookId] = newBook;
    saveStore(store);
    res.status(201).json(newBook);
  });

  app.post('/api/books/join', (req, res) => {
    const {
      inviteCode,
      memberName = 'Family Member',
      role = 'collaborator',
      relationship = 'Family Collaborator',
    } = req.body as {
      inviteCode?: string;
      memberName?: string;
      role?: UserRole;
      relationship?: string;
    };

    const code = (inviteCode || '').trim().toUpperCase();
    if (!code) {
      res.status(400).json({ error: 'Enter a book invite code (for example, CEDAR-1974).' });
      return;
    }

    const store = loadStore();
    const matched = Object.values(store.books).find(
      (b) => b.settings.inviteCode.toUpperCase() === code
    );
    if (!matched) {
      res.status(404).json({
        error: `No active book matched code "${code}". Try CEDAR-1974 for the sample book or check your code.`,
      });
      return;
    }

    const cleanName = memberName.trim() || 'Family Member';
    const exists = matched.collaborators.some(
      (c) => c.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (!exists) {
      matched.collaborators.push({
        id: `collab-${crypto.randomUUID().slice(0, 6)}`,
        name: cleanName,
        role,
        relationship,
        joinedAt: new Date().toISOString(),
      });
      saveStore(store);
    }

    matched.chapters.sort((a, b) => a.order - b.order);
    res.json(matched);
  });

  app.post('/api/book/sync', (req, res) => {
    const incoming = req.body as Partial<BookWorkspaceData>;
    if (incoming?.settings && Array.isArray(incoming?.chapters)) {
      const normalized = normalizeBook(incoming as BookWorkspaceData);
      const store = loadStore();
      store.books[normalized.settings.id] = normalized;
      saveStore(store);
      res.json(normalized);
      return;
    }
    res.status(400).json({ error: 'Invalid workspace snapshot.' });
  });

  app.put('/api/book/settings', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const { bookId: _ignored, ...patch } = req.body || {};
    book.settings = { ...book.settings, ...patch };
    saveStore(store);
    res.json(book.settings);
  });

  // --- Chapters Routes ---
  app.post('/api/chapters', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const {
      title,
      subtitle = '',
      promptQuestion = '',
      epigraph = '',
      pullQuote = '',
      body = '',
      transcript = '',
      audioUrl = null,
      videoUrl = null,
      audioDurationSeconds = 0,
      writingTone = 'Warm Memoir',
      aiEditLevel = 'balanced',
      toneStrength = 'slight',
      perspective = 'first-person',
      lengthPreference = 'balanced',
      providerUsed = 'gemini',
      isPrivate = false,
      editingStatus = 'none',
      editingNote = '',
      eraLabel = '',
      followUpQuestions = [],
      promptId,
    } = req.body as Partial<Chapter> & { promptId?: string };

    const nextOrder =
      book.chapters.length > 0 ? Math.max(...book.chapters.map((c) => c.order)) + 1 : 1;

    const newChapter: Chapter = {
      id: `chap-${crypto.randomUUID().slice(0, 8)}`,
      order: nextOrder,
      title: title || `Untitled Memory ${nextOrder}`,
      subtitle,
      promptQuestion,
      epigraph,
      pullQuote,
      body,
      transcript,
      audioUrl,
      videoUrl,
      audioDurationSeconds,
      writingTone: writingTone as WritingTone,
      aiEditLevel: aiEditLevel as AiEditLevel,
      toneStrength: toneStrength as ToneStrength,
      perspective: perspective as NarrativePerspective,
      lengthPreference: lengthPreference as StoryLength,
      providerUsed,
      isPrivate: Boolean(isPrivate),
      editingStatus,
      editingNote,
      eraLabel: eraLabel || subtitle,
      followUpQuestions,
      comments: [],
      updatedAt: new Date().toISOString(),
    };

    book.chapters.push(newChapter);
    if (promptId) {
      const prompt = book.prompts.find((p) => p.id === promptId);
      if (prompt) {
        prompt.answeredChapterId = newChapter.id;
        prompt.status = 'answered';
      }
    }
    saveStore(store);
    res.status(201).json(newChapter);
  });

  app.put('/api/chapters/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.chapters.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }
    const { bookId: _ignored, ...patch } = req.body || {};
    book.chapters[idx] = {
      ...book.chapters[idx],
      ...patch,
      id: book.chapters[idx].id,
      updatedAt: new Date().toISOString(),
    };
    saveStore(store);
    res.json(book.chapters[idx]);
  });

  app.post('/api/chapters/:id/comments', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.chapters.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }
    const { authorName = 'Family Member', relationship = 'Family', text } = req.body as {
      authorName?: string;
      relationship?: string;
      text?: string;
    };
    if (!text?.trim()) {
      res.status(400).json({ error: 'Comment text is required.' });
      return;
    }
    const comment: ChapterComment = {
      id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
      authorName: authorName.trim() || 'Family Member',
      relationship: relationship.trim() || 'Family',
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    const existing = Array.isArray(book.chapters[idx].comments) ? book.chapters[idx].comments! : [];
    book.chapters[idx] = {
      ...book.chapters[idx],
      comments: [...existing, comment],
    };
    saveStore(store);
    res.status(201).json(book.chapters[idx]);
  });

  app.post('/api/chapters/:id/request-editing', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.chapters.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Chapter not found.' });
      return;
    }
    const { note = '', status = 'requested' } = req.body as {
      note?: string;
      status?: 'none' | 'requested' | 'in-review' | 'completed';
    };
    book.chapters[idx] = {
      ...book.chapters[idx],
      editingStatus: status,
      editingNote: note,
      updatedAt: new Date().toISOString(),
    };
    saveStore(store);
    res.json(book.chapters[idx]);
  });

  app.delete('/api/chapters/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    book.chapters = book.chapters.filter((c) => c.id !== req.params.id);
    book.chapters.forEach((c, idx) => {
      c.order = idx + 1;
    });
    book.photos.forEach((p) => {
      if (p.chapterId === req.params.id) {
        p.chapterId = null;
      }
    });
    book.prompts.forEach((p) => {
      if (p.answeredChapterId === req.params.id) {
        p.answeredChapterId = null;
        p.status = 'inbox';
      }
    });
    saveStore(store);
    res.json({ ok: true, chapters: book.chapters });
  });

  app.post('/api/chapters/reorder', (req, res) => {
    const { orderedIds } = req.body as { orderedIds: string[] };
    if (!Array.isArray(orderedIds)) {
      res.status(400).json({ error: 'orderedIds array is required.' });
      return;
    }
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const map = new Map(book.chapters.map((c) => [c.id, c]));
    const reordered: Chapter[] = [];
    orderedIds.forEach((id, index) => {
      const chap = map.get(id);
      if (chap) {
        chap.order = index + 1;
        reordered.push(chap);
        map.delete(id);
      }
    });
    for (const remaining of map.values()) {
      remaining.order = reordered.length + 1;
      reordered.push(remaining);
    }
    book.chapters = reordered;
    saveStore(store);
    res.json(book.chapters);
  });

  // --- Photo Memories Routes ---
  app.post('/api/photos', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const {
      imageBase64,
      mimeType = 'image/jpeg',
      imageUrl: providedUrl,
      chapterId = null,
      caption = '',
      storyNarrative = '',
      memoryHint = '',
      yearLabel = '',
      locationLabel = '',
      placement = 'framed-figure',
      followUpQuestions = [],
    } = req.body as Partial<MemoryPhoto> & { imageBase64?: string; mimeType?: string };

    let finalUrl = providedUrl || '';
    if (imageBase64) {
      finalUrl = saveBase64Media(imageBase64, mimeType, 'photo');
    }
    if (!finalUrl) {
      res.status(400).json({ error: 'An image file or URL is required.' });
      return;
    }

    const newPhoto: MemoryPhoto = {
      id: `photo-${crypto.randomUUID().slice(0, 8)}`,
      chapterId,
      imageUrl: finalUrl,
      caption,
      storyNarrative,
      memoryHint,
      yearLabel,
      locationLabel,
      placement,
      followUpQuestions,
      createdAt: new Date().toISOString(),
    };
    book.photos.unshift(newPhoto);
    saveStore(store);
    res.status(201).json(newPhoto);
  });

  app.put('/api/photos/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.photos.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Photo not found.' });
      return;
    }
    const { bookId: _ignored, ...patch } = req.body || {};
    book.photos[idx] = { ...book.photos[idx], ...patch, id: book.photos[idx].id };
    saveStore(store);
    res.json(book.photos[idx]);
  });

  app.delete('/api/photos/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    book.photos = book.photos.filter((p) => p.id !== req.params.id);
    saveStore(store);
    res.json({ ok: true });
  });

  // --- Collaborator & Guided Prompts Routes ---
  app.post('/api/prompts/collaborator', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const {
      category = 'Family & Roots',
      question,
      memoryTriggers = [],
      coachingTip = 'Speak naturally about one real moment—who was there, what you noticed, and why it mattered.',
      estimatedMinutes = 4,
      createdBy = book.settings.organizerName || 'Family Collaborator',
      cadence = book.settings.promptCadence || 'weekly',
      status = 'inbox',
      photoBase64,
      photoMimeType = 'image/jpeg',
      voicePromptBase64,
      voicePromptMimeType = 'audio/webm',
      voicePromptDurationSeconds = 0,
    } = req.body as Partial<GuidedPrompt> & {
      photoBase64?: string;
      photoMimeType?: string;
      voicePromptBase64?: string;
      voicePromptMimeType?: string;
    };

    if (!question?.trim() && !voicePromptBase64 && !photoBase64) {
      res.status(400).json({ error: 'Enter a question, record a voice prompt, or attach a photo.' });
      return;
    }

    const savedPhotoUrl = photoBase64
      ? saveBase64Media(photoBase64, photoMimeType, 'prompt-photo')
      : null;
    const savedVoiceUrl = voicePromptBase64
      ? saveBase64Media(voicePromptBase64, voicePromptMimeType, 'prompt-voice')
      : null;

    const prompt: GuidedPrompt = {
      id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
      category: category as PromptCategory,
      question:
        question?.trim() ||
        (savedPhotoUrl
          ? 'What does this photograph help you remember?'
          : 'Listen to this family voice prompt and share whatever memory comes to mind.'),
      memoryTriggers: memoryTriggers.filter((t) => t.trim().length > 0),
      coachingTip,
      estimatedMinutes,
      isCustom: true,
      createdBy,
      cadence: cadence as PromptCadence,
      status: status as 'inbox' | 'queued' | 'answered',
      photoUrl: savedPhotoUrl,
      voicePromptUrl: savedVoiceUrl,
      voicePromptDurationSeconds,
      answeredChapterId: null,
      createdAt: new Date().toISOString(),
    };

    book.prompts.unshift(prompt);
    saveStore(store);
    res.status(201).json(prompt);
  });

  app.post('/api/prompts/custom', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const {
      category = 'Childhood & Early Days',
      question,
      memoryTriggers = [],
      coachingTip = 'Speak naturally about one concrete scene, smell, or conversation you still remember.',
      estimatedMinutes = 4,
      createdBy = book.settings.organizerName || 'Organizer',
      cadence = book.settings.promptCadence || 'weekly',
    } = req.body as Partial<GuidedPrompt>;

    if (!question?.trim()) {
      res.status(400).json({ error: 'Question text is required.' });
      return;
    }

    const prompt: GuidedPrompt = {
      id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
      category: category as PromptCategory,
      question: question.trim(),
      memoryTriggers:
        memoryTriggers.length > 0
          ? memoryTriggers
          : [
              'Close your eyes and place yourself in the room or street where this happened.',
              'Start with the people present and what time of day it was.',
            ],
      coachingTip,
      estimatedMinutes,
      isCustom: true,
      createdBy,
      cadence: cadence as PromptCadence,
      status: 'inbox',
      photoUrl: null,
      voicePromptUrl: null,
      answeredChapterId: null,
      createdAt: new Date().toISOString(),
    };
    book.prompts.unshift(prompt);
    saveStore(store);
    res.status(201).json(prompt);
  });

  app.put('/api/prompts/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.prompts.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Prompt not found.' });
      return;
    }
    const { bookId: _ignored, ...patch } = req.body || {};
    book.prompts[idx] = { ...book.prompts[idx], ...patch, id: book.prompts[idx].id };
    saveStore(store);
    res.json(book.prompts[idx]);
  });

  app.post('/api/prompts/:id/vote', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    const idx = book.prompts.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Prompt not found.' });
      return;
    }
    const { memberName = 'Family Member' } = req.body as { memberName?: string };
    const voter = memberName.trim() || 'Family Member';
    const current = book.prompts[idx];
    const votedBy = Array.isArray(current.votedBy) ? [...current.votedBy] : [];
    const existingIdx = votedBy.findIndex((v) => v.toLowerCase() === voter.toLowerCase());
    if (existingIdx >= 0) {
      votedBy.splice(existingIdx, 1);
    } else {
      votedBy.push(voter);
    }
    book.prompts[idx] = {
      ...current,
      votedBy,
      votes: votedBy.length,
    };
    saveStore(store);
    res.json(book.prompts[idx]);
  });

  app.delete('/api/prompts/:id', (req, res) => {
    const store = loadStore();
    const book = getBookFromRequest(store, req);
    book.prompts = book.prompts.filter((p) => p.id !== req.params.id);
    saveStore(store);
    res.json({ ok: true });
  });

  // --- AI Routes (Dual Switchable Groq + Gemini + Founder's Method) ---
  app.post('/api/ai/transcribe-and-draft', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const {
        audioBase64,
        mimeType = 'audio/webm',
        transcriptOverride,
        promptQuestion = '',
        storytellerName = book.settings.authorName || 'the storyteller',
        writingTone = 'Warm Memoir',
        aiEditLevel = 'balanced',
        toneStrength = 'slight',
        perspective = 'first-person',
        lengthPreference = 'balanced',
        preferredProvider,
        memoryNotes = '',
        spellingHints,
      } = req.body as {
        audioBase64?: string;
        mimeType?: string;
        transcriptOverride?: string;
        promptQuestion?: string;
        storytellerName?: string;
        writingTone?: WritingTone;
        aiEditLevel?: AiEditLevel;
        toneStrength?: ToneStrength;
        perspective?: NarrativePerspective;
        lengthPreference?: StoryLength;
        preferredProvider?: AiVoiceProvider;
        memoryNotes?: string;
        spellingHints?: SpellingHintsInput;
      };

      const activeProvider =
        preferredProvider || book.settings.preferredAiProvider || 'gemini-lite';
      const allowFallback = book.settings.enableProviderFallback;
      const spellingBlock = buildSpellingPromptBlock(book, spellingHints);

      let transcriptText = (transcriptOverride || '').trim();
      let savedAudioUrl: string | null = null;
      let savedVideoUrl: string | null = null;
      let providerUsed: string = activeProvider;
      let fallbackNotice: string | undefined;

      if (audioBase64) {
        const isVideo = (mimeType || '').split(';')[0].trim().toLowerCase().startsWith('video/');
        const cleanedMime = cleanMimeType(mimeType, 'audio/webm');
        const rawBase64 = extractBase64(audioBase64);
        if (isVideo) {
          savedVideoUrl = saveBase64Media(rawBase64, mimeType, 'interview-video');
        } else {
          savedAudioUrl = saveBase64Media(rawBase64, cleanedMime, 'interview');
        }

        const audioResult = await transcribeAudioWithDualProvider(
          rawBase64,
          cleanedMime,
          activeProvider,
          allowFallback,
          spellingBlock
        );
        transcriptText = audioResult.transcript;
        providerUsed = audioResult.providerUsed;
        fallbackNotice = audioResult.fallbackNotice;
      }

      if (!transcriptText) {
        res.status(400).json({ error: 'Provide either recorded audio or written memory notes.' });
        return;
      }

      const editInstruction = buildEditLevelInstruction(
        aiEditLevel,
        toneStrength,
        writingTone,
        perspective,
        lengthPreference,
        storytellerName
      );

      const prompt = `Shape this spoken memory into a family book chapter while strictly respecting the AI editing level and the Founder's Method.

${book.settings.founderGuidePrompt}

${editInstruction}
${spellingBlock ? `\n${spellingBlock}\n` : ''}
Storyteller: ${storytellerName}
Prompt Question: ${promptQuestion || 'Spontaneous personal memory'}
Additional Context: ${memoryNotes || 'None'}

Original Spoken Transcript:
"""
${transcriptText}
"""

Requirements:
1. NEVER invent facts, names, dates, or events not grounded in the transcript.
2. NEVER flatten the speaker's natural voice into stiff AI clichés.
3. Preserve exact spelling of any verified names, places, and addresses listed above.
4. Return JSON with fields: title, subtitle, eraLabel (e.g., "1974 · Childhood" or "Mid-1980s"), epigraph (1 short opening sentence), pullQuote (1 authentic standout quote from their words), body (multi-paragraph text separated by blank lines matching the exact AI editing level requested), and followUpQuestions (array of 2 gentle follow-up questions).`;

      const draftSchema: Schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          eraLabel: { type: Type.STRING },
          epigraph: { type: Type.STRING },
          pullQuote: { type: Type.STRING },
          body: { type: Type.STRING },
          followUpQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: [
          'title',
          'subtitle',
          'eraLabel',
          'epigraph',
          'pullQuote',
          'body',
          'followUpQuestions',
        ],
      };

      const { data: chapterDraft, providerUsed: textProvider, fallbackNotice: textNotice } =
        await generateStructuredJsonWithDualProvider({
          prompt,
          systemInstruction:
            'You are a careful, warm memoir editor at RememberPress. You act strictly as a helper, never replacing the storyteller’s authentic voice.',
          preferredProvider: activeProvider,
          enableFallback: allowFallback,
          geminiSchema: draftSchema,
          fallbackObj: {
            title: 'Untitled Memory',
            subtitle: '',
            eraLabel: '',
            epigraph: '',
            pullQuote: '',
            body: transcriptText,
            followUpQuestions: [],
          },
        });

      res.json({
        transcript: transcriptText,
        chapter: chapterDraft,
        audioUrl: savedAudioUrl,
        videoUrl: savedVideoUrl,
        providerUsed: audioBase64 ? `${providerUsed} + ${textProvider}` : textProvider,
        fallbackNotice: fallbackNotice || textNotice,
      });
    } catch (error) {
      console.error('transcribe-and-draft error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to transcribe and draft memory.'),
      });
    }
  });

  app.post('/api/ai/rewrite-memory', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const {
        transcript,
        currentTitle = '',
        currentSubtitle = '',
        writingTone = 'Warm Memoir',
        aiEditLevel = 'balanced',
        toneStrength = 'slight',
        perspective = 'first-person',
        lengthPreference = 'balanced',
        storytellerName = book.settings.authorName || 'the storyteller',
        preferredProvider,
      } = req.body as {
        transcript?: string;
        currentTitle?: string;
        currentSubtitle?: string;
        writingTone?: WritingTone;
        aiEditLevel?: AiEditLevel;
        toneStrength?: ToneStrength;
        perspective?: NarrativePerspective;
        lengthPreference?: StoryLength;
        storytellerName?: string;
        preferredProvider?: AiVoiceProvider;
      };

      if (!transcript?.trim()) {
        res.status(400).json({
          error: 'Original transcript is required so AI edits remain grounded in your real words.',
        });
        return;
      }

      const activeProvider =
        preferredProvider || book.settings.preferredAiProvider || 'gemini-lite';
      const allowFallback = book.settings.enableProviderFallback;

      if (aiEditLevel === 'raw' && perspective !== 'third-person') {
        res.json({
          title: currentTitle || 'Untitled Memory',
          subtitle: currentSubtitle,
          epigraph: '',
          pullQuote: '',
          body: transcript.trim(),
          providerUsed: 'verbatim-source',
        });
        return;
      }

      const editInstruction = buildEditLevelInstruction(
        aiEditLevel,
        toneStrength,
        writingTone,
        perspective,
        lengthPreference,
        storytellerName
      );

      const prompt = `Re-shape the original spoken transcript below according to the exact AI Helper Level and Tone Strength requested.

${book.settings.founderGuidePrompt}
${editInstruction}

Current Title Suggestion: ${currentTitle || 'Create an authentic title'}
Original Spoken Transcript (Source of Truth):
"""
${transcript}
"""

Return JSON with fields: title, subtitle, epigraph, pullQuote, body.`;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          subtitle: { type: Type.STRING },
          epigraph: { type: Type.STRING },
          pullQuote: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['title', 'subtitle', 'epigraph', 'pullQuote', 'body'],
      };

      const { data, providerUsed, fallbackNotice } =
        await generateStructuredJsonWithDualProvider({
          prompt,
          systemInstruction:
            'You are RememberPress’s gentle editorial helper. Always preserve the storyteller’s natural vocabulary, emotional warmth, and true facts.',
          preferredProvider: activeProvider,
          enableFallback: allowFallback,
          geminiSchema: schema,
          fallbackObj: {
            title: currentTitle || 'Untitled Memory',
            subtitle: currentSubtitle,
            epigraph: '',
            pullQuote: '',
            body: transcript,
          },
        });

      res.json({
        ...data,
        providerUsed,
        fallbackNotice,
      });
    } catch (error) {
      console.error('rewrite-memory error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to adjust AI polish level.'),
      });
    }
  });

  app.post('/api/ai/sequence-book', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      if (book.chapters.length < 2) {
        res.json({
          chapters: book.chapters,
          rationale: 'Add at least two chapters to auto-sequence the book timeline.',
          providerUsed: 'none',
        });
        return;
      }

      const summaries = book.chapters.map((c) => ({
        id: c.id,
        currentOrder: c.order,
        title: c.title,
        subtitle: c.subtitle,
        eraLabel: c.eraLabel,
        excerpt: c.body.slice(0, 260),
      }));

      const prompt = `These memoir memories were captured out of order. Organize them into the most natural, heartwarming printed book chapter sequence (typically childhood -> family roots -> coming of age -> work/love -> turning points -> wisdom & legacy).

Chapters to sequence:
${JSON.stringify(summaries, null, 2)}

Return JSON with:
- orderedIds: array containing every chapter id exactly once in the recommended book order.
- rationale: 1 short, warm sentence explaining why this chapter sequence flows well.`;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          orderedIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          rationale: { type: Type.STRING },
        },
        required: ['orderedIds', 'rationale'],
      };

      const { data, providerUsed } = await generateStructuredJsonWithDualProvider({
        prompt,
        systemInstruction:
          'You are a memoir book editor organizing non-linear family stories into a cohesive, chronologically and emotionally satisfying book.',
        preferredProvider: book.settings.preferredAiProvider || 'gemini-lite',
        enableFallback: book.settings.enableProviderFallback,
        geminiSchema: schema,
        fallbackObj: {
          orderedIds: book.chapters.map((c) => c.id),
          rationale: 'Preserved your current chapter sequence.',
        },
      });

      const map = new Map(book.chapters.map((c) => [c.id, c]));
      const reordered: Chapter[] = [];
      for (const id of data.orderedIds || []) {
        const ch = map.get(id);
        if (ch) {
          ch.order = reordered.length + 1;
          reordered.push(ch);
          map.delete(id);
        }
      }
      for (const leftover of map.values()) {
        leftover.order = reordered.length + 1;
        reordered.push(leftover);
      }

      book.chapters = reordered;
      saveStore(store);
      res.json({
        chapters: book.chapters,
        rationale: data.rationale,
        providerUsed,
      });
    } catch (error) {
      console.error('sequence-book error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to organize book sequence.'),
      });
    }
  });

  app.post('/api/ai/refine-chapter', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const { title, body, transcript, instruction } = req.body as {
        title: string;
        body: string;
        transcript?: string;
        instruction: string;
      };
      if (!body || !instruction) {
        res.status(400).json({ error: 'Chapter body and refinement instruction are required.' });
        return;
      }

      const prompt = `Refine the following memoir chapter manuscript according to the instruction while preserving the storyteller's authentic voice and staying faithful to the original transcript.

${book.settings.founderGuidePrompt}
Chapter Title: ${title}
Instruction: ${instruction}

Current Manuscript Body:
"""
${body}
"""

Original Spoken Transcript (Source of Truth):
"""
${transcript || 'Not provided'}
"""

Return JSON with: title, pullQuote, body.`;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          pullQuote: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ['title', 'pullQuote', 'body'],
      };

      const { data } = await generateStructuredJsonWithDualProvider({
        prompt,
        systemInstruction:
          'You are a careful literary memoir editor. Keep the storyteller’s genuine phrasing and facts.',
        preferredProvider: book.settings.preferredAiProvider || 'gemini-lite',
        enableFallback: book.settings.enableProviderFallback,
        geminiSchema: schema,
        fallbackObj: { title, pullQuote: '', body },
      });

      res.json(data);
    } catch (error) {
      console.error('refine-chapter error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to refine chapter.'),
      });
    }
  });

  app.post('/api/ai/describe-photo', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const {
        imageBase64,
        mimeType = 'image/jpeg',
        memoryHint = '',
        chapterContext = '',
      } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        memoryHint?: string;
        chapterContext?: string;
      };

      const inlineImg = resolveImageInlineData(imageBase64, mimeType);
      if (!inlineImg) {
        res.status(400).json({ error: 'Image data is required to generate a photo story.' });
        return;
      }

      const { response: resp } = await generateGeminiWithFallback({
        preferredProvider: book.settings.preferredAiProvider,
        enableFallback: book.settings.enableProviderFallback,
        buildRequest: (model) => ({
          model,
          contents: {
            parts: [
              { inlineData: inlineImg },
              {
                text: `Look closely at this family photograph and weave a warm, truthful memoir story around it.

User's Memory Note: ${memoryHint || 'No written hint yet—describe the visible moment warmly.'}
Book Chapter Context: ${chapterContext || 'General family memoir'}

Return JSON:
- caption: Crisp 1-sentence book figure caption.
- storyNarrative: Warm 2-paragraph narrative grounded strictly in what is visible and the memory note.
- yearLabel: Era or estimated decade/season.
- memoryQuestions: 3 specific follow-up questions pointing to real visual details in the photo.`,
              },
            ],
          },
          config: {
            systemInstruction:
              'You are a memoir visual curator at RememberPress. Never fabricate names or dates not present in the note.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                caption: { type: Type.STRING },
                storyNarrative: { type: Type.STRING },
                yearLabel: { type: Type.STRING },
                memoryQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['caption', 'storyNarrative', 'yearLabel', 'memoryQuestions'],
            },
          },
        }),
      });

      res.json(
        safeParseModelJson(resp.text, {
          caption: memoryHint || 'Family photograph',
          storyNarrative: '',
          yearLabel: '',
          memoryQuestions: [],
        })
      );
    } catch (error) {
      console.error('describe-photo error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to describe photo.'),
      });
    }
  });

  app.post('/api/ai/photo-memory-questions', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const { imageBase64, mimeType = 'image/jpeg', memoryHint = '' } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        memoryHint?: string;
      };

      const inlineImg = resolveImageInlineData(imageBase64, mimeType);
      if (!inlineImg) {
        res.status(400).json({ error: 'Select or upload a photograph first.' });
        return;
      }

      const { response: resp, modelUsed } = await generateGeminiWithFallback({
        preferredProvider: book.settings.preferredAiProvider,
        enableFallback: book.settings.enableProviderFallback,
        buildRequest: (model) => ({
          model,
          contents: {
            parts: [
              { inlineData: inlineImg },
              {
                text: `You are helping a family member craft warm, specific memory questions around this photograph for ${book.settings.authorName}.
Apply this coaching methodology:
${book.settings.founderGuidePrompt}

Optional context note: ${memoryHint || 'None yet'}

Look carefully at the setting, people, objects, clothing, and lighting in the photo.
Return JSON:
1. observationLead: 1 warm sentence noticing a visual detail and asking "What does this photo help you remember?"
2. questions: 4 concise, human memory questions anchored in real visual clues (the family member will choose which ones to keep or remove before sending).`,
              },
            ],
          },
          config: {
            systemInstruction:
              'You are a warm oral historian at RememberPress helping families ask thoughtful questions around cherished photos.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                observationLead: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['observationLead', 'questions'],
            },
          },
        }),
      });

      const parsed = safeParseModelJson(resp.text, {
        observationLead:
          'Take a quiet moment with this photograph—what does it help you remember first?',
        questions: [
          'Who is in this photograph, and who was holding the camera?',
          'What happened right before or right after this picture was taken?',
          'What sounds, smells, or conversations from that day come back to you?',
        ],
      });

      res.json({ ...parsed, providerUsed: modelUsed });
    } catch (error) {
      console.error('photo-memory-questions error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to generate memory questions from photo.'),
      });
    }
  });

  app.post('/api/ai/photo-explanation-story', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const {
        imageBase64,
        mimeType = 'image/jpeg',
        audioBase64,
        audioMimeType = 'audio/webm',
        writtenExplanation = '',
        askedQuestions = [],
        storytellerName = book.settings.authorName || 'the storyteller',
        memoryHint = '',
        writingTone = 'Warm Memoir',
        aiEditLevel = 'balanced',
        toneStrength = 'slight',
        preferredProvider,
        spellingHints,
      } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        audioBase64?: string;
        audioMimeType?: string;
        writtenExplanation?: string;
        askedQuestions?: string[];
        storytellerName?: string;
        memoryHint?: string;
        writingTone?: WritingTone;
        aiEditLevel?: AiEditLevel;
        toneStrength?: ToneStrength;
        preferredProvider?: AiVoiceProvider;
        spellingHints?: SpellingHintsInput;
      };

      const inlineImg = resolveImageInlineData(imageBase64, mimeType);
      if (!inlineImg) {
        res.status(400).json({ error: 'A photograph is required.' });
        return;
      }

      const activeProvider =
        preferredProvider || book.settings.preferredAiProvider || 'gemini-lite';
      const allowFallback = book.settings.enableProviderFallback;
      const spellingBlock = buildSpellingPromptBlock(book, spellingHints);

      let explanationText = (writtenExplanation || '').trim();
      let savedAudioUrl: string | null = null;
      let savedVideoUrl: string | null = null;
      let audioProvider = 'text';
      let fallbackNotice: string | undefined;

      if (audioBase64) {
        const isVideo = (audioMimeType || '').split(';')[0].trim().toLowerCase().startsWith('video/');
        const cleanedAudioMime = cleanMimeType(audioMimeType, 'audio/webm');
        const rawAudioBase64 = extractBase64(audioBase64);
        if (isVideo) {
          savedVideoUrl = saveBase64Media(rawAudioBase64, audioMimeType, 'photo-video');
        } else {
          savedAudioUrl = saveBase64Media(rawAudioBase64, cleanedAudioMime, 'photo-interview');
        }

        const audioRes = await transcribeAudioWithDualProvider(
          rawAudioBase64,
          cleanedAudioMime,
          activeProvider,
          allowFallback,
          spellingBlock
        );
        explanationText = audioRes.transcript;
        audioProvider = audioRes.providerUsed;
        fallbackNotice = audioRes.fallbackNotice;
      }

      if (!explanationText) {
        res.status(400).json({
          error: 'Please record or write the storyteller’s explanation first.',
        });
        return;
      }

      const editInstruction = buildEditLevelInstruction(
        aiEditLevel,
        toneStrength,
        writingTone,
        'first-person',
        'balanced',
        storytellerName
      );

      const promptText = `We showed this photograph to ${storytellerName} and asked what memories it brings back.

${book.settings.founderGuidePrompt}
${editInstruction}
${spellingBlock ? `\n${spellingBlock}\n` : ''}
Questions Asked:
${askedQuestions.length > 0 ? askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n') : 'What does this photo help you remember?'}

Optional Context Note: ${memoryHint || 'None'}

Storyteller's Explanation (Source of Truth):
"""
${explanationText}
"""

Using BOTH the photograph and everything the storyteller explained (staying strictly faithful to their voice, facts, and verified name/place/address spellings), return JSON:
- caption: Crisp 1-sentence editorial figure caption.
- storyNarrative: 2-to-3 paragraph narrative shaped exactly to the requested AI editing level.
- yearLabel: Era or year mentioned (or gentle estimate if unstated).
- chapterTitle: Evocative chapter title.
- chapterSubtitle: Concise era/place subtitle.
- memoryQuestions: 2 gentle follow-up questions if they want to add more later.`;

      const storyFallbackObj = {
        caption: memoryHint || 'Family memory photograph',
        storyNarrative: explanationText,
        yearLabel: '',
        chapterTitle: 'A Moment Remembered',
        chapterSubtitle: '',
        memoryQuestions: [] as string[],
      };

      const storySchema: Schema = {
        type: Type.OBJECT,
        properties: {
          caption: { type: Type.STRING },
          storyNarrative: { type: Type.STRING },
          yearLabel: { type: Type.STRING },
          chapterTitle: { type: Type.STRING },
          chapterSubtitle: { type: Type.STRING },
          memoryQuestions: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'caption',
          'storyNarrative',
          'yearLabel',
          'chapterTitle',
          'chapterSubtitle',
          'memoryQuestions',
        ],
      };

      let parsed = storyFallbackObj;
      let visionModelUsed = 'gemini-3.1-flash-lite';

      try {
        const gemResult = await generateGeminiWithFallback({
          preferredProvider: activeProvider,
          enableFallback: allowFallback,
          buildRequest: (model) => ({
            model,
            contents: {
              parts: [
                { inlineData: inlineImg },
                { text: promptText },
              ],
            },
            config: {
              systemInstruction:
                'You are a careful memoir editor at RememberPress turning a storyteller’s photo memories into authentic book pages.',
              responseMimeType: 'application/json',
              responseSchema: storySchema,
            },
          }),
        });
        parsed = safeParseModelJson(gemResult.response.text, storyFallbackObj);
        visionModelUsed = gemResult.modelUsed;
        if (gemResult.fallbackNotice) {
          fallbackNotice = fallbackNotice
            ? `${fallbackNotice} · ${gemResult.fallbackNotice}`
            : gemResult.fallbackNotice;
        }
      } catch (gemErr) {
        if (!allowFallback || !process.env.GROQ_API_KEY) {
          throw gemErr;
        }
        const reason = formatApiError(gemErr, 'Gemini busy');
        const groqRes = await callGroqQwenJson(
          promptText,
          'You are a careful memoir editor at RememberPress turning a storyteller’s photo explanation into authentic book pages.',
          storyFallbackObj
        );
        parsed = groqRes.data;
        visionModelUsed = `groq-${groqRes.modelUsed}`;
        fallbackNotice = `Switched to Groq ${groqRes.modelUsed} (${reason})`;
      }

      res.json({
        transcript: explanationText,
        ...parsed,
        audioUrl: savedAudioUrl,
        videoUrl: savedVideoUrl,
        providerUsed: audioBase64 ? `${audioProvider} + ${visionModelUsed}` : visionModelUsed,
        fallbackNotice,
      });
    } catch (error) {
      console.error('photo-explanation-story error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to build photo story from explanation.'),
      });
    }
  });

  app.post('/api/ai/guided-prompts', async (req, res) => {
    try {
      const store = loadStore();
      const book = getBookFromRequest(store, req);
      const {
        category,
        lifeContext = '',
        existingTitles = [],
        createdBy = book.settings.organizerName || 'RememberPress Guide',
        cadence = book.settings.promptCadence || 'weekly',
        status = 'queued',
      } = req.body as {
        category: string;
        lifeContext?: string;
        existingTitles?: string[];
        createdBy?: string;
        cadence?: PromptCadence;
        status?: 'inbox' | 'queued';
      };

      const prompt = `Generate 3 thoughtful, human memoir questions for the theme "${category}".

Follow this Founder's Book-Writing Guide strictly:
${book.settings.founderGuidePrompt}

Storyteller Name: ${book.settings.authorName}
Family / Life Context: ${lifeContext || 'Everyday family life, friendships, work, and traditions'}
Chapters already written: ${existingTitles.length > 0 ? existingTitles.join('; ') : 'None yet'}

For each question return:
- question: Warm, specific question inviting one real story (avoid clichés).
- memoryTriggers: 3 short sensory cues (sounds, objects, routines) to help unlock memories.
- coachingTip: 1 encouraging speaking tip grounded in the Founder's Method.
- estimatedMinutes: integer between 3 and 6.`;

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          prompts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                memoryTriggers: { type: Type.ARRAY, items: { type: Type.STRING } },
                coachingTip: { type: Type.STRING },
                estimatedMinutes: { type: Type.INTEGER },
              },
              required: ['question', 'memoryTriggers', 'coachingTip', 'estimatedMinutes'],
            },
          },
        },
        required: ['prompts'],
      };

      const { data: result, providerUsed } = await generateStructuredJsonWithDualProvider<{
        prompts: Array<{
          question: string;
          memoryTriggers?: string[];
          coachingTip?: string;
          estimatedMinutes?: number;
        }>;
      }>({
        prompt,
        systemInstruction:
          'You are an oral historian trained in the RememberPress Founder’s Method, helping families ask warm, story-sparking questions.',
        preferredProvider: book.settings.preferredAiProvider || 'gemini-lite',
        enableFallback: book.settings.enableProviderFallback,
        geminiSchema: schema,
        fallbackObj: { prompts: [] },
      });

      const now = new Date().toISOString();
      const created: GuidedPrompt[] = (result.prompts || []).map((item) => ({
        id: `prompt-${crypto.randomUUID().slice(0, 8)}`,
        category: (category as PromptCategory) || 'Family & Roots',
        question: item.question,
        memoryTriggers: item.memoryTriggers || [],
        coachingTip: item.coachingTip || '',
        estimatedMinutes: item.estimatedMinutes || 4,
        isCustom: false,
        createdBy,
        cadence,
        status,
        photoUrl: null,
        voicePromptUrl: null,
        answeredChapterId: null,
        createdAt: now,
      }));
      book.prompts = [...created, ...book.prompts];
      saveStore(store);

      res.json({ prompts: created, providerUsed });
    } catch (error) {
      console.error('guided-prompts error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to generate guided prompts.'),
      });
    }
  });

  app.post('/api/ai/narrate-chapter', async (req, res) => {
    try {
      const { title, body } = req.body as { title: string; body: string };
      if (!body?.trim()) {
        res.status(400).json({ error: 'Chapter text is required for narration.' });
        return;
      }

      const ai = getAiClient();
      const excerpt = `${title ? `${title}. ` : ''}${body}`.slice(0, 1800);
      const ttsResp = await ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: excerpt,
                speechMetadata: {
                  style: 'Warm, unhurried audiobook narrator reading a personal family memoir',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = ttsResp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) {
        throw new Error('Narration audio was not returned.');
      }

      res.json({ audioBase64: base64Audio, mimeType: 'audio/wav' });
    } catch (error) {
      console.error('narrate-chapter error:', error);
      res.status(500).json({
        error: formatApiError(error, 'Failed to narrate chapter.'),
      });
    }
  });

  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled /api error:', err);
    const status =
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status?: number }).status === 'number'
        ? (err as { status: number }).status
        : 500;
    res.status(status).json({
      error: formatApiError(err, 'Unexpected server error while handling request.'),
    });
  });

  return app;
}
