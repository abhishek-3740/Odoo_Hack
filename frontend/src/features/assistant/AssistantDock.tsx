import { useMutation, useQuery } from '@tanstack/react-query'
import { MessageCircle, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { ApiError, assistant, keys, type AssistantTurn } from '@/api'
import { useAuth } from '@/auth/useAuth'
import { REFERENCE_QUERY_OPTIONS } from '@/app/queryClient'
import { Badge, Button, InlineError, Spinner, Textarea } from '@/design-system'
import { cn } from '@/lib/cn'

/**
 * One assistant, scoped to what the user is looking at.
 *
 * Deliberately a single shared dock rather than a chatbot per screen. Three
 * rules it holds to:
 *
 *  - **It cannot do anything.** It reads context the user is already authorised
 *    to see and explains it. Handing a question to finance drafts a request the
 *    user submits themselves; nothing is sent on their behalf.
 *  - **No fake streaming.** The endpoint returns one complete answer, so the UI
 *    shows an honest pending state instead of animating tokens that do not
 *    exist.
 *  - **The draft survives a failure.** Rate limits and provider outages are
 *    normal; losing what someone typed because of one is not.
 */

const SUGGESTIONS: Record<string, string[]> = {
  REP: ['What is blocking this deal?', 'Explain the proposed upgrade.', 'Why does this need approval?'],
  MANAGER: ['Why did this version require review?', 'What changed since the last version?'],
  FINANCE: ['Explain this invoice.', 'What does this subscription change cost?'],
  ADMIN: ['Explain this policy version.', 'Why did this quotation route to finance?'],
  CUSTOMER: ['Explain these terms.', 'Help me draft a counteroffer.', 'What am I paying today?'],
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  at: number
}

export function AssistantDock() {
  const { me } = useAuth()
  const params = useParams()
  const quoteId = params.quoteId ?? null

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const status = useQuery({
    queryKey: keys.assistantStatus(),
    queryFn: ({ signal }) => assistant.status(signal),
    enabled: Boolean(me) && open,
    ...REFERENCE_QUERY_OPTIONS,
  })

  // A persona change must not carry the previous conversation with it.
  useEffect(() => {
    setMessages([])
    setDraft('')
  }, [me?.profileId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, open])

  const ask = useMutation({
    mutationFn: (message: string) => {
      // The server bounds history at eight turns; send the most recent ones.
      const history: AssistantTurn[] = messages
        .slice(-8)
        .map((entry) => ({ role: entry.role, content: entry.content }))
      return assistant.chat({ message, quoteId, history })
    },
    onSuccess: (answer, message) => {
      setMessages((current) => [
        ...current,
        { role: 'user', content: message, at: Date.now() },
        { role: 'assistant', content: answer.answer, at: Date.now() },
      ])
      setDraft('')
    },
  })

  if (!me) return null

  const configured = status.data?.configured
  const suggestions = SUGGESTIONS[me.role] ?? []

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || ask.isPending) return
    ask.mutate(trimmed)
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // A compact circle: the wide pill sat on top of the deal workspace's
          // sticky action bar, hiding the very buttons the screen is for.
          title="Ask about this screen"
          aria-label="Ask the assistant about this screen"
          className={cn(
            'fixed bottom-4 right-4 z-30 inline-flex size-12 items-center justify-center rounded-full',
            'border border-line-inverse bg-ink-800 text-text-inverse',
            'shadow-overlay transition-colors hover:bg-ink-700',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-500',
          )}
        >
          <Sparkles className="size-5 text-brass-300" aria-hidden />
        </button>
      ) : (
        <div
          role="dialog"
          aria-label="Workspace assistant"
          className={cn(
            'fixed bottom-4 right-4 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col',
            'max-h-[min(34rem,calc(100vh-2rem))] overflow-hidden rounded-[--radius-panel]',
            'border border-line bg-panel shadow-overlay',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-panel-muted px-4 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-text">
                <Sparkles className="size-3.5 text-brass-500" aria-hidden />
                Assistant
              </p>
              <p className="truncate text-2xs text-text-muted">
                {quoteId ? 'Reading this quotation' : `Your ${me.role.toLowerCase()} workspace`} ·
                read-only
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-[--radius-control] p-1.5 text-text-secondary hover:bg-canvas-sunken hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          <div ref={scrollRef} className="scroll-subtle min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {status.isLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                <Spinner /> Checking the assistant…
              </div>
            ) : configured === false ? (
              <div className="rounded-[--radius-control] border border-neutral-border bg-neutral-surface px-3 py-2.5 text-[13px] text-text-secondary">
                The assistant provider is not configured on this server, so there is nothing to ask
                yet. Everything else on this screen works normally.
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-[13px] leading-relaxed text-text-secondary">
                  I can explain what is on this screen — why a version needs approval, what is
                  blocking a deal, what a proration costs. I cannot approve, send or change
                  anything.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => send(suggestion)}
                      className="rounded-full border border-line bg-panel px-2.5 py-1 text-2xs font-medium text-text-secondary transition-colors hover:border-forest-300 hover:text-text"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {messages.map((message, index) => (
                  <li
                    key={`${message.at}-${index}`}
                    className={cn(
                      'max-w-[92%] rounded-[--radius-control] px-3 py-2 text-[13px] leading-relaxed',
                      message.role === 'user'
                        ? 'ml-auto bg-forest-500 text-white'
                        : 'bg-canvas-sunken text-text whitespace-pre-wrap',
                    )}
                  >
                    {message.content}
                  </li>
                ))}
                {ask.isPending ? (
                  <li className="flex items-center gap-2 text-[13px] text-text-secondary">
                    <Spinner /> Thinking — this arrives as one complete answer.
                  </li>
                ) : null}
              </ul>
            )}

            {ask.error ? (
              <InlineError
                className="mt-3"
                error={ask.error}
                title={
                  ask.error instanceof ApiError && ask.error.code === 'ASSISTANT_RATE_LIMITED'
                    ? 'Too many questions at once'
                    : 'The assistant could not answer'
                }
                onRetry={draft.trim() ? () => send(draft) : undefined}
              />
            ) : null}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(event) => {
              event.preventDefault()
              send(draft)
            }}
          >
            <label htmlFor="assistant-draft" className="sr-only">
              Ask the assistant
            </label>
            <Textarea
              id="assistant-draft"
              rows={2}
              value={draft}
              disabled={configured === false}
              placeholder="Ask about this screen…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send(draft)
                }
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <Badge tone="neutral" size="sm">
                Read-only
              </Badge>
              <Button
                type="submit"
                size="sm"
                variant="primary"
                busy={ask.isPending}
                disabled={configured === false || !draft.trim()}
                disabledReason={
                  configured === false
                    ? 'The assistant provider is not configured on this server.'
                    : 'Type a question first.'
                }
                icon={<Send className="size-3.5" />}
              >
                Ask
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

export { MessageCircle }
