package com.dealflow.portal.controller;

import com.dealflow.auth.dto.AuthDtos.ChangePasswordRequest;
import com.dealflow.auth.models.Actor;
import com.dealflow.portal.dto.PortalAccountDtos.AccountResponse;
import com.dealflow.portal.dto.PortalAccountDtos.AccountUpdateRequest;
import com.dealflow.portal.dto.PortalAccountDtos.PreferencesRequest;
import com.dealflow.portal.service.PortalAccountService;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The customer's own profile and settings. */
@RestController
@RequestMapping("/api/v1/portal/account")
@PreAuthorize("hasRole('CUSTOMER')")
public class PortalAccountController {

    private final PortalAccountService accounts;

    public PortalAccountController(PortalAccountService accounts) {
        this.accounts = accounts;
    }

    @GetMapping
    public ApiResponse<AccountResponse> get(Actor actor) {
        return ApiResponse.of(accounts.get(actor));
    }

    @PatchMapping
    public ApiResponse<AccountResponse> update(@Valid @RequestBody AccountUpdateRequest request, Actor actor) {
        return ApiResponse.of(accounts.update(actor, request));
    }

    @PutMapping("/preferences")
    public ApiResponse<AccountResponse> preferences(@Valid @RequestBody PreferencesRequest request, Actor actor) {
        return ApiResponse.of(accounts.updatePreferences(actor, request.preferences()));
    }

    @PostMapping("/password")
    public ApiResponse<Map<String, Object>> changePassword(@Valid @RequestBody ChangePasswordRequest request,
                                                           Actor actor) {
        accounts.changePassword(actor, request.currentPassword(), request.newPassword());
        return ApiResponse.of(Map.of("changed", true));
    }
}
