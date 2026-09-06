package com.dealflow.portal.controller;

import com.dealflow.auth.models.Actor;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteDetail;
import com.dealflow.portal.service.PortalRecommendationService;
import com.dealflow.shared.idempotency.IdempotencyService;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/portal/quotes/{quoteId}")
@PreAuthorize("hasRole('CUSTOMER')")
public class PortalRecommendationController {
    private final PortalRecommendationService recommendations;
    private final IdempotencyService idempotency;
    public PortalRecommendationController(PortalRecommendationService recommendations, IdempotencyService idempotency) {
        this.recommendations = recommendations;
        this.idempotency = idempotency;
    }
    @GetMapping("/recommendations")
    public ApiResponse<PortalRecommendationService.Result> get(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(recommendations.recommend(quoteId, actor));
    }
    @PostMapping("/recommendation-requests")
    public ApiResponse<PortalQuoteDetail> request(@PathVariable UUID quoteId,
            @RequestHeader(value = "Idempotency-Key", required = false) String key,
            @Valid @RequestBody PortalRecommendationService.Request request, Actor actor) {
        return ApiResponse.of(idempotency.execute(actor, "portal-recommendation:" + quoteId, key,
                request, PortalQuoteDetail.class, () -> recommendations.request(quoteId, request, actor)));
    }
}
