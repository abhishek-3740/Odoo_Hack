package com.dealflow.billing;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvoiceLineRepository extends JpaRepository<InvoiceLine, UUID> {

    List<InvoiceLine> findByInvoiceIdOrderByPositionAsc(UUID invoiceId);

    List<InvoiceLine> findByInvoiceIdIn(Collection<UUID> invoiceIds);

    /** Charge segments for a subscription: the basis for any later credit. */
    List<InvoiceLine> findBySubscriptionIdOrderByCoverageStartAsc(UUID subscriptionId);

    Optional<InvoiceLine> findByChargeKey(String chargeKey);

    boolean existsByChargeKey(String chargeKey);
}
