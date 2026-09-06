package com.dealflow.billing.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.billing.dto.BillingDtos.PlanChangeRequest;
import com.dealflow.billing.models.*;
import com.dealflow.billing.repo.*;
import com.dealflow.catalog.models.SubscriptionPlan;
import com.dealflow.catalog.models.CatalogEnums.BillingAnchor;
import com.dealflow.catalog.repo.SubscriptionPlanRepository;
import com.dealflow.catalog.repo.ProductRepository;
import com.dealflow.config.AppProperties;
import com.dealflow.outbox.service.OutboxWriter;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import com.dealflow.shared.money.Money;
import com.dealflow.shared.time.BusinessClock;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class PlanSwitchService {
    private final SubscriptionRepository subscriptions;
    private final SubscriptionPlanRepository plans;
    private final ProductRepository products;
    private final SubscriptionChangeRepository changes;
    private final InvoiceRepository invoices;
    private final InvoiceLineRepository lines;
    private final CreditNoteRepository credits;
    private final UnusedSubscriptionCoverage unused;
    private final ProrationCalculator proration;
    private final BillingService billing;
    private final SettlementService settlement;
    private final BusinessClock clock;
    private final AppProperties properties;
    private final AuditService audit;
    private final OutboxWriter outbox;
    private final ObjectMapper json;
    public PlanSwitchService(SubscriptionRepository subscriptions, SubscriptionPlanRepository plans, ProductRepository products,
            SubscriptionChangeRepository changes, InvoiceRepository invoices, InvoiceLineRepository lines,
            CreditNoteRepository credits, UnusedSubscriptionCoverage unused, ProrationCalculator proration,
            BillingService billing, SettlementService settlement, BusinessClock clock, AppProperties properties,
            AuditService audit, OutboxWriter outbox, ObjectMapper json) {
        this.subscriptions=subscriptions;this.plans=plans;this.products=products;this.changes=changes;this.invoices=invoices;
        this.lines=lines;this.credits=credits;this.unused=unused;this.proration=proration;this.billing=billing;
        this.settlement=settlement;this.clock=clock;this.properties=properties;this.audit=audit;this.outbox=outbox;this.json=json;
    }
    public record Preview(UUID subscriptionId, UUID newPlanId, String newPlanName, long rowVersion,
            LocalDate effectiveDate, LocalDate coverageEnd, BigDecimal oldCreditNet, BigDecimal oldCreditTax,
            BigDecimal newChargeNet, BigDecimal newChargeTax, boolean intervalChanged, String explanation,
            UUID invoiceId, UUID creditNoteId, boolean applied) {}
    private record Calculation(SubscriptionPlan plan, LocalDate date, LocalDate end,
            UnusedSubscriptionCoverage.Credit credit, ProrationCalculator.Adjustment charge, boolean intervalChanged) {}

    @Transactional(readOnly=true)
    public Preview preview(UUID id, PlanChangeRequest request) {
        var sub=subscriptions.findById(id).orElseThrow(() -> ApiException.notFound("Subscription"));
        return response(sub, calculate(sub,request),null,null,false);
    }
    @Transactional
    public Preview apply(UUID id, PlanChangeRequest request, String key, Actor actor) {
        var sub=subscriptions.findByIdForUpdate(id).orElseThrow(() -> ApiException.notFound("Subscription"));
        if (request.expectedRowVersion()==null || request.expectedRowVersion()!=sub.getRowVersion())
            throw new ApiException(ErrorCode.CONFLICTING_STATE,"Subscription changed. Preview the latest terms first.");
        var c=calculate(sub,request);
        String before=snapshot(sub);
        var change=changes.save(new SubscriptionChange(id,SubscriptionChange.ChangeType.PLAN,c.date(),before,
                json.writeValueAsString(Map.of("planId",c.plan().getId(),"periodEnd",c.end())),key,actor.profileId(),clock.now()));
        CreditNote credit=null;
        if(c.credit().net()+c.credit().tax()>0) {
            credit=new CreditNote("CN-"+credits.nextReferenceNumber(),sub.getCustomerId(),sub.getCurrency(),
                    "Unused coverage before plan switch",c.credit().net(),c.credit().tax(),actor.profileId());
            credit.setSubscriptionId(id);credit.setSubscriptionChangeId(change.getId());credit.setCoverage(c.date(),sub.getPeriodEnd());
            credits.save(credit);change.setCreditNoteId(credit.getId());
        }
        Invoice invoice=billing.newInvoice(sub.getCustomerId(),Invoice.InvoiceKind.ADJUSTMENT,sub.getCurrency());
        invoice.setSubscriptionId(id);invoice.setOrderId(sub.getOrderId());invoices.save(invoice);
        InvoiceLine line=new InvoiceLine(invoice.getId(),"Plan switch to "+c.plan().getName(),sub.getQuantity(),
                c.plan().getIntervalPriceMinor(),c.charge().netMinor(),c.plan().getTaxRateBp(),c.charge().taxMinor());
        line.setSubscriptionId(id);line.setCoverage(c.date(),c.end());line.setLineType(InvoiceLine.LineType.PRORATION);
        line.setChargeKey(InvoiceLine.adjustmentChargeKey(id,c.date(),c.end(),change.getId()));lines.save(line);
        invoice.addLineTotals(c.charge().netMinor(),c.charge().taxMinor());
        invoice.issue(clock.businessToday(),clock.businessToday().plusDays(properties.billing().invoiceDueDays()));
        change.setAdjustmentInvoiceId(invoice.getId());
        if(credit!=null) settlement.applyCreditToOpenInvoices(credit,actor);
        sub.setPlanId(c.plan().getId());sub.setUnitIntervalPriceMinor(c.plan().getIntervalPriceMinor());
        sub.setUnitIntervalCostMinor(c.plan().getIntervalCostMinor());sub.setTaxRateBp(c.plan().getTaxRateBp());
        sub.setProrationPolicy(c.plan().getProrationPolicy());sub.setCancellationPolicy(c.plan().getCancellationPolicy());
        if(c.intervalChanged()) {
            sub.setIntervalMonths(c.plan().getIntervalMonths());sub.setPeriodStart(c.date());sub.setPeriodEnd(c.end());
            sub.setAnchorDay(c.date().getDayOfMonth());sub.setBillingAnchor(BillingAnchor.ACTIVATION_DATE);sub.setNextBillAt(c.end());
        }
        audit.record(actor,"SUBSCRIPTION_PLAN_CHANGED","Subscription",id).before(Map.of("snapshot",before))
                .after(Map.of("newPlanId",c.plan().getId(),"creditNet",c.credit().net(),"chargeNet",c.charge().netMinor())).reason(request.note()).save();
        outbox.publish(OutboxWriter.Events.SUBSCRIPTION_UPDATED,"Subscription",id,sub.getRowVersion(),Map.of("changeType","PLAN"),OutboxWriter.RecipientScope.deal(sub.getCustomerId(),null,null));
        outbox.publish(OutboxWriter.Events.INVOICE_UPDATED,"Invoice",invoice.getId(),invoice.getRowVersion(),Map.of("kind","ADJUSTMENT"),OutboxWriter.RecipientScope.deal(sub.getCustomerId(),null,null));
        subscriptions.flush();
        return response(sub,c,invoice.getId(),credit==null?null:credit.getId(),true);
    }
    private Calculation calculate(Subscription sub,PlanChangeRequest request) {
        if(sub.getStatus()!=Subscription.SubscriptionStatus.ACTIVE) throw new ApiException(ErrorCode.SUBSCRIPTION_NOT_ACTIVE,"Only active subscriptions can switch plans.");
        LocalDate date=request.effectiveDate()==null?clock.businessToday():request.effectiveDate();
        if(!date.equals(clock.businessToday())) throw new ApiException(ErrorCode.BACKDATED_CHANGE_REJECTED,"An immediate plan switch must take effect today.");
        if(date.isBefore(sub.getPeriodStart()) || !date.isBefore(sub.getPeriodEnd())) throw new ApiException(ErrorCode.EFFECTIVE_DATE_OUT_OF_PERIOD,"Run due billing before switching this plan.");
        var plan=plans.findById(request.newPlanId()).orElseThrow(() -> ApiException.notFound("Plan"));
        var old=plans.findById(sub.getPlanId()).orElseThrow(() -> ApiException.notFound("Current plan"));
        if(!plan.isActive() || !products.findById(plan.getProductId()).orElseThrow().isActive()
                || !plan.getProductId().equals(old.getProductId()) || !plan.getCurrency().equals(sub.getCurrency()) || plan.getId().equals(old.getId()))
            throw new ApiException(ErrorCode.VALIDATION_FAILED,"Select a different active plan for the same product and currency.");
        boolean changed=plan.getIntervalMonths()!=sub.getIntervalMonths();
        LocalDate end=changed?date.plusMonths(plan.getIntervalMonths()):sub.getPeriodEnd();
        var charge=proration.remainderAtNewPrice(sub.getQuantity(),plan.getIntervalPriceMinor(),date,
                changed?date:sub.getPeriodStart(),end,plan.getTaxRateBp());
        return new Calculation(plan,date,end,unused.at(sub.getId(),date),charge,changed);
    }
    private Preview response(Subscription sub,Calculation c,UUID invoice,UUID credit,boolean applied) {
        return new Preview(sub.getId(),c.plan().getId(),c.plan().getName(),sub.getRowVersion(),c.date(),c.end(),
                Money.toMajor(c.credit().net()),Money.toMajor(c.credit().tax()),Money.toMajor(c.charge().netMinor()),Money.toMajor(c.charge().taxMinor()),c.intervalChanged(),
                "Old coverage is credited separately; new service uses the selected plan's current catalog price. "
                        +(c.intervalChanged()?"A full new calendar interval starts today.":"The current period end is preserved."),invoice,credit,applied);
    }
    private String snapshot(Subscription sub) { return json.writeValueAsString(Map.of("planId",sub.getPlanId(),"priceMinor",sub.getUnitIntervalPriceMinor(),"quantity",sub.getQuantity(),"periodStart",sub.getPeriodStart(),"periodEnd",sub.getPeriodEnd())); }
}
