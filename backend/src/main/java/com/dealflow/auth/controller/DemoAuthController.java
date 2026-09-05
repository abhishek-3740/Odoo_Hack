package com.dealflow.auth.controller;


import com.dealflow.auth.models.*;
import com.dealflow.auth.repo.*;
import com.dealflow.auth.service.*;
import com.dealflow.auth.models.DemoAccount;
import com.dealflow.auth.service.DemoTokenService;
import com.dealflow.shared.web.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public authentication endpoints for Postman and integration verification.
 * Provides 1-click token retrieval and login for all DealFlow360 demo personas.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class DemoAuthController {

    private final DemoTokenService demoTokenService;

    public DemoAuthController(DemoTokenService demoTokenService) {
        this.demoTokenService = demoTokenService;
    }

    public record DemoTokenRequest(String email, String role, String password) {
    }

    public record AuthTokenResponse(
            String email,
            String fullName,
            String role,
            String tokenType,
            String accessToken,
            long expiresIn,
            List<String> capabilities,
            String sampleCurl
    ) {
    }

    /**
     * Lists all available demo accounts, complete with pre-minted Bearer tokens
     * and ready-to-execute curl commands for Postman.
     */
    @GetMapping("/demo-accounts")
    public ApiResponse<List<DemoAccount>> listDemoAccounts() {
        return ApiResponse.of(demoTokenService.getAllDemoAccounts());
    }

    /**
     * Mints a fresh 30-day Bearer token for a demo account by email or role.
     * Example body: { "email": "admin@dealflow.demo" } or { "role": "ADMIN" }
     */
    @PostMapping("/demo-token")
    public ApiResponse<AuthTokenResponse> mintDemoToken(@RequestBody(required = false) DemoTokenRequest request) {
        return ApiResponse.of(demoTokenService.authenticateDemo(request));
    }

    /**
     * Standard credentials login endpoint for Postman collections.
     * Accepts: { "email": "admin@dealflow.demo", "password": "demo" }
     */
    @PostMapping("/login")
    public ApiResponse<AuthTokenResponse> login(@RequestBody(required = false) DemoTokenRequest request) {
        return ApiResponse.of(demoTokenService.authenticateDemo(request));
    }
}
