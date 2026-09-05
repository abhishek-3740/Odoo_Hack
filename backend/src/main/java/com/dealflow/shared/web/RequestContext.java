package com.dealflow.shared.web;

/**
 * Per-request correlation id, echoed in every response envelope and written to
 * the audit trail so a support question about "what happened at 14:03" can be
 * answered from the database alone.
 */
public final class RequestContext {

    private static final ThreadLocal<String> REQUEST_ID = new ThreadLocal<>();

    private RequestContext() {
    }

    public static void setRequestId(String requestId) {
        REQUEST_ID.set(requestId);
    }

    public static String currentRequestId() {
        String id = REQUEST_ID.get();
        return id == null ? "-" : id;
    }

    public static void clear() {
        REQUEST_ID.remove();
    }
}
