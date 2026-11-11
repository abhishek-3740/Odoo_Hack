import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban,
  Copy,
  Handshake,
  MessageCircleQuestion,
  PanelRightOpen,
  Save,
  Send,
  Share2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  ApiError,
  APPROVAL_LEVEL_LABEL,
  keys,
  quotes as quotesApi,
  REVISION_SOURCE_LABEL,
  STAGE_LABEL,
  type QuoteEvaluation,
} from '@/api'
import { useAuth } from '@/auth/useAuth'
import {
  ActionBar,
  Badge,
  Button,
  ConfirmDialog,
  InlineError,
  LoadingPanel,
  Panel,
  PanelHeader,
  PageHeader,
  RefreshingHint,
  Section,
  SidePanel,
  StatusBadge,
  TabPanel,
  Tabs,
  approvalLevelStatus,
  stageStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate } from '@/lib/dates'
import { cn } from '@/lib/cn'

import {
  canAdopt,
  canCancel,
  canEdit,
  canSave,
  canShare,
  canSubmit,
  nextStepSentence,
  showsInternalFigures,
} from './actions'
import { AddLineDialog } from './components/AddLineDialog'
import { ApprovalRoute } from './components/ApprovalRoute'
import { GateChecklist } from './components/GateChecklist'
import { HistoryTab } from './components/HistoryTab'
import { NegotiationDesk } from './components/NegotiationDesk'
import { QuoteEditor } from './components/QuoteEditor'
import { RecommendationsTab } from './components/RecommendationsTab'
import { RiskPanel } from './components/RiskPanel'
import { TotalsPanel } from './components/TotalsPanel'
import { EscalationDialog } from '../escalations/EscalationDialog'
import { newLineKey, useQuoteDraft } from './useQuoteDraft'

/**
 * The deal workspace.
 *
 * One screen that answers the product's three questions about a quotation:
 * what is happening (stage, version, who proposed it), what is blocking it (the
 * three gates and the policy check), and what this person can do next (the
 * action bar, where every unavailable action states its reason).
 */
export default function DealWorkspacePage() {
  const { quoteId = '' } = useParams()
  const { me } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const quote = useQuery({
    queryKey: keys.quote(quoteId),
    queryFn: ({ signal }) => quotesApi.get(quoteId, signal),
    enabled: Boolean(quoteId),
  })

  if (quote.isLoading && !quote.data) return <LoadingPanel rows={8} />
  if (quote.error) {
    return (
      <InlineError
        error={quote.error}
        title="This quotation could not be opened"
        onRetry={() => void quote.refetch()}
      />
    )
  }
  if (!quote.data) return null

  return (
    <Workspace
      key={quote.data.quoteId}
      server={quote.data}
      refreshing={quote.isFetching && !quote.isLoading}
      onRefresh={() => void quote.refetch()}
      onDeleted={() => navigate('/admin/quotes')}
      me={me}
      queryClient={queryClient}
    />
  )
}

type QueryClientLike = ReturnType<typeof useQueryClient>

function Workspace({
  server,
  refreshing,
  onRefresh,
  me,
  queryClient,
}: {
  server: QuoteEvaluation
  refreshing: boolean
  onRefresh: () => void
  onDeleted: () => void
  me: ReturnType<typeof useAuth>['me']
  queryClient: QueryClientLike
}) {
  const draft = useQuoteDraft(server)
  const [tab, setTab] = useState('quote')
  const addLine = useDisclosure()
  const inspector = useDisclosure()
  const cancelDialog = useDisclosure()
  const escalate = useDisclosure()
  const [shareLink, setShareLink] = useState<string | null>(null)

  const evaluation = draft.evaluation
  const context = {
    evaluation: server,
    me,
    dirty: draft.dirty,
    pendingLineCount: draft.draft.lines.length,
  }
  const internalFigures = showsInternalFigures(me)

  const editable = canEdit(context)
  const saveable = canSave(context)
  const submittable = canSubmit(context)
  const shareable = canShare(context)
  const adoptable = canAdopt(context)
  const cancellable = canCancel(context)

  /* ------------------------------------------------------------ mutations */
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: keys.quote(server.quoteId) })
    void queryClient.invalidateQueries({ queryKey: keys.quotes() })
  }

  const save = useMutation({
    mutationFn: () => quotesApi.saveRevision(server.quoteId, draft.saveRequest()),
    onSuccess: (result) => {
      toast.success(`Saved as version ${result.revisionNo}`, {
        description: 'The server re-priced these terms and re-ran the policy check.',
      })
      draft.reset()
      invalidate()
    },
  })

  const submit = useMutation({
    mutationFn: () =>
      quotesApi.submit(server.quoteId, {
        expectedRevisionId: server.revisionId,
        expectedRowVersion: server.rowVersion,
      }),
    onSuccess: (result) => {
      const level = result.risk.requiredLevel
      toast.success('Submitted', {
        description:
          level === 'NONE'
            ? 'Within policy — no approval step was created.'
            : `${APPROVAL_LEVEL_LABEL[level]} · the approver has been notified.`,
      })
      invalidate()
    },
  })

  const share = useMutation({
    mutationFn: () => quotesApi.share(server.quoteId),
    onSuccess: (result) => {
      const url = `${window.location.origin}${result.portalPath.startsWith('/') ? '' : '/'}${result.portalPath}`
      setShareLink(url)
      toast.success('Shared with the customer', {
        description: 'These terms are now visible in their deal room.',
      })
      invalidate()
    },
  })

  const adopt = useMutation({
    mutationFn: () =>
      quotesApi.adopt(server.quoteId, {
        revisionId: server.revisionId,
        expectedRowVersion: server.rowVersion,
      }),
    onSuccess: (result) => {
      toast.success(
        server.revisionSource === 'CUSTOMER_COUNTER' ? 'Customer terms adopted' : 'Terms adopted',
        {
          description: `You now stand behind version ${result.revisionNo}. Approval and customer acceptance are still their own gates.`,
        },
      )
      invalidate()
    },
  })

  const cancel = useMutation({
    mutationFn: (reason: string) =>
      quotesApi.cancel(server.quoteId, { reason, expectedRowVersion: server.rowVersion }),
    onSuccess: () => {
      cancelDialog.hide()
      toast.success('Quotation cancelled')
      invalidate()
    },
  })

  const [cancelReason, setCancelReason] = useState('')

  // A conflict means somebody else moved the record. Re-read so the screen can
  // explain what changed instead of leaving a stale row version in the form.
  useEffect(() => {
    const failure = save.error ?? submit.error ?? adopt.error
    if (failure instanceof ApiError && failure.isStale) onRefresh()
  }, [save.error, submit.error, adopt.error, onRefresh])

  /* ---------------------------------------------------------------- render */
  const stage = stageStatus(server.stage)
  const level = approvalLevelStatus(server.risk.requiredLevel)
  const customerProposed = server.revisionSource === 'CUSTOMER_COUNTER'
  const awaitingAdoption = customerProposed && !server.gates.sellerAdopted

  const openRequests = 0 // filled in by the conversation tab's own query badge

  const inspectorContent = (
    <div className="space-y-4">
      <Panel className="space-y-3">
        <PanelHeader title="Gates" description="All three are needed before an order exists." />
        <GateChecklist gates={server.gates} />
      </Panel>

      <TotalsPanel
        evaluation={evaluation}
        evaluating={draft.evaluating}
        showInternalFigures={internalFigures}
      />

      <RiskPanel
        risk={evaluation.risk}
        currency={evaluation.currency}
        submitted={server.revisionStatus === 'SUBMITTED'}
      />

      {server.approvals.length > 0 ? (
        <Panel className="space-y-3">
          <PanelHeader
            title="Approval route"
            description="Both steps are created at submission; step 2 unlocks when step 1 is approved."
          />
          <ApprovalRoute steps={server.approvals} />
        </Panel>
      ) : null}
    </div>
  )

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Quotations', to: '/admin/quotes' }, { label: server.reference }]}
        eyebrow={server.customerName ?? undefined}
        title={server.title || server.reference}
        meta={
          <>
            <span className="tabular text-[13px] text-text-secondary">{server.reference}</span>
            <StatusBadge label={stage.label} tone={stage.tone} size="sm" />
            <Badge tone="neutral" size="sm">
              Version {server.revisionNo}
            </Badge>
            {customerProposed ? (
              <Badge tone="brass" size="sm">
                {REVISION_SOURCE_LABEL.CUSTOMER_COUNTER}
              </Badge>
            ) : null}
            <StatusBadge
              label={
                server.risk.requiredLevel === 'NONE' && server.revisionStatus === 'SUBMITTED'
                  ? 'Within policy · no approval required'
                  : level.label
              }
              tone={level.tone}
              size="sm"
            />
            {server.validUntil ? (
              <span className="text-[13px] text-text-secondary">
                Valid to {formatBusinessDate(server.validUntil)}
              </span>
            ) : null}
            <RefreshingHint visible={refreshing} />
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<MessageCircleQuestion className="size-3.5" />}
              onClick={escalate.show}
            >
              Ask a question
            </Button>
          </>
        }
      />

      {/* The one sentence that says what happens next. */}
      <section
        aria-label="Next workflow step"
        className={cn(
          'mb-5 rounded-[--radius-panel] border px-4 py-3.5',
          server.gates.orderExists
            ? 'border-ok-border bg-ok-surface'
            : awaitingAdoption
              ? 'border-brass-200 bg-brass-50'
              : 'border-line bg-panel',
        )}
      >
        <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          Next workflow step
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-text">{nextStepSentence(server)}</p>
      </section>

      {/* The three gates, under the header at every width. */}
      <Panel className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-text-muted">
              Before an order can exist
            </p>
            <GateChecklist gates={server.gates} compact />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="2xl:hidden"
            icon={<PanelRightOpen className="size-3.5" />}
            onClick={inspector.show}
          >
            Totals &amp; policy
          </Button>
        </div>
      </Panel>

      {awaitingAdoption ? (
        <Panel className="mb-5 border-brass-200 bg-brass-50">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text">The customer proposed these terms</p>
              <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                Version {server.revisionNo} came from the customer and has been priced by the
                server. Adopting it makes it your offer; editing and saving creates your own
                counter-proposal instead.
              </p>
            </div>
            <Button
              variant="editorial"
              icon={<Handshake className="size-4" />}
              busy={adopt.isPending}
              disabled={!adoptable.allowed}
              disabledReason={adoptable.reason}
              onClick={() => adopt.mutate()}
            >
              Adopt these terms
            </Button>
          </div>
        </Panel>
      ) : null}

      {draft.externalChange ? (
        <Panel className="mb-5 border-wait-border bg-wait-surface">
          <p className="text-[13px] font-semibold text-wait-text">A newer version is available</p>
          <p className="mt-1 text-[13px] leading-relaxed text-text">
            Someone saved version {draft.externalChange.revisionNo} while you were editing. Your
            unsaved changes are still here — saving them now would be refused, because they were
            based on version {server.revisionNo}.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={draft.acceptExternal}>
              Load the newer version
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTab('history')}>
              Compare versions
            </Button>
            <Button size="sm" variant="ghost" onClick={draft.dismissExternal}>
              Keep editing mine
            </Button>
          </div>
        </Panel>
      ) : null}

      {shareLink ? (
        <Panel className="mb-5 border-forest-200 bg-forest-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text">Customer link</p>
              <p className="tabular mt-0.5 truncate text-[13px] text-text-secondary">{shareLink}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="size-3.5" />}
              onClick={() => {
                void navigator.clipboard?.writeText(shareLink)
                toast.success('Link copied')
              }}
            >
              Copy
            </Button>
          </div>
          <p className="mt-2 text-2xs text-text-muted">
            The customer also sees this quotation in their own deal room; this link is a
            convenience, not the only way in. Nothing is emailed automatically.
          </p>
        </Panel>
      ) : null}

      {/* ---------------------------------------------------- main + inspector */}
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Tabs
            label="Deal sections"
            value={tab}
            onValueChange={setTab}
            tabs={[
              { value: 'quote', label: 'Quote' },
              { value: 'recommendations', label: 'Recommendations' },
              { value: 'conversation', label: 'Conversation', badge: openRequests ? <Badge tone="wait" size="sm">{openRequests}</Badge> : undefined },
              { value: 'approvals', label: 'Approvals' },
              { value: 'history', label: 'History' },
            ]}
          >
            <TabPanel value="quote">
              <div className="space-y-4">
                {draft.evaluationError ? (
                  <InlineError
                    error={draft.evaluationError}
                    title="These terms could not be priced"
                  />
                ) : null}

                <QuoteEditor
                  evaluation={evaluation}
                  lines={draft.draft.lines}
                  readOnly={!editable.allowed}
                  readOnlyReason={editable.reason}
                  showInternalFigures={internalFigures}
                  onChangeLine={(lineKey, patch) =>
                    draft.setLines((lines) =>
                      lines.map((line) =>
                        line.lineKey === lineKey ? { ...line, ...patch } : line,
                      ),
                    )
                  }
                  onRemoveLine={(lineKey) =>
                    draft.setLines((lines) => lines.filter((line) => line.lineKey !== lineKey))
                  }
                  onAddLine={addLine.show}
                  orderDiscountBp={draft.draft.orderDiscountBp}
                  onOrderDiscountChange={draft.setOrderDiscountBp}
                  backorderTerms={draft.draft.backorderTerms}
                  onBackorderTermsChange={draft.setBackorderTerms}
                  requestedActivationDate={draft.draft.requestedActivationDate}
                  onActivationDateChange={draft.setRequestedActivationDate}
                />

                {save.error ? <InlineError error={save.error} title="Could not save" /> : null}
              </div>
            </TabPanel>

            <TabPanel value="recommendations">
              <RecommendationsTab
                evaluation={server}
                canApply={editable.allowed && !draft.dirty}
                applyDisabledReason={
                  draft.dirty
                    ? 'Save or discard your unsaved changes first.'
                    : editable.reason
                }
              />
            </TabPanel>

            <TabPanel value="conversation">
              <NegotiationDesk
                evaluation={server}
                canAdoptCandidate={adoptable.allowed || !server.gates.sellerAdopted}
                adoptDisabledReason={adoptable.reason}
              />
            </TabPanel>

            <TabPanel value="approvals">
              <Section
                id="approval-route"
                title="Approval route"
                description="Raised only when the terms breach the discount policy. Manager first, finance second."
              >
                {server.approvals.length > 0 ? (
                  <Panel>
                    <ApprovalRoute steps={server.approvals} />
                  </Panel>
                ) : (
                  <Panel className="border-ok-border bg-ok-surface">
                    <p className="text-[13px] leading-relaxed text-ok-text">
                      <span className="font-semibold">No approval step exists for this version.</span>{' '}
                      {server.revisionStatus === 'SUBMITTED'
                        ? 'It was submitted and found to be inside policy, so nothing was raised and nobody is waiting in a queue.'
                        : 'It has not been submitted yet. Submitting it runs the policy check, which decides whether an approver is involved at all.'}{' '}
                      The measurements behind that decision are in the policy check alongside.
                    </p>
                  </Panel>
                )}
              </Section>
            </TabPanel>

            <TabPanel value="history">
              <HistoryTab evaluation={server} />
            </TabPanel>
          </Tabs>
        </div>

        {/* The inspector is a column at 2xl and a drawer below it. */}
        <aside className="hidden 2xl:block">{inspectorContent}</aside>
      </div>

      {/* ------------------------------------------------------------ actions */}
      <ActionBar
        status={
          draft.dirty ? (
            <span className="flex items-center gap-2 font-medium text-brass-600">
              Unsaved changes
              {draft.evaluating ? <RefreshingHint visible /> : null}
            </span>
          ) : (
            <span>
              {STAGE_LABEL[server.stage] ?? server.stage} · version {server.revisionNo} ·{' '}
              {server.revisionStatus === 'SUBMITTED' ? 'submitted' : 'saved'}
            </span>
          )
        }
      >
        {draft.dirty ? (
          <Button variant="ghost" onClick={draft.reset}>
            Discard changes
          </Button>
        ) : null}

        <Button
          variant={draft.dirty ? 'primary' : 'secondary'}
          icon={<Save className="size-4" />}
          busy={save.isPending}
          disabled={!saveable.allowed}
          disabledReason={saveable.reason}
          onClick={() => save.mutate()}
        >
          Save terms
        </Button>

        <Button
          variant="secondary"
          icon={<Send className="size-4" />}
          busy={submit.isPending}
          disabled={!submittable.allowed}
          disabledReason={submittable.reason}
          onClick={() => submit.mutate()}
        >
          {server.revisionStatus === 'SUBMITTED' ? 'Submitted' : 'Submit for approval'}
        </Button>

        <Button
          variant="secondary"
          icon={<Share2 className="size-4" />}
          busy={share.isPending}
          disabled={!shareable.allowed}
          disabledReason={shareable.reason}
          onClick={() => share.mutate()}
        >
          Share customer portal
        </Button>

        {!awaitingAdoption ? (
          <Button
            variant="secondary"
            icon={<Handshake className="size-4" />}
            busy={adopt.isPending}
            disabled={!adoptable.allowed}
            disabledReason={adoptable.reason}
            onClick={() => adopt.mutate()}
          >
            {server.gates.sellerAdopted ? 'Terms adopted' : 'Adopt terms'}
          </Button>
        ) : null}

        <Button
          variant="ghost"
          icon={<Ban className="size-4" />}
          disabled={!cancellable.allowed}
          disabledReason={cancellable.reason}
          onClick={cancelDialog.show}
        >
          Cancel
        </Button>
      </ActionBar>

      {submit.error ? (
        <InlineError className="mt-4" error={submit.error} title="Could not submit" />
      ) : null}
      {share.error ? (
        <InlineError className="mt-4" error={share.error} title="Could not share" />
      ) : null}
      {adopt.error ? (
        <InlineError className="mt-4" error={adopt.error} title="Could not adopt" />
      ) : null}

      {/* ------------------------------------------------------------ overlays */}
      <AddLineDialog
        open={addLine.open}
        onOpenChange={addLine.setOpen}
        onAdd={(choice) =>
          draft.setLines((lines) => [
            ...lines,
            {
              lineKey: newLineKey(),
              variantId: choice.variantId ?? null,
              planId: choice.planId ?? null,
              quantity: '1',
              lineDiscountBp: 0,
              promisedDate: null,
              description: choice.label,
            },
          ])
        }
      />

      <SidePanel
        open={inspector.open}
        onOpenChange={inspector.setOpen}
        title="Totals, policy and gates"
        description={`${server.reference} · version ${server.revisionNo}`}
        width="lg"
      >
        {inspectorContent}
      </SidePanel>

      <ConfirmDialog
        open={cancelDialog.open}
        onOpenChange={cancelDialog.setOpen}
        title="Cancel this quotation?"
        tone="danger"
        confirmLabel="Cancel the quotation"
        cancelLabel="Keep it open"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate(cancelReason)}
        body={
          <div className="space-y-3">
            <p>
              The quotation stays visible in history with its versions and decisions, but it can no
              longer be edited, approved or accepted.
            </p>
            <div className="space-y-1.5">
              <label htmlFor="cancel-reason" className="block text-[13px] font-medium text-text">
                Reason
              </label>
              <textarea
                id="cancel-reason"
                rows={2}
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value)}
                placeholder="Recorded in the audit trail."
                className="w-full rounded-[--radius-control] border border-line-strong bg-panel px-3 py-2 text-sm"
              />
            </div>
            {cancel.error ? <InlineError error={cancel.error} /> : null}
          </div>
        }
      />

      <EscalationDialog
        open={escalate.open}
        onOpenChange={escalate.setOpen}
        quoteId={server.quoteId}
        revisionId={server.revisionId}
        reference={server.reference}
      />
    </>
  )
}
