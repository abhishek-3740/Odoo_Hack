import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { keys, newIdempotencyKey, portal } from '@/api'
import {
  Badge,
  Button,
  Field,
  IconButton,
  InlineError,
  Input,
  Panel,
  PanelHeader,
  PageHeader,
  SidePanel,
  Textarea,
  useDisclosure,
} from '@/design-system'
import { formatMoney } from '@/lib/money'

import { CatalogueBrowser } from '../catalog/CatalogueBrowser'
import { useQuoteCart } from './useQuoteCart'

/**
 * Building a quotation request from the catalogue.
 *
 * What this does and does not do, stated on the page because it matters: it asks
 * for a quotation. It does not place an order, agree a price or commit to
 * anything. A real quotation is created, owned by the account manager and priced
 * at list until they work on it.
 */
export default function CustomerCataloguePage() {
  const cart = useQuoteCart()
  const drawer = useDisclosure()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  // One key per request intent, held while the drawer is open so a retry after a
  // dropped connection cannot create a second quotation.
  const [requestKey, setRequestKey] = useState(() => newIdempotencyKey())

  const submit = useMutation({
    mutationFn: () =>
      portal.requestQuote(
        {
          title: title.trim() || null,
          note: note.trim() || null,
          lines: cart.lines.map((line) => ({
            variantId: line.variantId ?? null,
            planId: line.planId ?? null,
            quantity: line.quantity,
          })),
        },
        requestKey,
      ),
    onSuccess: (quote) => {
      toast.success('Quotation requested', {
        description: `${quote.reference} is with your account manager.`,
      })
      cart.clear()
      setTitle('')
      setNote('')
      setRequestKey(newIdempotencyKey())
      drawer.hide()
      void queryClient.invalidateQueries({ queryKey: keys.portalQuotes() })
      navigate(`/customer/quotes/${quote.id}`)
    },
  })

  return (
    <>
      <PageHeader
        title="Catalogue"
        description="Pick what you would like priced. Your account manager turns the request into a real quotation."
        actions={
          <Button
            variant="primary"
            icon={<ShoppingBag className="size-4" />}
            onClick={drawer.show}
            disabled={cart.count === 0}
            disabledReason="Add something from the catalogue first."
          >
            Request a quotation
            {cart.count > 0 ? (
              <Badge tone="neutral" size="sm" className="ml-1.5 bg-white/20 text-white">
                {cart.count}
              </Badge>
            ) : null}
          </Button>
        }
      />

      <CatalogueBrowser
        intro={
          cart.count > 0 ? (
            <Panel tone="muted" className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-text-secondary">
                {cart.count} item{cart.count === 1 ? '' : 's'} selected. Nothing has been ordered or
                priced yet.
              </p>
              <Button size="sm" variant="secondary" onClick={drawer.show}>
                Review the request
              </Button>
            </Panel>
          ) : undefined
        }
        renderVariantAction={(variant, product) => (
          <IconButton
            label={
              cart.has(variant.id)
                ? `${variant.name} is already in your request`
                : `Add ${variant.name} to your request`
            }
            size="sm"
            variant={cart.has(variant.id) ? 'primary' : 'secondary'}
            onClick={() =>
              cart.add({
                variantId: variant.id,
                name: `${product.name} · ${variant.name}`,
                listPrice: variant.listPrice,
                currency: product.currency,
              })
            }
          >
            {cart.has(variant.id) ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Plus className="size-3.5" aria-hidden />
            )}
          </IconButton>
        )}
        renderPlanAction={(plan, product) => (
          <IconButton
            label={
              cart.has(plan.id)
                ? `${plan.name} is already in your request`
                : `Add ${plan.name} to your request`
            }
            size="sm"
            variant={cart.has(plan.id) ? 'primary' : 'secondary'}
            onClick={() =>
              cart.add({
                planId: plan.id,
                name: `${product.name} · ${plan.name}`,
                listPrice: plan.intervalPrice,
                currency: plan.currency,
                cadence: `every ${plan.intervalMonths} month${plan.intervalMonths === 1 ? '' : 's'}`,
              })
            }
          >
            {cart.has(plan.id) ? (
              <Check className="size-3.5" aria-hidden />
            ) : (
              <Plus className="size-3.5" aria-hidden />
            )}
          </IconButton>
        )}
      />

      <SidePanel
        open={drawer.open}
        onOpenChange={drawer.setOpen}
        title="Request a quotation"
        description="Your account manager prices this and sends it back. Nothing here is an order."
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={drawer.hide} disabled={submit.isPending}>
              Keep browsing
            </Button>
            <Button
              variant="primary"
              busy={submit.isPending}
              disabled={cart.count === 0}
              disabledReason="Add something from the catalogue first."
              onClick={() => submit.mutate()}
            >
              Send the request
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {cart.lines.length === 0 ? (
            <p className="text-[13px] text-text-secondary">Nothing selected yet.</p>
          ) : (
            <ul className="space-y-2">
              {cart.lines.map((line) => (
                <li
                  key={line.key}
                  className="flex flex-wrap items-center gap-3 rounded-[--radius-control] border border-line px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-text">
                      {line.name}
                    </span>
                    <span className="tabular block text-2xs text-text-muted">
                      List {formatMoney(line.listPrice, line.currency)}
                      {line.cadence ? ` · ${line.cadence}` : ''}
                    </span>
                  </span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    aria-label={`Quantity of ${line.name}`}
                    value={line.quantity}
                    onChange={(event) => cart.setQuantity(line.key, Number(event.target.value))}
                    className="tabular h-9 w-20 rounded-[--radius-control] border border-line-strong px-2 text-right text-sm"
                  />
                  <IconButton
                    label={`Remove ${line.name}`}
                    size="sm"
                    onClick={() => cart.remove(line.key)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <Field label="What is this for?" hint="Optional. It helps your account manager reply usefully.">
            {(props) => (
              <Input
                {...props}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Second-floor network refresh"
              />
            )}
          </Field>

          <Field label="Anything they should know?">
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Timing, delivery constraints, a budget you have to work within…"
              />
            )}
          </Field>

          <PanelHeader
            as="h4"
            title="What happens next"
            description="A real quotation is created and priced at list. Your account manager reviews it, applies any pricing you are entitled to, and shares it back here for you to negotiate or accept."
          />

          {submit.error ? <InlineError error={submit.error} title="The request was not sent" /> : null}
        </div>
      </SidePanel>
    </>
  )
}
