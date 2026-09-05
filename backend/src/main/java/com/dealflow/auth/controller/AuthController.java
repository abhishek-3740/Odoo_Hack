package com.dealflow.auth.controller;

import com.dealflow.auth.controller.DemoAuthController.AuthTokenResponse;
import com.dealflow.auth.controller.DemoAuthController.DemoTokenRequest;
import com.dealflow.auth.dto.AuthDtos.LoginRequest;
import com.dealflow.auth.dto.AuthDtos.RegisterRequest;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.service.DemoTokenService;
import com.dealflow.auth.service.LocalAuthService;
import com.dealflow.config.AppProperties;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public sign-in and sign-up.
 *
 * <p>{@code /login} serves two kinds of identity behind one form: accounts that
 * registered here with a password, and — when demo authentication is switched
 * on — the pre-seeded demo personas. A profile that has a password hash is
 * always verified against it; the demo shortcut never overrides a real
 * credential.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final LocalAuthService localAuth;
    private final DemoTokenService demoTokens;
    private final ProfileRepository profiles;
    private final AppProperties properties;

    public AuthController(LocalAuthService localAuth, DemoTokenService demoTokens,
                          ProfileRepository profiles, AppProperties properties) {
        this.localAuth = localAuth;
        this.demoTokens = demoTokens;
        this.profiles = profiles;
        this.properties = properties;
    }

    /** What the sign-in page may offer, so it does not render a form that cannot work. */
    @GetMapping("/options")
    public ApiResponse<Map<String, Object>> options() {
        boolean demo = properties.demo() != null && properties.demo().authEnabled();
        return ApiResponse.of(Map.of(
                "passwordLogin", localAuth.enabled(),
                "selfRegistration", localAuth.enabled(),
                "demoPersonas", demo));
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<AuthTokenResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ApiResponse.of(localAuth.register(request));
    }

    @PostMapping("/login")
    public ApiResponse<AuthTokenResponse> login(@Valid @RequestBody LoginRequest request) {
        Profile profile = profiles.findByEmailIgnoreCase(request.email().trim()).orElse(null);
        if (localAuth.hasLocalCredential(profile)) {
            return ApiResponse.of(localAuth.login(request.email(), request.password()));
        }
        boolean demoEnabled = properties.demo() != null && properties.demo().authEnabled();
        if (demoEnabled && demoTokens.isDemoPersona(request.email())) {
            return ApiResponse.of(demoTokens.authenticateDemo(
                    new DemoTokenRequest(request.email(), null, request.password())));
        }
        throw new ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.");
    }
}
