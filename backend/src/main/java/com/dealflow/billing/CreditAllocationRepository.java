package com.dealflow.billing;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CreditAllocationRepository extends JpaRepository<CreditAllocation, UUID> {

    List<CreditAllocation> findByCreditNoteId(UUID creditNoteId);

    List<CreditAllocation> findByInvoiceId(UUID invoiceId);
}
