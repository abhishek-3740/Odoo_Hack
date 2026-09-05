package com.dealflow.quotes.controller;

import com.dealflow.auth.models.Actor;
import com.dealflow.portal.service.NegotiationDeskService;
import com.dealflow.portal.service.NegotiationDeskService.NegotiationView;
import com.dealflow.portal.service.NegotiationDeskService.ReplyRequest;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Internal view of, and replies to, a customer's negotiation requests. */
@RestController
@RequestMapping("/api/v1/quotes/{quoteId}/requests")
public class NegotiationController {

    private final NegotiationDeskService desk;

    public NegotiationController(NegotiationDeskService desk) {
        this.desk = desk;
    }

    @GetMapping
    public ApiResponse<List<NegotiationView>> list(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(desk.list(quoteId, actor));
    }

    @PostMapping("/{requestId}/responses")
    public ApiResponse<NegotiationView> reply(@PathVariable UUID quoteId, @PathVariable UUID requestId,
                                              @Valid @RequestBody ReplyRequest request, Actor actor) {
        return ApiResponse.of(desk.reply(quoteId, requestId, request, actor));
    }
}
