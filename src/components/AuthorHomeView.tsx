import { ArrowRight, Camera, Inbox, Mic, Plus, Volume2 } from 'lucide-react';
import type { BookWorkspaceData, GuidedPrompt } from '../types';
import { ResilientImage } from './ResilientImage';
import type { ActiveTab } from './TopBar';

interface AuthorHomeViewProps {
  workspace: BookWorkspaceData;
  showPoolShortcut?: boolean;
  onStartSpontaneousMemory: () => void;
  onAnswerPrompt: (prompt: GuidedPrompt) => void;
  onNavigate: (tab: ActiveTab) => void;
}

export function AuthorHomeView({
  workspace,
  showPoolShortcut = false,
  onStartSpontaneousMemory,
  onAnswerPrompt,
  onNavigate,
}: AuthorHomeViewProps) {
  const { settings, prompts, chapters } = workspace;
  const firstName = settings.authorName.split(' ')[0] || settings.authorName;
  const inboxPrompts = prompts.filter((p) => p.status === 'inbox' && !p.answeredChapterId);

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-10 space-y-14">
      {/* Calm, Encouraging Greeting */}
      <section className="space-y-6">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs font-medium text-[#1B4332]">
            {settings.title} · No rush, no deadlines
          </p>
          <h1
            className="font-editorial text-[clamp(2rem,3.8vw,3.2rem)] leading-[1.1] font-semibold text-[#18181B]"
            style={{ textWrap: 'balance' }}
          >
            Hello, {firstName}. What story feels ready today?
          </h1>
          <p className="text-base text-[#57534E] leading-relaxed">
            Record any memory in whatever order it comes to mind—by voice, photograph, or writing.
            We keep your words true to how you tell them and organize the book when you are ready.
          </p>
        </div>

        {/* Two Simple Primary Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <button
            type="button"
            onClick={onStartSpontaneousMemory}
            className="group text-left p-7 rounded-xl bg-[#1B4332] text-white hover:bg-[#143326] transition-colors flex flex-col justify-between min-h-[190px] cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg bg-white/15 flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </div>
              <ArrowRight className="w-5 h-5 opacity-75 group-hover:translate-x-0.5 transition-transform" />
            </div>
            <div className="space-y-1.5 pt-6">
              <h2 className="font-editorial text-2xl font-semibold">Add Memory</h2>
              <p className="text-sm text-[#E4E2DD] leading-relaxed">
                Start a spontaneous story anytime—speak into the microphone, share an old photo, or
                jot down a thought.
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              if (inboxPrompts[0]) {
                onAnswerPrompt(inboxPrompts[0]);
              } else {
                onStartSpontaneousMemory();
              }
            }}
            className="group text-left p-7 rounded-xl bg-white border border-[#E4E2DD] hover:border-[#1B4332] transition-colors flex flex-col justify-between min-h-[190px] cursor-pointer"
          >
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg bg-[#F2EFE9] flex items-center justify-center text-[#1B4332]">
                <Inbox className="w-5 h-5" />
              </div>
              <span className="text-xs font-medium text-[#57534E] tabular-nums">
                {inboxPrompts.length} waiting in inbox
              </span>
            </div>
            <div className="space-y-1.5 pt-6">
              <h2 className="font-editorial text-2xl font-semibold text-[#18181B]">
                Answer from Inbox
              </h2>
              <p className="text-sm text-[#57534E] leading-relaxed">
                {inboxPrompts.length > 0
                  ? `Next from ${inboxPrompts[0].createdBy}: “${inboxPrompts[0].question}”`
                  : 'Your inbox is clear for now—invite family to add questions or share a spontaneous memory.'}
              </p>
            </div>
          </button>
        </div>
      </section>

      {/* Story Inbox */}
      <section className="space-y-5 pt-2 border-t border-[#E4E2DD]">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h2 className="font-editorial text-2xl font-semibold text-[#18181B]">
              Story Inbox
            </h2>
            <p className="text-sm text-[#57534E]">
              Questions, voice notes, and photographs sent by family. Pick whichever one sparks a
              memory—order does not matter.
            </p>
          </div>
          {showPoolShortcut && (
            <button
              type="button"
              onClick={() => onNavigate('pool')}
              className="text-sm font-medium text-[#1B4332] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Family Question Pool
            </button>
          )}
        </div>

        {inboxPrompts.length === 0 ? (
          <div className="border border-[#E4E2DD] rounded-xl bg-white p-8 text-center space-y-3">
            <p className="font-editorial text-lg font-medium text-[#18181B]">
              No waiting questions right now
            </p>
            <p className="text-sm text-[#57534E] max-w-md mx-auto">
              Whenever you think of a story, click Add Memory above to record at your own pace.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {inboxPrompts.map((prompt) => (
              <article
                key={prompt.id}
                className="border border-[#E4E2DD] rounded-xl bg-white p-6 flex flex-col md:flex-row gap-6 items-start justify-between"
              >
                <div className="flex flex-col sm:flex-row gap-5 flex-1 min-w-0">
                  {prompt.photoUrl && (
                    <div className="w-full sm:w-40 aspect-[4/3] rounded-lg overflow-hidden border border-[#E4E2DD] bg-[#EFECE6] shrink-0">
                      <ResilientImage
                        src={prompt.photoUrl}
                        alt="Prompt photograph"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="space-y-2.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#57534E]">
                      <span>Asked by {prompt.createdBy}</span>
                      <span aria-hidden="true">·</span>
                      <span>{prompt.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">~{prompt.estimatedMinutes} min</span>
                      {prompt.photoUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[#1B4332]">
                            <Camera className="w-3 h-3" />
                            Photo Prompt
                          </span>
                        </>
                      )}
                      {prompt.voicePromptUrl && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1 text-[#1B4332]">
                            <Volume2 className="w-3 h-3" />
                            Voice Prompt
                          </span>
                        </>
                      )}
                    </div>

                    <h3 className="font-editorial text-xl font-semibold text-[#18181B] leading-snug">
                      {prompt.question}
                    </h3>

                    {prompt.voicePromptUrl && (
                      <div className="pt-1 max-w-md">
                        <p className="text-xs text-[#57534E] mb-1">
                          Listen to {prompt.createdBy}’s voice message:
                        </p>
                        <audio controls src={prompt.voicePromptUrl} className="w-full h-9" />
                      </div>
                    )}

                    {prompt.memoryTriggers.length > 0 && (
                      <ul className="text-xs text-[#57534E] space-y-1 pt-1">
                        {prompt.memoryTriggers.slice(0, 3).map((cue, idx) => (
                          <li key={idx}>• {cue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="shrink-0 w-full md:w-auto flex md:flex-col items-end justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => onAnswerPrompt(prompt)}
                    className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#1B4332] rounded-lg hover:bg-[#143326] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Mic className="w-4 h-4" />
                    Answer This
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Quiet Recent Memories Strip */}
      <section className="pt-4 border-t border-[#E4E2DD] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="text-sm text-[#57534E]">
          <span className="font-semibold text-[#18181B] tabular-nums">{chapters.length}</span>{' '}
          memories saved so far · Out-of-order capture enabled
        </div>
        <button
          type="button"
          onClick={() => onNavigate('review')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1B4332] hover:underline cursor-pointer"
        >
          Review &amp; organize saved memories
          <ArrowRight className="w-4 h-4" />
        </button>
      </section>
    </div>
  );
}
