package com.dealflow.billing;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PaymentAllocationRepository extends JpaRepository<PaymentAllocation, UUID> {

    List<PaymentAllocation> findByPaymentId(UUID paymentId);

    List<PaymentAllocation> findByInvoiceId(UUID invoiceId);
}
