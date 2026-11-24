import { useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Edit3,
  Mail,
  MessageSquare,
  Share2,
  Send,
  Users,
} from 'lucide-react';
import type { BookWorkspaceData } from '../types';
import type { ActiveTab } from './TopBar';

interface OrganizerHomeViewProps {
  workspace: BookWorkspaceData;
  onNavigateTab: (tab: ActiveTab) => void;
  onSelectChapter: (chapterId: string) => void;
}

export function OrganizerHomeView({
  workspace,
  onNavigateTab,
  onSelectChapter,
}: OrganizerHomeViewProps) {
  const { settings, chapters, prompts, collaborators } = workspace;
  const firstName = settings.authorName.split(' ')[0] || settings.authorName;

  const [copiedKey, setCopiedKey] = useState<'storyteller' | 'family' | null>(null);

  const inboxPrompts = prompts.filter((p) => p.status === 'inbox' && !p.answeredChapterId);
  const queuedPrompts = prompts.filter((p) => p.status === 'queued' && !p.answeredChapterId);
  const answeredPrompts = prompts.filter((p) => Boolean(p.answeredChapterId) || p.status === 'answered');
  const editingRequests = chapters.filter(
    (c) => c.editingStatus === 'requested' || c.editingStatus === 'in-review'
  );
  const recentChapters = [...chapters]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 4);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const storytellerLink = `${origin}/?invite=${encodeURIComponent(settings.inviteCode)}&role=author`;
  const familyInviteLink = `${origin}/?invite=${encodeURIComponent(settings.inviteCode)}&role=collaborator`;

  async function copyLink(url: string, key: 'storyteller' | 'family') {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2200);
    } catch {
      // Clipboard fallback ignored
    }
  }

  function buildEmailHref() {
    const subject = encodeURIComponent(`Your recording link for "${settings.title}"`);
    const body = encodeURIComponent(
      `Hi ${firstName},\n\nI set up a quiet recording page for "${settings.title}" so you can share your stories whenever you feel ready—just open the link and tap the Record button:\n\n${storytellerLink}\n\nLove,\n${settings.organizerName}`
    );
    return `mailto:?subject=${subject}&body=${body}`;
  }

  function buildSmsHref() {
    const body = encodeURIComponent(
      `Hi ${firstName}, here is your simple recording link for "${settings.title}" (no login needed): ${storytellerLink}`
    );
    return `sms:?&body=${body}`;
  }

  async function handleNativeShare() {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${settings.title} — Recording Link`,
          text: `Tap this link to record a memory for ${settings.title}:`,
          url: storytellerLink,
        });
      } catch {
        // User cancelled share sheet
      }
    } else {
      await copyLink(storytellerLink, 'storyteller');
    }
  }

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#E4E2DD] pb-6">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-[#1B4332]">
            Family Organizer Workspace · {settings.authorName}
          </p>
          <h1 className="font-editorial text-3xl font-semibold text-[#18181B]">
            {settings.title}
          </h1>
          <p className="text-sm text-[#57534E]">{settings.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigateTab('preview')}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-white border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
          >
            <BookOpen className="w-4 h-4 text-[#1B4332]" />
            Book Preview
          </button>
          <button
            type="button"
            onClick={() => onNavigateTab('pool')}
            className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
          >
            <Send className="w-4 h-4" />
            Prepare &amp; Send Prompts
          </button>
        </div>
      </div>

      {/* Overview Metrics */}
      <section className="grid grid-cols-2 lg:grid-cols-4 border border-[#E4E2DD] rounded-xl bg-white divide-y lg:divide-y-0 lg:divide-x divide-[#E4E2DD]">
        <div className="p-5 space-y-1">
          <p className="text-xs text-[#57534E]">Stories Recorded</p>
          <p className="font-editorial text-3xl font-semibold text-[#18181B] tabular-nums">
            {chapters.length}
          </p>
        </div>
        <div className="p-5 space-y-1">
          <p className="text-xs text-[#57534E]">In {firstName}’s Inbox</p>
          <p className="font-editorial text-3xl font-semibold text-[#18181B] tabular-nums">
            {inboxPrompts.length}
          </p>
        </div>
        <div className="p-5 space-y-1">
          <p className="text-xs text-[#57534E]">Questions Answered</p>
          <p className="font-editorial text-3xl font-semibold text-[#18181B] tabular-nums">
            {answeredPrompts.length}
          </p>
        </div>
        <div className="p-5 space-y-1">
          <p className="text-xs text-[#57534E]">Family Contributors</p>
          <p className="font-editorial text-3xl font-semibold text-[#18181B] tabular-nums">
            {collaborators.length}
          </p>
        </div>
      </section>

      {/* Send Recording Link + Invite Family */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
          <div className="space-y-1">
            <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
              Send Recording Link to {firstName}
            </h2>
            <p className="text-xs text-[#57534E] leading-relaxed">
              This direct link opens {firstName}’s simple recording screen with zero passwords or
              organizer settings.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-[#18181B] truncate">{storytellerLink}</span>
            <span className="font-mono text-xs text-[#57534E] shrink-0">
              {settings.inviteCode}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => copyLink(storytellerLink, 'storyteller')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer"
            >
              {copiedKey === 'storyteller' ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Link Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Link
                </>
              )}
            </button>

            <a
              href={buildEmailHref()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332]"
            >
              <Mail className="w-3.5 h-3.5 text-[#1B4332]" />
              Send via Email
            </a>

            <a
              href={buildSmsHref()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332]"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#1B4332]" />
              Send via Text
            </a>

            <button
              type="button"
              onClick={handleNativeShare}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[44px] text-xs font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-[#1B4332]">
              <Users className="w-4 h-4" />
              <span>Family Collaboration</span>
            </div>
            <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
              Invite Siblings &amp; Relatives
            </h2>
            <p className="text-xs text-[#57534E] leading-relaxed">
              Collaborators can suggest questions, upvote favorite prompts, and leave reactions on
              finished chapters.
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-xs text-[#57534E]">
              Active members:{' '}
              <span className="text-[#18181B] font-medium">
                {collaborators.map((c) => c.name).join(' · ')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => copyLink(familyInviteLink, 'family')}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] text-xs font-medium text-[#18181B] bg-[#F2EFE9] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] cursor-pointer"
            >
              {copiedKey === 'family' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#1B4332]" />
                  Collaborator Invite Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Family Collaborator Invite
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Recent Chapters + Queued Prompts */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
              Recent Recorded Stories
            </h2>
            <button
              type="button"
              onClick={() => onNavigateTab('review')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
            >
              Open Stories &amp; Order
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentChapters.length === 0 ? (
            <div className="p-6 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] text-center space-y-2">
              <p className="text-sm font-medium text-[#18181B]">No stories recorded yet</p>
              <p className="text-xs text-[#57534E]">
                Send {firstName} the recording link above, or customize their first questions in
                Send Prompts.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#EFECE6]">
              {recentChapters.map((ch) => (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => onSelectChapter(ch.id)}
                  className="w-full py-3.5 text-left flex items-center justify-between gap-4 hover:bg-[#FAF9F6] px-2 -mx-2 rounded-lg transition-colors cursor-pointer"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs text-[#57534E] tabular-nums">
                      Chapter {String(ch.order).padStart(2, '0')}
                      {ch.isPrivate ? ' · Private to Storyteller' : ''}
                      {ch.comments && ch.comments.length > 0
                        ? ` · ${ch.comments.length} family note${ch.comments.length === 1 ? '' : 's'}`
                        : ''}
                    </p>
                    <p className="font-editorial text-base font-semibold text-[#18181B] truncate">
                      {ch.isPrivate ? 'Private Memory' : ch.title}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-[#1B4332] shrink-0">Review</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 border border-[#E4E2DD] rounded-xl bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
              Next Prompts &amp; Status
            </h2>
            <button
              type="button"
              onClick={() => onNavigateTab('pool')}
              className="text-xs font-medium text-[#1B4332] hover:underline cursor-pointer"
            >
              Manage
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] flex items-center justify-between">
              <span className="text-[#57534E]">Prompt delivery cadence</span>
              <span className="font-medium text-[#18181B] capitalize">
                {settings.promptCadence === 'on-demand' ? 'Anytime' : settings.promptCadence}
              </span>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] flex items-center justify-between">
              <span className="text-[#57534E]">Scheduled in queue</span>
              <span className="font-medium text-[#18181B] tabular-nums">{queuedPrompts.length}</span>
            </div>
            <div className="p-3.5 rounded-lg bg-[#FAF9F6] border border-[#E4E2DD] flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[#57534E]">
                <Edit3 className="w-3.5 h-3.5 text-[#1B4332]" />
                Editing requests
              </span>
              <span className="font-medium text-[#18181B] tabular-nums">
                {editingRequests.length}
              </span>
            </div>
          </div>

          {inboxPrompts.length > 0 && (
            <div className="pt-2 border-t border-[#EFECE6] space-y-2">
              <p className="text-xs font-medium text-[#57534E]">Waiting in {firstName}’s Inbox:</p>
              <ul className="space-y-1.5 text-xs text-[#18181B]">
                {inboxPrompts.slice(0, 2).map((p) => (
                  <li key={p.id} className="truncate">
                    • {p.question}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
