package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.models.Role;
import com.dealflow.support.AbstractIntegrationTest;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.context.TestPropertySource;

@TestPropertySource(properties = {
        "dealflow.demo.auth-enabled=true",
        "dealflow.demo.jwt-secret=integration-demo-signing-secret-with-at-least-32-bytes"
})
class DemoAuthEnabledIT extends AbstractIntegrationTest {
    @Test
    void explicitLocalDemoTokenAuthenticatesThroughResourceServer() throws Exception {
        var response = http.post().uri("/api/v1/auth/demo-token").body(Map.of("role", "ADMIN"))
                .retrieve().toEntity(String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        String token = objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
        var me = http.get().uri("/api/v1/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .retrieve().toEntity(String.class);
        assertThat(me.getStatusCode().value()).isEqualTo(200);
        assertThat(objectMapper.readTree(me.getBody()).path("data").path("role").asText()).isEqualTo("ADMIN");
    }

    @Test
    void primarySupabaseStyleTokenStillAuthenticatesWhenDemoAuthIsEnabled() {
        var rep = person("primary-token-rep", Role.REP, null, null);
        var me = get("/api/v1/me", tokenFor(rep)).retrieve().toEntity(String.class);
        assertThat(me.getStatusCode().value()).isEqualTo(200);
        assertThat(objectMapper.readTree(me.getBody()).path("data").path("role").asText()).isEqualTo("REP");
    }

    @Test
    void unknownDemoIdentityIsRejected() {
        assertThat(http.post().uri("/api/v1/auth/demo-token").body(Map.of("email", "unknown@example.test"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(400);
    }
}
