package com.dealflow.assistant;

import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Role;
import com.dealflow.approvals.repo.ApprovalRequestRepository;
import com.dealflow.portal.service.PortalService;
import com.dealflow.portal.service.DealEscalationService;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.service.QuoteService;
import com.dealflow.reporting.service.ReportService;
import com.dealflow.reporting.dto.ReportDtos.ReportFilter;
import java.util.*;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AssistantContextService {
    private final QuoteService quotes;
    private final QuoteRepository repository;
    private final PortalService portal;
    private final DealEscalationService escalations;
    private final ReportService reports;
    private final ApprovalRequestRepository approvals;
    public AssistantContextService(QuoteService quotes, QuoteRepository repository, PortalService portal,
            DealEscalationService escalations, ReportService reports, ApprovalRequestRepository approvals) {
        this.quotes=quotes; this.repository=repository; this.portal=portal; this.escalations=escalations; this.reports=reports;
        this.approvals=approvals;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> context(UUID quoteId, Actor actor) {
        Map<String,Object> context=new LinkedHashMap<>();
        context.put("role",actor.role().name());
        if(actor.isCustomer()) {
            // Never obtain internal DTOs, policy, recommendations or internal escalation messages here.
            if(quoteId!=null) context.put("customerQuotation",portal.getQuote(quoteId,actor));
            else {
                context.put("recentCustomerQuotes",portal.listQuotes(actor).stream().limit(15).toList());
                context.put("customerInvoices",portal.listInvoices(actor).stream().limit(15).toList());
            }
        } else if(quoteId!=null) {
            context.put("quotation",quotes.get(quoteId,actor));
            context.put("internalReviewCases",escalations.list(quoteId,actor));
        } else {
            UUID owner=actor.role()==Role.REP ? actor.profileId() : null;
            UUID team=actor.role()==Role.MANAGER ? actor.teamId() : null;
            var page=repository.search(owner,team,null,null,PageRequest.of(0,15,Sort.by(Sort.Direction.DESC,"createdAt")));
            context.put("totalAccessibleQuotes",page.getTotalElements());
            context.put("recentQuotes",page.getContent().stream().map(q -> Map.of(
                    "reference",q.getReference(),"stage",q.getStage().name(),"quoteId",q.getId())).toList());
            context.put("internalReviewCases",escalations.list(null,actor).stream().limit(15).toList());
            var pending=approvals.pendingForWorkspace(actor.role().isApprover() ? actor.role() : null,
                    owner,team,PageRequest.of(0,15,Sort.by("createdAt")));
            context.put("totalPendingApprovalSteps",pending.getTotalElements());
            context.put("pendingApprovalSteps",pending.getContent().stream().map(a -> {
                Map<String,Object> step=new LinkedHashMap<>();
                step.put("quoteId",a.getQuoteId()); step.put("revisionId",a.getRevisionId());
                step.put("requiredRole",a.getRequiredRole()); step.put("step",a.getStep());
                step.put("dueAt",a.getDueAt()); step.put("reasons",a.getReasons());
                step.put("sequence",approvals.findByRevisionIdOrderByStepAsc(a.getRevisionId()).stream()
                        .map(s -> Map.of("step",s.getStep(),"role",s.getRequiredRole(),"status",s.getStatus())).toList());
                return step;
            }).toList());
            if(actor.role()==Role.FINANCE || actor.isAdmin()) {
                var report=reports.salesReport(new ReportFilter(null,null,null,null,null,null,null),actor);
                context.put("financialSummaryLast90Days",Map.of("currency",report.currency(),
                        "oneTimeSales",report.oneTimeSales(),"monthlyRecurringRevenue",report.monthlyRecurringRevenue(),
                        "invoiced",report.invoicedRevenue(),"cashCollected",report.cashCollected(),
                        "outstanding",report.outstandingReceivables()));
            }
        }
        return context;
    }
}
