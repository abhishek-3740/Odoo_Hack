package com.dealflow.recommendations;

import com.dealflow.auth.Actor;
import com.dealflow.recommendations.RecommendationService.RecommendationResult;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.constraints.NotNull;
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
 * <p>Adding a suggestion is not an endpoint here: the client adds the variant
 * as a normal line through {@code POST /quotes/{id}/revisions}, which prices
 * and risk-checks it exactly like anything else. Only dismissal is its own
 * resource, because it is the one action that is specific to the panel.
 */
@RestController
@RequestMapping("/api/v1/quotes/{quoteId}")
public class RecommendationController {

    public record DismissRequest(@NotNull UUID variantId) {
    }

    private final RecommendationService recommendations;

    public RecommendationController(RecommendationService recommendations) {
        this.recommendations = recommendations;
    }

    @GetMapping("/recommendations")
    public ApiResponse<RecommendationResult> recommendations(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(recommendations.recommend(quoteId, actor));
    }

    @PostMapping("/recommendation-dismissals")
    public ApiResponse<Map<String, Object>> dismiss(@PathVariable UUID quoteId,
                                                    @RequestBody DismissRequest request, Actor actor) {
        recommendations.dismiss(quoteId, request.variantId(), actor);
        return ApiResponse.of(Map.of("quoteId", quoteId, "variantId", request.variantId(),
                "dismissed", true));
    }
}
