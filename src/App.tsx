import { useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Home,
  Loader2,
  Plus,
  Send,
  Settings,
} from 'lucide-react';
import type {
  BookSettings,
  BookWorkspaceData,
  Chapter,
  GuidedPrompt,
  MemoryPhoto,
  UserRole,
} from './types';
import { TopBar, type ActiveTab, type TopBarNavItem } from './components/TopBar';
import { OnboardingView } from './components/OnboardingView';
import { OrganizerHomeView } from './components/OrganizerHomeView';
import { StorytellerStudioView } from './components/StorytellerStudioView';
import { QuestionPoolView } from './components/QuestionPoolView';
import { StoriesReviewView } from './components/StoriesReviewView';
import { BookLayoutView } from './components/BookLayoutView';
import { SharedStoryView } from './components/SharedStoryView';
import { SettingsView } from './components/SettingsView';
import { parseJsonResponse, withBookId } from './utils/api';
import { DEFAULT_FOUNDER_GUIDE, getFallbackSeedWorkspace } from './utils/seedWorkspace';

const SESSION_KEY = 'rememberpress_session_v2';

interface StoredSession {
  bookId: string;
  role: UserRole;
  memberName: string;
  onboardingComplete: boolean;
}

interface BookSummary {
  id: string;
  title: string;
  authorName: string;
  organizerName: string;
  inviteCode: string;
  bookMode: BookSettings['bookMode'];
  chapterCount: number;
}

function readSession(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (parsed?.bookId && parsed?.role) {
      return parsed;
    }
  } catch {
    // Ignore storage issues
  }
  return null;
}

function writeSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota errors
  }
}

function workspaceStorageKey(bookId: string): string {
  return `rememberpress_workspace_${bookId}_v2`;
}

function normalizeClientWorkspace(data: BookWorkspaceData): BookWorkspaceData {
  const seed = getFallbackSeedWorkspace();
  return {
    ...data,
    settings: {
      ...seed.settings,
      ...(data.settings || {}),
      founderGuidePrompt: data.settings?.founderGuidePrompt || DEFAULT_FOUNDER_GUIDE,
      spellingGlossary: Array.isArray(data.settings?.spellingGlossary)
        ? data.settings.spellingGlossary
        : seed.settings.spellingGlossary,
    },
    collaborators: Array.isArray(data.collaborators) ? data.collaborators : seed.collaborators,
    chapters: Array.isArray(data.chapters)
      ? data.chapters.map((ch, i) => ({
          ...ch,
          order: ch.order || i + 1,
          aiEditLevel: ch.aiEditLevel || 'balanced',
          toneStrength: ch.toneStrength || 'slight',
          perspective: ch.perspective || 'first-person',
          lengthPreference: ch.lengthPreference || 'balanced',
          videoUrl: ch.videoUrl || null,
          isPrivate: Boolean(ch.isPrivate),
          editingStatus: ch.editingStatus || 'none',
          editingNote: ch.editingNote || '',
          eraLabel: ch.eraLabel || '',
          comments: Array.isArray(ch.comments) ? ch.comments : [],
        }))
      : [],
    photos: Array.isArray(data.photos) ? data.photos : [],
    prompts: Array.isArray(data.prompts)
      ? data.prompts.map((p) => ({
          ...p,
          cadence: p.cadence || 'weekly',
          status: p.answeredChapterId ? 'answered' : p.status || 'inbox',
          createdBy: p.createdBy || 'Family Organizer',
          votes: typeof p.votes === 'number' ? p.votes : 0,
          votedBy: Array.isArray(p.votedBy) ? p.votedBy : [],
        }))
      : [],
  };
}

function readLocalWorkspace(bookId: string): BookWorkspaceData | null {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookWorkspaceData;
    if (parsed?.settings && Array.isArray(parsed?.chapters)) {
      return normalizeClientWorkspace(parsed);
    }
  } catch {
    // Ignore storage read issues
  }
  return null;
}

function writeLocalWorkspace(data: BookWorkspaceData): void {
  try {
    if (!data?.settings?.id) return;
    window.localStorage.setItem(workspaceStorageKey(data.settings.id), JSON.stringify(data));
  } catch {
    // Ignore storage quota errors
  }
}

function getRoleNavItems(
  role: UserRole,
  settings: BookSettings | undefined
): TopBarNavItem[] {
  const isSelfBook = settings?.bookMode === 'self';
  const showAuthorPreview = isSelfBook || Boolean(settings?.authorPreviewEnabled);

  if (role === 'organizer') {
    return [
      { id: 'home', label: 'Home' },
      { id: 'review', label: 'Stories' },
      { id: 'pool', label: 'Prompts' },
      { id: 'preview', label: 'Book Preview' },
      { id: 'settings', label: 'Project settings' },
    ];
  }

  if (role === 'collaborator') {
    return [
      { id: 'pool', label: 'Suggest Questions' },
      { id: 'preview', label: 'Book Preview' },
    ];
  }

  // Storyteller / Parent ('author')
  if (isSelfBook) {
    return [
      { id: 'home', label: 'Record' },
      { id: 'pool', label: 'Prompts' },
      { id: 'review', label: 'My Stories' },
      { id: 'preview', label: 'Book Preview' },
      { id: 'settings', label: 'Settings' },
    ];
  }

  const authorItems: TopBarNavItem[] = [
    { id: 'home', label: 'Record' },
    { id: 'review', label: 'My Stories' },
  ];
  if (showAuthorPreview) {
    authorItems.push({ id: 'preview', label: 'Book Preview' });
  }
  return authorItems;
}

export default function App() {
  const [workspace, setWorkspace] = useState<BookWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [role, setRole] = useState<UserRole>('organizer');
  const [memberName, setMemberName] = useState<string>('Maya Vance');
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');

  const [capturePrompt, setCapturePrompt] = useState<GuidedPrompt | null>(null);
  const [sharedChapterId, setSharedChapterId] = useState<string | null>(null);

  const [selectedReviewChapterId, setSelectedReviewChapterId] = useState<string | null>(null);
  const [selectedPreviewChapterId, setSelectedPreviewChapterId] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [availableBooks, setAvailableBooks] = useState<BookSummary[]>([]);
  const [bookMenuOpen, setBookMenuOpen] = useState(false);
  const [mobileBookMenuOpen, setMobileBookMenuOpen] = useState(false);
  const [switchingBookId, setSwitchingBookId] = useState<string | null>(null);
  const desktopBookMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileBookMenuRef = useRef<HTMLDivElement | null>(null);

  async function refreshBookList(currentWorkspace?: BookWorkspaceData | null) {
    let list: BookSummary[] = [];
    try {
      const res = await fetch('/api/books');
      if (res.ok) {
        const data = (await res.json()) as { books?: BookSummary[] };
        if (Array.isArray(data.books)) {
          list = data.books;
        }
      }
    } catch {
      // Fallback to localStorage / current workspace below
    }

    try {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith('rememberpress_workspace_') && key.endsWith('_v2')) {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as BookWorkspaceData;
          if (parsed?.settings?.id && !list.some((b) => b.id === parsed.settings.id)) {
            list.push({
              id: parsed.settings.id,
              title: parsed.settings.title,
              authorName: parsed.settings.authorName,
              organizerName: parsed.settings.organizerName,
              inviteCode: parsed.settings.inviteCode,
              bookMode: parsed.settings.bookMode,
              chapterCount: parsed.chapters?.length || 0,
            });
          }
        }
      }
    } catch {
      // Ignore storage inspection issues
    }

    const active = currentWorkspace || workspace;
    if (active?.settings?.id) {
      const activeSummary: BookSummary = {
        id: active.settings.id,
        title: active.settings.title,
        authorName: active.settings.authorName,
        organizerName: active.settings.organizerName,
        inviteCode: active.settings.inviteCode,
        bookMode: active.settings.bookMode,
        chapterCount: active.chapters.length,
      };
      const idx = list.findIndex((b) => b.id === active.settings.id);
      if (idx >= 0) {
        list[idx] = activeSummary;
      } else {
        list.unshift(activeSummary);
      }
    }

    setAvailableBooks(list);
  }

  useEffect(() => {
    function handleOutsideClick(ev: MouseEvent) {
      const target = ev.target as Node;
      if (desktopBookMenuRef.current && !desktopBookMenuRef.current.contains(target)) {
        setBookMenuOpen(false);
      }
      if (mobileBookMenuRef.current && !mobileBookMenuRef.current.contains(target)) {
        setMobileBookMenuOpen(false);
      }
    }
    function handleEscape(ev: KeyboardEvent) {
      if (ev.key === 'Escape') {
        setBookMenuOpen(false);
        setMobileBookMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  useEffect(() => {
    async function initApp() {
      const params = new URLSearchParams(window.location.search);
      const inviteParam = params.get('invite');
      const bookIdParam = params.get('bookId');
      const promptParam = params.get('prompt');
      const chapterParam = params.get('chapter');
      const roleParam = params.get('role')?.toLowerCase();
      const savedSession = readSession();

      const hasDeepLink = Boolean(inviteParam || bookIdParam || promptParam || chapterParam || roleParam);

      // Build server query URL
      let endpoint = '/api/book';
      if (inviteParam) {
        endpoint = `/api/book?invite=${encodeURIComponent(inviteParam)}`;
      } else if (bookIdParam) {
        endpoint = `/api/book?bookId=${encodeURIComponent(bookIdParam)}`;
      } else if (savedSession?.bookId) {
        endpoint = `/api/book?bookId=${encodeURIComponent(savedSession.bookId)}`;
      }

      const explicitRole: UserRole | null =
        roleParam === 'author' || roleParam === 'storyteller'
          ? 'author'
          : roleParam === 'organizer'
            ? 'organizer'
            : roleParam === 'collaborator'
              ? 'collaborator'
              : null;

      const initialRole: UserRole = promptParam
        ? 'author'
        : explicitRole || savedSession?.role || 'organizer';
      setRole(initialRole);

      try {
        const res = await fetch(endpoint);
        const serverData = normalizeClientWorkspace(
          await parseJsonResponse<BookWorkspaceData>(res, 'Could not load Remember Press workspace')
        );

        const localCached = readLocalWorkspace(serverData.settings.id);
        let activeWorkspace = serverData;

        if (localCached && localCached.chapters.length > serverData.chapters.length) {
          activeWorkspace = localCached;
          fetch(withBookId('/api/book/sync', serverData.settings.id), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(localCached),
          }).catch(() => {});
        } else {
          writeLocalWorkspace(serverData);
        }

        setWorkspace(activeWorkspace);
        refreshBookList(activeWorkspace);
        setMemberName(
          initialRole === 'author'
            ? activeWorkspace.settings.authorName
            : savedSession?.memberName || activeWorkspace.settings.organizerName
        );

        if (promptParam) {
          const matchedPrompt = activeWorkspace.prompts.find((p) => p.id === promptParam);
          if (matchedPrompt) {
            setCapturePrompt(matchedPrompt);
          }
          setSharedChapterId(null);
          setActiveTab('home');
          setShowOnboarding(false);
        } else if (chapterParam) {
          setSharedChapterId(chapterParam);
          setSelectedPreviewChapterId(chapterParam);
          setActiveTab('preview');
          setShowOnboarding(false);
        } else if (!hasDeepLink && !savedSession?.onboardingComplete) {
          setShowOnboarding(true);
        } else {
          setActiveTab(initialRole === 'collaborator' ? 'pool' : 'home');
          setShowOnboarding(false);
        }
      } catch {
        const fallback = normalizeClientWorkspace(
          (savedSession?.bookId && readLocalWorkspace(savedSession.bookId)) ||
            getFallbackSeedWorkspace()
        );
        setWorkspace(fallback);
        writeLocalWorkspace(fallback);
        refreshBookList(fallback);
        setMemberName(
          savedSession?.memberName ||
            (initialRole === 'organizer'
              ? fallback.settings.organizerName
              : fallback.settings.authorName)
        );
        if (!hasDeepLink && !savedSession?.onboardingComplete) {
          setShowOnboarding(true);
        }
      } finally {
        setLoading(false);
      }
    }

    initApp();
  }, []);

  useEffect(() => {
    if (workspace) {
      writeLocalWorkspace(workspace);
    }
  }, [workspace]);

  const navItems = getRoleNavItems(role, workspace?.settings);

  // Enforce strict role isolation: if activeTab is outside current role's allowed navItems, switch to default tab.
  useEffect(() => {
    if (navItems.length > 0 && !navItems.some((item) => item.id === activeTab)) {
      setActiveTab(navItems[0].id);
    }
  }, [role, workspace?.settings.bookMode, workspace?.settings.authorPreviewEnabled, activeTab]);

  function handleWorkspaceReady(
    nextWorkspace: BookWorkspaceData,
    nextRole: UserRole,
    nextMemberName: string
  ) {
    const normalized = normalizeClientWorkspace(nextWorkspace);
    setWorkspace(normalized);
    writeLocalWorkspace(normalized);
    setRole(nextRole);
    setMemberName(nextMemberName);
    writeSession({
      bookId: normalized.settings.id,
      role: nextRole,
      memberName: nextMemberName,
      onboardingComplete: true,
    });
    setShowOnboarding(false);
    setCapturePrompt(null);
    setSharedChapterId(null);
    setBookMenuOpen(false);
    setMobileBookMenuOpen(false);
    refreshBookList(normalized);
    setActiveTab(nextRole === 'collaborator' ? 'pool' : 'home');
  }

  async function handleSelectBookFromList(book: BookSummary) {
    if (!workspace) return;
    if (book.id === workspace.settings.id) {
      setBookMenuOpen(false);
      setMobileBookMenuOpen(false);
      return;
    }

    setSwitchingBookId(book.id);
    try {
      const res = await fetch(`/api/book?bookId=${encodeURIComponent(book.id)}`);
      const nextWs = normalizeClientWorkspace(
        await parseJsonResponse<BookWorkspaceData>(res, 'Could not load selected book')
      );
      setWorkspace(nextWs);
      writeLocalWorkspace(nextWs);
      const nextRole: UserRole = nextWs.settings.bookMode === 'self' ? 'author' : role;
      const nextMember =
        nextRole === 'author'
          ? nextWs.settings.authorName
          : nextWs.settings.organizerName || memberName;
      setRole(nextRole);
      setMemberName(nextMember);
      writeSession({
        bookId: nextWs.settings.id,
        role: nextRole,
        memberName: nextMember,
        onboardingComplete: true,
      });
      setCapturePrompt(null);
      setSelectedReviewChapterId(null);
      setSelectedPreviewChapterId(null);
      refreshBookList(nextWs);
    } catch {
      const local = readLocalWorkspace(book.id);
      if (local) {
        setWorkspace(local);
        writeSession({
          bookId: local.settings.id,
          role,
          memberName,
          onboardingComplete: true,
        });
      }
    } finally {
      setSwitchingBookId(null);
      setBookMenuOpen(false);
      setMobileBookMenuOpen(false);
    }
  }

  function handleChapterSaved(chapter: Chapter, answeredPromptId?: string) {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const existing = prev.chapters.some((c) => c.id === chapter.id);
      const updatedChapters = (
        existing
          ? prev.chapters.map((c) => (c.id === chapter.id ? chapter : c))
          : [...prev.chapters, chapter]
      ).sort((a, b) => a.order - b.order);

      const updatedPrompts = prev.prompts.map((p) => {
        const matchesAnswered = answeredPromptId && p.id === answeredPromptId;
        const matchesActive = capturePrompt && p.id === capturePrompt.id;
        const matchesQuestion = p.question === chapter.promptQuestion && !p.answeredChapterId;
        if (matchesAnswered || matchesActive || matchesQuestion) {
          return { ...p, status: 'answered' as const, answeredChapterId: chapter.id };
        }
        return p;
      });

      return {
        ...prev,
        chapters: updatedChapters,
        prompts: updatedPrompts,
      };
    });
  }

  function handlePhotoSaved(photo: MemoryPhoto) {
    setWorkspace((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        photos: [photo, ...prev.photos],
      };
    });
  }

  async function handleCopyInviteLink() {
    if (!workspace) return;
    const url = `${window.location.origin}/?invite=${encodeURIComponent(
      workspace.settings.inviteCode
    )}&role=author`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAF9F6] text-[#57534E]">
        <div className="flex items-center gap-2.5 text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-[#1B4332]" />
          <span>Opening Remember Press...</span>
        </div>
      </div>
    );
  }

  if (showOnboarding || !workspace) {
    return (
      <OnboardingView
        onWorkspaceReady={handleWorkspaceReady}
        onCancel={
          workspace
            ? () => {
                const homeRole: UserRole =
                  workspace.settings.bookMode === 'self' ? 'author' : 'organizer';
                const homeMember =
                  homeRole === 'author'
                    ? workspace.settings.authorName
                    : workspace.settings.organizerName || 'Maya Vance';
                setRole(homeRole);
                setMemberName(homeMember);
                setCapturePrompt(null);
                setActiveTab('home');
                writeSession({
                  bookId: workspace.settings.id,
                  role: homeRole,
                  memberName: homeMember,
                  onboardingComplete: true,
                });
                setShowOnboarding(false);
              }
            : undefined
        }
      />
    );
  }

  if (sharedChapterId) {
    return (
      <SharedStoryView
        workspace={workspace}
        chapterId={sharedChapterId}
        defaultMemberName={memberName}
        onChapterUpdated={(updatedChapter) =>
          setWorkspace((prev) =>
            prev
              ? {
                  ...prev,
                  chapters: prev.chapters.map((c) =>
                    c.id === updatedChapter.id ? updatedChapter : c
                  ),
                }
              : prev
          )
        }
        onOpenWorkspace={() => {
          setSharedChapterId(null);
          try {
            const url = new URL(window.location.href);
            url.searchParams.delete('chapter');
            window.history.replaceState({}, '', url.toString());
          } catch {
            // Ignore URL history issues
          }
          setActiveTab(role === 'collaborator' ? 'pool' : 'home');
        }}
      />
    );
  }

  const isSelfBook = workspace.settings.bookMode === 'self';
  const isStorytellerOnly = role === 'author' && !isSelfBook;
  const showPreviewTab = navItems.some((item) => item.id === 'preview');
  const showInviteBar = !isStorytellerOnly;

  const roleDisplayLabel =
    role === 'author'
      ? isSelfBook
        ? 'Author & Organizer'
        : 'Storyteller'
      : role === 'organizer'
        ? 'Family Organizer'
        : 'Family Collaborator';

  const primaryCtaLabel =
    role === 'author'
      ? 'Record a Story'
      : role === 'organizer'
        ? 'Send a Prompt'
        : 'Suggest a Question';

  function handlePrimaryCta() {
    if (role === 'author') {
      setCapturePrompt(null);
      setActiveTab('home');
    } else {
      setCapturePrompt(null);
      setActiveTab('pool');
    }
  }

  const isOrganizerDesktopSidebar = role === 'organizer';
  const authorFirstName =
    workspace.settings.authorName.split(' ')[0] || workspace.settings.authorName;
  const authorInitial =
    workspace.settings.authorName.trim().charAt(0).toUpperCase() || 'R';
  const waitingInboxCount = workspace.prompts.filter(
    (p) => p.status === 'inbox' && !p.answeredChapterId
  ).length;

  function renderOrganizerNavIcon(tabId: ActiveTab) {
    switch (tabId) {
      case 'home':
        return <Home className="w-4 h-4 shrink-0" />;
      case 'pool':
        return <Send className="w-4 h-4 shrink-0" />;
      case 'review':
        return <BookMarked className="w-4 h-4 shrink-0" />;
      case 'preview':
        return <BookOpen className="w-4 h-4 shrink-0" />;
      case 'settings':
        return <Settings className="w-4 h-4 shrink-0" />;
    }
  }

  return (
    <div
      className={`min-h-screen flex bg-[#FAF9F6] text-[#18181B] ${
        isOrganizerDesktopSidebar ? 'flex-col lg:flex-row' : 'flex-col'
      }`}
    >
      {/* Desktop Dark Forest-Green Organizer Sidebar */}
      {isOrganizerDesktopSidebar && (
        <aside
          aria-label="Organizer Sidebar"
          className="no-print hidden lg:flex w-64 shrink-0 flex-col justify-between bg-[#142E26] text-[#FAF9F6] border-r border-[#0E221C] px-4 py-6 sticky top-0 h-screen"
        >
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => {
                setCapturePrompt(null);
                setActiveTab('home');
              }}
              className="flex items-center gap-2.5 px-2 text-left cursor-pointer group"
            >
              <span className="w-7 h-7 rounded-md bg-[#E8F09C] text-[#142E26] flex items-center justify-center font-editorial font-bold text-sm shrink-0">
                R
              </span>
              <span className="font-editorial text-xl font-semibold tracking-tight text-white group-hover:text-[#E8F09C] transition-colors">
                Remember Press
              </span>
            </button>

            <div ref={desktopBookMenuRef} className="relative">
              <button
                type="button"
                aria-expanded={bookMenuOpen}
                onClick={() => {
                  refreshBookList();
                  setBookMenuOpen((prev) => !prev);
                }}
                className="w-full bg-[#1C3D32] hover:bg-[#234A3D] border border-white/10 rounded-xl p-3 flex items-center justify-between gap-2.5 text-left cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-9 h-9 rounded-lg bg-[#9FC3B4] text-[#142E26] font-semibold text-sm flex items-center justify-center shrink-0">
                    {authorInitial}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] text-[#B7CEC4] truncate">
                      {workspace.settings.authorName}
                    </p>
                    <p className="text-xs font-semibold text-white truncate">
                      {workspace.settings.title}
                    </p>
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 text-[#B7CEC4] shrink-0 transition-transform ${
                    bookMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {bookMenuOpen && (
                <div className="absolute left-0 right-0 mt-2 rounded-xl bg-white text-[#18181B] border border-[#E4E2DD] shadow-xl z-40 overflow-hidden">
                  <div className="px-3 py-2 border-b border-[#EFECE6] flex items-center justify-between text-[11px] font-medium text-[#57534E]">
                    <span>Your Books ({Math.max(1, availableBooks.length)})</span>
                    <span className="font-mono text-[#1B4332]">
                      {availableBooks.length <= 1 ? '1 book' : 'Select'}
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-[#EFECE6]">
                    {(availableBooks.length > 0
                      ? availableBooks
                      : [
                          {
                            id: workspace.settings.id,
                            title: workspace.settings.title,
                            authorName: workspace.settings.authorName,
                            organizerName: workspace.settings.organizerName,
                            inviteCode: workspace.settings.inviteCode,
                            bookMode: workspace.settings.bookMode,
                            chapterCount: workspace.chapters.length,
                          },
                        ]
                    ).map((b) => {
                      const isCurrent = b.id === workspace.settings.id;
                      const isLoadingThis = switchingBookId === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => handleSelectBookFromList(b)}
                          className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 text-xs hover:bg-[#FAF9F6] cursor-pointer ${
                            isCurrent ? 'bg-[#F2EFE9]/70' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-[#18181B] truncate">{b.title}</p>
                            <p className="text-[11px] text-[#57534E] truncate">
                              {b.authorName} · {b.chapterCount}{' '}
                              {b.chapterCount === 1 ? 'story' : 'stories'}
                            </p>
                          </div>
                          {isLoadingThis ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1B4332] shrink-0" />
                          ) : isCurrent ? (
                            <Check className="w-3.5 h-3.5 text-[#1B4332] shrink-0" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBookMenuOpen(false);
                      setShowOnboarding(true);
                    }}
                    className="w-full px-3 py-2.5 border-t border-[#E4E2DD] bg-[#FAF9F6] hover:bg-[#F2EFE9] text-left text-xs font-medium text-[#1B4332] flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Create or join another book
                  </button>
                </div>
              )}
            </div>

            <nav aria-label="Organizer Primary" className="space-y-1">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCapturePrompt(null);
                      setActiveTab(item.id);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      active
                        ? 'bg-[#294E41] text-white'
                        : 'text-[#CFE0D8] hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <span className={active ? 'text-[#E8F09C]' : 'text-[#9FC3B4]'}>
                      {renderOrganizerNavIcon(item.id)}
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="pt-4 border-t border-white/10 space-y-3">
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-[#E8F09C] text-[#142E26] hover:bg-[#DDE786] text-xs font-semibold cursor-pointer transition-colors"
            >
              {copiedInvite ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>Storyteller link copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 shrink-0" />
                  <span>Copy Storyteller Link</span>
                </>
              )}
            </button>

            <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-[#B7CEC4]">
              <span className="truncate">
                Code:{' '}
                <span className="font-mono text-white">{workspace.settings.inviteCode}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="text-xs text-[#E8F09C] hover:underline shrink-0 cursor-pointer"
              >
                Switch
              </button>
            </div>
          </div>
        </aside>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar & Context Bar: hidden on Organizer desktop where the dark left rail owns navigation */}
        <div className={isOrganizerDesktopSidebar ? 'no-print lg:hidden' : 'no-print'}>
          <TopBar
            activeTab={activeTab}
            navItems={navItems}
            primaryCtaLabel={primaryCtaLabel}
            hideDesktopNav={isOrganizerDesktopSidebar}
            onSelectTab={(tab) => {
              setCapturePrompt(null);
              setActiveTab(tab);
            }}
            onPrimaryCta={handlePrimaryCta}
            onBrandClick={() => {
              setCapturePrompt(null);
              setActiveTab(navItems[0]?.id || 'home');
            }}
          />

          <div className="border-b border-[#E4E2DD] bg-[#F2EFE9]/70">
            <div className="max-w-[1360px] mx-auto px-5 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-[#57534E]">
                <div ref={mobileBookMenuRef} className="relative">
                  <button
                    type="button"
                    aria-expanded={mobileBookMenuOpen}
                    onClick={() => {
                      refreshBookList();
                      setMobileBookMenuOpen((prev) => !prev);
                    }}
                    className="inline-flex items-center gap-1 font-medium text-[#18181B] hover:text-[#1B4332] cursor-pointer"
                  >
                    <span>{workspace.settings.title}</span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 text-[#57534E] transition-transform ${
                        mobileBookMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {mobileBookMenuOpen && (
                    <div className="absolute left-0 mt-2 w-64 rounded-xl bg-white text-[#18181B] border border-[#E4E2DD] shadow-xl z-40 overflow-hidden">
                      <div className="px-3 py-2 border-b border-[#EFECE6] text-[11px] font-medium text-[#57534E]">
                        Books ({Math.max(1, availableBooks.length)})
                      </div>
                      <div className="max-h-56 overflow-y-auto divide-y divide-[#EFECE6]">
                        {(availableBooks.length > 0
                          ? availableBooks
                          : [
                              {
                                id: workspace.settings.id,
                                title: workspace.settings.title,
                                authorName: workspace.settings.authorName,
                                organizerName: workspace.settings.organizerName,
                                inviteCode: workspace.settings.inviteCode,
                                bookMode: workspace.settings.bookMode,
                                chapterCount: workspace.chapters.length,
                              },
                            ]
                        ).map((b) => {
                          const isCurrent = b.id === workspace.settings.id;
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => handleSelectBookFromList(b)}
                              className={`w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 text-xs hover:bg-[#FAF9F6] cursor-pointer ${
                                isCurrent ? 'bg-[#F2EFE9]/70' : ''
                              }`}
                            >
                              <div className="min-w-0">
                                <p className="font-semibold text-[#18181B] truncate">{b.title}</p>
                                <p className="text-[11px] text-[#57534E] truncate">
                                  {b.authorName}
                                </p>
                              </div>
                              {isCurrent && (
                                <Check className="w-3.5 h-3.5 text-[#1B4332] shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {!isStorytellerOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setMobileBookMenuOpen(false);
                            setShowOnboarding(true);
                          }}
                          className="w-full px-3 py-2.5 border-t border-[#E4E2DD] bg-[#FAF9F6] hover:bg-[#F2EFE9] text-left text-xs font-medium text-[#1B4332] flex items-center gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Create or join another book
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span aria-hidden="true">·</span>
                <span>
                  {isStorytellerOnly
                    ? `Hello, ${authorFirstName}`
                    : `${memberName} (${roleDisplayLabel})`}
                </span>
                {showInviteBar && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Code:{' '}
                      <span className="font-mono text-[#18181B]">
                        {workspace.settings.inviteCode}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyInviteLink}
                      className="inline-flex items-center gap-1 text-[#1B4332] hover:underline cursor-pointer"
                    >
                      {copiedInvite ? (
                        <>
                          <Check className="w-3 h-3" />
                          Storyteller link copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy storyteller link
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowOnboarding(true)}
                className="text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
              >
                Switch User / Book
              </button>
            </div>
          </div>
        </div>

        {/* Organizer Contextual Sage Status Banner */}
        {role === 'organizer' && (
          <div className="no-print bg-[#D9EAE2] text-[#142E26] border-b border-[#C2DCD0] px-5 sm:px-6 py-2.5 text-xs flex flex-wrap items-center justify-center sm:justify-between gap-2">
            <span className="font-medium text-center sm:text-left">
              {waitingInboxCount === 0
                ? `${authorFirstName} needs a new prompt for their next session.`
                : `${authorFirstName} has ${waitingInboxCount} waiting ${
                    waitingInboxCount === 1 ? 'prompt' : 'prompts'
                  } ready to record.`}
            </span>
            {waitingInboxCount === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setCapturePrompt(null);
                  setActiveTab('pool');
                }}
                className="font-semibold text-[#142E26] underline underline-offset-2 hover:text-[#0F241D] cursor-pointer"
              >
                Add prompts →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCopyInviteLink}
                className="font-semibold text-[#142E26] underline underline-offset-2 hover:text-[#0F241D] cursor-pointer"
              >
                {copiedInvite ? 'Storyteller link copied' : 'Copy storyteller link →'}
              </button>
            )}
          </div>
        )}

        <main className="flex-1 min-w-0">
          {activeTab === 'home' && role === 'organizer' && (
            <OrganizerHomeView
              workspace={workspace}
              onNavigateTab={(tab) => {
                setCapturePrompt(null);
                setActiveTab(tab);
              }}
              onSelectChapter={(chapterId) => {
                setSelectedReviewChapterId(chapterId);
                setActiveTab('review');
              }}
            />
          )}

          {activeTab === 'home' && role === 'author' && (
            <StorytellerStudioView
              workspace={workspace}
              initialPrompt={capturePrompt}
              onChapterSaved={handleChapterSaved}
              onPhotoSaved={handlePhotoSaved}
              onSettingsUpdated={(settings: BookSettings) =>
                setWorkspace((prev) => (prev ? { ...prev, settings } : prev))
              }
              onOpenMyStories={(chapterId) => {
                setSelectedReviewChapterId(chapterId ?? null);
                setActiveTab('review');
              }}
            />
          )}

          {activeTab === 'pool' && (role !== 'author' || isSelfBook) && (
            <QuestionPoolView
              workspace={workspace}
              activeRole={role}
              currentMemberName={memberName}
              onPromptsUpdated={(prompts: GuidedPrompt[]) =>
                setWorkspace((prev) => (prev ? { ...prev, prompts } : prev))
              }
              onSettingsUpdated={(settings: BookSettings) =>
                setWorkspace((prev) => (prev ? { ...prev, settings } : prev))
              }
              onAnswerPrompt={(prompt) => {
                if (role === 'author') {
                  setCapturePrompt(prompt);
                  setActiveTab('home');
                }
              }}
              onViewChapter={(chapterId) => {
                setSelectedReviewChapterId(chapterId);
                setActiveTab('review');
              }}
            />
          )}

          {activeTab === 'review' && role !== 'collaborator' && (
            <StoriesReviewView
              workspace={workspace}
              activeRole={role}
              currentMemberName={memberName}
              initialChapterId={selectedReviewChapterId}
              onChaptersUpdated={(chapters: Chapter[]) =>
                setWorkspace((prev) => (prev ? { ...prev, chapters } : prev))
              }
              onSettingsUpdated={(settings: BookSettings) =>
                setWorkspace((prev) => (prev ? { ...prev, settings } : prev))
              }
              onOpenPreview={
                showPreviewTab
                  ? (chapterId) => {
                      setSelectedPreviewChapterId(chapterId);
                      setActiveTab('preview');
                    }
                  : undefined
              }
            />
          )}

          {activeTab === 'preview' && showPreviewTab && (
            <BookLayoutView
              workspace={workspace}
              activeRole={role}
              initialChapterId={selectedPreviewChapterId}
              onSettingsUpdated={(settings: BookSettings) =>
                setWorkspace((prev) => (prev ? { ...prev, settings } : prev))
              }
              onChaptersUpdated={(chapters: Chapter[]) =>
                setWorkspace((prev) => (prev ? { ...prev, chapters } : prev))
              }
              onBackToStories={
                role !== 'collaborator' ? () => setActiveTab('review') : undefined
              }
            />
          )}

          {activeTab === 'settings' && (role === 'organizer' || isSelfBook) && (
            <SettingsView
              workspace={workspace}
              activeRole={role}
              onSettingsUpdated={(settings: BookSettings) =>
                setWorkspace((prev) => (prev ? { ...prev, settings } : prev))
              }
              onChaptersUpdated={(chapters: Chapter[]) =>
                setWorkspace((prev) => (prev ? { ...prev, chapters } : prev))
              }
              onWorkspaceImported={(imported) => {
                const normalized = normalizeClientWorkspace(imported);
                setWorkspace(normalized);
                writeLocalWorkspace(normalized);
                writeSession({
                  bookId: normalized.settings.id,
                  role,
                  memberName,
                  onboardingComplete: true,
                });
              }}
              onOpenSetup={() => setShowOnboarding(true)}
            />
          )}
        </main>

        <footer className="no-print border-t border-[#E4E2DD] bg-[#FAF9F6] mt-16">
          <div className="max-w-[1360px] mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#57534E]">
            <div className="flex items-center gap-3">
              <span className="font-editorial text-sm font-semibold text-[#18181B]">
                Remember Press
              </span>
              <span aria-hidden="true">·</span>
              <span>Guided Family Storytelling &amp; Heirloom Books</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-6">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setCapturePrompt(null);
                    setActiveTab(item.id);
                  }}
                  className="hover:text-[#18181B] cursor-pointer"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
