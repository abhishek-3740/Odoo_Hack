import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { billing, INVOICE_KIND_LABEL, keys, type InvoiceFormat } from '@/api'
import {
  Badge,
  Button,
  DataTable,
  DetailRow,
  Dialog,
  InlineError,
  LoadingPanel,
  Menu,
  MenuItem,
  MenuLabel,
  Panel,
  PanelHeader,
  PageHeader,
  Spinner,
  StatusBadge,
  invoiceStatus,
  useDisclosure,
} from '@/design-system'
import { formatBusinessDate } from '@/lib/dates'
import { formatMoney, formatQuantity } from '@/lib/money'

/**
 * One invoice.
 *
 * `outstanding` is derived on the server from total less credits and payments,
 * and it is displayed exactly as it arrives. Recomputing it here — and getting
 * a rounding disagreement with the accounting record — is the kind of small
 * difference that costs a great deal of trust.
 */
export default function InvoiceDetailPage() {
  const { invoiceId = '' } = useParams()
  const preview = useDisclosure()

  const invoice = useQuery({
    queryKey: keys.invoice(invoiceId),
    queryFn: ({ signal }) => billing.invoice(invoiceId, signal),
    enabled: Boolean(invoiceId),
  })

  if (invoice.isLoading && !invoice.data) return <LoadingPanel rows={6} />
  if (invoice.error) {
    return (
      <InlineError
        error={invoice.error}
        title="This invoice could not be opened"
        onRetry={() => void invoice.refetch()}
      />
    )
  }
  if (!invoice.data) return null

  const row = invoice.data
  const status = invoiceStatus(row.status)

  const download = async (format: InvoiceFormat) => {
    try {
      await billing.downloadInvoice(row.id, row.reference, format)
    } catch (error) {
      toast.error('The document could not be downloaded', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Billing', to: `/admin/billing?customerId=${row.customerId}` },
          { label: row.reference },
        ]}
        eyebrow={row.customerName ?? undefined}
        title={row.reference}
        meta={
          <>
            <StatusBadge label={status.label} tone={status.tone} size="sm" />
            <Badge tone="neutral" size="sm">
              {INVOICE_KIND_LABEL[row.invoiceKind] ?? row.invoiceKind}
            </Badge>
            <span className="text-[13px] text-text-secondary">
              Issued {formatBusinessDate(row.issueDate)} · due {formatBusinessDate(row.dueDate)}
            </span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon={<Eye className="size-4" />} onClick={preview.show}>
              Preview
            </Button>
            <Menu
              trigger={
                <Button variant="secondary" icon={<Download className="size-4" />}>
                  Download
                </Button>
              }
            >
              <MenuLabel>Document format</MenuLabel>
              <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => void download('pdf')}>
                PDF
              </MenuItem>
              <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => void download('xlsx')}>
                Excel workbook
              </MenuItem>
              <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => void download('doc')}>
                Word document
              </MenuItem>
            </Menu>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <DataTable
            caption={`Lines on invoice ${row.reference}`}
            rows={row.lines}
            rowKey={(line) => line.id}
            columns={[
              {
                id: 'description',
                header: 'Description',
                cell: (line) => (
                  <span>
                    <span className="block font-medium text-text">{line.description}</span>
                    {line.coverageStart || line.coverageEnd ? (
                      <span className="block text-2xs text-text-muted">
                        Covers {formatBusinessDate(line.coverageStart)} –{' '}
                        {formatBusinessDate(line.coverageEnd)}
                      </span>
                    ) : null}
                  </span>
                ),
              },
              {
                id: 'type',
                header: 'Type',
                hideBelow: 'md',
                cell: (line) => (
                  <Badge tone="neutral" size="sm">
                    {line.lineType === 'PRORATION'
                      ? 'Proration'
                      : line.lineType === 'RECURRING'
                        ? 'Recurring'
                        : 'One-time'}
                  </Badge>
                ),
              },
              {
                id: 'quantity',
                header: 'Qty',
                align: 'right',
                cell: (line) => formatQuantity(line.quantity),
              },
              {
                id: 'unit',
                header: 'Unit price',
                align: 'right',
                hideBelow: 'lg',
                cell: (line) => formatMoney(line.unitPrice, row.currency),
              },
              {
                id: 'net',
                header: 'Net',
                align: 'right',
                cell: (line) => formatMoney(line.net, row.currency),
              },
              {
                id: 'tax',
                header: 'Tax',
                align: 'right',
                hideBelow: 'md',
                cell: (line) => formatMoney(line.tax, row.currency),
              },
            ]}
          />
        </div>

        <div className="space-y-4">
          <Panel className="space-y-2">
            <PanelHeader title="Amounts" description="As computed and stored by the server." />
            <dl className="divide-y divide-line">
              <DetailRow label="Net">{formatMoney(row.net, row.currency)}</DetailRow>
              <DetailRow label="Tax">{formatMoney(row.tax, row.currency)}</DetailRow>
              <DetailRow label="Total">
                <span className="font-semibold">{formatMoney(row.total, row.currency)}</span>
              </DetailRow>
              <DetailRow label="Credited">{formatMoney(row.credited, row.currency)}</DetailRow>
              <DetailRow label="Paid">{formatMoney(row.paid, row.currency)}</DetailRow>
              <DetailRow label="Outstanding">
                <span
                  className={
                    Number(row.outstanding) > 0
                      ? 'text-base font-semibold text-stop-text'
                      : 'text-base font-semibold text-ok-text'
                  }
                >
                  {formatMoney(row.outstanding, row.currency)}
                </span>
              </DetailRow>
            </dl>
            <p className="border-t border-line pt-3 text-[13px] leading-relaxed text-text-secondary">
              Outstanding is total less credits and payments, derived by the server. It is displayed
              exactly as received rather than recalculated here.
            </p>
          </Panel>

          <Panel className="space-y-2">
            <PanelHeader title="Related records" />
            <ul className="space-y-1.5 text-[13px]">
              {row.orderId ? (
                <li>
                  <Link
                    to={`/admin/orders/${row.orderId}`}
                    className="font-medium text-forest-600 hover:underline"
                  >
                    Open the order →
                  </Link>
                </li>
              ) : null}
              {row.subscriptionId ? (
                <li>
                  <Link
                    to={`/admin/subscriptions/${row.subscriptionId}`}
                    className="font-medium text-forest-600 hover:underline"
                  >
                    Open the subscription →
                  </Link>
                </li>
              ) : null}
              <li>
                <Link
                  to={`/admin/billing?customerId=${row.customerId}`}
                  className="font-medium text-forest-600 hover:underline"
                >
                  All billing for {row.customerName ?? 'this customer'} →
                </Link>
              </li>
            </ul>
          </Panel>
        </div>
      </div>

      <DocumentPreview
        open={preview.open}
        onOpenChange={preview.setOpen}
        invoiceId={row.id}
        reference={row.reference}
      />
    </>
  )
}

/* ---------------------------------------------------------------- preview */

/**
 * Renders the server's own PDF rather than a browser imitation of it.
 *
 * The exported document is what the customer receives, so previewing anything
 * else would be a preview of the wrong thing. The blob URL is revoked when the
 * dialog closes.
 */
function DocumentPreview({
  open,
  onOpenChange,
  invoiceId,
  reference,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  reference: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!open) return
    let revoke: (() => void) | null = null
    let cancelled = false

    setError(null)
    setUrl(null)
    billing
      .previewInvoice(invoiceId)
      .then((result) => {
        if (cancelled) {
          result.revoke()
          return
        }
        revoke = result.revoke
        setUrl(result.url)
      })
      .catch((cause) => {
        if (!cancelled) setError(cause)
      })

    return () => {
      cancelled = true
      revoke?.()
    }
  }, [open, invoiceId])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Invoice ${reference}`}
      description="The document the customer receives, rendered by the server."
      size="xl"
    >
      {error ? (
        <InlineError error={error} title="The document could not be produced" />
      ) : url ? (
        <iframe title={`Invoice ${reference}`} src={url} className="h-[70vh] w-full rounded-[--radius-control] border border-line" />
      ) : (
        <div className="flex items-center gap-2 py-10 text-[13px] text-text-secondary">
          <Spinner /> Producing the document…
        </div>
      )}
    </Dialog>
  )
}
