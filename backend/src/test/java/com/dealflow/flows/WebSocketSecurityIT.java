package com.dealflow.flows;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.dealflow.auth.models.Profile;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.CatalogEnums.CustomerTier;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.models.ProductVariant;
import com.dealflow.outbox.service.OutboxDispatcher;
import com.dealflow.support.AbstractIntegrationTest;
import java.lang.reflect.Type;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.converter.StringMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/**
 * The STOMP session is authenticated by its CONNECT frame and confined to its
 * own private queue (verifications I02-I04): an anonymous CONNECT is refused,
 * a subscription to anything but the caller's queue closes the session, and a
 * committed outbox event reaches the authenticated owner as a minimal frame.
 */
class WebSocketSecurityIT extends AbstractIntegrationTest {

    @Autowired
    OutboxDispatcher outboxDispatcher;

    @Test
    @DisplayName("CONNECT without a bearer token is refused")
    void anonymousConnectIsRefused() {
        WebSocketStompClient client = client();
        CompletableFuture<StompSession> connecting = client.connectAsync(
                wsUrl(), new WebSocketHttpHeaders(), new StompHeaders(), new StompSessionHandlerAdapter() { });

        assertThatThrownBy(() -> connecting.get(15, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class);
    }

    @Test
    @DisplayName("an authenticated owner receives a minimal frame for their own quotation")
    void ownerReceivesOwnEvent() throws Exception {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile rep = person("rep-" + suffix(), Role.REP, null, null);
        ProductVariant laptop = stockedItem("Laptop", 1_000_000L, 700_000L, false);
        String token = tokenFor(rep);

        BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        StompSession session = connect(token);
        session.subscribe("/user/queue/deal-events", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                frames.add(String.valueOf(payload));
            }
        });

        UUID quoteId = UUID.fromString(json(post("/api/v1/quotes", token)
                .body(toJson(map("customerId", alpha.getId())))
                .retrieve().toEntity(String.class).getBody()).get("data").get("quoteId").asText());
        post("/api/v1/quotes/" + quoteId + "/revisions", token)
                .body(toJson(map("lines", List.of(map("variantId", laptop.getId(), "quantity", "1")))))
                .retrieve().toEntity(String.class);

        outboxDispatcher.dispatchNow();

        String frame = frames.poll(15, TimeUnit.SECONDS);
        assertThat(frame).as("a QUOTE_REVISED frame reaches the owner").isNotNull();
        assertThat(frame).contains("QUOTE_REVISED").contains(quoteId.toString());
        // Minimal on purpose: no money and no quotation body in the push.
        assertThat(frame).doesNotContain("unitCost").doesNotContain("margin").doesNotContain("net");

        session.disconnect();
    }

    @Test
    @DisplayName("subscribing to a broker topic instead of the private queue closes the session")
    void foreignSubscriptionIsRefused() throws Exception {
        Customer alpha = customer("Alpha", CustomerTier.BRONZE);
        Profile buyer = person("buyer-" + suffix(), Role.CUSTOMER, null, alpha.getId());

        StompSession session = connect(tokenFor(buyer));
        assertThat(session.isConnected()).isTrue();

        session.subscribe("/topic/everything", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return String.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
            }
        });

        long deadline = System.currentTimeMillis() + 10_000;
        while (session.isConnected() && System.currentTimeMillis() < deadline) {
            Thread.sleep(100);
        }
        assertThat(session.isConnected()).as("server closed the session after the refused SUBSCRIBE").isFalse();
    }

    // -------------------------------------------------------------- helpers

    private StompSession connect(String token) throws Exception {
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add("Authorization", "Bearer " + token);
        return client().connectAsync(wsUrl(), new WebSocketHttpHeaders(), connectHeaders,
                new StompSessionHandlerAdapter() { }).get(15, TimeUnit.SECONDS);
    }

    private static WebSocketStompClient client() {
        WebSocketStompClient client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new StringMessageConverter());
        return client;
    }

    private String wsUrl() {
        return "ws://localhost:" + port + "/ws";
    }

    private static String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}
