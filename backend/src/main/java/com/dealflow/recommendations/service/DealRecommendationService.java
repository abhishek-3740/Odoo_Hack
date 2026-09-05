package com.dealflow.recommendations.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.config.AppProperties;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.catalog.repo.ProductVariantRepository;
import com.dealflow.quotes.dto.QuoteDtos.*;
import com.dealflow.quotes.models.QuoteEnums.BackorderTerms;
import com.dealflow.quotes.service.QuoteService;
import com.dealflow.recommendations.repo.RecommendationDismissalRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Recommendations propose terms; the ordinary quote service owns every commercial mutation. */
@Service
public class DealRecommendationService {
    private final RecommendationService recommendations;
    private final QuoteService quotes;
    private final ProductVariantRepository variants;
    private final RecommendationDismissalRepository dismissals;
    private final AppProperties properties;

    public DealRecommendationService(RecommendationService recommendations, QuoteService quotes,
            ProductVariantRepository variants, RecommendationDismissalRepository dismissals, AppProperties properties) {
        this.recommendations = recommendations;
        this.quotes = quotes;
        this.variants = variants;
        this.dismissals = dismissals;
        this.properties = properties;
    }

    public record Offer(UUID variantId, String name, String type, String replaceLineKey,
            String reason, String basis, boolean promoted, BigDecimal unitPrice,
            BigDecimal netDelta, BigDecimal contributionDelta, BigDecimal marginPercentDelta,
            String requiredApproval, String availabilityNote, boolean inStock) {}
    public record Result(UUID revisionId, long rowVersion, List<Offer> suggestions,
            boolean limitedHistory, String note, long eligibleHistoricalOrders) {}
    public record Apply(@NotNull UUID variantId, String replaceLineKey,
            @NotNull UUID expectedRevisionId, @NotNull Long expectedRowVersion) {}

    @Transactional(readOnly = true)
    public Result recommend(UUID quoteId, Actor actor) {
        var current = quotes.get(quoteId, actor);
        var base = recommendations.recommend(quoteId, actor);
        if (current.gates().orderExists() || Set.of("CONFIRMED", "CANCELED", "LOST", "EXPIRED").contains(current.stage()))
            return new Result(current.revisionId(), current.rowVersion(), List.of(), base.limitedHistory(), "This quotation is closed. Recommendations are available on open deals.", base.eligibleHistoricalOrders());
        List<Offer> offers = new ArrayList<>();
        for (var suggestion : base.suggestions()) {
            preview(quoteId, current, suggestion.variantId(), null, suggestion.reason(),
                    suggestion.basis(), suggestion.promoted(), actor).ifPresent(offers::add);
        }
        Set<UUID> dismissed = new HashSet<>();
        dismissals.findByRevisionId(current.revisionId()).forEach(d -> dismissed.add(d.getVariantId()));
        Set<UUID> inCart = new HashSet<>();
        current.lines().forEach(l -> inCart.add(l.variantId()));
        var candidates = variants.findAll().stream().filter(ProductVariant::isActive)
                .filter(v -> !dismissed.contains(v.getId()) && !inCart.contains(v.getId()))
                .sorted(Comparator.comparing(ProductVariant::getSku)).toList();
        int upgrades = 0;
        for (var line : current.lines()) {
            if (line.variantId() == null || upgrades >= 5) continue;
            var original = variants.findById(line.variantId()).orElse(null);
            if (original == null || original.getSubstitutionGroup() == null
                    || original.getSubstitutionGroup().isBlank()) continue;
            for (var candidate : candidates) {
                if (upgrades >= 5) break;
                if (!original.getSubstitutionGroup().equals(candidate.getSubstitutionGroup())) continue;
                var offer = preview(quoteId, current, candidate.getId(), line.lineKey(),
                        "Configured compatible replacement for " + line.description()
                                + ". Review the higher price and specifications before applying.",
                        "COMPATIBLE_UPGRADE", false, actor);
                if (offer.isPresent() && offer.get().unitPrice().compareTo(line.unitPrice()) > 0) {
                    offers.add(offer.get());
                    upgrades++;
                }
            }
        }
        return new Result(current.revisionId(), current.rowVersion(), offers,
                base.limitedHistory(), base.note(), base.eligibleHistoricalOrders());
    }

    private Optional<Offer> preview(UUID id, QuoteEvaluationResponse current, UUID variantId,
            String replaceLineKey, String reason, String basis, boolean promoted, Actor actor) {
        if (current.lines().isEmpty() || current.gates().orderExists()) return Optional.empty();
        try {
            var draft = draft(current, variantId, replaceLineKey, current.rowVersion());
            var evaluated = quotes.evaluate(id, draft, actor);
            var line = evaluated.lines().stream().filter(l -> variantId.equals(l.variantId())).findFirst().orElseThrow();
            if (line.margin().signum() < 0 || line.marginPercent() == null
                    || line.marginPercent().compareTo(properties.recommendations().minimumCandidateMarginPercent()) < 0) return Optional.empty();
            var stock = evaluated.stockPreview().stream().filter(s -> variantId.equals(s.variantId())).findFirst();
            boolean inStock = stock.isEmpty() || stock.get().shortfall().signum() == 0;
            BigDecimal marginDelta = current.totals().contributionPercent() == null
                    || evaluated.totals().contributionPercent() == null ? null
                    : evaluated.totals().contributionPercent().subtract(current.totals().contributionPercent());
            return Optional.of(new Offer(variantId, line.description(), replaceLineKey == null ? "CROSS_SELL" : "UPSELL",
                    replaceLineKey, reason, basis, promoted, line.unitPrice(),
                    evaluated.totals().comparisonNet().subtract(current.totals().comparisonNet()),
                    evaluated.totals().contribution().subtract(current.totals().contribution()), marginDelta,
                    evaluated.risk().requiredLevel(), inStock ? "Available for requested quantity" : "Shortfall — would be backordered", inStock));
        } catch (ApiException ex) {
            return Optional.empty(); // Inactive or unpriceable products cannot be offered.
        }
    }

    @Transactional
    public QuoteEvaluationResponse apply(UUID id, Apply request, Actor actor) {
        var current = quotes.get(id, actor);
        if (!current.revisionId().equals(request.expectedRevisionId()) || current.rowVersion() != request.expectedRowVersion()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE, "Quotation changed. Refresh recommendations before applying.");
        }
        boolean offered = recommend(id, actor).suggestions().stream().anyMatch(o ->
                o.variantId().equals(request.variantId()) && Objects.equals(o.replaceLineKey(), request.replaceLineKey()));
        if (!offered) throw new ApiException(ErrorCode.CONFLICTING_STATE, "This recommendation is no longer eligible.");
        return quotes.saveDraft(id, draft(current, request.variantId(), request.replaceLineKey(), request.expectedRowVersion()), actor);
    }

    private QuoteDraftRequest draft(QuoteEvaluationResponse current, UUID variantId, String replaceKey, long version) {
        List<QuoteLineRequest> lines = new ArrayList<>();
        for (var line : current.lines()) {
            boolean replace = Objects.equals(line.lineKey(), replaceKey);
            lines.add(new QuoteLineRequest(line.lineKey(), replace ? variantId : line.variantId(),
                    replace ? null : line.planId(), line.quantity(), line.lineDiscountBp(), line.promisedDate(),
                    replace ? "UPSELL" : line.source()));
        }
        if (replaceKey == null) lines.add(new QuoteLineRequest(UUID.randomUUID().toString(), variantId,
                null, BigDecimal.ONE, 0, null, "CROSS_SELL"));
        return new QuoteDraftRequest(lines, current.orderDiscountBp(), BackorderTerms.valueOf(current.backorderTerms()),
                current.requestedActivationDate(), version);
    }
}
