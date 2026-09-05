package com.dealflow.auth.service;


import com.dealflow.auth.models.*;
import com.dealflow.auth.repo.*;
import com.dealflow.auth.controller.*;
import com.dealflow.auth.models.DemoAccount;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.models.Role;
import com.dealflow.auth.controller.DemoAuthController;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.catalog.models.Team;
import com.dealflow.catalog.repo.TeamRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service for minting verified Bearer JWT tokens for DealFlow360 demo accounts.
 * Enables zero-setup API testing in Postman, curl, or automated test runners.
 */
@Service
public class DemoTokenService {

    private static final Logger log = LoggerFactory.getLogger(DemoTokenService.class);
    public static final String DEMO_ISSUER = "dealflow-demo";
    public static final String DEMO_AUDIENCE = "dealflow-demo";

    private final AppProperties properties;
    private final ProfileRepository profiles;
    private final TeamRepository teams;
    private final CustomerRepository customers;

    // Deterministic UUIDs for demo auth users
    public static final UUID AUTH_ID_ADMIN = UUID.fromString("00000000-0000-4000-8000-000000000001");
    public static final UUID AUTH_ID_REP_A = UUID.fromString("00000000-0000-4000-8000-000000000002");
    public static final UUID AUTH_ID_REP_B = UUID.fromString("00000000-0000-4000-8000-000000000003");
    public static final UUID AUTH_ID_MANAGER_A = UUID.fromString("00000000-0000-4000-8000-000000000004");
    public static final UUID AUTH_ID_MANAGER_BACKUP = UUID.fromString("00000000-0000-4000-8000-000000000005");
    public static final UUID AUTH_ID_FINANCE = UUID.fromString("00000000-0000-4000-8000-000000000006");
    public static final UUID AUTH_ID_ALPHA = UUID.fromString("00000000-0000-4000-8000-000000000007");
    public static final UUID AUTH_ID_BETA = UUID.fromString("00000000-0000-4000-8000-000000000008");

    public record DemoPersonaSpec(
            String email,
            String fullName,
            Role role,
            String description,
            UUID authUserId,
            String teamName,
            String customerName,
            List<String> capabilities
    ) {}

    private static final List<DemoPersonaSpec> SPECS = List.of(
            new DemoPersonaSpec(
                    "admin@dealflow.demo",
                    "Demo Admin",
                    Role.ADMIN,
                    "System Administrator with full permissions across master catalog, governance policies, user management, approval reassignment, reports, and jobs",
                    AUTH_ID_ADMIN,
                    null,
                    null,
                    List.of("admin:catalog", "admin:policy", "admin:warehouses", "admin:plans", "admin:profiles",
                            "approvals:reassign", "quotes:read-all", "reports:all", "alerts:all", "jobs:run")
            ),
            new DemoPersonaSpec(
                    "rep.a@dealflow.demo",
                    "Rep A (Sales)",
                    Role.REP,
                    "Commercial Sales Representative for Alpha Traders, Beta Systems, and Delta Logistics",
                    AUTH_ID_REP_A,
                    "Sales East",
                    null,
                    List.of("quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share", "quotes:adopt",
                            "recommendations:read", "reports:own", "alerts:own")
            ),
            new DemoPersonaSpec(
                    "rep.b@dealflow.demo",
                    "Rep B (Sales)",
                    Role.REP,
                    "Commercial Sales Representative for Gamma Retail and Epsilon Labs",
                    AUTH_ID_REP_B,
                    "Sales East",
                    null,
                    List.of("quotes:create", "quotes:edit-own", "quotes:submit", "quotes:share", "quotes:adopt",
                            "recommendations:read", "reports:own", "alerts:own")
            ),
            new DemoPersonaSpec(
                    "manager.a@dealflow.demo",
                    "Manager A",
                    Role.MANAGER,
                    "Sales Manager reviewing Step 1 discount approvals, team velocity, and margin compliance",
                    AUTH_ID_MANAGER_A,
                    "Sales East",
                    null,
                    List.of("quotes:read-team", "approvals:manager", "policy:read", "reports:team", "alerts:team", "alerts:nudge")
            ),
            new DemoPersonaSpec(
                    "manager.backup@dealflow.demo",
                    "Backup Manager",
                    Role.MANAGER,
                    "Delegated approver covering Manager A approval queue during leave windows (E07)",
                    AUTH_ID_MANAGER_BACKUP,
                    "Sales East",
                    null,
                    List.of("quotes:read-team", "approvals:manager", "policy:read", "reports:team", "alerts:team")
            ),
            new DemoPersonaSpec(
                    "finance@dealflow.demo",
                    "Finance Ops",
                    Role.FINANCE,
                    "Finance Controller approving Step 2 high-concession deals, recording payments, and dispatching shipments",
                    AUTH_ID_FINANCE,
                    null,
                    null,
                    List.of("quotes:read-all", "approvals:finance", "allocations:override", "stock:receive",
                            "shipments:dispatch", "payments:record", "refunds:record", "subscriptions:change", "reports:all")
            ),
            new DemoPersonaSpec(
                    "alpha@customer.demo",
                    "Alpha Buyer",
                    Role.CUSTOMER,
                    "Client buyer contact for Alpha Traders (Bronze Tier) with access to proposal counter-negotiation and acceptance",
                    AUTH_ID_ALPHA,
                    null,
                    "Alpha Traders",
                    List.of("portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices")
            ),
            new DemoPersonaSpec(
                    "beta@customer.demo",
                    "Beta Buyer",
                    Role.CUSTOMER,
                    "Client buyer contact for Beta Systems (Gold Tier) with access to proposal counter-negotiation and acceptance",
                    AUTH_ID_BETA,
                    null,
                    "Beta Systems",
                    List.of("portal:quotes", "portal:negotiate", "portal:accept", "portal:invoices")
            )
    );

    /** Runs the bootstrap in its own transaction so a lost race cannot poison the caller's. */
    private final org.springframework.transaction.support.TransactionTemplate ownTransaction;

    public DemoTokenService(AppProperties properties,
                            ProfileRepository profiles,
                            TeamRepository teams,
                            CustomerRepository customers,
                            org.springframework.transaction.PlatformTransactionManager transactionManager) {
        this.properties = properties;
        this.profiles = profiles;
        this.teams = teams;
        this.customers = customers;
        this.ownTransaction =
                new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(
                org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    /**
     * Mint an authentic HS256 JWT accepted by the Spring Security OAuth2 resource server.
     */
    public String generateToken(UUID authUserId, String email, String fullName) {
        requireDemoAuthEnabled();
        String secret = properties.demo().jwtSecret();

        try {
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .subject(authUserId.toString())
                    .issuer(DEMO_ISSUER)
                    .audience(List.of(DEMO_AUDIENCE))
                    .issueTime(new Date())
                    .expirationTime(new Date(System.currentTimeMillis() + 30L * 86400000L)) // 30 days
                    .claim("email", email)
                    .claim("full_name", fullName != null ? fullName : "")
                    .claim("role", "authenticated")
                    .claim("dealflow_demo", true)
                    .build();

            SignedJWT signedJWT = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            signedJWT.sign(new MACSigner(secret.getBytes(StandardCharsets.UTF_8)));
            return signedJWT.serialize();
        } catch (Exception ex) {
            log.error("Failed to sign demo token for {}", email, ex);
            throw new IllegalStateException("Could not generate demo JWT token: " + ex.getMessage(), ex);
        }
    }

    /**
     * Returns all available demo accounts, each pre-populated with an active JWT token.
     */
    @Transactional
    public List<DemoAccount> getAllDemoAccounts() {
        ensureDemoProfilesReady();
        List<DemoAccount> accounts = new ArrayList<>();
        for (DemoPersonaSpec spec : SPECS) {
            String token = generateToken(spec.authUserId(), spec.email(), spec.fullName());
            String curl = "curl -X GET http://localhost:8080/api/v1/me -H \"Authorization: Bearer " + token + "\"";
            accounts.add(new DemoAccount(
                    spec.email(),
                    spec.fullName(),
                    spec.role(),
                    spec.description(),
                    spec.authUserId(),
                    spec.teamName(),
                    spec.customerName(),
                    spec.capabilities(),
                    token,
                    curl
            ));
        }
        return accounts;
    }

    /**
     * Authenticates a demo account request by email or role, returning a Bearer access token.
     */
    @Transactional
    public DemoAuthController.AuthTokenResponse authenticateDemo(DemoAuthController.DemoTokenRequest req) {
        requireDemoAuthEnabled();
        DemoPersonaSpec matched = null;

        if (req != null) {
            if (req.email() != null && !req.email().isBlank()) {
                String search = req.email().trim().toLowerCase();
                matched = SPECS.stream()
                        .filter(s -> s.email().equalsIgnoreCase(search))
                        .findFirst()
                        .orElse(null);
            }
            if (matched == null && req.role() != null && !req.role().isBlank()) {
                String searchRole = req.role().trim().toUpperCase();
                matched = SPECS.stream()
                        .filter(s -> s.role().name().equalsIgnoreCase(searchRole))
                        .findFirst()
                        .orElse(null);
            }
        }

        if (matched == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Choose a known demo email or role. This endpoint is not a Supabase password login.");
        }

        ensureDemoProfilesReady();
        String token = generateToken(matched.authUserId(), matched.email(), matched.fullName());
        String curl = "curl -X GET http://localhost:8080/api/v1/me -H \"Authorization: Bearer " + token + "\"";

        return new DemoAuthController.AuthTokenResponse(
                matched.email(),
                matched.fullName(),
                matched.role().name(),
                "Bearer",
                token,
                2592000L, // 30 days in seconds
                matched.capabilities(),
                curl
        );
    }

    /**
     * Ensures all demo profiles and organizational bindings are present in dealflow.profiles.
     *
     * <p>The reference rows here — the "Sales East" team, the two demo customers
     * — are also created by {@code DemoDataSeeder}, which runs after Tomcat has
     * already started accepting requests. A sign-in during that window read no
     * team, tried to insert one, and lost to the seeder's commit on the unique
     * constraint, surfacing as a meaningless 409. Two parallel first sign-ins
     * race the same way.
     *
     * <p>So the bootstrap runs in its own transaction: a lost race rolls back
     * only that transaction, never the caller's, and re-reading afterwards sees
     * the winner's committed row. One retry is enough — the second attempt finds
     * every row present and inserts nothing.
     */
    public void ensureDemoProfilesReady() {
        requireDemoAuthEnabled();
        try {
            ownTransaction.executeWithoutResult(status -> bootstrapDemoIdentities());
        } catch (org.springframework.dao.DataAccessException race) {
            ownTransaction.executeWithoutResult(status -> bootstrapDemoIdentities());
        }
    }

    private void bootstrapDemoIdentities() {
        Team defaultTeam = teams.findByName("Sales East")
                .orElseGet(() -> teams.save(new Team("Sales East")));
        Customer alphaCustomer = customers.findByNameIgnoreCase("Alpha Traders")
                .orElseGet(() -> customers.save(new Customer("Alpha Traders", CustomerTier.BRONZE, "INR")));
        Customer betaCustomer = customers.findByNameIgnoreCase("Beta Systems")
                .orElseGet(() -> customers.save(new Customer("Beta Systems", CustomerTier.GOLD, "INR")));
        for (DemoPersonaSpec spec : SPECS) {
            Profile profile = profiles.findByEmailIgnoreCase(spec.email()).orElse(null);
            if (profile == null) {
                profile = new Profile(spec.authUserId(), spec.email(), spec.fullName(), spec.role());
                if (spec.teamName() != null) profile.setTeamId(defaultTeam.getId());
                if ("Alpha Traders".equals(spec.customerName())) profile.setCustomerId(alphaCustomer.getId());
                else if ("Beta Systems".equals(spec.customerName())) profile.setCustomerId(betaCustomer.getId());
                profiles.save(profile);
                log.info("Demo account provisioned: {} ({})", spec.email(), spec.role());
            } else if (profile.getAuthUserId() == null) {
                profile.setAuthUserId(spec.authUserId());
                profiles.save(profile);
            }
        }
    }

    /** Whether this email belongs to one of the pre-seeded demo personas. */
    public boolean isDemoPersona(String email) {
        if (email == null || email.isBlank()) {
            return false;
        }
        String search = email.trim();
        return SPECS.stream().anyMatch(spec -> spec.email().equalsIgnoreCase(search));
    }

    /** Demo tokens have a dedicated signing key and are deliberately opt-in. */
    private void requireDemoAuthEnabled() {
        if (properties.demo() == null || !properties.demo().authEnabled()) {
            throw ApiException.forbidden("Demo authentication is disabled.");
        }
        String secret = properties.demo().jwtSecret();
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw ApiException.forbidden("Demo authentication needs a DEMO_JWT_SECRET of at least 32 bytes.");
        }
    }
}
