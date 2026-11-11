import type { Me, QuoteEvaluation } from '@/api'
import { TERMINAL_STAGES } from '@/api'
import { can } from '@/auth/capabilities'

/**
 * Which actions this actor may take on this quotation, and why not.
 *
 * Centralised on purpose. The previous frontend inferred eligibility from a
 * stage label in each component, which is how "Submit" stayed on screen after a
 * submission and how the customer's Accept button disappeared for a quotation
 * the server was perfectly willing to accept.
 *
 * Two rules hold throughout:
 *
 *  - Eligibility is derived from the *server's* facts — revision status, gates,
 *    row version, capabilities — never from a display string.
 *  - Every unavailable action carries a sentence saying why. A greyed control
 *    with no explanation is the most common way a workflow screen becomes
 *    unusable, and the reason is always knowable here.
 *
 * The backend checks all of this again. This exists to avoid offering an action
 * that will certainly fail, not to be the thing that prevents it.
 */

export interface ActionAvailability {
  allowed: boolean
  reason?: string
}

const OK: ActionAvailability = { allowed: true }
const no = (reason: string): ActionAvailability => ({ allowed: false, reason })

export interface QuoteActionContext {
  evaluation: QuoteEvaluation
  me: Me | null
  /** True while the editor holds unsaved changes. */
  dirty: boolean
  /**
   * How many lines the editor currently holds.
   *
   * Every other question here is about the *saved* revision, which is why
   * `evaluation` is the server's copy. Saving is the exception: it asks whether
   * what is on screen can be persisted. Reading the server's line count instead
   * made the first save of a new quotation impossible — the rep added a line,
   * and Save stayed disabled because the saved revision was still empty.
   */
  pendingLineCount?: number
}

/** A deal nobody can commercially change any more. */
export function isClosed(evaluation: QuoteEvaluation): boolean {
  return TERMINAL_STAGES.includes(evaluation.stage) || evaluation.gates.orderExists
}

function ownsIt(evaluation: QuoteEvaluation, me: Me | null): boolean {
  return me != null && evaluation.ownerProfileId === me.profileId
}

/** Reps may only work their own deals; managers, finance and admins may not edit. */
export function canEdit({ evaluation, me }: QuoteActionContext): ActionAvailability {
  if (!me) return no('Sign in to edit this quotation.')
  if (isClosed(evaluation)) {
    return no(
      evaluation.gates.orderExists
        ? 'An order exists for these terms, so they can no longer be changed.'
        : `This quotation is ${evaluation.stage.toLowerCase()} and can no longer be edited.`,
    )
  }
  if (me.role === 'ADMIN') return OK
  if (!can(me, 'quotes:edit-own')) {
    return no('Your role can read this quotation but not change its terms.')
  }
  if (!ownsIt(evaluation, me)) {
    return no('This quotation belongs to another salesperson.')
  }
  return OK
}

export function canSave(context: QuoteActionContext): ActionAvailability {
  const edit = canEdit(context)
  if (!edit.allowed) return edit
  if (!context.dirty) return no('Nothing has changed since the last save.')
  const lineCount = context.pendingLineCount ?? context.evaluation.lines.length
  if (lineCount === 0) return no('A quotation needs at least one line.')
  return OK
}

/**
 * Submitting for approval.
 *
 * Only the current *saved* revision can be submitted, and a revision that is
 * already SUBMITTED must not offer submission again — that is the duplicate the
 * plan calls out explicitly.
 */
export function canSubmit(context: QuoteActionContext): ActionAvailability {
  const { evaluation, me, dirty } = context
  if (!me) return no('Sign in to submit this quotation.')
  if (isClosed(evaluation)) return no('This quotation is closed.')
  if (dirty) return no('Save your changes first — only the saved version can be submitted.')
  if (evaluation.revisionStatus === 'SUBMITTED') {
    return no('This version has already been submitted. Do not submit it again.')
  }
  if (evaluation.revisionStatus !== 'DRAFT') {
    return no(`This version is ${evaluation.revisionStatus.toLowerCase()} and cannot be submitted.`)
  }
  // The server refuses an empty quotation outright. Offering the button and
  // then reporting its error is the pattern this frontend exists to remove.
  if (evaluation.lines.length === 0) {
    return no('Add at least one line. There is nothing here to price or approve.')
  }
  if (!can(me, 'quotes:submit') && me.role !== 'ADMIN') {
    return no('Your role cannot submit quotations for approval.')
  }
  if (me.role === 'REP' && !ownsIt(evaluation, me)) {
    return no('This quotation belongs to another salesperson.')
  }
  return OK
}

/** Making the terms visible in the customer's deal room. */
export function canShare(context: QuoteActionContext): ActionAvailability {
  const { evaluation, me, dirty } = context
  if (!me) return no('Sign in to share this quotation.')
  if (evaluation.gates.orderExists) return no('The order is already confirmed.')
  if (dirty) return no('Save your changes first, so the customer sees the terms you mean.')
  if (evaluation.revisionStatus === 'DRAFT') {
    return no('Submit this version first — a draft is not shared with a customer.')
  }
  if (!can(me, 'quotes:share') && me.role !== 'ADMIN') {
    return no('Your role cannot share quotations with customers.')
  }
  return OK
}

/**
 * Adopting the terms on screen.
 *
 * Meaningful in two situations: after submission, and — the one that matters —
 * when the customer has countered and the seller is deciding whether to stand
 * behind the customer's version.
 */
export function canAdopt(context: QuoteActionContext): ActionAvailability {
  const { evaluation, me, dirty } = context
  if (!me) return no('Sign in to adopt these terms.')
  if (evaluation.gates.orderExists) return no('The order is already confirmed.')
  if (evaluation.gates.sellerAdopted) return no('You have already adopted this version.')
  if (dirty) return no('Save or discard your changes first — adoption applies to a saved version.')
  if (!can(me, 'quotes:adopt') && me.role !== 'ADMIN') {
    return no('Your role cannot adopt quotation terms.')
  }
  if (me.role === 'REP' && !ownsIt(evaluation, me)) {
    return no('This quotation belongs to another salesperson.')
  }
  return OK
}

export function canCancel(context: QuoteActionContext): ActionAvailability {
  const { evaluation, me } = context
  if (!me) return no('Sign in to cancel this quotation.')
  if (evaluation.gates.orderExists) return no('An order exists — a confirmed deal is not cancelled here.')
  if (isClosed(evaluation)) return no('This quotation is already closed.')
  if (me.role === 'ADMIN' || me.role === 'MANAGER') return OK
  if (me.role === 'REP' && ownsIt(evaluation, me)) return OK
  return no('Only the owning salesperson, a manager or an administrator can cancel this.')
}

/** Whether this viewer is entitled to cost, margin and contribution figures. */
export function showsInternalFigures(me: Me | null): boolean {
  return me != null && me.role !== 'CUSTOMER'
}

/**
 * The single sentence describing what has to happen next.
 *
 * Branch order is load-bearing and was got wrong once already: a submitted
 * quotation sits at stage REVIEW, so testing the share-the-portal branch before
 * the approval branch made "waiting for approval" unreachable for exactly the
 * deals that were waiting for approval. Approval is the earlier gate, so it is
 * the earlier branch.
 */
export function nextStepSentence(evaluation: QuoteEvaluation): string {
  const { gates, stage, revisionStatus } = evaluation

  if (gates.orderExists) {
    return 'Order confirmed. Fulfilment and invoicing can proceed.'
  }
  if (revisionStatus === 'DRAFT') {
    return evaluation.lines.length === 0
      ? 'Salesperson: add the products this customer asked for, then submit for approval.'
      : 'Salesperson: submit these terms for approval when they are ready.'
  }
  if (!gates.sellerAdopted) {
    return 'Salesperson: adopt these terms below, or edit and save a revised offer.'
  }
  if (!gates.approvalCleared) {
    const who = gates.approvalStatus === 'PENDING_FINANCE' ? 'step 2 finance' : 'step 1 manager'
    return (
      `Waiting for ${who} approval. You can share the terms with the customer meanwhile; ` +
      'the order is only created once approval also clears.'
    )
  }
  if (['REVIEW', 'UNDER_NEGOTIATION'].includes(stage) && !gates.customerAccepted) {
    return (
      'Salesperson: use Share customer portal to make these submitted terms available for ' +
      'acceptance. Do not submit this version again.'
    )
  }
  if (!gates.customerAccepted) {
    return 'Customer: open the shared quotation and accept this exact version. The order is created automatically when every gate clears.'
  }
  return gates.blockingReasons.join(' ') || 'Every decision is recorded. Refresh to check order confirmation.'
}
