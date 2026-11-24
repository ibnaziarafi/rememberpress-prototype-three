import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import type { BookMode, BookWorkspaceData, PromptCadence, UserRole } from '../types';
import { parseJsonResponse } from '../utils/api';
import { ResilientImage } from './ResilientImage';

interface OnboardingViewProps {
  onWorkspaceReady: (
    workspace: BookWorkspaceData,
    role: UserRole,
    memberName: string
  ) => void;
  onCancel?: () => void;
}

export function OnboardingView({ onWorkspaceReady, onCancel }: OnboardingViewProps) {
  const [userType, setUserType] = useState<'family' | 'storyteller'>('family');
  const [bookStatus, setBookStatus] = useState<'new' | 'existing'>('new');
  const [bookMode, setBookMode] = useState<BookMode>('gift');

  const [bookTitle, setBookTitle] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [promptCadence, setPromptCadence] = useState<PromptCadence>('weekly');

  const [inviteCode, setInviteCode] = useState('');
  const [memberName, setMemberName] = useState('');
  const [joinRole, setJoinRole] = useState<UserRole>('organizer');
  const [relationship, setRelationship] = useState('Daughter / Son');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSamplePicker, setShowSamplePicker] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (userType === 'storyteller') {
        const code = inviteCode.trim().toUpperCase();
        if (!code) {
          throw new Error('Enter the family book code shared with you.');
        }
        const res = await fetch(`/api/book?invite=${encodeURIComponent(code)}`);
        const workspace = await parseJsonResponse<BookWorkspaceData>(
          res,
          'Could not find that family book'
        );
        if (workspace.settings.inviteCode.toUpperCase() !== code) {
          throw new Error(`No book matched code "${code}". Check your invitation code and try again.`);
        }
        onWorkspaceReady(workspace, 'author', memberName.trim() || workspace.settings.authorName);
        return;
      }

      if (bookStatus === 'new') {
        const cleanAuthor = authorName.trim();
        if (!cleanAuthor) {
          throw new Error('Please enter the storyteller’s name.');
        }
        const cleanOrganizer =
          bookMode === 'self' ? cleanAuthor : organizerName.trim() || 'Family Organizer';
        const res = await fetch('/api/books', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bookMode,
            title: bookTitle.trim() || `${cleanAuthor.split(' ')[0]}’s Keepsake Book`,
            authorName: cleanAuthor,
            organizerName: cleanOrganizer,
            promptCadence,
          }),
        });
        const created = await parseJsonResponse<BookWorkspaceData>(
          res,
          'Could not create book workspace'
        );
        const role: UserRole = bookMode === 'self' ? 'author' : 'organizer';
        onWorkspaceReady(created, role, bookMode === 'self' ? cleanAuthor : cleanOrganizer);
      } else {
        const code = inviteCode.trim().toUpperCase();
        if (!code) {
          throw new Error('Enter your family book invitation code.');
        }
        const cleanMember = memberName.trim();
        if (!cleanMember) {
          throw new Error('Enter your name so family members see who suggested prompts.');
        }
        const res = await fetch('/api/books/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteCode: code,
            memberName: cleanMember,
            role: joinRole,
            relationship: relationship.trim() || 'Family Member',
          }),
        });
        const joined = await parseJsonResponse<BookWorkspaceData>(
          res,
          'Could not join book workspace'
        );
        onWorkspaceReady(joined, joinRole, cleanMember);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open book workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOpenSampleBook(role: UserRole) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/book?invite=CEDAR-1974');
      const data = await parseJsonResponse<BookWorkspaceData>(
        res,
        'Could not load archive book'
      );
      const name =
        role === 'author'
          ? data.settings.authorName
          : role === 'organizer'
            ? data.settings.organizerName || 'Maya Vance'
            : data.collaborators.find((c) => c.role === 'collaborator')?.name || 'Leo Vance';
      onWorkspaceReady(data, role, name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load example workspace.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#18181B] flex flex-col">
      <div className="max-w-[1200px] w-full mx-auto px-6 py-10 lg:py-14 space-y-10 flex-1">
        <div className="flex items-center justify-between border-b border-[#E4E2DD] pb-5">
          <span className="font-editorial text-2xl font-semibold text-[#18181B]">
            Remember Press
          </span>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm font-medium text-[#57534E] hover:text-[#18181B] cursor-pointer"
            >
              Return to Home
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
          <div className="lg:col-span-5 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <p className="text-xs font-medium text-[#1B4332]">
                Guided Family Storytelling &amp; Heirloom Books
              </p>
              <h1
                className="font-editorial text-[clamp(2rem,3.6vw,3rem)] leading-[1.1] font-semibold text-[#18181B]"
                style={{ textWrap: 'balance' }}
              >
                Children set the prompts. Parents just press record.
              </h1>
              <p className="text-sm leading-relaxed text-[#57534E]">
                Organizers prepare thoughtful questions, family photos, and chapter order—while the
                storyteller receives a calm recording link with one Record button and easy name or
                address notes.
              </p>
            </div>

            <div className="aspect-[4/3] rounded-xl overflow-hidden border border-[#E4E2DD] bg-[#EFECE6]">
              <ResilientImage
                src="/src/assets/images/hero_remember_press_1794804938137.jpg"
                alt="Heirloom linen hardcover book and archival family photographs"
                className="w-full h-full object-cover"
              />
            </div>

            <ol className="grid grid-cols-3 gap-4 pt-2 border-t border-[#E4E2DD] text-xs">
              <li className="space-y-1">
                <span className="font-mono text-[#1B4332] tabular-nums">01</span>
                <p className="font-medium text-[#18181B]">Curate Prompts</p>
                <p className="text-[#57534E]">Text, photos, or voice messages.</p>
              </li>
              <li className="space-y-1">
                <span className="font-mono text-[#1B4332] tabular-nums">02</span>
                <p className="font-medium text-[#18181B]">Tap &amp; Speak</p>
                <p className="text-[#57534E]">Voice or video with no passwords.</p>
              </li>
              <li className="space-y-1">
                <span className="font-mono text-[#1B4332] tabular-nums">03</span>
                <p className="font-medium text-[#18181B]">Print &amp; Listen</p>
                <p className="text-[#57534E]">Keepsake pages with QR audio.</p>
              </li>
            </ol>
          </div>

          <form
            onSubmit={handleSubmit}
            className="lg:col-span-7 border border-[#E4E2DD] rounded-xl bg-white p-7 lg:p-8 space-y-7"
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-[#57534E]">
                <span className="font-mono text-[#1B4332] tabular-nums">01.</span>
                <span className="font-semibold text-[#18181B]">Who is signing in?</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setUserType('family')}
                  className={`p-4 text-left rounded-lg border transition-colors cursor-pointer ${
                    userType === 'family'
                      ? 'border-[#1B4332] bg-[#1B4332]/5'
                      : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                  }`}
                >
                  <p className="font-editorial text-base font-semibold text-[#18181B]">
                    Family / Organizer
                  </p>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    Start a book for Mom, Dad, or yourself, curate prompts, and review finished
                    chapters.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setUserType('storyteller')}
                  className={`p-4 text-left rounded-lg border transition-colors cursor-pointer ${
                    userType === 'storyteller'
                      ? 'border-[#1B4332] bg-[#1B4332]/5'
                      : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                  }`}
                >
                  <p className="font-editorial text-base font-semibold text-[#18181B]">
                    Parent / Storyteller
                  </p>
                  <p className="text-xs text-[#57534E] mt-1 leading-relaxed">
                    Open your simplified recording studio with one button to answer family
                    questions.
                  </p>
                </button>
              </div>
            </div>

            {userType === 'family' ? (
              <>
                <div className="space-y-3 pt-4 border-t border-[#E4E2DD]">
                  <div className="flex items-center gap-2 text-xs text-[#57534E]">
                    <span className="font-mono text-[#1B4332] tabular-nums">02.</span>
                    <span className="font-semibold text-[#18181B]">Book Project</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setBookStatus('new')}
                      className={`p-3.5 text-left rounded-lg border transition-colors cursor-pointer ${
                        bookStatus === 'new'
                          ? 'border-[#1B4332] bg-[#1B4332]/5'
                          : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                      }`}
                    >
                      <p className="text-sm font-semibold text-[#18181B]">Create a New Book</p>
                      <p className="text-xs text-[#57534E] mt-0.5">
                        Fresh keepsake workspace with your own invite code.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setBookStatus('existing')}
                      className={`p-3.5 text-left rounded-lg border transition-colors cursor-pointer ${
                        bookStatus === 'existing'
                          ? 'border-[#1B4332] bg-[#1B4332]/5'
                          : 'border-[#E4E2DD] bg-[#FAF9F6] hover:border-[#18181B]/30'
                      }`}
                    >
                      <p className="text-sm font-semibold text-[#18181B]">Join an Existing Book</p>
                      <p className="text-xs text-[#57534E] mt-0.5">
                        Collaborate with family members using a book code.
                      </p>
                    </button>
                  </div>
                </div>

                {bookStatus === 'new' ? (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-[#57534E]">Writing for:</span>
                      <div className="inline-flex items-center gap-1 p-1 bg-[#F2EFE9] rounded-lg">
                        <button
                          type="button"
                          onClick={() => setBookMode('gift')}
                          className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                            bookMode === 'gift'
                              ? 'bg-white text-[#18181B] shadow-xs'
                              : 'text-[#57534E]'
                          }`}
                        >
                          Parent / Loved One
                        </button>
                        <button
                          type="button"
                          onClick={() => setBookMode('self')}
                          className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                            bookMode === 'self'
                              ? 'bg-white text-[#18181B] shadow-xs'
                              : 'text-[#57534E]'
                          }`}
                        >
                          Myself
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[#57534E] mb-1">
                          {bookMode === 'self'
                            ? 'Your Full Name (Storyteller)'
                            : 'Storyteller’s Full Name'}
                        </label>
                        <input
                          type="text"
                          required
                          value={authorName}
                          onChange={(e) => setAuthorName(e.target.value)}
                          placeholder="e.g., Margaret Ellis"
                          className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                        />
                      </div>

                      {bookMode === 'gift' ? (
                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Your Name (Organizer)
                          </label>
                          <input
                            type="text"
                            required
                            value={organizerName}
                            onChange={(e) => setOrganizerName(e.target.value)}
                            placeholder="e.g., Hannah Ellis"
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                          />
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Working Book Title
                          </label>
                          <input
                            type="text"
                            value={bookTitle}
                            onChange={(e) => setBookTitle(e.target.value)}
                            placeholder="e.g., Stories from Maple Street"
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                          />
                        </div>
                      )}

                      {bookMode === 'gift' && (
                        <div>
                          <label className="block text-xs font-medium text-[#57534E] mb-1">
                            Working Book Title
                          </label>
                          <input
                            type="text"
                            value={bookTitle}
                            onChange={(e) => setBookTitle(e.target.value)}
                            placeholder="e.g., Mom’s Stories"
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-medium text-[#57534E] mb-1">
                          Prompt Rhythm
                        </label>
                        <select
                          value={promptCadence}
                          onChange={(e) => setPromptCadence(e.target.value as PromptCadence)}
                          className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                        >
                          <option value="weekly">Weekly Prompts</option>
                          <option value="daily">Daily Prompts</option>
                          <option value="on-demand">On-Demand (Anytime)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Book Invitation Code
                      </label>
                      <input
                        type="text"
                        required
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="Enter book code"
                        className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Your Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={memberName}
                        onChange={(e) => setMemberName(e.target.value)}
                        placeholder="e.g., David Ellis"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Role
                      </label>
                      <select
                        value={joinRole}
                        onChange={(e) => setJoinRole(e.target.value as UserRole)}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      >
                        <option value="organizer">Organizer (Manage Book &amp; Prompts)</option>
                        <option value="collaborator">Family Collaborator (Suggest Prompts)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[#57534E] mb-1">
                        Relationship
                      </label>
                      <input
                        type="text"
                        value={relationship}
                        onChange={(e) => setRelationship(e.target.value)}
                        placeholder="e.g., Son, Daughter, Grandchild"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-4 pt-4 border-t border-[#E4E2DD]">
                <div className="flex items-center gap-2 text-xs text-[#57534E]">
                  <span className="font-mono text-[#1B4332] tabular-nums">02.</span>
                  <span className="font-semibold text-[#18181B]">Enter Your Family Book Code</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Family Book Code
                    </label>
                    <input
                      type="text"
                      required
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="Shared by your family"
                      className="w-full px-3.5 py-2.5 text-sm font-mono uppercase bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#57534E] mb-1">
                      Your Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={memberName}
                      onChange={(e) => setMemberName(e.target.value)}
                      placeholder="Uses storyteller name on book"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg focus:outline-none focus:border-[#1B4332]"
                    />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg border border-[#B91C1C]/30 bg-[#FEF2F2] text-xs text-[#991B1B]">
                {error}
              </div>
            )}

            <div className="pt-2 flex items-center justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 px-6 py-3 min-h-[44px] text-sm font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors cursor-pointer disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Opening Book...
                  </>
                ) : (
                  <>
                    {userType === 'storyteller'
                      ? 'Open Recording Studio'
                      : bookStatus === 'new'
                        ? 'Create Family Book'
                        : 'Open Existing Book'}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Subtle footer utility for inspecting the Cedar Cove archive book if desired */}
      <footer className="border-t border-[#E4E2DD] py-4 px-6 bg-[#FAF9F6]">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs text-[#57534E]">
          <span>Remember Press · Private Family Memoir Studio</span>
          {!showSamplePicker ? (
            <button
              type="button"
              onClick={() => setShowSamplePicker(true)}
              className="text-[#57534E] hover:text-[#18181B] underline underline-offset-4 cursor-pointer"
            >
              Inspect reference archive book (CEDAR-1974)
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span>Open Cedar Cove archive as:</span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleOpenSampleBook('organizer')}
                className="font-medium text-[#1B4332] hover:underline cursor-pointer"
              >
                Organizer
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleOpenSampleBook('author')}
                className="font-medium text-[#1B4332] hover:underline cursor-pointer"
              >
                Storyteller
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleOpenSampleBook('collaborator')}
                className="font-medium text-[#1B4332] hover:underline cursor-pointer"
              >
                Collaborator
              </button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
