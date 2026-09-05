package com.dealflow.jobs.service;


import com.dealflow.jobs.models.*;
import com.dealflow.jobs.repo.*;
import com.dealflow.jobs.controller.*;
import com.dealflow.shared.time.BusinessClock;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * A database-backed lease so one job does not run twice at once.
 *
 * <p>The lease is a convenience that stops two sweeps from doing redundant work
 * and holding locks against each other. It is <em>not</em> the correctness
 * guarantee: unique charge keys and idempotent writes are what make an
 * overlapping run harmless. Timing is never a substitute for idempotency.
 *
 * <p>A lease expires on its own, so a job that dies holding one does not block
 * the next run forever.
 */
@Service
public class JobLeaseService {

    /** Unique to this process, so a lease can be renewed only by its holder. */
    private final String holder = "api-" + UUID.randomUUID().toString().substring(0, 8);

    @PersistenceContext
    private EntityManager entityManager;

    private final BusinessClock clock;

    public JobLeaseService(BusinessClock clock) {
        this.clock = clock;
    }

    /**
     * Takes the lease if it is free or expired, or already ours.
     *
     * <p>Runs in its own short transaction so the claim commits before the job
     * starts, and never shares a transaction with the job's business writes.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean tryAcquire(String jobName, Duration duration) {
        Instant now = clock.now();
        int updated = entityManager.createNativeQuery("""
                insert into dealflow.job_leases (job_name, lease_until, holder, updated_at)
                values (:jobName, :leaseUntil, :holder, :now)
                on conflict (job_name) do update
                    set lease_until = excluded.lease_until,
                        holder = excluded.holder,
                        updated_at = excluded.updated_at
                  where dealflow.job_leases.lease_until < :now
                     or dealflow.job_leases.holder = :holder
                """)
                .setParameter("jobName", jobName)
                .setParameter("leaseUntil", now.plus(duration))
                .setParameter("holder", holder)
                .setParameter("now", now)
                .executeUpdate();
        return updated > 0;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void release(String jobName) {
        entityManager.createNativeQuery("""
                update dealflow.job_leases
                   set lease_until = :now
                 where job_name = :jobName and holder = :holder
                """)
                .setParameter("now", clock.now())
                .setParameter("jobName", jobName)
                .setParameter("holder", holder)
                .executeUpdate();
    }

    public String holder() {
        return holder;
    }
}
