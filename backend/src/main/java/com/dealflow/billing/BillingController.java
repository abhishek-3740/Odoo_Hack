package com.dealflow.billing;

import com.dealflow.auth.Actor;
import com.dealflow.auth.Role;
import com.dealflow.billing.dto.BillingDtos.AllocationResponse;
import com.dealflow.billing.dto.BillingDtos.CancelSubscriptionRequest;
import com.dealflow.billing.dto.BillingDtos.CreditNoteResponse;
import com.dealflow.billing.dto.BillingDtos.InvoiceLineResponse;
import com.dealflow.billing.dto.BillingDtos.InvoiceResponse;
import com.dealflow.billing.dto.BillingDtos.PaymentResponse;
import com.dealflow.billing.dto.BillingDtos.RecordPaymentRequest;
import com.dealflow.billing.dto.BillingDtos.RecordRefundRequest;
import com.dealflow.billing.dto.BillingDtos.RefundResponse;
import com.dealflow.billing.dto.BillingDtos.SubscriptionChangePreview;
import com.dealflow.billing.dto.BillingDtos.SubscriptionChangeRequest;
import com.dealflow.billing.dto.BillingDtos.SubscriptionResponse;
import com.dealflow.catalog.Customer;
import com.dealflow.catalog.CustomerRepository;
import com.dealflow.catalog.SubscriptionPlan;
import com.dealflow.catalog.SubscriptionPlanRepository;
import com.dealflow.orders.Order;
import com.dealflow.orders.OrderRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.idempotency.IdempotencyService;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Invoices, subscriptions, payments, credits and refunds. */
@RestController
@RequestMapping("/api/v1")
public class BillingController {

    private static final Set<String> SORTS = Set.of("createdAt", "issueDate", "dueDate", "recordedAt");

    private final InvoiceRepository invoices;
    private final InvoiceLineRepository invoiceLines;
    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final PaymentRepository payments;
    private final PaymentAllocationRepository paymentAllocations;
    private final CreditNoteRepository creditNotes;
    private final RefundRepository refunds;
    private final CustomerRepository customers;
    private final OrderRepository orders;
    private final SubscriptionService subscriptionService;
    private final SettlementService settlementService;
    private final IdempotencyService idempotency;

    public BillingController(InvoiceRepository invoices, InvoiceLineRepository invoiceLines,
                             SubscriptionRepository subscriptions, SubscriptionPlanRepository plans,
                             PaymentRepository payments, PaymentAllocationRepository paymentAllocations,
                             CreditNoteRepository creditNotes, RefundRepository refunds,
                             CustomerRepository customers, OrderRepository orders,
                             SubscriptionService subscriptionService, SettlementService settlementService,
                             IdempotencyService idempotency) {
        this.invoices = invoices;
        this.invoiceLines = invoiceLines;
        this.subscriptions = subscriptions;
        this.plans = plans;
        this.payments = payments;
        this.paymentAllocations = paymentAllocations;
        this.creditNotes = creditNotes;
        this.refunds = refunds;
        this.customers = customers;
        this.orders = orders;
        this.subscriptionService = subscriptionService;
        this.settlementService = settlementService;
        this.idempotency = idempotency;
    }

    // ------------------------------------------------------------- invoices

    @GetMapping("/invoices")
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<InvoiceResponse>> invoices(@RequestParam(required = false) UUID customerId,
                                                               @RequestParam(required = false) UUID orderId,
                                                               @RequestParam(required = false) Integer page,
                                                               @RequestParam(required = false) Integer pageSize,
                                                               @RequestParam(required = false) String sort,
                                                               Actor actor) {
        requireInternal(actor);
        if (orderId != null) {
            List<InvoiceResponse> rows = invoices.findByOrderId(orderId).stream()
                    .filter(invoice -> visibleTo(invoice, actor)).map(this::toInvoice).toList();
            return ApiResponse.of(new PageResponse<>(rows, 0, rows.size(), rows.size(), 1));
        }
        if (customerId == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Filter invoices by customerId or orderId.");
        }
        Page<Invoice> result = invoices.findByCustomerId(customerId,
                Paging.of(page, pageSize, sort, SORTS, "createdAt"));
        return ApiResponse.of(PageResponse.of(result, invoice -> visibleTo(invoice, actor) ? toInvoice(invoice) : null));
    }

    @GetMapping("/invoices/{invoiceId}")
    @Transactional(readOnly = true)
    public ApiResponse<InvoiceResponse> invoice(@PathVariable UUID invoiceId, Actor actor) {
        requireInternal(actor);
        Invoice invoice = invoices.findById(invoiceId).orElseThrow(() -> ApiException.notFound("Invoice " + invoiceId));
        if (!visibleTo(invoice, actor)) {
            throw ApiException.notFound("Invoice " + invoiceId);
        }
        return ApiResponse.of(toInvoice(invoice));
    }

    // -------------------------------------------------------- subscriptions

    @GetMapping("/subscriptions")
    @Transactional(readOnly = true)
    public ApiResponse<List<SubscriptionResponse>> subscriptions(@RequestParam(required = false) UUID customerId,
                                                                 @RequestParam(required = false) UUID orderId,
                                                                 Actor actor) {
        requireInternal(actor);
        List<Subscription> rows = orderId != null
                ? subscriptions.findByOrderId(orderId)
                : customerId != null
                        ? subscriptions.findByCustomerId(customerId,
                                org.springframework.data.domain.PageRequest.of(0, 100)).getContent()
                        : List.of();
        return ApiResponse.of(rows.stream().filter(sub -> visibleTo(sub, actor)).map(this::toSubscription).toList());
    }

    @GetMapping("/subscriptions/{subscriptionId}")
    @Transactional(readOnly = true)
    public ApiResponse<SubscriptionResponse> subscription(@PathVariable UUID subscriptionId, Actor actor) {
        requireInternal(actor);
        Subscription subscription = subscriptions.findById(subscriptionId)
                .orElseThrow(() -> ApiException.notFound("Subscription " + subscriptionId));
        if (!visibleTo(subscription, actor)) {
            throw ApiException.notFound("Subscription " + subscriptionId);
        }
        return ApiResponse.of(toSubscription(subscription));
    }

    /** Shows the arithmetic before committing. Persists nothing. */
    @PostMapping("/subscriptions/{subscriptionId}/change-previews")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<SubscriptionChangePreview> previewChange(@PathVariable UUID subscriptionId,
                                                                @Valid @RequestBody SubscriptionChangeRequest request) {
        return ApiResponse.of(subscriptionService.previewQuantityChange(subscriptionId, request));
    }

    /** Applies a quantity change. {@code Idempotency-Key} is the change's request key. */
    @PostMapping("/subscriptions/{subscriptionId}/changes")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<SubscriptionChangePreview> change(@PathVariable UUID subscriptionId,
                                                         @RequestHeader(value = "Idempotency-Key", required = false)
                                                         String idempotencyKey,
                                                         @Valid @RequestBody SubscriptionChangeRequest request,
                                                         Actor actor) {
        return ApiResponse.of(subscriptionService.applyQuantityChange(subscriptionId,
                requireKey(idempotencyKey), request, actor));
    }

    @PostMapping("/subscriptions/{subscriptionId}/cancellations")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<SubscriptionChangePreview> cancel(@PathVariable UUID subscriptionId,
                                                         @RequestHeader(value = "Idempotency-Key", required = false)
                                                         String idempotencyKey,
                                                         @RequestBody(required = false) CancelSubscriptionRequest request,
                                                         Actor actor) {
        CancelSubscriptionRequest body = request == null
                ? new CancelSubscriptionRequest(null, null, null) : request;
        return ApiResponse.of(subscriptionService.cancel(subscriptionId, requireKey(idempotencyKey), body, actor));
    }

    // ------------------------------------------------------------- payments

    @PostMapping("/payments")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<PaymentResponse> recordPayment(@RequestHeader(value = "Idempotency-Key", required = false)
                                                      String idempotencyKey,
                                                      @Valid @RequestBody RecordPaymentRequest request,
                                                      Actor actor) {
        return ApiResponse.of(idempotency.execute(actor, "record-payment", idempotencyKey, request,
                PaymentResponse.class, () -> toPayment(settlementService.recordPayment(request, actor))));
    }

    @GetMapping("/payments")
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<PaymentResponse>> payments(@RequestParam UUID customerId,
                                                               @RequestParam(required = false) Integer page,
                                                               @RequestParam(required = false) Integer pageSize,
                                                               Actor actor) {
        requireInternal(actor);
        Page<Payment> result = payments.findByCustomerId(customerId,
                Paging.of(page, pageSize, null, SORTS, "recordedAt"));
        return ApiResponse.of(PageResponse.of(result, this::toPayment));
    }

    @PostMapping("/refunds")
    @PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
    public ApiResponse<RefundResponse> recordRefund(@RequestHeader(value = "Idempotency-Key", required = false)
                                                    String idempotencyKey,
                                                    @Valid @RequestBody RecordRefundRequest request,
                                                    Actor actor) {
        return ApiResponse.of(idempotency.execute(actor, "record-refund", idempotencyKey, request,
                RefundResponse.class, () -> {
                    Refund refund = settlementService.recordRefund(request, actor);
                    return new RefundResponse(refund.getId(), refund.getReference(), refund.getCreditNoteId(),
                            Money.toMajor(refund.getAmountMinor()), refund.getMethod(), refund.getRecordedAt());
                }));
    }

    @GetMapping("/credit-notes")
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<CreditNoteResponse>> creditNotes(@RequestParam UUID customerId,
                                                                     @RequestParam(required = false) Integer page,
                                                                     @RequestParam(required = false) Integer pageSize,
                                                                     Actor actor) {
        requireInternal(actor);
        Page<CreditNote> result = creditNotes.findByCustomerId(customerId,
                Paging.of(page, pageSize, null, SORTS, "createdAt"));
        return ApiResponse.of(PageResponse.of(result, note -> new CreditNoteResponse(note.getId(),
                note.getReference(), note.getCustomerId(), note.getSubscriptionId(), note.getCurrency(),
                note.getReason(), Money.toMajor(note.getNetMinor()), Money.toMajor(note.getTaxMinor()),
                Money.toMajor(note.getTotalMinor()), Money.toMajor(note.getAppliedMinor()),
                Money.toMajor(note.getRefundedMinor()), Money.toMajor(note.availableMinor()),
                note.getCoverageStart(), note.getCoverageEnd(), note.getStatus().name(), note.getCreatedAt())));
    }

    // -------------------------------------------------------------- helpers

    private InvoiceResponse toInvoice(Invoice invoice) {
        Customer customer = customers.findById(invoice.getCustomerId()).orElse(null);
        List<InvoiceLineResponse> lines = invoiceLines.findByInvoiceIdOrderByPositionAsc(invoice.getId()).stream()
                .map(line -> new InvoiceLineResponse(line.getId(), line.getDescription(), line.getQuantity(),
                        Money.toMajor(line.getUnitPriceMinor()), Money.toMajor(line.getNetMinor()),
                        Money.toMajor(line.getTaxMinor()), line.getCoverageStart(), line.getCoverageEnd(),
                        line.getLineType().name()))
                .toList();
        return new InvoiceResponse(invoice.getId(), invoice.getReference(), invoice.getCustomerId(),
                customer == null ? null : customer.getName(), invoice.getOrderId(), invoice.getSubscriptionId(),
                invoice.getInvoiceKind().name(), invoice.getStatus().name(), invoice.getCurrency(),
                invoice.getIssueDate(), invoice.getDueDate(), Money.toMajor(invoice.getNetMinor()),
                Money.toMajor(invoice.getTaxMinor()), Money.toMajor(invoice.getTotalMinor()),
                Money.toMajor(invoice.getCreditedMinor()), Money.toMajor(invoice.getPaidMinor()),
                Money.toMajor(invoice.outstandingMinor()), lines);
    }

    private SubscriptionResponse toSubscription(Subscription subscription) {
        Customer customer = customers.findById(subscription.getCustomerId()).orElse(null);
        SubscriptionPlan plan = plans.findById(subscription.getPlanId()).orElse(null);
        BigDecimal mrr = BigDecimal.valueOf(subscription.intervalNetMinor())
                .multiply(BusinessCalendar.monthlyNormalisationFactor(subscription.getIntervalMonths()))
                .setScale(0, RoundingMode.HALF_UP);
        return new SubscriptionResponse(subscription.getId(), subscription.getReference(),
                subscription.getOrderId(), subscription.getCustomerId(),
                customer == null ? null : customer.getName(), subscription.getPlanId(),
                plan == null ? null : plan.getName(), subscription.getCurrency(), subscription.getQuantity(),
                Money.toMajor(subscription.getUnitIntervalPriceMinor()), subscription.getIntervalMonths(),
                BusinessCalendar.cadenceLabel(subscription.getIntervalMonths()), subscription.getActivationDate(),
                subscription.getPeriodStart(), subscription.getPeriodEnd(), subscription.getNextBillAt(),
                subscription.getStatus().name(), subscription.getCancelEffectiveDate(),
                subscription.getProrationPolicy().name(), subscription.getCancellationPolicy().name(),
                Money.toMajor(mrr.longValueExact()), subscription.getRowVersion());
    }

    private PaymentResponse toPayment(SettlementService.PaymentOutcome outcome) {
        return toPayment(outcome.payment());
    }

    private PaymentResponse toPayment(Payment payment) {
        List<PaymentAllocation> allocations = paymentAllocations.findByPaymentId(payment.getId());
        long allocated = allocations.stream().mapToLong(PaymentAllocation::getAmountMinor).sum();
        List<AllocationResponse> rows = allocations.stream().map(allocation -> {
            Invoice invoice = invoices.findById(allocation.getInvoiceId()).orElse(null);
            return new AllocationResponse(allocation.getInvoiceId(),
                    invoice == null ? null : invoice.getReference(), Money.toMajor(allocation.getAmountMinor()),
                    invoice == null ? null : Money.toMajor(invoice.outstandingMinor()),
                    invoice == null ? null : invoice.getStatus().name());
        }).toList();
        return new PaymentResponse(payment.getId(), payment.getReference(), payment.getCustomerId(),
                Money.toMajor(payment.getAmountMinor()), Money.toMajor(allocated),
                Money.toMajor(payment.getAmountMinor() - allocated), payment.getMethod(),
                payment.getExternalReference(), payment.getRecordedAt(), rows);
    }

    private boolean visibleTo(Invoice invoice, Actor actor) {
        if (actor.role() != Role.REP) {
            return true;
        }
        return invoice.getOrderId() != null && orders.findById(invoice.getOrderId())
                .map(order -> Objects.equals(order.getOwnerProfileId(), actor.profileId())).orElse(false);
    }

    private boolean visibleTo(Subscription subscription, Actor actor) {
        if (actor.role() != Role.REP) {
            return true;
        }
        return orders.findById(subscription.getOrderId())
                .map(order -> Objects.equals(order.getOwnerProfileId(), actor.profileId())).orElse(false);
    }

    private static void requireInternal(Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Use the portal endpoints.");
        }
    }

    private static String requireKey(String idempotencyKey) {
        if (idempotencyKey == null || idempotencyKey.isBlank()) {
            throw new ApiException(ErrorCode.IDEMPOTENCY_KEY_REQUIRED);
        }
        return idempotencyKey.trim();
    }
}
