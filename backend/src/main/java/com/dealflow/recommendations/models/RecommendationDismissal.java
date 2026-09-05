package com.dealflow.recommendations.models;


import com.dealflow.recommendations.repo.*;
import com.dealflow.recommendations.service.*;
import com.dealflow.recommendations.controller.*;
import com.dealflow.shared.domain.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.util.UUID;

/**
 * A suggestion the rep has already rejected for this version of the deal.
 *
 * <p>Scoped to the revision, not the quotation: re-quoting is a new conversation
 * and the suggestion may be relevant again. Within one revision it stays
 * dismissed, so the panel does not keep proposing the same accessory after the
 * rep has said no.
 */
@Entity
@Table(name = "recommendation_dismissals")
public class RecommendationDismissal extends BaseEntity {

    @Column(name = "quote_id", nullable = false, updatable = false)
    private UUID quoteId;

    @Column(name = "revision_id", nullable = false, updatable = false)
    private UUID revisionId;

    @Column(name = "variant_id", nullable = false, updatable = false)
    private UUID variantId;

    @Column(name = "actor_profile_id", nullable = false, updatable = false)
    private UUID actorProfileId;

    protected RecommendationDismissal() {
    }

    public RecommendationDismissal(UUID quoteId, UUID revisionId, UUID variantId, UUID actorProfileId) {
        this.quoteId = quoteId;
        this.revisionId = revisionId;
        this.variantId = variantId;
        this.actorProfileId = actorProfileId;
    }

    public UUID getQuoteId() {
        return quoteId;
    }

    public UUID getRevisionId() {
        return revisionId;
    }

    public UUID getVariantId() {
        return variantId;
    }

    public UUID getActorProfileId() {
        return actorProfileId;
    }
}
