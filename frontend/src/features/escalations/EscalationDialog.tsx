import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import {
  ESCALATION_CATEGORY_HINT,
  ESCALATION_CATEGORY_LABEL,
  escalations,
  keys,
  type UUID,
} from '@/api'
import { Button, Dialog, Field, InlineError, Select, Textarea } from '@/design-system'
import { useIntentKey } from '@/lib/useIntentKey'

/**
 * Asking a question about a deal.
 *
 * The distinction the wording has to carry: **an escalation is a question, not
 * an approval.** A pricing question can go straight to finance even on a
 * quotation that will later need manager-then-finance approval, and resolving
 * the question approves nothing. Both facts are stated on the form, because the
 * two paths look similar and are routinely confused.
 *
 * The AI assistant may help draft the text; it never sends one. The person
 * reads it and submits it.
 */
export function EscalationDialog({
  open,
  onOpenChange,
  quoteId,
  revisionId,
  reference,
  initialReason,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  quoteId: UUID
  revisionId: UUID
  reference: string
  initialReason?: string
}) {
  const queryClient = useQueryClient()
  const [category, setCategory] = useState<'DISCOUNT' | 'POLICY' | 'REVIEW'>('REVIEW')
  const [reason, setReason] = useState(initialReason ?? '')

  // One key per intent. Editing the text is still the same intent — the user is
  // asking one question — so the key is stable for as long as the dialog is open.
  const requestKey = useIntentKey(open)

  const create = useMutation({
    mutationFn: () =>
      escalations.create({
        quoteId,
        expectedRevisionId: revisionId,
        requestKey,
        category,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Question sent', {
        description: 'It appears in the Questions inbox. It does not approve anything.',
      })
      setReason('')
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: keys.escalations() })
      void queryClient.invalidateQueries({ queryKey: keys.escalations(quoteId) })
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Ask a question about this deal"
      description={`${reference} · sent as a question, separate from the approval queue.`}
      busy={create.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={create.isPending}
            disabled={reason.trim().length < 3}
            disabledReason="Describe what you are asking."
            onClick={() => create.mutate()}
          >
            Send the question
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Who should answer" hint={ESCALATION_CATEGORY_HINT[category]}>
          {(props) => (
            <Select
              {...props}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as 'DISCOUNT' | 'POLICY' | 'REVIEW')
              }
            >
              <option value="REVIEW">{ESCALATION_CATEGORY_LABEL.REVIEW} — your manager</option>
              <option value="DISCOUNT">{ESCALATION_CATEGORY_LABEL.DISCOUNT} — finance</option>
              <option value="POLICY">{ESCALATION_CATEGORY_LABEL.POLICY} — an administrator</option>
            </Select>
          )}
        </Field>

        <Field
          label="What do you need to know?"
          required
          hint="Kept against this exact version, so whoever answers sees the terms you are asking about."
        >
          {(props) => (
            <Textarea
              {...props}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. The customer wants 15% on the installation line. Is there room below the margin floor?"
            />
          )}
        </Field>

        <p className="rounded-[--radius-control] bg-canvas-sunken px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
          Sending this does not submit the quotation, approve a discount or change any price. If the
          terms need manager-then-finance approval, that sequence still has to happen in the
          approval queue.
        </p>

        {create.error ? <InlineError error={create.error} /> : null}
      </div>
    </Dialog>
  )
}
