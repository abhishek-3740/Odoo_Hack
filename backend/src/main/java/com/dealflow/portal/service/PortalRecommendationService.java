package com.dealflow.portal.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.portal.dto.PortalDtos;
import com.dealflow.recommendations.service.DealRecommendationService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Ownership checked first; internal pricing results never leave this projection. */
@Service
public class PortalRecommendationService {
    private final PortalService portal;
    private final DealRecommendationService recommendations;
    public PortalRecommendationService(PortalService portal, DealRecommendationService recommendations) {
        this.portal = portal;
        this.recommendations = recommendations;
    }
    public record Offer(UUID variantId, String name, String type, String replaceLineKey,
                        BigDecimal unitPrice, BigDecimal netDelta, String availabilityNote) {}
    public record Result(UUID revisionId, List<Offer> suggestions, boolean limitedHistory) {}
    public record Request(@NotNull UUID variantId, String replaceLineKey, @NotNull UUID expectedRevisionId) {}

    @Transactional(readOnly = true)
    public Result recommend(UUID quoteId, Actor actor) {
        var visible = portal.getQuote(quoteId, actor);
        // Read-only system evaluation after the portal's ownership/share gate. No customer can
        // use this path to call an internal mutation or receive an internal DTO.
        var result = recommendations.recommend(quoteId, Actor.system());
        return new Result(visible.revisionId(), result.suggestions().stream().map(o ->
                new Offer(o.variantId(), o.name(), o.type(), o.replaceLineKey(),
                        o.unitPrice(), o.netDelta(), o.availabilityNote())).toList(), result.limitedHistory());
    }

    @Transactional
    public PortalDtos.PortalQuoteDetail request(UUID id, Request request, Actor actor) {
        var result = recommend(id, actor);
        if (!result.revisionId().equals(request.expectedRevisionId()))
            throw new ApiException(ErrorCode.CONFLICTING_STATE, "Quotation changed. Refresh offers before requesting.");
        var offer = result.suggestions().stream().filter(o -> o.variantId().equals(request.variantId())
                && Objects.equals(o.replaceLineKey(), request.replaceLineKey())).findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.CONFLICTING_STATE, "This offer is no longer available."));
        String message = "Please review " + (offer.type().equals("UPSELL") ? "an upgrade to " : "adding ")
                + offer.name() + " (variant " + offer.variantId() + "). Please send revised terms for my acceptance.";
        return portal.submitRequest(id, new PortalDtos.PortalRequest("COMMENT",
                offer.replaceLineKey(), message, null, null, result.revisionId()), actor);
    }
}
