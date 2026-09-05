package com.dealflow.recommendations.controller;


import com.dealflow.recommendations.models.*;
import com.dealflow.recommendations.repo.*;
import com.dealflow.recommendations.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.recommendations.service.RecommendationService.RecommendationResult;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The recommendation panel.
 *
 * <p>Application verifies the saved revision and current eligibility, then
 * delegates to the ordinary quote revision service for pricing and policy checks.
 */
@RestController
@RequestMapping("/api/v1/quotes/{quoteId}")
public class RecommendationController {

    public record DismissRequest(@NotNull UUID variantId) {
    }

    private final RecommendationService recommendations;
    private final DealRecommendationService deals;

    public RecommendationController(RecommendationService recommendations, DealRecommendationService deals) {
        this.recommendations = recommendations;
        this.deals = deals;
    }

    @GetMapping("/recommendations")
    public ApiResponse<DealRecommendationService.Result> recommendations(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(deals.recommend(quoteId, actor));
    }

    @PostMapping("/recommendation-applications")
    public ApiResponse<com.dealflow.quotes.dto.QuoteDtos.QuoteEvaluationResponse> apply(@PathVariable UUID quoteId,
            @Valid @RequestBody DealRecommendationService.Apply request, Actor actor) {
        return ApiResponse.of(deals.apply(quoteId, request, actor));
    }

    @PostMapping("/recommendation-dismissals")
    public ApiResponse<Map<String, Object>> dismiss(@PathVariable UUID quoteId,
                                                    @Valid @RequestBody DismissRequest request, Actor actor) {
        recommendations.dismiss(quoteId, request.variantId(), actor);
        return ApiResponse.of(Map.of("quoteId", quoteId, "variantId", request.variantId(),
                "dismissed", true));
    }
}
