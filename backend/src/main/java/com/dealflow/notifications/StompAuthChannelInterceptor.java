package com.dealflow.notifications;

import com.dealflow.auth.models.ProfileAuthenticationToken;
import com.dealflow.auth.service.ProfileJwtAuthenticationConverter;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;

/**
 * Token-only authentication and authorisation for the STOMP session.
 *
 * <h2>Why the token travels in the CONNECT frame</h2>
 *
 * <p>A browser's WebSocket API cannot set an {@code Authorization} header on
 * the upgrade request. Tokens in the URL end up in logs and referrers. So the
 * client sends its access token as a STOMP {@code CONNECT} header, and nothing
 * else about the session is trusted until that header has been verified here.
 * The HTTP upgrade being permitted does not authenticate the messaging session
 * that follows.
 *
 * <h2>What a session may do</h2>
 *
 * <ul>
 *   <li>{@code CONNECT} — only with a valid token for an active profile. An
 *       unauthenticated CONNECT is rejected, which closes the socket.</li>
 *   <li>{@code SUBSCRIBE} — only to the caller's own private queue. A customer
 *       asking for another user's destination, or anyone asking for a broker
 *       {@code /topic/**}, is refused.</li>
 *   <li>{@code SEND} — never. Every business command is an HTTPS request.</li>
 * </ul>
 *
 * <p>Spring Security's {@code @EnableWebSocketSecurity} is deliberately not
 * used: its default CONNECT CSRF check exists for cookie sessions, and mixing it
 * with a bearer-only design would either break CONNECT or tempt someone into
 * weakening CSRF globally to make the socket work.
 */
@Component
public class StompAuthChannelInterceptor implements ChannelInterceptor {

    private static final Logger log = LoggerFactory.getLogger(StompAuthChannelInterceptor.class);

    /** The only destination a client may subscribe to; Spring resolves the user part. */
    public static final String PRIVATE_QUEUE = "/user/queue/deal-events";

    private final JwtDecoder jwtDecoder;
    private final ProfileJwtAuthenticationConverter converter;

    public StompAuthChannelInterceptor(JwtDecoder jwtDecoder, ProfileJwtAuthenticationConverter converter) {
        this.jwtDecoder = jwtDecoder;
        this.converter = converter;
    }

    @Override
    public Message<?> preSend(Message<?> message, MessageChannel channel) {
        StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
        if (accessor == null || accessor.getCommand() == null) {
            return message;
        }
        switch (accessor.getCommand()) {
            case CONNECT, STOMP -> authenticate(accessor);
            case SUBSCRIBE -> authoriseSubscription(accessor);
            case SEND -> throw new IllegalArgumentException(
                    "Clients do not send business messages over the socket; use the REST API.");
            default -> { }
        }
        return message;
    }

    private void authenticate(StompHeaderAccessor accessor) {
        String token = bearerToken(accessor.getNativeHeader("Authorization"));
        if (token == null) {
            throw new IllegalArgumentException("STOMP CONNECT requires an Authorization: Bearer header.");
        }
        try {
            Jwt jwt = jwtDecoder.decode(token);
            AbstractAuthenticationToken authentication = converter.convert(jwt);
            if (authentication == null || !authentication.isAuthenticated()) {
                throw new IllegalArgumentException("The token does not identify an active profile.");
            }
            // Principal name = profile id, which is what convertAndSendToUser targets.
            accessor.setUser(authentication);
        } catch (JwtException ex) {
            log.debug("Rejected STOMP CONNECT: {}", ex.getMessage());
            throw new IllegalArgumentException("Invalid or expired token.");
        }
    }

    private void authoriseSubscription(StompHeaderAccessor accessor) {
        if (!(accessor.getUser() instanceof ProfileAuthenticationToken)) {
            throw new IllegalArgumentException("Subscribe requires an authenticated session.");
        }
        String destination = accessor.getDestination();
        if (destination == null || !destination.equals(PRIVATE_QUEUE)) {
            // No /topic, no broker queues, no other users' destinations. Spring
            // rewrites /user/queue/... to this session's own queue, so the only
            // way to receive another person's events is to be that person.
            log.warn("Refused subscription to {} by {}", destination, accessor.getUser().getName());
            throw new IllegalArgumentException("Only " + PRIVATE_QUEUE + " may be subscribed to.");
        }
    }

    private static String bearerToken(List<String> headers) {
        if (headers == null || headers.isEmpty()) {
            return null;
        }
        String value = headers.getFirst();
        if (value == null || !value.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        String token = value.substring(7).trim();
        return token.isEmpty() ? null : token;
    }
}
