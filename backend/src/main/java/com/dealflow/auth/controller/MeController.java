package com.dealflow.auth.controller;


import com.dealflow.auth.models.*;
import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Role;
import com.dealflow.shared.web.ApiResponse;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Who am I, and what may I do — as the server sees it. */
@RestController
@RequestMapping("/api/v1/me")
public class MeController {

    /**
     * Capabilities are computed here from the database role, so the frontend
     * shows the right controls. They are a courtesy to the UI; every endpoint
     * enforces the same rules again on its own.
     */
    public record MeResponse(UUID profileId, String email, String role, UUID teamId, UUID customerId,
                             boolean internal, List<String> capabilities) {
    }

    @GetMapping
    public ApiResponse<MeResponse> me(Actor actor) {
        return ApiResponse.of(new MeResponse(actor.profileId(), actor.email(), actor.role().name(),
                actor.teamId(), actor.customerId(), actor.isInternal(), capabilitiesFor(actor.role())));
    }

    private static List<String> capabilitiesFor(Role role) {
        return switch (role) {
            case REP -> List.of("quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share",
                    "quotes:adopt", "recommendations:read", "reports:own", "alerts:own");
            case MANAGER -> List.of("quotes:read-team", "approvals:manager", "policy:read",
                    "reports:team", "alerts:team", "alerts:nudge");
            case FINANCE -> List.of("quotes:read-all", "approvals:finance", "allocations:override",
                    "stock:receive", "shipments:dispatch", "payments:record", "refunds:record",
                    "subscriptions:change", "reports:all", "alerts:all", "jobs:run");
            case ADMIN -> List.of("admin:catalog", "admin:policy", "admin:warehouses", "admin:plans",
                    "admin:profiles", "approvals:reassign", "quotes:read-all", "reports:all",
                    "alerts:all", "jobs:run", "stock:receive", "allocations:override");
            case CUSTOMER -> List.of("portal:quotes", "portal:negotiate", "portal:accept",
                    "portal:invoices");
        };
    }
}
