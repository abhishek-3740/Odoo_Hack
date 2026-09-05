package com.dealflow.assistant;

import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import java.time.Duration;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

@Component
public class SarvamClient {
    private final RestClient http;
    private final ObjectMapper mapper;
    private final String key;
    private final String model;
    private final String endpoint;
    @Autowired
    public SarvamClient(ObjectMapper mapper, @Value("${SARVAM_API_KEY:}") String key,
            @Value("${SARVAM_MODEL:sarvam-105b}") String model,
            @Value("${dealflow.assistant.endpoint:https://api.sarvam.ai/v1/chat/completions}") String endpoint) {
        this(mapper, key, model, endpoint, createClient());
    }
    SarvamClient(ObjectMapper mapper, String key, String model, String endpoint, RestClient client) {
        this.mapper=mapper; this.key=key; this.model=model; this.endpoint=endpoint; this.http=client;
    }
    private static RestClient createClient() {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(35));
        return RestClient.builder().requestFactory(factory)
                .defaultStatusHandler(status -> true, (request, response) -> { }).build();
    }
    public boolean configured() { return !key.isBlank(); }
    public String complete(List<Map<String,String>> messages) {
        if(!configured()) throw new ApiException(ErrorCode.ASSISTANT_UNAVAILABLE,"Assistant is not configured. Contact your administrator; normal deal actions remain available.");
        try {
            var payload = mapper.createObjectNode();
            payload.put("model", model); payload.set("messages", mapper.valueToTree(messages));
            payload.put("temperature", 0.2); payload.put("max_tokens", 1100);
            // Explicit null disables hidden reasoning and preserves the visible reply budget.
            payload.putNull("reasoning_effort");
            String body = mapper.writeValueAsString(payload);
            var response=http.post().uri(endpoint).contentType(MediaType.APPLICATION_JSON)
                    .header("api-subscription-key",key).body(body)
                    .retrieve().toEntity(String.class);
            int status=response.getStatusCode().value();
            if(status==429) throw new ApiException(ErrorCode.ASSISTANT_RATE_LIMITED,"Sarvam is busy. Wait briefly and retry.");
            if(status<200 || status>=300)
                throw new ApiException(ErrorCode.ASSISTANT_UNAVAILABLE,"Sarvam could not complete this request (HTTP "+status+"). Check provider access and credits.");
            String answer=mapper.readTree(response.getBody()).path("choices").path(0).path("message").path("content").asText("");
            if(answer.isBlank()) throw new ApiException(ErrorCode.ASSISTANT_UNAVAILABLE,"Sarvam returned no answer. Please retry.");
            return answer;
        } catch(ApiException ex) { throw ex; }
        catch(Exception ex) { throw new ApiException(ErrorCode.ASSISTANT_UNAVAILABLE,"Assistant connection timed out or failed. Please retry; your quotation has not changed."); }
    }
}
