package com.dealflow.billing.service;


import com.dealflow.billing.models.*;
import com.dealflow.billing.repo.*;
import com.dealflow.billing.dto.*;
import com.dealflow.billing.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.billing.service.ProrationCalculator;
import com.dealflow.catalog.models.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.models.SubscriptionPlan;
import com.dealflow.catalog.repo.SubscriptionPlanRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.orders.models.Order;
import com.dealflow.orders.models.OrderLine;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.quotes.models.QuoteEnums.InvoicingTerms;
import com.dealflow.quotes.models.PricingModel.LineKind;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessCalendar;
import com.dealflow.shared.time.BusinessClock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates the billing side of a confirmed order, and raises recurring charges.
 *
 * <h2>Hybrid deals stay separated</h2>
 *
 * <p>One-time lines produce one invoice. Recurring lines each become a
 * subscription with its own schedule, and their first charges are grouped by
 * cadence and coverage window into separate recurring invoices. The customer
 * sees "INR 39,300 now" and "INR 3,000 monthly from 1 October" as two facts,
 * because that is what they are.
 *
 * <h2>Charging exactly once</h2>
 *
 * <p>Every charge carries a {@code chargeKey} unique across the database,
 * encoding the subscription and the exact service window. The job can run twice,
 * overlap itself, or catch up after an outage; a repeat attempt hits the unique
 * index and rolls back, so each interval is billed once and only once (test T19).
 */
@Service
public class BillingService {

    private static final Logger log = LoggerFactory.getLogger(BillingService.class);

    private final InvoiceRepository invoices;
    private final InvoiceLineRepository invoiceLines;
    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final ProrationCalculator proration;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;
    private final AppProperties properties;

    public BillingService(InvoiceRepository invoices, InvoiceLineRepository invoiceLines,
                          SubscriptionRepository subscriptions, SubscriptionPlanRepository plans,
                          ProrationCalculator proration, AuditService audit, OutboxWriter outbox,
                          BusinessClock clock, AppProperties properties) {
        this.invoices = invoices;
        this.invoiceLines = invoiceLines;
        this.subscriptions = subscriptions;
        this.plans = plans;
        this.proration = proration;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
        this.properties = properties;
    }

    /** What billing produced for a newly confirmed order. */
    public record BillingResult(UUID oneTimeInvoiceId, List<UUID> subscriptionIds,
                                List<UUID> recurringInvoiceIds, long initialAmountDueMinor) {
    }

    /**
     * Sets up billing for a confirmed order.
     *
     * <p>Runs in the caller's transaction, so a failure here rolls back the order
     * and its reservations too. There is no state in which stock is committed to
     * an order that was never billed.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public BillingResult initializeBilling(Order order, List<OrderLine> orderLines,
                                           InvoicingTerms invoicingTerms,
                                           LocalDate requestedActivationDate, Actor actor) {
        LocalDate businessToday = clock.businessToday();

        // Edge case E16: an activation date that has slipped into the past while
        // the quotation waited for approval is refused. Silently starting today
        // would give away free days; silently charging arrears would bill for
        // service never delivered. Either needs a fresh, valid revision.
        LocalDate activationDate = requestedActivationDate == null ? businessToday : requestedActivationDate;
        if (activationDate.isBefore(businessToday)) {
            throw ApiException.of(ErrorCode.BACKDATED_CHANGE_REJECTED,
                    "The requested activation date has passed. Re-quote with a current start date.",
                    "requestedActivationDate", activationDate.toString(),
                    "businessDate", businessToday.toString());
        }

        UUID oneTimeInvoiceId = createOneTimeInvoice(order, orderLines, invoicingTerms, businessToday, actor);
        SubscriptionSetup setup = createSubscriptions(order, orderLines, activationDate, actor);

        order.setBillingStatus(Order.BillingStatus.INITIALIZED);

        long initialDue = oneTimeInvoiceId == null ? 0L
                : invoices.findById(oneTimeInvoiceId).map(Invoice::getTotalMinor).orElse(0L);

        return new BillingResult(oneTimeInvoiceId, setup.subscriptionIds(),
                setup.invoiceIds(), initialDue);
    }

    // ------------------------------------------------------------- one-time

    private UUID createOneTimeInvoice(Order order, List<OrderLine> orderLines,
                                      InvoicingTerms invoicingTerms, LocalDate businessToday,
                                      Actor actor) {
        List<OrderLine> oneTimeLines = orderLines.stream()
                .filter(line -> line.getLineKind() == LineKind.ONE_TIME)
                .sorted(java.util.Comparator.comparingInt(OrderLine::getPosition))
                .toList();
        if (oneTimeLines.isEmpty()) {
            return null;
        }

        Invoice invoice = newInvoice(order.getCustomerId(), Invoice.InvoiceKind.ONE_TIME,
                order.getCurrency());
        invoice.setOrderId(order.getId());
        invoices.save(invoice);

        int position = 0;
        for (OrderLine line : oneTimeLines) {
            InvoiceLine invoiceLine = new InvoiceLine(invoice.getId(), line.getDescription(),
                    line.getQuantity(), line.getUnitPriceMinor(), line.getNetMinor(),
                    line.getTaxRateBp(), line.getTaxMinor());
            invoiceLine.setOrderLineId(line.getId());
            invoiceLine.setPosition(position++);
            invoiceLine.setLineType(InvoiceLine.LineType.ONE_TIME);
            // Unique across the database: an order line can be invoiced once.
            invoiceLine.setChargeKey(InvoiceLine.oneTimeChargeKey(line.getId()));
            invoiceLines.save(invoiceLine);
            invoice.addLineTotals(line.getNetMinor(), line.getTaxMinor());
        }

        // ON_CONFIRMATION was disclosed in the accepted terms alongside the
        // backorder policy. Issuing an invoice is not taking a payment: nothing
        // is charged to any instrument here.
        if (invoicingTerms == InvoicingTerms.ON_CONFIRMATION) {
            invoice.issue(businessToday, businessToday.plusDays(properties.billing().invoiceDueDays()));
        }

        audit.record(actor, "INVOICE_ISSUED", "Invoice", invoice.getId())
                .order(order.getId())
                .after(Map.of("reference", invoice.getReference(),
                        "totalMinor", invoice.getTotalMinor(), "kind", "ONE_TIME"))
                .save();

        outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                invoice.getRowVersion(), Map.of("orderId", order.getId().toString()),
                OutboxWriter.RecipientScope.deal(order.getCustomerId(), order.getOwnerProfileId(), null));

        return invoice.getId();
    }

    // ------------------------------------------------------------ recurring

    private record SubscriptionSetup(List<UUID> subscriptionIds, List<UUID> invoiceIds) {
    }

    /**
     * Creates one subscription per recurring line and raises its first charge.
     *
     * <p>First charges are grouped by cadence and coverage window, so a customer
     * buying monthly and yearly seats on one order receives one monthly invoice
     * and one yearly invoice, not four unrelated documents.
     */
    private SubscriptionSetup createSubscriptions(Order order, List<OrderLine> orderLines,
                                                  LocalDate activationDate, Actor actor) {
        List<OrderLine> recurringLines = orderLines.stream()
                .filter(line -> line.getLineKind() == LineKind.RECURRING && line.getPlanId() != null)
                .sorted(java.util.Comparator.comparingInt(OrderLine::getPosition))
                .toList();
        if (recurringLines.isEmpty()) {
            return new SubscriptionSetup(List.of(), List.of());
        }

        Map<UUID, SubscriptionPlan> plansById = plans
                .findAllById(recurringLines.stream().map(OrderLine::getPlanId).collect(Collectors.toSet()))
                .stream().collect(Collectors.toMap(SubscriptionPlan::getId, plan -> plan));

        List<UUID> subscriptionIds = new ArrayList<>();
        Map<String, Invoice> invoicesByGroup = new LinkedHashMap<>();
        Map<UUID, Integer> positionByInvoice = new LinkedHashMap<>();

        for (OrderLine line : recurringLines) {
            SubscriptionPlan plan = plansById.get(line.getPlanId());
            if (plan == null) {
                throw ApiException.notFound("Subscription plan " + line.getPlanId());
            }

            int anchorDay = plan.getBillingAnchor() == BillingAnchor.CALENDAR_MONTH_START
                    ? 1 : activationDate.getDayOfMonth();
            LocalDate periodEnd = BusinessCalendar.firstPeriodEnd(
                    activationDate, anchorDay, plan.getIntervalMonths());

            Subscription subscription = new Subscription(
                    nextSubscriptionReference(), order.getId(), line.getId(), order.getCustomerId(),
                    plan.getId(), order.getCurrency(), line.getQuantity(),
                    line.discountedUnitPriceMinor(), plan.getIntervalMonths(), activationDate);
            subscription.setUnitIntervalCostMinor(plan.getIntervalCostMinor());
            subscription.setTaxRateBp(line.getTaxRateBp());
            subscription.setAnchorDay(anchorDay);
            subscription.setBillingAnchor(plan.getBillingAnchor());
            subscription.setProrationPolicy(plan.getProrationPolicy());
            subscription.setCancellationPolicy(plan.getCancellationPolicy());
            subscription.setClawbackPolicy(plan.getClawbackPolicy());
            subscription.setPeriodStart(activationDate);
            subscription.setPeriodEnd(periodEnd);
            subscription.setStatus(Subscription.SubscriptionStatus.ACTIVE);
            // The next charge falls due when this period ends.
            subscription.setNextBillAt(periodEnd);
            subscriptions.save(subscription);
            subscriptionIds.add(subscription.getId());

            // A mid-month start on a calendar-anchored plan is billed only for
            // the days it covers, with the real dates on the line.
            ProrationCalculator.Adjustment firstCharge = proration.firstPeriodCharge(
                    line.getQuantity(), subscription.getUnitIntervalPriceMinor(),
                    activationDate, periodEnd, anchorDay, plan.getIntervalMonths(),
                    subscription.getTaxRateBp());

            String groupKey = plan.getIntervalMonths() + "|" + activationDate + "|" + periodEnd;
            Invoice invoice = invoicesByGroup.computeIfAbsent(groupKey, key -> {
                Invoice created = newInvoice(order.getCustomerId(), Invoice.InvoiceKind.RECURRING,
                        order.getCurrency());
                created.setOrderId(order.getId());
                created.setSubscriptionId(subscription.getId());
                invoices.save(created);
                return created;
            });

            int position = positionByInvoice.merge(invoice.getId(), 0, (existing, ignored) -> existing + 1);
            InvoiceLine invoiceLine = new InvoiceLine(invoice.getId(),
                    line.getDescription() + " (" + BusinessCalendar.cadenceLabel(plan.getIntervalMonths())
                            + ", " + activationDate + " to " + periodEnd + ")",
                    line.getQuantity(), subscription.getUnitIntervalPriceMinor(),
                    firstCharge.netMinor(), subscription.getTaxRateBp(), firstCharge.taxMinor());
            invoiceLine.setSubscriptionId(subscription.getId());
            invoiceLine.setPosition(position);
            invoiceLine.setCoverage(activationDate, periodEnd);
            invoiceLine.setLineType(firstCharge.remainingFraction().compareTo(java.math.BigDecimal.ONE) < 0
                    ? InvoiceLine.LineType.PRORATION : InvoiceLine.LineType.RECURRING);
            invoiceLine.setChargeKey(
                    InvoiceLine.periodChargeKey(subscription.getId(), activationDate, periodEnd));
            invoiceLines.save(invoiceLine);
            invoice.addLineTotals(firstCharge.netMinor(), firstCharge.taxMinor());

            audit.record(actor, "SUBSCRIPTION_CREATED", "Subscription", subscription.getId())
                    .order(order.getId())
                    .after(Map.of("reference", subscription.getReference(),
                            "quantity", line.getQuantity().toPlainString(),
                            "unitIntervalPriceMinor", subscription.getUnitIntervalPriceMinor(),
                            "intervalMonths", plan.getIntervalMonths(),
                            "periodStart", activationDate.toString(),
                            "periodEnd", periodEnd.toString()))
                    .save();
        }

        LocalDate businessToday = clock.businessToday();
        for (Invoice invoice : invoicesByGroup.values()) {
            invoice.issue(businessToday, businessToday.plusDays(properties.billing().invoiceDueDays()));
            outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                    invoice.getRowVersion(), Map.of("orderId", order.getId().toString()),
                    OutboxWriter.RecipientScope.deal(order.getCustomerId(),
                            order.getOwnerProfileId(), null));
        }

        return new SubscriptionSetup(subscriptionIds,
                invoicesByGroup.values().stream().map(Invoice::getId).toList());
    }

    // ------------------------------------------------------- recurring jobs

    /**
     * Raises the next period charge for one due subscription.
     *
     * <p>Called with the subscription already locked. Returns null when the
     * charge already exists, which is the normal outcome of a retry or an
     * overlapping run rather than an error.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public Invoice chargeNextPeriod(Subscription subscription, Actor actor) {
        LocalDate coverageStart = subscription.getPeriodEnd();
        int anchor = subscription.getAnchorDay() == null
                ? coverageStart.getDayOfMonth() : subscription.getAnchorDay();
        LocalDate coverageEnd = BusinessCalendar.nextBoundary(coverageStart, anchor,
                subscription.getIntervalMonths());

        // A subscription set to stop at period end is not renewed.
        if (subscription.getStatus() == Subscription.SubscriptionStatus.CANCEL_AT_PERIOD_END) {
            subscription.setStatus(Subscription.SubscriptionStatus.CANCELED);
            subscription.setCanceledAt(clock.now());
            subscription.setNextBillAt(null);
            audit.recordSystem("SUBSCRIPTION_ENDED", "Subscription", subscription.getId())
                    .after(Map.of("reason", "cancelled at period end"))
                    .save();
            return null;
        }

        String chargeKey = InvoiceLine.periodChargeKey(subscription.getId(), coverageStart, coverageEnd);
        if (invoiceLines.existsByChargeKey(chargeKey)) {
            // Already billed for this window. Advance the schedule and move on:
            // this is what makes a duplicate or overlapping run harmless.
            log.debug("Charge {} already exists; advancing schedule only", chargeKey);
            subscription.setPeriodStart(coverageStart);
            subscription.setPeriodEnd(coverageEnd);
            subscription.setNextBillAt(coverageEnd);
            return null;
        }

        long net = subscription.intervalNetMinor();
        long tax = Money.round(java.math.BigDecimal.valueOf(net)
                .multiply(com.dealflow.shared.money.Bp.fraction(subscription.getTaxRateBp()),
                        Money.CALC));

        Invoice invoice = newInvoice(subscription.getCustomerId(), Invoice.InvoiceKind.RECURRING,
                subscription.getCurrency());
        invoice.setSubscriptionId(subscription.getId());
        invoice.setOrderId(subscription.getOrderId());
        invoices.save(invoice);

        InvoiceLine line = new InvoiceLine(invoice.getId(),
                BusinessCalendar.cadenceLabel(subscription.getIntervalMonths())
                        + " charge, " + coverageStart + " to " + coverageEnd,
                subscription.getQuantity(), subscription.getUnitIntervalPriceMinor(),
                net, subscription.getTaxRateBp(), tax);
        line.setSubscriptionId(subscription.getId());
        line.setCoverage(coverageStart, coverageEnd);
        line.setLineType(InvoiceLine.LineType.RECURRING);
        line.setChargeKey(chargeKey);
        invoiceLines.save(line);
        invoice.addLineTotals(net, tax);

        LocalDate businessToday = clock.businessToday();
        invoice.issue(businessToday, businessToday.plusDays(properties.billing().invoiceDueDays()));

        subscription.setPeriodStart(coverageStart);
        subscription.setPeriodEnd(coverageEnd);
        subscription.setNextBillAt(coverageEnd);

        audit.record(actor, "RECURRING_CHARGE_RAISED", "Invoice", invoice.getId())
                .after(Map.of("subscriptionId", subscription.getId().toString(),
                        "coverageStart", coverageStart.toString(),
                        "coverageEnd", coverageEnd.toString(),
                        "totalMinor", invoice.getTotalMinor()))
                .save();

        outbox.publish(OutboxWriter.Events.INVOICE_UPDATED, "Invoice", invoice.getId(),
                invoice.getRowVersion(),
                Map.of("subscriptionId", subscription.getId().toString()),
                OutboxWriter.RecipientScope.deal(subscription.getCustomerId(), null, null));

        return invoice;
    }

    // -------------------------------------------------------------- helpers

    /** A new invoice with its sequence-issued number and reference. */
    Invoice newInvoice(UUID customerId, Invoice.InvoiceKind kind, String currency) {
        long invoiceNo = subscriptions.nextInvoiceNumber();
        return new Invoice(invoiceNo, "INV-" + invoiceNo, customerId, kind, currency);
    }

    private String nextSubscriptionReference() {
        return "SUB-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(java.util.Locale.ROOT);
    }
}
