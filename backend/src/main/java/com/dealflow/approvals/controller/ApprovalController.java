package com.dealflow.approvals.controller;


import com.dealflow.approvals.models.*;
import com.dealflow.approvals.repo.*;
import com.dealflow.approvals.service.*;
import com.dealflow.approvals.dto.*;
import com.dealflow.approvals.models.ApprovalRequest;
import com.dealflow.approvals.repo.ApprovalRequestRepository;
import com.dealflow.approvals.service.ApprovalService;
import com.dealflow.approvals.dto.ApprovalDtos.ApprovalQueueItem;
import com.dealflow.approvals.dto.ApprovalDtos.ApprovalReasonDto;
import com.dealflow.approvals.dto.ApprovalDtos.DecisionRequest;
import com.dealflow.approvals.dto.ApprovalDtos.DecisionResponse;
import com.dealflow.approvals.dto.ApprovalDtos.ReassignRequest;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.models.Role;
import com.dealflow.catalog.models.Customer;
import com.dealflow.catalog.repo.CustomerRepository;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.idempotency.IdempotencyService;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessClock;
import com.dealflow.shared.web.ApiResponse;
import com.dealflow.shared.web.PageResponse;
import com.dealflow.shared.web.Paging;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** The approver's queue and decisions. */
@RestController
@RequestMapping("/api/v1/approval-requests")
public class ApprovalController {

    private static final Set<String> SORTS = Set.of("createdAt", "dueAt", "step");

    private final ApprovalService approvalService;
    private final ApprovalRequestRepository approvals;
    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final CustomerRepository customers;
    private final ProfileRepository profiles;
    private final IdempotencyService idempotency;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;

    public ApprovalController(ApprovalService approvalService, ApprovalRequestRepository approvals,
                              QuoteRepository quotes, QuoteRevisionRepository revisions,
                              CustomerRepository customers, ProfileRepository profiles,
                              IdempotencyService idempotency, BusinessClock clock,
                              ObjectMapper objectMapper) {
        this.approvalService = approvalService;
        this.approvals = approvals;
        this.quotes = quotes;
        this.revisions = revisions;
        this.customers = customers;
        this.profiles = profiles;
        this.idempotency = idempotency;
        this.clock = clock;
        this.objectMapper = objectMapper;
    }

    /**
     * The queue for this approver's role. Reps see the steps on their own
     * quotations; administrators see everything.
     */
    @GetMapping
    @Transactional(readOnly = true)
    public ApiResponse<PageResponse<ApprovalQueueItem>> queue(
            @RequestParam(required = false, defaultValue = "PENDING") String status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer pageSize,
            @RequestParam(required = false) String sort,
            Actor actor) {
        if (actor.isCustomer()) {
            throw ApiException.forbidden("Approvals are internal.");
        }
        ApprovalRequestStatus statusFilter = ApprovalRequestStatus.valueOf(
                status.toUpperCase(java.util.Locale.ROOT));
        Role roleFilter = actor.role().isApprover() ? actor.role() : null;
        UUID teamFilter = actor.role() == Role.MANAGER ? actor.teamId() : null;

        Page<ApprovalRequest> result = approvals.queue(statusFilter, roleFilter, teamFilter, null,
                Paging.of(page, pageSize, sort, SORTS, "createdAt"));

        // A rep only sees steps that belong to their own quotations.
        Page<ApprovalRequest> visible = actor.role() == Role.REP
                ? result.map(step -> quotes.findById(step.getQuoteId())
                        .filter(quote -> actor.profileId().equals(quote.getOwnerProfileId()))
                        .map(quote -> step).orElse(null))
                : result;

        return ApiResponse.of(PageResponse.of(visible, step -> step == null ? null : toItem(step)));
    }

    @GetMapping("/{approvalRequestId}")
    @Transactional(readOnly = true)
    public ApiResponse<ApprovalQueueItem> get(@PathVariable UUID approvalRequestId, Actor actor) {
        ApprovalRequest step = approvals.findById(approvalRequestId)
                .orElseThrow(() -> ApiException.notFound("Approval step " + approvalRequestId));
        if (actor.isCustomer()) {
            throw ApiException.notFound("Approval step " + approvalRequestId);
        }
        return ApiResponse.of(toItem(step));
    }

    /**
     * Records a decision. Requires an {@code Idempotency-Key}: a double-clicked
     * approve produces one decision, and a retried one returns the same answer.
     */
    @PostMapping("/{approvalRequestId}/decisions")
    public ApiResponse<DecisionResponse> decide(@PathVariable UUID approvalRequestId,
                                                @RequestHeader(value = "Idempotency-Key", required = false)
                                                String idempotencyKey,
                                                @Valid @RequestBody DecisionRequest request,
                                                Actor actor) {
        DecisionResponse response = idempotency.execute(actor, "approval-decision:" + approvalRequestId,
                idempotencyKey, request, DecisionResponse.class,
                () -> approvalService.decide(approvalRequestId, request, actor));
        return ApiResponse.of(response);
    }

    @PostMapping("/{approvalRequestId}/reassignments")
    public ApiResponse<ApprovalQueueItem> reassign(@PathVariable UUID approvalRequestId,
                                                   @Valid @RequestBody ReassignRequest request,
                                                   Actor actor) {
        approvalService.reassign(approvalRequestId, request, actor);
        return get(approvalRequestId, actor);
    }

    // -------------------------------------------------------------- mapping

    private ApprovalQueueItem toItem(ApprovalRequest step) {
        Quote quote = quotes.findById(step.getQuoteId()).orElse(null);
        QuoteRevision revision = revisions.findById(step.getRevisionId()).orElse(null);
        Customer customer = quote == null ? null : customers.findById(quote.getCustomerId()).orElse(null);
        Profile assignee = step.getAssigneeProfileId() == null ? null
                : profiles.findById(step.getAssigneeProfileId()).orElse(null);
        Instant now = clock.now();

        boolean actionable = step.isPending();
        String blocked = null;
        if (step.isPending() && step.getStep() == 2) {
            ApprovalRequestStatus managerStatus = approvals
                    .findByRevisionIdAndStep(step.getRevisionId(), 1)
                    .map(ApprovalRequest::getStatus).orElse(null);
            if (managerStatus != ApprovalRequestStatus.APPROVED) {
                actionable = false;
                blocked = "Waiting for the manager step to be approved first.";
            }
        }
        if (revision != null && quote != null && !revision.getId().equals(quote.getCurrentRevisionId())) {
            actionable = false;
            blocked = "This version has been superseded.";
        }

        BigDecimal worstExcess = null;
        if (revision != null && revision.getRiskResult() != null) {
            try {
                var node = objectMapper.readTree(revision.getRiskResult());
                var value = node.get("worstLineExcessPp");
                worstExcess = value == null || value.isNull() ? null : new BigDecimal(value.asText());
            } catch (RuntimeException ignored) {
                worstExcess = null;
            }
        }

        return new ApprovalQueueItem(step.getId(), step.getQuoteId(),
                quote == null ? null : quote.getReference(),
                customer == null ? null : customer.getName(),
                step.getRevisionId(), revision == null ? 0 : revision.getRevisionNo(),
                step.getStep(), step.getRequiredRole().name(), step.getStatus().name(),
                step.getAssigneeProfileId(),
                assignee == null ? null
                        : (assignee.getFullName() != null ? assignee.getFullName() : assignee.getEmail()),
                step.getDueAt(),
                step.isPending() && step.getDueAt() != null && step.getDueAt().isBefore(now),
                actionable, blocked,
                revision == null ? "INR" : revision.getCurrency(),
                revision == null ? null : Money.toMajor(revision.getOneTimeNetMinor()),
                revision == null ? null : Money.toMajor(revision.getRecurringFirstCycleNetMinor()),
                revision == null ? null : revision.getMarginPercent(),
                worstExcess, parseReasons(step.getReasons()), step.getCreatedAt());
    }

    private List<ApprovalReasonDto> parseReasons(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(json,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, ApprovalReasonDto.class));
        } catch (RuntimeException ex) {
            return List.of();
        }
    }
}
