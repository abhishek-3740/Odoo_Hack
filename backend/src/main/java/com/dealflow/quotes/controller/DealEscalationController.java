package com.dealflow.quotes.controller;

import com.dealflow.auth.models.Actor;
import com.dealflow.portal.service.DealEscalationService;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.*;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/escalations")
public class DealEscalationController {
    private final DealEscalationService service;
    public DealEscalationController(DealEscalationService service) { this.service=service; }
    @GetMapping
    public ApiResponse<List<DealEscalationService.Escalation>> list(@RequestParam(required=false) UUID quoteId, Actor actor) {
        return ApiResponse.of(service.list(quoteId,actor));
    }
    @PostMapping
    public ApiResponse<DealEscalationService.Escalation> create(@Valid @RequestBody DealEscalationService.Create input, Actor actor) {
        return ApiResponse.of(service.create(input,actor));
    }
    @PostMapping("/{id}/resolutions")
    public ApiResponse<DealEscalationService.Escalation> resolve(@PathVariable UUID id, @Valid @RequestBody DealEscalationService.Resolve input, Actor actor) {
        return ApiResponse.of(service.resolve(id,input,actor));
    }
}
