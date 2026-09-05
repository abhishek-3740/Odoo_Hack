package com.dealflow.shared.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Assigns (or accepts) a correlation id and puts it on the response and the logs. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class RequestIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Request-Id";
    private static final String MDC_KEY = "requestId";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        // A caller-supplied id is echoed for tracing but never trusted as data:
        // it is length-capped and stripped of anything but safe characters.
        String requestId = sanitise(incoming);
        RequestContext.setRequestId(requestId);
        MDC.put(MDC_KEY, requestId);
        response.setHeader(HEADER, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            MDC.remove(MDC_KEY);
            RequestContext.clear();
        }
    }

    private static String sanitise(String incoming) {
        if (incoming == null || incoming.isBlank()) {
            return UUID.randomUUID().toString();
        }
        String cleaned = incoming.replaceAll("[^A-Za-z0-9._:-]", "");
        if (cleaned.isEmpty()) {
            return UUID.randomUUID().toString();
        }
        return cleaned.length() > 64 ? cleaned.substring(0, 64) : cleaned;
    }
}
