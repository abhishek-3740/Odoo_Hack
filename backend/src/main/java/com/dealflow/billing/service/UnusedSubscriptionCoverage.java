package com.dealflow.billing.service;

import com.dealflow.billing.repo.CreditNoteRepository;
import com.dealflow.billing.repo.InvoiceLineRepository;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Deduct only the still-unused fraction of earlier credits, preserving net and tax. */
@Service
public class UnusedSubscriptionCoverage {
    private final InvoiceLineRepository lines;
    private final CreditNoteRepository notes;
    private final ProrationCalculator proration;
    public UnusedSubscriptionCoverage(InvoiceLineRepository lines, CreditNoteRepository notes, ProrationCalculator proration) {
        this.lines = lines; this.notes = notes; this.proration = proration;
    }
    public record Credit(long net, long tax) {}
    public Credit at(UUID id, LocalDate date) {
        var charged = proration.unusedCoverage(lines.findBySubscriptionIdOrderByCoverageStartAsc(id).stream()
                .map(l -> new ProrationCalculator.ChargeSegment(l.getCoverageStart(),l.getCoverageEnd(),l.getNetMinor(),l.getTaxMinor())).toList(), date);
        var credited = proration.unusedCoverage(notes.findBySubscriptionId(id).stream()
                .map(n -> new ProrationCalculator.ChargeSegment(n.getCoverageStart(),n.getCoverageEnd(),n.getNetMinor(),n.getTaxMinor())).toList(), date);
        return new Credit(Math.max(0,charged.netMinor()-credited.netMinor()), Math.max(0,charged.taxMinor()-credited.taxMinor()));
    }
}
