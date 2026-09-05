package com.dealflow.assistant;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;
import com.dealflow.shared.error.ApiException;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.http.*;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

class SarvamClientTest {
    private MockRestServiceServer server;
    private SarvamClient client;
    @BeforeEach void setup() {
        var builder=RestClient.builder().defaultStatusHandler(status -> true, (request,response) -> {});
        server=MockRestServiceServer.bindTo(builder).build();
        client=new SarvamClient(new ObjectMapper(),"test-only-key","sarvam-105b","https://provider.test/chat",builder.build());
    }
    private List<Map<String,String>> messages() { return List.of(Map.of("role","user","content","Explain my quote")); }
    @Test void sendsProviderHeaderAndExplicitNoReasoningAndReturnsOnlyFinalAnswer() {
        server.expect(requestTo("https://provider.test/chat")).andExpect(method(HttpMethod.POST))
                .andExpect(header("api-subscription-key","test-only-key"))
                .andExpect(content().json("{\"model\":\"sarvam-105b\",\"reasoning_effort\":null,\"messages\":[{\"role\":\"user\",\"content\":\"Explain my quote\"}]}"))
                .andRespond(withSuccess("{\"choices\":[{\"message\":{\"content\":\"Visible answer\",\"reasoning_content\":\"Private reasoning\"}}]}",MediaType.APPLICATION_JSON));
        assertThat(client.complete(messages())).isEqualTo("Visible answer"); server.verify();
    }
    @Test void providerErrorsAreSanitized() {
        server.expect(anything()).andRespond(withStatus(HttpStatus.UNAUTHORIZED).body("sensitive upstream error"));
        assertThatThrownBy(() -> client.complete(messages())).isInstanceOf(ApiException.class)
                .hasMessageContaining("HTTP 401").hasMessageNotContaining("sensitive").hasMessageNotContaining("test-only-key");
    }
    @Test void throttlingHasAnActionableError() {
        server.expect(anything()).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS));
        assertThatThrownBy(() -> client.complete(messages())).isInstanceOf(ApiException.class).hasMessageContaining("retry");
    }
    @Test void emptyReplyIsNotPresentedAsSuccess() {
        server.expect(anything()).andRespond(withSuccess("{\"choices\":[{\"message\":{\"content\":null}}]}",MediaType.APPLICATION_JSON));
        assertThatThrownBy(() -> client.complete(messages())).isInstanceOf(ApiException.class).hasMessageContaining("no answer");
    }
    @Test void absentKeyDoesNotMakeARequest() {
        var missing=new SarvamClient(new ObjectMapper(),"","sarvam-105b","https://provider.test/chat",RestClient.create());
        assertThat(missing.configured()).isFalse();
        assertThatThrownBy(() -> missing.complete(messages())).isInstanceOf(ApiException.class).hasMessageContaining("not configured");
    }
}
