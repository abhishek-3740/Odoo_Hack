package com.dealflow.shared.web;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Success envelope: {@code { "data": ..., "meta": { "requestId", "evaluatedAt" } }}.
 */
public record ApiResponse<T>(T data, Map<String, Object> meta) {

    public static <T> ApiResponse<T> of(T data) {
        return new ApiResponse<>(data, baseMeta());
    }

    public static <T> ApiResponse<T> of(T data, Map<String, Object> extraMeta) {
        Map<String, Object> meta = baseMeta();
        meta.putAll(extraMeta);
        return new ApiResponse<>(data, meta);
    }

    private static Map<String, Object> baseMeta() {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("requestId", RequestContext.currentRequestId());
        meta.put("evaluatedAt", Instant.now().toString());
        return meta;
    }
}
