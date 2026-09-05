package com.dealflow.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

import com.dealflow.auth.controller.DemoAuthController;
import com.dealflow.auth.service.DemoTokenService;
import com.dealflow.auth.models.DemoAccount;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.catalog.repo.TeamRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.config.AppProperties.Auth;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class DemoTokenServiceTest {

    private DemoTokenService service;
    private ProfileRepository profiles;
    private TeamRepository teams;
    private CustomerRepository customers;
    private AppProperties properties;

    @BeforeEach
    void setUp() {
        Auth auth = new Auth(
                "http://127.0.0.1:54321/auth/v1",
                null,
                "super-secret-jwt-token-with-at-least-32-characters-long",
                "authenticated",
                true,
                60L,
                List.of("http://localhost:3000"),
                true,
                "http://127.0.0.1:54321",
                null,
                null
        );

        properties = mock(AppProperties.class);
        org.mockito.Mockito.when(properties.auth()).thenReturn(auth);
        when(properties.demo()).thenReturn(new AppProperties.Demo(true, false, null, true,
                "demo-signing-secret-with-at-least-32-bytes"));

        profiles = mock(ProfileRepository.class);
        teams = mock(TeamRepository.class);
        customers = mock(CustomerRepository.class);

        when(teams.save(org.mockito.ArgumentMatchers.any())).thenAnswer(call -> call.getArgument(0));
        when(customers.save(org.mockito.ArgumentMatchers.any())).thenAnswer(call -> call.getArgument(0));

        // The bootstrap now runs through its own TransactionTemplate so a lost
        // race on shared reference rows cannot roll back the caller. Here that
        // only needs a manager that hands out a status and accepts a commit.
        org.springframework.transaction.PlatformTransactionManager transactionManager =
                mock(org.springframework.transaction.PlatformTransactionManager.class);
        when(transactionManager.getTransaction(org.mockito.ArgumentMatchers.any()))
                .thenAnswer(call -> new org.springframework.transaction.support.SimpleTransactionStatus());

        service = new DemoTokenService(properties, profiles, teams, customers, transactionManager);
    }

    @Test
    @DisplayName("Generates signed JWT token for demo admin")
    void testTokenGeneration() {
        String token = service.generateToken(DemoTokenService.AUTH_ID_ADMIN, "admin@dealflow.demo", "Demo Admin");
        assertThat(token).isNotBlank();
        assertThat(token.split("\\.")).hasSize(3);
    }

    @Test
    @DisplayName("All 8 demo personas are enumerated with tokens")
    void testGetAllDemoAccounts() {
        List<DemoAccount> accounts = service.getAllDemoAccounts();
        assertThat(accounts).hasSize(8);

        assertThat(accounts).extracting(DemoAccount::email).containsExactlyInAnyOrder(
                "admin@dealflow.demo",
                "rep.a@dealflow.demo",
                "rep.b@dealflow.demo",
                "manager.a@dealflow.demo",
                "manager.backup@dealflow.demo",
                "finance@dealflow.demo",
                "alpha@customer.demo",
                "beta@customer.demo"
        );

        for (DemoAccount acc : accounts) {
            assertThat(acc.token()).isNotBlank();
            assertThat(acc.curlExample()).contains("Authorization: Bearer");
        }
    }

    @Test
    @DisplayName("Authenticates by email and role")
    void testAuthenticateDemo() {
        DemoAuthController.AuthTokenResponse adminResp = service.authenticateDemo(
                new DemoAuthController.DemoTokenRequest("admin@dealflow.demo", null, null));
        assertThat(adminResp.role()).isEqualTo("ADMIN");
        assertThat(adminResp.accessToken()).isNotBlank();

        DemoAuthController.AuthTokenResponse repResp = service.authenticateDemo(
                new DemoAuthController.DemoTokenRequest(null, "REP", null));
        assertThat(repResp.role()).isEqualTo("REP");
        assertThat(repResp.accessToken()).isNotBlank();
    }

    @Test
    void disabledDemoCannotProvisionOrMint() {
        when(properties.demo()).thenReturn(new AppProperties.Demo(false, false, null, false, null));
        assertThatThrownBy(() -> service.getAllDemoAccounts()).hasMessageContaining("disabled");
        assertThatThrownBy(() -> service.generateToken(DemoTokenService.AUTH_ID_ADMIN,
                "admin@dealflow.demo", "Admin")).hasMessageContaining("disabled");
        verifyNoInteractions(profiles, teams, customers);
    }

    @Test
    void hostedJwksAndDedicatedDemoSecretCanCoexist() {
        when(properties.auth()).thenReturn(new Auth("https://project.supabase.co/auth/v1",
                "https://project.supabase.co/auth/v1/.well-known/jwks.json", null,
                "authenticated", true, 60L, List.of("http://localhost:3000"), true, null, null, null));
        assertThat(service.generateToken(DemoTokenService.AUTH_ID_ADMIN,
                "admin@dealflow.demo", "Demo Admin")).isNotBlank();
    }

    @Test
    void missingOrUnknownIdentityDoesNotDefaultToAdmin() {
        assertThatThrownBy(() -> service.authenticateDemo(null)).hasMessageContaining("known demo");
        assertThatThrownBy(() -> service.authenticateDemo(
                new DemoAuthController.DemoTokenRequest("unknown@example.test", null, null)))
                .hasMessageContaining("known demo");
        verifyNoInteractions(profiles, teams, customers);
    }

    @Test
    void demoTokenHasValidSignatureAndExpectedClaims() throws Exception {
        var token = com.nimbusds.jwt.SignedJWT.parse(service.generateToken(
                DemoTokenService.AUTH_ID_ADMIN, "admin@dealflow.demo", "Demo Admin"));
        assertThat(token.verify(new com.nimbusds.jose.crypto.MACVerifier(
                properties.demo().jwtSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8)))).isTrue();
        assertThat(token.getJWTClaimsSet().getSubject()).isEqualTo(DemoTokenService.AUTH_ID_ADMIN.toString());
        assertThat(token.getJWTClaimsSet().getIssuer()).isEqualTo(DemoTokenService.DEMO_ISSUER);
        assertThat(token.getJWTClaimsSet().getAudience()).contains(DemoTokenService.DEMO_AUDIENCE);
        assertThat(token.getJWTClaimsSet().getBooleanClaim("dealflow_demo")).isTrue();
    }
}
