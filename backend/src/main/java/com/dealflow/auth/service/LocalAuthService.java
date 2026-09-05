package com.dealflow.auth.service;

import com.dealflow.auth.controller.DemoAuthController.AuthTokenResponse;
import com.dealflow.auth.controller.MeController;
import com.dealflow.auth.dto.AuthDtos.RegisterRequest;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Email/password identities for customers who sign up through the storefront.
 *
 * <p>Supabase remains the identity provider for internal staff. This service
 * exists so a prospective customer can create an account and see their own
 * portal without an administrator provisioning them first. The rules that make
 * that safe:
 *
 * <ul>
 *   <li>Signup only ever creates a {@link Role#CUSTOMER} profile bound to a
 *       new customer organisation. No path here grants an internal role.</li>
 *   <li>Tokens are signed with a dedicated secret and issuer, so they can
 *       coexist with Supabase and demo verification without weakening either.
 *       The resource server still reads role, binding and active status from
 *       the database on every request.</li>
 *   <li>Passwords are stored as BCrypt hashes and never logged.</li>
 * </ul>
 */
@Service
public class LocalAuthService {

    private static final Logger log = LoggerFactory.getLogger(LocalAuthService.class);

    public static final String LOCAL_ISSUER = "dealflow-local";
    public static final String LOCAL_AUDIENCE = "dealflow-local";
    public static final String LOCAL_CLAIM = "dealflow_local";
    private static final Duration TOKEN_LIFETIME = Duration.ofDays(7);

    private final AppProperties properties;
    private final ProfileRepository profiles;
    private final CustomerRepository customers;
    private final AuditService audit;
    private final PasswordEncoder encoder = new BCryptPasswordEncoder();

    public LocalAuthService(AppProperties properties, ProfileRepository profiles,
                            CustomerRepository customers, AuditService audit) {
        this.properties = properties;
        this.profiles = profiles;
        this.customers = customers;
        this.audit = audit;
    }

    /**
     * The signing secret: {@code AUTH_LOCAL_JWT_SECRET}, or the demo secret when
     * that is the only one configured. Null when neither is usable.
     */
    public String signingSecret() {
        String local = properties.auth().localJwtSecret();
        if (usable(local)) {
            return local;
        }
        String demo = properties.demo() == null ? null : properties.demo().jwtSecret();
        return usable(demo) ? demo : null;
    }

    public boolean enabled() {
        return signingSecret() != null;
    }

    /** True when this profile can sign in with a password. */
    public boolean hasLocalCredential(Profile profile) {
        return profile != null && profile.getPasswordHash() != null;
    }

    @Transactional
    public AuthTokenResponse register(RegisterRequest request) {
        requireEnabled();
        String email = request.email().trim().toLowerCase(Locale.ROOT);
        if (profiles.findByEmailIgnoreCase(email).isPresent()) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "An account already exists for " + email + ". Sign in instead.");
        }

        Customer customer = new Customer(request.companyName().trim(), CustomerTier.BRONZE, "INR");
        customer.setContactEmail(email);
        customer.setContactPhone(blankToNull(request.phone()));
        // Every customer gets an account manager, so a quotation request has an
        // owner to land with. The first active rep is the default assignee.
        profiles.findActiveByRole(Role.REP).stream().findFirst()
                .ifPresent(rep -> customer.setOwnerRepProfileId(rep.getId()));
        customers.save(customer);

        Profile profile = new Profile(UUID.randomUUID(), email, request.fullName().trim(), Role.CUSTOMER);
        profile.setCustomerId(customer.getId());
        profile.setPhone(blankToNull(request.phone()));
        profile.setPasswordHash(encoder.encode(request.password()));
        profiles.save(profile);

        audit.record(profile.toActor(), "CUSTOMER_REGISTERED", "Profile", profile.getId())
                .after(Map.of("email", email, "customerId", customer.getId().toString(),
                        "customerName", customer.getName()))
                .save();
        log.info("Customer account registered for {} ({})", email, customer.getName());
        return tokenResponse(profile);
    }

    @Transactional(readOnly = true)
    public AuthTokenResponse login(String email, String password) {
        requireEnabled();
        Profile profile = profiles.findByEmailIgnoreCase(email.trim()).orElse(null);
        if (profile == null || !hasLocalCredential(profile) || password == null
                || !encoder.matches(password, profile.getPasswordHash())) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED, "Invalid email or password.");
        }
        if (!profile.isActive()) {
            throw new ApiException(ErrorCode.PROFILE_INACTIVE, "This account is deactivated.");
        }
        return tokenResponse(profile);
    }

    @Transactional
    public void changePassword(Actor actor, String currentPassword, String newPassword) {
        Profile profile = profiles.findById(actor.profileId())
                .orElseThrow(() -> ApiException.notFound("Your profile"));
        if (!hasLocalCredential(profile)) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "This account signs in through an external identity provider; "
                            + "its password is managed there.");
        }
        if (!encoder.matches(currentPassword, profile.getPasswordHash())) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "The current password is incorrect.");
        }
        profile.setPasswordHash(encoder.encode(newPassword));
        audit.record(actor, "PASSWORD_CHANGED", "Profile", profile.getId()).save();
    }

    private AuthTokenResponse tokenResponse(Profile profile) {
        String token = mint(profile);
        return new AuthTokenResponse(profile.getEmail(), profile.getFullName(), profile.getRole().name(),
                "Bearer", token, TOKEN_LIFETIME.toSeconds(),
                MeController.capabilitiesFor(profile.getRole()), null);
    }

    private String mint(Profile profile) {
        try {
            Date now = new Date();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(profile.getAuthUserId().toString())
                    .issuer(LOCAL_ISSUER)
                    .audience(List.of(LOCAL_AUDIENCE))
                    .issueTime(now)
                    .expirationTime(new Date(now.getTime() + TOKEN_LIFETIME.toMillis()))
                    .claim("email", profile.getEmail())
                    .claim("full_name", profile.getFullName() == null ? "" : profile.getFullName())
                    .claim(LOCAL_CLAIM, true)
                    .build();
            SignedJWT jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(signingSecret().getBytes(StandardCharsets.UTF_8)));
            return jwt.serialize();
        } catch (Exception ex) {
            throw new IllegalStateException("Could not sign local token: " + ex.getMessage(), ex);
        }
    }

    private void requireEnabled() {
        if (!enabled()) {
            throw ApiException.forbidden("Email/password sign-in is not configured on this server. "
                    + "Set AUTH_LOCAL_JWT_SECRET (at least 32 bytes).");
        }
    }

    private static boolean usable(String secret) {
        return secret != null && secret.getBytes(StandardCharsets.UTF_8).length >= 32;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
