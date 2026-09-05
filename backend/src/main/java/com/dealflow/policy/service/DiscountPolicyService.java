package com.dealflow.policy.service;


import com.dealflow.policy.models.*;
import com.dealflow.policy.repo.*;
import com.dealflow.policy.controller.*;
import com.dealflow.auth.models.Actor;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.time.BusinessClock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

/**
 * Publishes and resolves versions of the discount policy.
 *
 * <p>Policy is append-only. "Editing" a ceiling publishes a new version with a
 * new effective time; the old version stays exactly as it was. Two things depend
 * on that:
 *
 * <ul>
 *   <li>A submitted revision stores the version it was judged against, so a
 *       later configuration change cannot retroactively rewrite whether an
 *       approval was needed.</li>
 *   <li>Changing a threshold today <em>does</em> change the next evaluation, which
 *       is what makes the configuration screens real rather than decorative
 *       (test T25).</li>
 * </ul>
 */
@Service
public class DiscountPolicyService {

    /** Effective policy plus the version number to stamp onto a revision. */
    public record EffectivePolicy(int versionNo, DiscountPolicyDefinition definition, String rawJson,
                                  Instant effectiveAt) {
    }

    @PersistenceContext
    private EntityManager entityManager;

    private final DiscountPolicyRepository repository;
    private final BusinessClock clock;
    private final ObjectMapper objectMapper;
    private final AuditService audit;

    public DiscountPolicyService(DiscountPolicyRepository repository, BusinessClock clock,
                                 ObjectMapper objectMapper, AuditService audit) {
        this.repository = repository;
        this.clock = clock;
        this.objectMapper = objectMapper;
        this.audit = audit;
    }

    /** The version in force right now. */
    @Transactional(readOnly = true)
    public EffectivePolicy effectiveNow() {
        return effectiveAt(clock.now());
    }

    @Transactional(readOnly = true)
    public EffectivePolicy effectiveAt(Instant moment) {
        List<DiscountPolicy> candidates = repository.findEffectiveAt(moment, Limit.of(1));
        if (candidates.isEmpty()) {
            throw new ApiException(ErrorCode.POLICY_NOT_CONFIGURED,
                    "No discount policy version is in effect. An administrator must publish one "
                            + "before quotations can be evaluated.");
        }
        DiscountPolicy policy = candidates.getFirst();
        return new EffectivePolicy(policy.getVersionNo(), parse(policy.getDefinition()),
                policy.getDefinition(), policy.getEffectiveAt());
    }

    /** The exact version a submitted revision was judged against. */
    @Transactional(readOnly = true)
    public DiscountPolicyDefinition byVersion(int versionNo) {
        return repository.findByVersionNo(versionNo)
                .map(policy -> parse(policy.getDefinition()))
                .orElseThrow(() -> ApiException.notFound("Discount policy version " + versionNo));
    }

    /**
     * Publishes a new version.
     *
     * <p>The version number comes from a database sequence rather than
     * {@code max(version_no) + 1}, so two administrators saving at the same
     * moment get distinct versions instead of one silently losing.
     */
    @Transactional
    public DiscountPolicy publish(Actor actor, DiscountPolicyDefinition definition, String note) {
        validate(definition);
        int versionNo = nextVersionNo();
        Instant now = clock.now();

        DiscountPolicy policy = repository.save(new DiscountPolicy(
                versionNo, objectMapper.writeValueAsString(definition), now, note, actor.profileId()));

        audit.record(actor, "DISCOUNT_POLICY_PUBLISHED", "DiscountPolicy", policy.getId())
                .after(Map.of("versionNo", versionNo))
                .reason(note)
                .save();
        return policy;
    }

    @Transactional(readOnly = true)
    public List<DiscountPolicy> history() {
        return repository.findAllByOrderByVersionNoDesc();
    }

    public DiscountPolicyDefinition parse(String json) {
        try {
            return objectMapper.readValue(json, DiscountPolicyDefinition.class);
        } catch (RuntimeException ex) {
            throw new ApiException(ErrorCode.POLICY_NOT_CONFIGURED,
                    "The stored discount policy could not be read: " + ex.getMessage());
        }
    }

    private int nextVersionNo() {
        Number value = (Number) entityManager
                .createNativeQuery("select nextval('dealflow.discount_policy_version_seq')")
                .getSingleResult();
        return value.intValue();
    }

    /**
     * Rejects a policy that cannot be applied consistently.
     *
     * <p>The finance floor must not sit above the manager floor: that would mean
     * a margin could demand finance approval without ever having required a
     * manager, and finance always follows manager.
     */
    private void validate(DiscountPolicyDefinition definition) {
        if (definition.tierCeilingPercent() == null || definition.tierCeilingPercent().isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Configure a ceiling for every customer tier.");
        }
        definition.tierCeilingPercent().forEach((tier, percent) -> {
            if (percent == null || percent.signum() < 0 || percent.doubleValue() > 100) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "The " + tier + " ceiling must be between 0% and 100%.");
            }
        });
        definition.categoryCeilingPercent().forEach((code, percent) -> {
            if (percent == null || percent.signum() < 0 || percent.doubleValue() > 100) {
                throw new ApiException(ErrorCode.VALIDATION_FAILED,
                        "The " + code + " ceiling must be between 0% and 100%.");
            }
        });
        if (definition.manager() == null || definition.finance() == null) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "Both manager and finance triggers must be configured.");
        }
        var managerFloor = definition.manager().aggregateMarginPercentBelow();
        var financeFloor = definition.finance().aggregateMarginPercentBelow();
        if (managerFloor != null && financeFloor != null && financeFloor.compareTo(managerFloor) > 0) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED,
                    "The finance margin floor cannot be higher than the manager floor: finance approval "
                            + "always follows manager approval, never replaces it.");
        }
    }
}
