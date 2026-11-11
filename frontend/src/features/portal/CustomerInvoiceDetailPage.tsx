import { useQuery } from '@tanstack/react-query'
import { Download, Eye, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { keys, portal, type InvoiceFormat } from '@/api'
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
 * One invoice, from the customer's side.
 *
 * The same invoice type the internal screen reads — the portal endpoint returns
 * it for this customer's own invoices only, and the server enforces that. What
 * is deliberately absent is any payment control: this system records receipts,
 * it does not take them, and pretending otherwise would be the worst kind of
 * demo shortcut.
 */
export default function CustomerInvoiceDetailPage() {
  const { invoiceId = '' } = useParams()
  const preview = useDisclosure()

  const invoice = useQuery({
    queryKey: keys.portalInvoice(invoiceId),
    queryFn: ({ signal }) => portal.invoice(invoiceId, signal),
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
      await portal.downloadInvoice(row.id, row.reference, format)
    } catch (error) {
      toast.error('The document could not be downloaded', {
        description: error instanceof Error ? error.message : undefined,
      })
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Invoices', to: '/customer/invoices' }, { label: row.reference }]}
        title={row.reference}
        meta={
          <>
            <StatusBadge label={status.label} tone={status.tone} size="sm" />
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
                <Button variant="primary" icon={<Download className="size-4" />}>
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
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
                id: 'quantity',
                header: 'Qty',
                align: 'right',
                cell: (line) => formatQuantity(line.quantity),
              },
              {
                id: 'unit',
                header: 'Unit price',
                align: 'right',
                hideBelow: 'sm',
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
            <PanelHeader title="Amounts" />
            <dl className="divide-y divide-line">
              <DetailRow label="Net">{formatMoney(row.net, row.currency)}</DetailRow>
              <DetailRow label="Tax">{formatMoney(row.tax, row.currency)}</DetailRow>
              <DetailRow label="Total">
                <span className="font-semibold">{formatMoney(row.total, row.currency)}</span>
              </DetailRow>
              {Number(row.credited) > 0 ? (
                <DetailRow label="Credited">{formatMoney(row.credited, row.currency)}</DetailRow>
              ) : null}
              <DetailRow label="Paid">{formatMoney(row.paid, row.currency)}</DetailRow>
              <DetailRow label="Outstanding">
                {Number(row.outstanding) > 0 ? (
                  <span className="text-base font-semibold text-stop-text">
                    {formatMoney(row.outstanding, row.currency)}
                  </span>
                ) : (
                  <Badge tone="ok" size="sm">
                    Settled
                  </Badge>
                )}
              </DetailRow>
            </dl>
          </Panel>

          <Panel tone="muted" className="text-[13px] leading-relaxed text-text-secondary">
            Payment details are on the document itself. Our finance team records a receipt once it
            arrives, and this page updates when they do.
          </Panel>
        </div>
      </div>

      <PreviewDialog
        open={preview.open}
        onOpenChange={preview.setOpen}
        invoiceId={row.id}
        reference={row.reference}
      />
    </>
  )
}

function PreviewDialog({
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
    portal
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
      description="The document as it was produced for you."
      size="xl"
    >
      {error ? (
        <InlineError error={error} title="The document could not be produced" />
      ) : url ? (
        <iframe
          title={`Invoice ${reference}`}
          src={url}
          className="h-[70vh] w-full rounded-[--radius-control] border border-line"
        />
      ) : (
        <div className="flex items-center gap-2 py-10 text-[13px] text-text-secondary">
          <Spinner /> Producing the document…
        </div>
      )}
    </Dialog>
  )
}
