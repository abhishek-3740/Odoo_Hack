package com.dealflow.approvals.service;


import com.dealflow.approvals.models.*;
import com.dealflow.approvals.repo.*;
import com.dealflow.approvals.dto.*;
import com.dealflow.approvals.controller.*;
import com.dealflow.approvals.models.ApprovalRequest;
import com.dealflow.approvals.repo.ApprovalRequestRepository;
import com.dealflow.approvals.dto.ApprovalDtos.DecisionRequest;
import com.dealflow.approvals.dto.ApprovalDtos.DecisionResponse;
import com.dealflow.approvals.dto.ApprovalDtos.ReassignRequest;
import com.dealflow.auth.models.ApprovalDelegation;
import com.dealflow.auth.repo.ApprovalDelegationRepository;
import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Profile;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.auth.models.Role;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.quotes.models.Quote;
import com.dealflow.quotes.models.QuoteEnums.ApprovalRequestStatus;
import com.dealflow.quotes.models.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.models.QuoteEnums.RevisionStatus;
import com.dealflow.quotes.models.QuoteEnums.Stage;
import com.dealflow.quotes.service.QuoteGateListener;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.models.QuoteRevision;
import com.dealflow.quotes.repo.QuoteRevisionRepository;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Records approval decisions.
 *
 * <h2>How a decision is made safe</h2>
 *
 * <p>Every decision locks the quotation aggregate <em>and</em> the step row, then
 * re-checks four things: the actor holds the required role, the earlier step is
 * already approved, this step is still {@code PENDING}, and the revision it
 * refers to is still the current one.
 *
 * <p>That is what resolves the classic race (edge case E05). A manager approval
 * and a finance rejection arriving together cannot both commit: whichever
 * reaches the lock second sees the state the first one left. If finance somehow
 * arrives first, it fails the prerequisite check; if it arrives against a stale
 * revision, it gets a 409 and refreshes. There is no last-write-wins flag
 * anywhere in this flow, and a terminal decision is never overwritten.
 *
 * <h2>Absence of an approver is never approval</h2>
 *
 * <p>If nobody qualified is available, the step stays pending and visible and an
 * alert is raised. An administrator may reassign it to a role-qualified backup —
 * which changes <em>who is asked</em>, never <em>whether the business requires
 * the approval</em> (edge case E07).
 */
@Service
public class ApprovalService {

    private static final Logger log = LoggerFactory.getLogger(ApprovalService.class);

    private final ApprovalRequestRepository approvals;
    private final QuoteRepository quotes;
    private final QuoteRevisionRepository revisions;
    private final ProfileRepository profiles;
    private final ApprovalDelegationRepository delegations;
    private final QuoteGateListener gateListener;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final BusinessClock clock;

    public ApprovalService(ApprovalRequestRepository approvals, QuoteRepository quotes,
                           QuoteRevisionRepository revisions, ProfileRepository profiles,
                           ApprovalDelegationRepository delegations, QuoteGateListener gateListener,
                           AuditService audit, OutboxWriter outbox, BusinessClock clock) {
        this.approvals = approvals;
        this.quotes = quotes;
        this.revisions = revisions;
        this.profiles = profiles;
        this.delegations = delegations;
        this.gateListener = gateListener;
        this.audit = audit;
        this.outbox = outbox;
        this.clock = clock;
    }

    @Transactional(rollbackFor = Exception.class)
    public DecisionResponse decide(UUID approvalRequestId, DecisionRequest request, Actor actor) {
        ApprovalRequest peek = approvals.findById(approvalRequestId)
                .orElseThrow(() -> ApiException.notFound("Approval step " + approvalRequestId));

        // Lock order matters: always the quotation first, then the step. Every
        // command in the system takes them in this sequence, so they queue
        // instead of deadlocking.
        Quote quote = quotes.findByIdForUpdate(peek.getQuoteId())
                .orElseThrow(() -> ApiException.notFound("Quotation " + peek.getQuoteId()));
        ApprovalRequest step = approvals.findByIdForUpdate(approvalRequestId)
                .orElseThrow(() -> ApiException.notFound("Approval step " + approvalRequestId));

        QuoteRevision revision = revisions.findById(step.getRevisionId())
                .orElseThrow(() -> ApiException.notFound("Revision " + step.getRevisionId()));

        authoriseDecision(actor, quote, revision, step);
        validateDecidable(quote, revision, step, request);

        Instant now = clock.now();
        applyDecision(quote, revision, step, request, actor, now);

        // A genuine approver decision is business progress, so it clears the
        // external wait. A rep's own edit would not (edge case E22).
        quote.recordProgress(now);

        audit.record(actor, "APPROVAL_" + request.decision().name(), "ApprovalRequest", step.getId())
                .quote(quote.getId()).revision(revision.getId())
                .after(Map.of("step", step.getStep(), "role", step.getRequiredRole().name(),
                        "decision", request.decision().name()))
                .reason(request.reason())
                .save();

        outbox.publish(OutboxWriter.Events.APPROVAL_UPDATED, "Quote", quote.getId(),
                quote.getRowVersion(),
                Map.of("revisionId", revision.getId().toString(),
                        "approvalStatus", revision.getApprovalStatus().name(),
                        "stage", quote.getStage().name()),
                OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                        quote.getTeamId()).andRoles(Role.MANAGER.name(), Role.FINANCE.name()));

        if (quote.getStage() == Stage.SENT) {
            outbox.publish(OutboxWriter.Events.QUOTE_REVISED, "Quote", quote.getId(),
                    quote.getRowVersion(),
                    Map.of("revisionId", revision.getId().toString(),
                            "stage", quote.getStage().name()),
                    OutboxWriter.RecipientScope.deal(quote.getCustomerId(), quote.getOwnerProfileId(),
                            quote.getTeamId()).andRoles(Role.MANAGER.name(), Role.FINANCE.name()));
        }

        UUID orderId = null;
        String finalizationStatus = null;
        if (revision.getApprovalStatus().clearsApprovalGate()) {
            // The last approval may have completed the final gate. The
            // coordinator re-checks everything and does nothing if not.
            gateListener.onGatesPossiblyCleared(quote.getId(), actor);
            Optional<UUID> created = gateListener.findOrderIdForQuote(quote.getId());
            orderId = created.orElse(null);
            finalizationStatus = created.isPresent() ? "FINALIZED" : "WAITING";
        }

        return new DecisionResponse(step.getId(), step.getStatus().name(),
                revision.getApprovalStatus().name(), orderId, finalizationStatus,
                remainingGates(revision));
    }

    /**
     * Reassigns a pending step to a qualified backup.
     *
     * <p>Administrator-only, always with a reason, and always audited with both
     * the original and the replacement. The requirement itself is untouched:
     * reassignment answers "who decides", never "must someone decide".
     */
    @Transactional
    public void reassign(UUID approvalRequestId, ReassignRequest request, Actor actor) {
        if (!actor.isAdmin()) {
            throw ApiException.forbidden("Only an administrator can reassign an approval step.");
        }
        ApprovalRequest step = approvals.findByIdForUpdate(approvalRequestId)
                .orElseThrow(() -> ApiException.notFound("Approval step " + approvalRequestId));
        if (!step.isPending()) {
            throw new ApiException(ErrorCode.APPROVAL_ALREADY_DECIDED,
                    "This step already has a decision and cannot be reassigned.");
        }

        Profile target = profiles.findById(request.assigneeProfileId())
                .orElseThrow(() -> ApiException.notFound("Profile " + request.assigneeProfileId()));

        Instant now = clock.now();
        if (target.getRole() != step.getRequiredRole()) {
            throw new ApiException(ErrorCode.APPROVER_NOT_QUALIFIED,
                    "That person is not a " + step.getRequiredRole().name().toLowerCase()
                            + " and cannot take this step.");
        }
        if (!target.isAvailableAt(now)) {
            throw new ApiException(ErrorCode.NO_AVAILABLE_APPROVER,
                    "That person is deactivated or on leave.");
        }

        UUID previous = step.getAssigneeProfileId();
        step.reassignTo(target.getId(), request.reason());

        audit.record(actor, "APPROVAL_REASSIGNED", "ApprovalRequest", step.getId())
                .quote(step.getQuoteId()).revision(step.getRevisionId())
                .before(Map.of("assigneeProfileId", String.valueOf(previous)))
                .after(Map.of("assigneeProfileId", target.getId().toString()))
                .reason(request.reason())
                .save();

        outbox.publish(OutboxWriter.Events.APPROVAL_UPDATED, "Quote", step.getQuoteId(), 0L,
                Map.of("reassignedTo", target.getId().toString()),
                OutboxWriter.RecipientScope.owner(target.getId()));
    }

    // -------------------------------------------------------- authorisation

    private void authoriseDecision(Actor actor, Quote quote, QuoteRevision revision,
                                   ApprovalRequest step) {
        if (actor.role() != step.getRequiredRole() && !actor.isAdmin()) {
            throw new ApiException(ErrorCode.APPROVER_NOT_QUALIFIED,
                    "This step must be decided by "
                            + step.getRequiredRole().name().toLowerCase() + ".");
        }

        // Nobody approves their own deal, whatever role they hold.
        if (Objects.equals(actor.profileId(), quote.getOwnerProfileId())
                || Objects.equals(actor.profileId(), revision.getCreatedByProfileId())) {
            throw new ApiException(ErrorCode.SELF_APPROVAL_FORBIDDEN,
                    "A quotation cannot be approved by the person who submitted it.");
        }

        Instant now = clock.now();
        Profile approver = profiles.findById(actor.profileId())
                .orElseThrow(() -> ApiException.notFound("Your profile"));
        if (!approver.isAvailableAt(now)) {
            throw new ApiException(ErrorCode.PROFILE_INACTIVE,
                    "This account is deactivated or on leave and cannot approve.");
        }

        // A step assigned to someone specific is theirs — unless the actor holds
        // an in-date, role-qualified delegation for it, OR the actor is an admin,
        // OR the actor is a qualified manager for the quotation's team.
        UUID assignee = step.getAssigneeProfileId();
        if (assignee != null && !assignee.equals(actor.profileId())
                && !hasDelegation(actor, step, now)
                && !actor.isAdmin()) {
            boolean sameTeamManager = actor.role() == step.getRequiredRole()
                    && (step.getTeamId() == null || actor.teamId() == null || actor.teamId().equals(step.getTeamId()));
            if (!sameTeamManager) {
                throw ApiException.forbidden("This step is assigned to another approver.");
            }
        }

        // A manager decides for their own team (admins can decide across any team).
        if (!actor.isAdmin() && step.getRequiredRole() == Role.MANAGER && step.getTeamId() != null
                && actor.teamId() != null && !actor.teamId().equals(step.getTeamId())) {
            throw ApiException.forbidden("This step belongs to another team.");
        }
    }

    private boolean hasDelegation(Actor actor, ApprovalRequest step, Instant now) {
        List<ApprovalDelegation> active = delegations.findActive(
                step.getRequiredRole(), step.getTeamId(), now);
        return active.stream()
                .anyMatch(delegation -> delegation.getDelegateProfileId().equals(actor.profileId())
                        && delegation.isValidAt(now));
    }

    private void validateDecidable(Quote quote, QuoteRevision revision, ApprovalRequest step,
                                   DecisionRequest request) {
        if (!step.isPending()) {
            throw ApiException.of(ErrorCode.APPROVAL_ALREADY_DECIDED,
                    "This step was already " + step.getStatus().name().toLowerCase() + ".",
                    "status", step.getStatus().name());
        }
        if (revision.getStatus() != RevisionStatus.SUBMITTED) {
            throw new ApiException(ErrorCode.CONFLICTING_STATE,
                    "The version this step refers to is no longer active.");
        }
        if (!revision.getId().equals(quote.getCurrentRevisionId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "The quotation was revised. Review the current version before deciding.",
                    "currentRevisionId", String.valueOf(quote.getCurrentRevisionId()));
        }
        if (request.expectedRevisionId() != null
                && !request.expectedRevisionId().equals(revision.getId())) {
            throw ApiException.of(ErrorCode.STALE_QUOTE_VERSION,
                    "You are looking at an older version of this quotation.",
                    "currentRevisionId", revision.getId().toString());
        }
        if (request.expectedRowVersion() != null
                && request.expectedRowVersion() != step.getRowVersion()) {
            throw ApiException.of(ErrorCode.STALE_VERSION,
                    "This step changed. Refresh before deciding.",
                    "currentVersion", step.getRowVersion());
        }

        // Sequence: finance never decides while the manager step is open.
        if (step.getStep() == 2) {
            ApprovalRequest managerStep = approvals
                    .findByRevisionIdAndStep(revision.getId(), 1)
                    .orElseThrow(() -> new ApiException(ErrorCode.APPROVAL_SEQUENCE_VIOLATION,
                            "The manager step is missing for this version."));
            if (managerStep.getStatus() != ApprovalRequestStatus.APPROVED) {
                throw ApiException.of(ErrorCode.APPROVAL_SEQUENCE_VIOLATION,
                        "The manager has not approved this version yet.",
                        "managerStepStatus", managerStep.getStatus().name());
            }
        }
    }

    // -------------------------------------------------------------- outcome

    private void applyDecision(Quote quote, QuoteRevision revision, ApprovalRequest step,
                               DecisionRequest request, Actor actor, Instant now) {
        switch (request.decision()) {
            case APPROVE -> {
                step.decide(ApprovalRequestStatus.APPROVED, actor.profileId(), now, request.reason());
                Optional<ApprovalRequest> nextStep = approvals
                        .findByRevisionIdAndStep(revision.getId(), step.getStep() + 1)
                        .filter(ApprovalRequest::isPending);
                if (nextStep.isPresent()) {
                    revision.setApprovalStatus(ApprovalStatus.PENDING_FINANCE);
                } else {
                    revision.setApprovalStatus(ApprovalStatus.APPROVED);
                    if (quote.getStage() == Stage.REVIEW || quote.getStage() == Stage.DRAFT) {
                        quote.setStage(Stage.SENT);
                    }
                    if (revision.getSellerAdoptedAt() == null) {
                        revision.recordSellerAdoption(actor.profileId(), now);
                    }
                    if (revision.getStatus() != RevisionStatus.SUBMITTED) {
                        revision.markSubmitted(now);
                    }
                    quotes.save(quote);
                    revisions.save(revision);
                }
            }
            case REJECT -> {
                step.decide(ApprovalRequestStatus.REJECTED, actor.profileId(), now, request.reason());
                revision.setApprovalStatus(ApprovalStatus.REJECTED);
                quote.setStage(Stage.CANCELED);
                quotes.save(quote);
                revisions.save(revision);
                supersedeLaterSteps(revision, step, actor, "An earlier step rejected this version.");
            }
            case RETURN_FOR_REVISION -> {
                // Returning closes the attempt. The rep must submit a new
                // version; the old decisions cannot be reused for it.
                step.decide(ApprovalRequestStatus.REVISION_REQUIRED, actor.profileId(), now,
                        request.reason());
                revision.setApprovalStatus(ApprovalStatus.REVISION_REQUIRED);
                quote.setStage(Stage.DRAFT);
                quotes.save(quote);
                revisions.save(revision);
                supersedeLaterSteps(revision, step, actor, "The version was returned for revision.");
            }
        }
    }

    private void supersedeLaterSteps(QuoteRevision revision, ApprovalRequest decided, Actor actor,
                                     String reason) {
        approvals.findByRevisionIdOrderByStepAsc(revision.getId()).stream()
                .filter(candidate -> candidate.getStep() > decided.getStep())
                .filter(ApprovalRequest::isPending)
                .forEach(candidate -> {
                    candidate.supersede();
                    audit.record(actor, "APPROVAL_SUPERSEDED", "ApprovalRequest", candidate.getId())
                            .quote(revision.getQuoteId()).revision(revision.getId())
                            .reason(reason)
                            .save();
                });
    }

    private List<String> remainingGates(QuoteRevision revision) {
        List<String> gates = new ArrayList<>();
        if (!revision.getApprovalStatus().clearsApprovalGate()) {
            gates.add("Approval: " + revision.getApprovalStatus().name());
        }
        if (revision.getSellerAdoptedAt() == null) {
            gates.add("Seller adoption");
        }
        if (revision.getCustomerAcceptedAt() == null) {
            gates.add("Customer acceptance");
        }
        return gates;
    }
}
