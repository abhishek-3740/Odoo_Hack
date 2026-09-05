package com.dealflow.quotes;

import com.dealflow.approvals.ApprovalRequest;
import com.dealflow.approvals.ApprovalRequestRepository;
import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.catalog.CategoryRepository;
import com.dealflow.catalog.Customer;
import com.dealflow.fulfillment.StockAvailabilityService;
import com.dealflow.policy.DiscountPolicyService;
import com.dealflow.quotes.QuoteEnums.BackorderTerms;
import com.dealflow.quotes.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.dto.QuoteDtos.ApprovalStepDto;
import com.dealflow.quotes.dto.QuoteDtos.EvaluatedLine;
import com.dealflow.quotes.dto.QuoteDtos.GateSummary;
import com.dealflow.quotes.dto.QuoteDtos.LineRiskDto;
import com.dealflow.quotes.dto.QuoteDtos.QuoteEvaluationResponse;
import com.dealflow.quotes.dto.QuoteDtos.QuoteLineRequest;
import com.dealflow.quotes.dto.QuoteDtos.RecurringTotal;
import com.dealflow.quotes.dto.QuoteDtos.RiskReasonDto;
import com.dealflow.quotes.dto.QuoteDtos.RiskSummary;
import com.dealflow.quotes.dto.QuoteDtos.StockPreviewDto;
import com.dealflow.quotes.dto.QuoteDtos.Totals;
import com.dealflow.quotes.dto.QuoteDtos.WarehouseStockDto;
import com.dealflow.quotes.engine.PricingEngine;
import com.dealflow.quotes.engine.PricingModel.LineInput;
import com.dealflow.quotes.engine.PricingModel.LineResult;
import com.dealflow.quotes.engine.PricingModel.PricingInput;
import com.dealflow.quotes.engine.PricingModel.PricingResult;
import com.dealflow.quotes.engine.RiskEngine;
import com.dealflow.quotes.engine.RiskModel.LineRisk;
import com.dealflow.quotes.engine.RiskModel.RiskResult;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Turns a quotation into the complete picture a builder screen needs: priced
 * lines, separated totals, the approval route with its reasons, live stock
 * beside each stocked line, and what is still blocking execution.
 *
 * <p>Reads only. Every mutation path calls this to work out <em>what</em> to
 * persist, then persists it, so the evaluation the rep sees before saving and
 * the evaluation stored afterwards come from the same code.
 *
 * <p>Which policy applies depends on the revision's state, and that distinction
 * is the point of versioning policy at all:
 * <ul>
 *   <li>a DRAFT is judged against the policy in force <em>now</em>, so an
 *       administrator's change is visible on the next evaluation;</li>
 *   <li>a SUBMITTED revision is judged against the version snapshotted onto it,
 *       so a later change cannot rewrite a decision already made.</li>
 * </ul>
 */
@Service
public class QuoteEvaluationService {

    private final QuoteLineBuilder lineBuilder;
    private final PricingEngine pricingEngine;
    private final RiskEngine riskEngine;
    private final DiscountPolicyService policyService;
    private final StockAvailabilityService availability;
    private final CategoryRepository categories;
    private final ApprovalRequestRepository approvals;
    private final ProfileRepository profiles;
    private final BusinessClock clock;

    public QuoteEvaluationService(QuoteLineBuilder lineBuilder, PricingEngine pricingEngine,
                                  RiskEngine riskEngine, DiscountPolicyService policyService,
                                  StockAvailabilityService availability, CategoryRepository categories,
                                  ApprovalRequestRepository approvals, ProfileRepository profiles,
                                  BusinessClock clock) {
        this.lineBuilder = lineBuilder;
        this.pricingEngine = pricingEngine;
        this.riskEngine = riskEngine;
        this.policyService = policyService;
        this.availability = availability;
        this.categories = categories;
        this.approvals = approvals;
        this.profiles = profiles;
        this.clock = clock;
    }

    /** Pricing plus risk, with the policy version that produced it. */
    public record Evaluation(PricingResult pricing, RiskResult risk, int policyVersionNo,
                             String policyJson, List<LineInput> lineInputs) {
    }

    /**
     * Prices a set of requested lines against the current catalogue and policy.
     * Used for live evaluation while building and immediately before saving.
     */
    public Evaluation evaluateRequest(Customer customer, List<QuoteLineRequest> lineRequests,
                                      int orderDiscountBp) {
        LocalDate today = clock.businessToday();
        List<LineInput> inputs = lineBuilder.build(customer, lineRequests, today);
        PricingResult pricing = pricingEngine.evaluate(
                new PricingInput(customer.getCurrency(), orderDiscountBp, inputs));

        DiscountPolicyService.EffectivePolicy policy = policyService.effectiveNow();
        RiskResult risk = riskEngine.evaluate(pricing, customer.getTier(),
                policy.definition(), policy.versionNo());
        return new Evaluation(pricing, risk, policy.versionNo(), policy.rawJson(), inputs);
    }

    /**
     * Re-evaluates a revision from its <em>stored</em> lines.
     *
     * <p>Prices come from the frozen line snapshots, never from today's
     * catalogue, so reopening a submitted quotation shows the terms that were
     * actually offered rather than what the same items would cost now.
     */
    public Evaluation evaluateStored(Customer customer, QuoteRevision revision, List<QuoteLine> lines) {
        // Ceilings key on the category CODE. Resolved from the id frozen on the
        // line, so re-categorising a product later cannot change how an already
        // submitted revision was judged. One query, not one per line.
        Map<UUID, String> categoryCodes = categories
                .findAllById(lines.stream().map(QuoteLine::getCategoryId).collect(Collectors.toSet()))
                .stream()
                .collect(Collectors.toMap(com.dealflow.catalog.Category::getId,
                        com.dealflow.catalog.Category::getCode));

        List<LineInput> inputs = lines.stream()
                .sorted(java.util.Comparator.comparingInt(QuoteLine::getPosition))
                .map(line -> new LineInput(
                        line.getLineKey(), line.getPosition(), line.getLineKind(),
                        line.getProductId(), line.getCategoryId(),
                        categoryCodes.getOrDefault(line.getCategoryId(), "UNKNOWN"),
                        line.getVariantId(), line.getPlanId(), line.getDescription(),
                        line.getQuantity(), line.getUnitPriceMinor(), line.getUnitCostMinor(),
                        line.getTaxRateBp(), line.getLineDiscountBp(), line.getIntervalMonths(),
                        line.isRequiresStock(), line.getSource().name()))
                .toList();

        PricingResult pricing = pricingEngine.evaluate(
                new PricingInput(revision.getCurrency(), revision.getOrderDiscountBp(), inputs));

        int policyVersionNo;
        var definition = (com.dealflow.policy.DiscountPolicyDefinition) null;
        String policyJson = revision.getPolicySnapshot();

        if (revision.getStatus() == RevisionStatus.DRAFT || revision.getPolicyVersionNo() == null) {
            DiscountPolicyService.EffectivePolicy current = policyService.effectiveNow();
            policyVersionNo = current.versionNo();
            definition = current.definition();
            policyJson = current.rawJson();
        } else {
            policyVersionNo = revision.getPolicyVersionNo();
            definition = policyJson != null
                    ? policyService.parse(policyJson)
                    : policyService.byVersion(policyVersionNo);
        }

        RiskResult risk = riskEngine.evaluate(pricing, customer.getTier(), definition, policyVersionNo);
        return new Evaluation(pricing, risk, policyVersionNo, policyJson, inputs);
    }

    /**
     * Builds the full API response.
     *
     * @param existingOrderId the order already created from this quotation, if
     *                        any; resolved by the caller so that the quotation
     *                        module does not depend on the orders module
     */
    public QuoteEvaluationResponse toResponse(Quote quote, QuoteRevision revision, Customer customer,
                                              Evaluation evaluation, UUID existingOrderId,
                                              boolean preview) {
        PricingResult pricing = evaluation.pricing();
        RiskResult risk = evaluation.risk();

        List<EvaluatedLine> lines = pricing.lines().stream().map(this::toLineDto).toList();
        List<StockPreviewDto> stockPreview = buildStockPreview(pricing);
        List<ApprovalStepDto> approvalSteps = preview ? List.of() : approvalStepsFor(revision.getId());
        GateSummary gates = buildGates(quote, revision, existingOrderId);

        Profile owner = profiles.findById(quote.getOwnerProfileId()).orElse(null);

        return new QuoteEvaluationResponse(
                quote.getId(), quote.getReference(), quote.getTitle(),
                customer.getId(), customer.getName(), customer.getTier().name(),
                quote.getOwnerProfileId(), quote.getStage().name(), quote.getValidUntil(),
                revision.getId(), revision.getRevisionNo(), revision.getStatus().name(),
                revision.getSource().name(), pricing.currency(), pricing.orderDiscountBp(),
                revision.getBackorderTerms().name(), revision.getInvoicingTerms().name(),
                revision.getRequestedActivationDate(),
                lines, buildTotals(pricing), buildRisk(risk), stockPreview, gates, approvalSteps,
                revision.getCommercialHash(), quote.getRowVersion(), preview);
    }

    // -------------------------------------------------------------- mapping

    private EvaluatedLine toLineDto(LineResult line) {
        return new EvaluatedLine(
                line.lineKey(), line.position(), line.kind().name(),
                line.productId(), line.variantId(), line.planId(), line.categoryCode(),
                line.description(), line.quantity(),
                Money.toMajor(line.unitPriceMinor()), Money.toMajor(line.unitCostMinor()),
                line.taxRateBp(), line.lineDiscountBp(), line.appliedOrderDiscountBp(),
                line.effectiveDiscountBp(),
                Money.toMajor(line.baseMinor()), Money.toMajor(line.netMinor()),
                Money.toMajor(line.taxMinor()), Money.toMajor(line.costTotalMinor()),
                Money.toMajor(line.marginMinor()), line.marginPercent(),
                line.intervalMonths(), line.requiresStock(), null, line.source());
    }

    private Totals buildTotals(PricingResult pricing) {
        List<RecurringTotal> recurring = pricing.recurringByCadence().values().stream()
                .map(group -> new RecurringTotal(group.intervalMonths(), group.cadence(),
                        Money.toMajor(group.netMinor()), Money.toMajor(group.taxMinor()),
                        Money.toMajor(group.costMinor()), Money.toMajor(group.marginMinor()),
                        group.marginPercent()))
                .toList();

        return new Totals(
                pricing.currency(),
                Money.toMajor(pricing.oneTimeNetMinor()),
                Money.toMajor(pricing.oneTimeTaxMinor()),
                Money.toMajor(pricing.oneTimeNetMinor() + pricing.oneTimeTaxMinor()),
                recurring,
                Money.toMajor(pricing.recurringFirstCycleNetMinor()),
                Money.toMajor(pricing.initialAmountDueMinor()),
                Money.toMajor(pricing.comparisonNetMinor()),
                Money.toMajor(pricing.contributionMinor()),
                pricing.contributionPercent(),
                Money.toMajor(pricing.monthlyRecurringRevenueMinor()),
                Money.toMajor(pricing.totalBaseMinor()),
                Money.toMajor(pricing.totalDiscountMinor()));
    }

    private RiskSummary buildRisk(RiskResult risk) {
        List<RiskReasonDto> reasons = risk.reasons().stream()
                .map(reason -> new RiskReasonDto(reason.code(), reason.lineKey(), reason.description(),
                        reason.observedValue(), reason.thresholdValue(), reason.unit(),
                        reason.requiredLevel().name(), reason.message()))
                .toList();

        List<LineRiskDto> lines = risk.lines().stream()
                .map(this::toLineRiskDto)
                .toList();

        return new RiskSummary(risk.requiredLevel().name(), reasons, lines,
                risk.worstLineExcessPp(), risk.weightedExcessPp(),
                Money.toMajor(risk.excessValueMinor()),
                risk.aggregateDiscountPercent(), risk.aggregateMarginPercent(),
                risk.policyVersionNo());
    }

    private LineRiskDto toLineRiskDto(LineRisk line) {
        return new LineRiskDto(line.lineKey(), line.description(), line.categoryCode(),
                line.effectiveDiscountPercent(), line.allowedPercent(), line.excessPp(),
                Money.toMajor(line.excessValueMinor()),
                Money.toMajor(line.marginMinor()), line.marginPercent());
    }

    /**
     * Availability beside each stocked line.
     *
     * <p>Explicitly a preview. Nothing is held, and the shortfall shown here can
     * change before the order is confirmed — which is why confirmation re-reads
     * the same rows under a lock (edge case E10).
     */
    private List<StockPreviewDto> buildStockPreview(PricingResult pricing) {
        Map<UUID, BigDecimal> requestedByVariant = new LinkedHashMap<>();
        List<LineResult> stockedLines = pricing.lines().stream()
                .filter(line -> line.requiresStock() && line.variantId() != null)
                .toList();
        if (stockedLines.isEmpty()) {
            return List.of();
        }
        stockedLines.forEach(line ->
                requestedByVariant.merge(line.variantId(), line.quantity(), BigDecimal::add));

        Map<UUID, StockAvailabilityService.VariantAvailability> stock =
                availability.availabilityFor(Set.copyOf(requestedByVariant.keySet()));

        List<StockPreviewDto> preview = new ArrayList<>(stockedLines.size());
        for (LineResult line : stockedLines) {
            StockAvailabilityService.VariantAvailability variant = stock.get(line.variantId());
            BigDecimal available = variant == null ? BigDecimal.ZERO : variant.totalAvailable();
            BigDecimal shortfall = line.quantity().subtract(available).max(BigDecimal.ZERO);

            List<WarehouseStockDto> byWarehouse = variant == null ? List.of()
                    : variant.byWarehouse().stream()
                            .map(row -> new WarehouseStockDto(row.warehouseId(), row.warehouseCode(),
                                    row.warehouseName(), row.available(), row.expectedReceiptDate()))
                            .toList();

            preview.add(new StockPreviewDto(line.lineKey(), line.variantId(), line.description(),
                    line.quantity(), available, shortfall,
                    variant == null ? null : variant.earliestExpectedReceipt(), byWarehouse));
        }
        return preview;
    }

    /**
     * What still stands between this revision and an order.
     *
     * <p>Approval and customer acceptance are independent and may complete in
     * either order; both must hold, together with seller adoption and validity.
     */
    private GateSummary buildGates(Quote quote, QuoteRevision revision, UUID existingOrderId) {
        List<String> blocking = new ArrayList<>();
        boolean approvalCleared = revision.getApprovalStatus().clearsApprovalGate();
        boolean sellerAdopted = revision.getSellerAdoptedAt() != null;
        boolean customerAccepted = revision.getCustomerAcceptedAt() != null;
        boolean expired = quote.isExpiredOn(clock.businessToday());
        boolean orderExists = existingOrderId != null;

        if (revision.getStatus() != RevisionStatus.SUBMITTED) {
            blocking.add("This version has not been submitted yet.");
        }
        if (!approvalCleared) {
            blocking.add(switch (revision.getApprovalStatus()) {
                case PENDING_MANAGER -> "Waiting for manager approval.";
                case PENDING_FINANCE -> "Waiting for finance approval.";
                case REJECTED -> "This version was rejected.";
                case REVISION_REQUIRED -> "This version was returned for revision.";
                default -> "Approval has not been evaluated yet.";
            });
        }
        if (!sellerAdopted) {
            blocking.add("The sales rep has not adopted these terms.");
        }
        if (!customerAccepted) {
            blocking.add("The customer has not accepted these terms.");
        }
        if (expired) {
            blocking.add("This quotation passed its validity date.");
        }

        boolean ready = !orderExists && blocking.isEmpty();
        if (orderExists) {
            blocking.clear();
            blocking.add("An order already exists for this quotation.");
        }

        return new GateSummary(revision.getApprovalStatus().name(), approvalCleared, sellerAdopted,
                customerAccepted, expired, orderExists, existingOrderId, ready, List.copyOf(blocking));
    }

    private List<ApprovalStepDto> approvalStepsFor(UUID revisionId) {
        List<ApprovalRequest> steps = approvals.findByRevisionIdOrderByStepAsc(revisionId);
        if (steps.isEmpty()) {
            return List.of();
        }
        Set<UUID> profileIds = steps.stream()
                .flatMap(step -> java.util.stream.Stream.of(
                        step.getAssigneeProfileId(), step.getDecidedByProfileId()))
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());
        Map<UUID, Profile> people = profileIds.isEmpty() ? Map.of()
                : profiles.findAllById(profileIds).stream()
                        .collect(Collectors.toMap(Profile::getId, profile -> profile));

        return steps.stream()
                .map(step -> new ApprovalStepDto(step.getId(), step.getStep(),
                        step.getRequiredRole().name(), step.getStatus().name(),
                        step.getAssigneeProfileId(), nameOf(people, step.getAssigneeProfileId()),
                        step.getDueAt(), step.getDecidedByProfileId(),
                        nameOf(people, step.getDecidedByProfileId()),
                        step.getDecidedAt(), step.getDecisionReason()))
                .toList();
    }

    private static String nameOf(Map<UUID, Profile> people, UUID profileId) {
        if (profileId == null) {
            return null;
        }
        Profile profile = people.get(profileId);
        if (profile == null) {
            return null;
        }
        return profile.getFullName() != null ? profile.getFullName() : profile.getEmail();
    }

    public BackorderTerms defaultBackorderTerms() {
        return BackorderTerms.ALLOW_BACKORDER;
    }
}
