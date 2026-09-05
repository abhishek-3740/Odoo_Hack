package com.dealflow.policy.controller;


import com.dealflow.policy.models.*;
import com.dealflow.policy.repo.*;
import com.dealflow.policy.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Discount governance configuration.
 *
 * <p>Publishing creates a new immutable version. The next evaluation uses it;
 * revisions already submitted keep the version they were judged against.
 */
@RestController
@RequestMapping("/api/v1/discount-policies")
public class DiscountPolicyController {

    public record PublishRequest(@NotNull @Valid DiscountPolicyDefinition definition,
                                 @Size(max = 500) String note) {
    }

    public record PolicyResponse(UUID id, int versionNo, DiscountPolicyDefinition definition,
                                 Instant effectiveAt, String note, boolean current) {
    }

    private final DiscountPolicyService policyService;

    public DiscountPolicyController(DiscountPolicyService policyService) {
        this.policyService = policyService;
    }

    /** The version in force now. Managers and administrators may inspect it. */
    @GetMapping("/current")
    public ApiResponse<PolicyResponse> current(Actor actor) {
        requireGovernance(actor);
        var effective = policyService.effectiveNow();
        return ApiResponse.of(new PolicyResponse(null, effective.versionNo(), effective.definition(),
                effective.effectiveAt(), null, true));
    }

    @GetMapping
    public ApiResponse<List<PolicyResponse>> history(Actor actor) {
        requireGovernance(actor);
        int currentVersion = policyService.effectiveNow().versionNo();
        return ApiResponse.of(policyService.history().stream()
                .map(policy -> new PolicyResponse(policy.getId(), policy.getVersionNo(),
                        policyService.parse(policy.getDefinition()), policy.getEffectiveAt(), policy.getNote(),
                        policy.getVersionNo() == currentVersion))
                .toList());
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN','MANAGER')")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<PolicyResponse> publish(@Valid @RequestBody PublishRequest request, Actor actor) {
        DiscountPolicy policy = policyService.publish(actor, request.definition(), request.note());
        return ApiResponse.of(new PolicyResponse(policy.getId(), policy.getVersionNo(), request.definition(),
                policy.getEffectiveAt(), policy.getNote(), true), Map.of("published", true));
    }

    private static void requireGovernance(Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Discount policy is internal.");
        }
    }
}
