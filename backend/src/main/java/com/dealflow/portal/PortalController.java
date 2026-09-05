package com.dealflow.portal;

import com.dealflow.auth.Actor;
import com.dealflow.portal.dto.PortalDtos.AcceptanceRequest;
import com.dealflow.portal.dto.PortalDtos.AcceptanceResponse;
import com.dealflow.portal.dto.PortalDtos.PortalInvoiceSummary;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteDetail;
import com.dealflow.portal.dto.PortalDtos.PortalQuoteSummary;
import com.dealflow.portal.dto.PortalDtos.PortalRequest;
import com.dealflow.shared.idempotency.IdempotencyService;
import com.dealflow.shared.web.ApiResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The customer portal.
 *
 * <p>Every endpoint is restricted to the CUSTOMER role at the method level and
 * again inside the service, which additionally binds the request to the
 * caller's own customer. The response types here have no fields for internal
 * data, so there is nothing to strip and nothing to forget to strip.
 */
@RestController
@RequestMapping("/api/v1/portal")
@PreAuthorize("hasRole('CUSTOMER')")
public class PortalController {

    private final PortalService portalService;
    private final IdempotencyService idempotency;

    public PortalController(PortalService portalService, IdempotencyService idempotency) {
        this.portalService = portalService;
        this.idempotency = idempotency;
    }

    @GetMapping("/quotes")
    public ApiResponse<List<PortalQuoteSummary>> quotes(Actor actor) {
        return ApiResponse.of(portalService.listQuotes(actor));
    }

    @GetMapping("/quotes/{quoteId}")
    public ApiResponse<PortalQuoteDetail> quote(@PathVariable UUID quoteId, Actor actor) {
        return ApiResponse.of(portalService.getQuote(quoteId, actor));
    }

    /**
     * Comment, change request or counteroffer.
     *
     * <p>Requires an {@code Idempotency-Key}. Three identical parallel
     * submissions — a triple-click on a slow connection — produce one request,
     * one candidate revision and one approval chain (edge case E17).
     */
    @PostMapping("/quotes/{quoteId}/requests")
    public ApiResponse<PortalQuoteDetail> request(@PathVariable UUID quoteId,
                                                  @RequestHeader(value = "Idempotency-Key", required = false)
                                                  String idempotencyKey,
                                                  @Valid @RequestBody PortalRequest request,
                                                  Actor actor) {
        return ApiResponse.of(idempotency.execute(actor, "portal-request:" + quoteId, idempotencyKey,
                request, PortalQuoteDetail.class,
                () -> portalService.submitRequest(quoteId, request, actor)));
    }

    /** Accepts one exact version. Replaying a successful acceptance returns the same answer. */
    @PostMapping("/quotes/{quoteId}/acceptances")
    public ApiResponse<AcceptanceResponse> accept(@PathVariable UUID quoteId,
                                                  @RequestHeader(value = "Idempotency-Key", required = false)
                                                  String idempotencyKey,
                                                  @Valid @RequestBody AcceptanceRequest request,
                                                  Actor actor) {
        return ApiResponse.of(idempotency.execute(actor, "portal-accept:" + quoteId, idempotencyKey,
                request, AcceptanceResponse.class,
                () -> portalService.accept(quoteId, request, actor)));
    }

    @GetMapping("/invoices")
    public ApiResponse<List<PortalInvoiceSummary>> invoices(Actor actor) {
        return ApiResponse.of(portalService.listInvoices(actor));
    }
}
