package com.dealflow.config;

import com.dealflow.notifications.StompAuthChannelInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.security.messaging.context.SecurityContextChannelInterceptor;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketTransportRegistration;

/**
 * STOMP over a native WebSocket at {@code /ws}, with Spring's simple broker.
 *
 * <p>Single-instance by design. The simple broker holds subscriptions in this
 * process; a second replica would need a shared broker relay before an event
 * produced on one node could reach a user connected to the other. That is a
 * deliberate, documented limit of the baseline deployment, not an oversight
 * (verification I08).
 *
 * <p>Delivery is best-effort on purpose. Every event is also a committed outbox
 * row and a durable notification where relevant, and a reconnecting client
 * refetches through REST. A missed frame is never a missed invoice.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final AppProperties properties;
    private final StompAuthChannelInterceptor authInterceptor;

    public WebSocketConfig(AppProperties properties, StompAuthChannelInterceptor authInterceptor) {
        this.properties = properties;
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        // Exact origin allow-list, shared with CORS. No SockJS fallback: the
        // target browsers speak native WebSocket and the fallback transports
        // would widen the surface for no benefit.
        registry.addEndpoint("/ws")
                .setAllowedOrigins(properties.auth().allowedOrigins().toArray(String[]::new));
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/queue")
                .setHeartbeatValue(new long[]{10_000, 10_000})
                .setTaskScheduler(heartbeatScheduler());
        registry.setUserDestinationPrefix("/user");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        // Order matters: authenticate the CONNECT and vet each SUBSCRIBE first,
        // then let Spring Security see the resulting Principal.
        registration.interceptors(authInterceptor, new SecurityContextChannelInterceptor());
    }

    @Override
    public void configureWebSocketTransport(WebSocketTransportRegistration registry) {
        // Bounded frames and buffers. A push is a small invalidation, never a
        // document, so anything large is a misbehaving client.
        registry.setMessageSizeLimit(16 * 1024);
        registry.setSendBufferSizeLimit(256 * 1024);
        registry.setSendTimeLimit(10_000);
    }

    private org.springframework.scheduling.TaskScheduler heartbeatScheduler() {
        var scheduler = new org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("ws-heartbeat-");
        scheduler.initialize();
        return scheduler;
    }
}
