package com.dealflow.billing.controller;

import com.dealflow.auth.models.Actor;
import com.dealflow.billing.dto.BillingDtos.PlanChangeRequest;
import com.dealflow.billing.service.PlanSwitchService;
import com.dealflow.shared.idempotency.IdempotencyService;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/subscriptions/{id}")
@PreAuthorize("hasAnyRole('FINANCE','ADMIN')")
public class PlanSwitchController {
    private final PlanSwitchService plans;
    private final IdempotencyService idempotency;
    public PlanSwitchController(PlanSwitchService plans,IdempotencyService idempotency) {this.plans=plans;this.idempotency=idempotency;}
    @PostMapping("/plan-change-previews")
    public ApiResponse<PlanSwitchService.Preview> preview(@PathVariable UUID id,@Valid @RequestBody PlanChangeRequest request) { return ApiResponse.of(plans.preview(id,request)); }
    @PostMapping("/plan-changes")
    public ApiResponse<PlanSwitchService.Preview> change(@PathVariable UUID id,@Valid @RequestBody PlanChangeRequest request,
            @RequestHeader(value="Idempotency-Key",required=false) String key,Actor actor) {
        return ApiResponse.of(idempotency.execute(actor,"plan-switch:"+id,key,request,PlanSwitchService.Preview.class,() -> plans.apply(id,request,key,actor)));
    }
}
