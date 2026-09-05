package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;

import com.dealflow.auth.controller.DemoAuthController;
import com.dealflow.support.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

class DemoAuthDisabledIT extends AbstractIntegrationTest {
    @Autowired
    ApplicationContext context;

    @Test
    void demoEndpointsAreNotRegisteredWhenDemoAuthIsOff() {
        assertThat(context.getBeansOfType(DemoAuthController.class)).isEmpty();
        assertThat(http.get().uri("/api/v1/auth/demo-accounts").retrieve().toBodilessEntity()
                .getStatusCode().value()).isEqualTo(404);
        assertThat(http.post().uri("/api/v1/auth/demo-token").body(java.util.Map.of("role", "ADMIN"))
                .retrieve().toBodilessEntity().getStatusCode().value()).isEqualTo(404);
    }
}
