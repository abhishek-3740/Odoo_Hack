package com.dealflow.approvals;

import com.dealflow.auth.Actor;
import com.dealflow.auth.Profile;
import com.dealflow.auth.ProfileRepository;
import com.dealflow.auth.Role;
import com.dealflow.config.AppProperties;
import com.dealflow.outbox.OutboxWriter;
import com.dealflow.quotes.Quote;
import com.dealflow.quotes.QuoteEnums.ApprovalStatus;
import com.dealflow.quotes.QuoteRevision;
import com.dealflow.quotes.engine.RiskModel.ApprovalLevel;
import com.dealflow.shared.audit.AuditService;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Builds and retires approval chains.
 *
 * <p>Shared by every path that produces a new set of terms — a rep submitting, a
 * customer countering, a scenario being applied. Routing has to behave
 * identically whoever proposed the terms, and duplicating this logic per caller
 * is how a counteroffer ends up with an approval status but no approver queue
 * entry.
 *
 * <p>Two invariants it exists to hold:
 * <ul>
 *   <li>New terms are routed <em>from scratch</em>. A lower discount never
 *       inherits an earlier approval, because quantity, cadence, cost or
 *       delivery terms may have moved too (edge case E08).</li>
 *   <li>Retiring a superseded step never grants approval. If nobody qualified is
 *       available the step still exists, still blocks, and is reported — the
 *       absence of an approver is not an approval (edge case E07).</li>
 * </ul>
 */
@Service
public class ApprovalRoutingService {

    private static final Logger log = LoggerFactory.getLogger(ApprovalRoutingService.class);

    private final ApprovalRequestRepository approvals;
    private final ProfileRepository profiles;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final AppProperties properties;

    public ApprovalRoutingService(ApprovalRequestRepository approvals, ProfileRepository profiles,
                                  AuditService audit, OutboxWriter outbox, AppProperties properties) {
        this.approvals = approvals;
        this.profiles = profiles;
        this.audit = audit;
        this.outbox = outbox;
        this.properties = properties;
    }

    /** Whether a chain was created and, if so, whether anyone can act on it. */
    public record RoutingOutcome(ApprovalStatus approvalStatus, int stepsCreated,
                                 boolean unassignedForLackOfApprover) {
    }

    /**
     * Creates the chain for a newly submitted revision.
     *
     * <p>Both steps are created up front when finance is required, so an approver
     * sees the whole route rather than discovering a second step after approving
     * the first. Sequencing is enforced when a decision is recorded, never by
     * hiding the row.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public RoutingOutcome createChain(Quote quote, QuoteRevision revision, ApprovalLevel required,
                                      String reasonsJson, Instant now) {
        if (required == ApprovalLevel.NONE) {
            revision.setRequiredLevel(ApprovalLevel.NONE);
            revision.setApprovalStatus(ApprovalStatus.NOT_REQUIRED);
            return new RoutingOutcome(ApprovalStatus.NOT_REQUIRED, 0, false);
        }

        Instant dueAt = now.plus(Duration.ofHours(properties.health().approvalDueHours()));
        List<Role> chain = required == ApprovalLevel.MANAGER_FINANCE
                ? List.of(Role.MANAGER, Role.FINANCE)
                : List.of(Role.MANAGER);

        boolean anyUnassigned = false;
        for (int index = 0; index < chain.size(); index++) {
            Role role = chain.get(index);
            java.util.UUID teamId = role == Role.MANAGER ? quote.getTeamId() : null;

            ApprovalRequest step = new ApprovalRequest(quote.getId(), revision.getId(),
                    index + 1, role, teamId, dueAt);
            step.setReasons(reasonsJson == null ? "[]" : reasonsJson);

            List<Profile> candidates = profiles.findAvailableApprovers(role, teamId, now).stream()
                    // Nobody approves their own deal, whatever role they hold.
                    .filter(profile -> !profile.getId().equals(quote.getOwnerProfileId()))
                    .filter(profile -> !profile.getId().equals(revision.getCreatedByProfileId()))
                    .toList();

            if (candidates.size() == 1) {
                step.assignTo(candidates.getFirst().getId());
            } else if (candidates.isEmpty()) {
                // Left unassigned and visible. The step still blocks execution.
                anyUnassigned = true;
                log.warn("No available {} approver for quotation {}; step {} left unassigned",
                        role, quote.getReference(), index + 1);
            }
            approvals.save(step);
        }

        revision.setRequiredLevel(required);
        revision.setApprovalStatus(ApprovalStatus.PENDING_MANAGER);

        outbox.publish(OutboxWriter.Events.APPROVAL_UPDATED, "Quote", quote.getId(),
                quote.getRowVersion(),
                Map.of("revisionId", revision.getId().toString(), "requiredLevel", required.name()),
                OutboxWriter.RecipientScope.roles(Role.MANAGER.name(), Role.FINANCE.name()));

        return new RoutingOutcome(ApprovalStatus.PENDING_MANAGER, chain.size(), anyUnassigned);
    }

    /**
     * Retires the pending steps of a revision whose terms no longer exist.
     *
     * <p>Called when a quotation is revised, countered or cancelled. The steps
     * become {@code SUPERSEDED} rather than being deleted, so the history still
     * shows that someone was asked and why the request went away.
     */
    @Transactional(propagation = Propagation.REQUIRED)
    public int supersedePending(QuoteRevision revision, Actor actor, String reason) {
        List<ApprovalRequest> pending = approvals.findByRevisionIdOrderByStepAsc(revision.getId())
                .stream().filter(ApprovalRequest::isPending).toList();

        for (ApprovalRequest step : pending) {
            step.supersede();
            audit.record(actor, "APPROVAL_SUPERSEDED", "ApprovalRequest", step.getId())
                    .quote(revision.getQuoteId()).revision(revision.getId())
                    .reason(reason)
                    .save();
        }
        if (!pending.isEmpty()) {
            outbox.publish(OutboxWriter.Events.APPROVAL_UPDATED, "Quote", revision.getQuoteId(), 0L,
                    Map.of("revisionId", revision.getId().toString(),
                            "supersededSteps", pending.size(), "reason", reason),
                    OutboxWriter.RecipientScope.roles(Role.MANAGER.name(), Role.FINANCE.name()));
        }
        return pending.size();
    }
}
