package com.dealflow.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

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
                null
        );

        AppProperties properties = mock(AppProperties.class);
        org.mockito.Mockito.when(properties.auth()).thenReturn(auth);

        profiles = mock(ProfileRepository.class);
        teams = mock(TeamRepository.class);
        customers = mock(CustomerRepository.class);

        service = new DemoTokenService(properties, profiles, teams, customers);
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
}
