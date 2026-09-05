package com.dealflow.shared.web;

import java.util.Map;

/**
 * Error envelope: {@code { "error": { "code", "message", "details" }, "requestId" }}.
 */
public record ErrorResponse(Body error, String requestId) {

    public record Body(String code, String message, Map<String, Object> details) {
    }

    public static ErrorResponse of(String code, String message, Map<String, Object> details) {
        return new ErrorResponse(
                new Body(code, message, details == null ? Map.of() : details),
                RequestContext.currentRequestId());
    }
}
