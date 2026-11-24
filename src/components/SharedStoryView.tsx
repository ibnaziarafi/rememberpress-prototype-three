import { useState } from 'react';
import { ArrowLeft, BookOpen, MessageCircle, Send } from 'lucide-react';
import type { BookWorkspaceData, Chapter } from '../types';
import { parseJsonResponse, withBookId } from '../utils/api';
import { ResilientImage } from './ResilientImage';

interface SharedStoryViewProps {
  workspace: BookWorkspaceData;
  chapterId: string;
  defaultMemberName: string;
  onChapterUpdated: (chapter: Chapter) => void;
  onOpenWorkspace: () => void;
}

export function SharedStoryView({
  workspace,
  chapterId,
  defaultMemberName,
  onChapterUpdated,
  onOpenWorkspace,
}: SharedStoryViewProps) {
  const { settings, chapters, photos } = workspace;
  const chapter = chapters.find((c) => c.id === chapterId) || chapters[0] || null;
  const chapterPhotos = chapter
    ? photos.filter((p) => p.chapterId === chapter.id)
    : [];

  const [commentAuthor, setCommentAuthor] = useState(defaultMemberName || '');
  const [commentRelationship, setCommentRelationship] = useState('Family');
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleAddComment(e: React.FormEvent) {
    e.preventDefault();
    if (!chapter || !commentText.trim()) return;
    setPosting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(withBookId(`/api/chapters/${chapter.id}/comments`, settings.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorName: commentAuthor.trim() || 'Family Member',
          relationship: commentRelationship.trim() || 'Family',
          text: commentText.trim(),
        }),
      });
      const updated = await parseJsonResponse<Chapter>(res, 'Could not post family note');
      onChapterUpdated(updated);
      setCommentText('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post note.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#18181B]">
      <header className="border-b border-[#E4E2DD] bg-[#FAF9F6]/95 sticky top-0 z-20 backdrop-blur-sm">
        <div className="max-w-[820px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-[#57534E] truncate">{settings.title}</p>
            <p className="font-editorial text-sm font-semibold text-[#18181B] truncate">
              Digital Keepsake Companion · {settings.authorName}
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#1B4332] bg-[#F2EFE9] border border-[#E4E2DD] rounded-lg hover:border-[#1B4332] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Open Book Studio
          </button>
        </div>
      </header>

      <main className="max-w-[780px] mx-auto px-6 py-10 space-y-8">
        {!chapter ? (
          <div className="border border-[#E4E2DD] rounded-xl bg-white p-10 text-center space-y-3">
            <BookOpen className="w-6 h-6 text-[#1B4332] mx-auto" />
            <h1 className="font-editorial text-2xl font-semibold text-[#18181B]">
              Story Not Found
            </h1>
            <p className="text-sm text-[#57534E]">
              This keepsake chapter may have been moved or marked private by the storyteller.
            </p>
          </div>
        ) : chapter.isPrivate ? (
          <div className="border border-[#E4E2DD] rounded-xl bg-white p-10 text-center space-y-3">
            <h1 className="font-editorial text-2xl font-semibold text-[#18181B]">
              Private Story
            </h1>
            <p className="text-sm text-[#57534E]">
              {settings.authorName} has marked this memory private for now.
            </p>
          </div>
        ) : (
          <article className="space-y-8">
            <div className="space-y-3 border-b border-[#E4E2DD] pb-6">
              <p className="text-xs font-medium text-[#1B4332] tabular-nums">
                Chapter {String(chapter.order).padStart(2, '0')}
                {chapter.eraLabel ? ` · ${chapter.eraLabel}` : ''}
              </p>
              <h1
                className="font-editorial text-[clamp(2rem,4vw,2.75rem)] leading-[1.12] font-semibold text-[#18181B]"
                style={{ textWrap: 'balance' }}
              >
                {chapter.title}
              </h1>
              {chapter.subtitle && (
                <p className="text-base text-[#57534E] font-editorial italic">
                  {chapter.subtitle}
                </p>
              )}
            </div>

            {/* Original Video / Audio Keepsake Recording */}
            {(chapter.videoUrl || chapter.audioUrl) && (
              <section className="border border-[#E4E2DD] rounded-xl bg-white p-5 space-y-3">
                <p className="text-xs font-semibold text-[#1B4332]">
                  Hear It in {settings.authorName.split(' ')[0]}’s Own Voice
                </p>
                {chapter.videoUrl ? (
                  <video
                    controls
                    playsInline
                    src={chapter.videoUrl}
                    className="w-full max-h-[420px] rounded-lg bg-[#18181B]"
                  />
                ) : chapter.audioUrl ? (
                  <audio controls src={chapter.audioUrl} className="w-full h-10" />
                ) : null}
              </section>
            )}

            {/* Attached Photographs */}
            {chapterPhotos.length > 0 && (
              <div className="grid grid-cols-1 gap-6">
                {chapterPhotos.map((photo) => (
                  <figure
                    key={photo.id}
                    className="border border-[#E4E2DD] rounded-xl bg-white p-4 space-y-2.5"
                  >
                    <div className="aspect-[16/10] rounded-lg overflow-hidden bg-[#EFECE6]">
                      <ResilientImage
                        src={photo.imageUrl}
                        alt={photo.caption || 'Family memory photograph'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    {(photo.caption || photo.yearLabel) && (
                      <figcaption className="text-xs text-[#57534E]">
                        {photo.caption}
                        {photo.yearLabel ? ` · ${photo.yearLabel}` : ''}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            )}

            {chapter.pullQuote && (
              <blockquote className="py-4 px-6 border-y border-[#E4E2DD] font-editorial text-xl italic text-[#18181B] text-center">
                “{chapter.pullQuote}”
              </blockquote>
            )}

            <div className="space-y-4 font-editorial text-lg leading-[1.75] text-[#18181B]">
              {chapter.body
                .split(/\n\s*\n/)
                .filter((p) => p.trim())
                .map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
            </div>

            {/* Family Reactions & Notes */}
            <section className="border-t border-[#E4E2DD] pt-8 space-y-5">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-[#1B4332]" />
                <h2 className="font-editorial text-xl font-semibold text-[#18181B]">
                  Family Notes ({chapter.comments?.length || 0})
                </h2>
              </div>

              {chapter.comments && chapter.comments.length > 0 && (
                <div className="space-y-3">
                  {chapter.comments.map((cmt) => (
                    <div
                      key={cmt.id}
                      className="p-4 rounded-xl bg-white border border-[#E4E2DD] space-y-1"
                    >
                      <p className="text-xs text-[#57534E]">
                        <strong className="text-[#18181B]">{cmt.authorName}</strong> ·{' '}
                        {cmt.relationship}
                      </p>
                      <p className="text-sm text-[#18181B]">{cmt.text}</p>
                    </div>
                  ))}
                </div>
              )}

              <form
                onSubmit={handleAddComment}
                className="p-5 rounded-xl bg-white border border-[#E4E2DD] space-y-3"
              >
                <p className="text-xs font-medium text-[#18181B]">
                  Leave a memory reaction or family note on this story
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={commentAuthor}
                    onChange={(e) => setCommentAuthor(e.target.value)}
                    placeholder="Your name"
                    className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                  />
                  <input
                    type="text"
                    value={commentRelationship}
                    onChange={(e) => setCommentRelationship(e.target.value)}
                    placeholder="Relationship (e.g., Grandson, Daughter)"
                    className="px-3 py-2 text-xs bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                  />
                </div>
                <textarea
                  rows={2}
                  required
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Share what reading or hearing this memory meant to you..."
                  className="w-full p-3 text-sm bg-[#FAF9F6] border border-[#E4E2DD] rounded-lg"
                />
                {errorMsg && <p className="text-xs text-[#B91C1C]">{errorMsg}</p>}
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={posting || !commentText.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {posting ? 'Posting...' : 'Add Family Note'}
                  </button>
                </div>
              </form>
            </section>
          </article>
        )}
      </main>
    </div>
  );
}
