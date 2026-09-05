package com.dealflow.portal.service;

import com.dealflow.auth.models.Actor;
import com.dealflow.auth.models.Role;
import com.dealflow.auth.repo.ProfileRepository;
import com.dealflow.health.models.Notification;
import com.dealflow.health.repo.NotificationRepository;
import com.dealflow.quotes.repo.QuoteRepository;
import com.dealflow.quotes.service.QuoteAccessPolicy;
import com.dealflow.shared.audit.AuditService;
import com.dealflow.shared.error.ApiException;
import com.dealflow.shared.error.ErrorCode;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DealEscalationService {
    public enum Category { DISCOUNT, POLICY, REVIEW }
    public record Create(@NotNull UUID quoteId, @NotNull UUID expectedRevisionId,
            @NotNull UUID requestKey, @NotNull Category category, @NotBlank @Size(max=2000) String reason) {}
    public record Resolve(@NotBlank @Size(max=2000) String resolution) {}
    public record Escalation(UUID id, UUID quoteId, UUID revisionId, String reference,
            UUID raisedBy, String category, String targetRole, String reason, String status,
            String resolution, Instant createdAt, Instant resolvedAt) {}
    private static final String SELECT = "select e.*, q.reference from dealflow.deal_escalations e join dealflow.quotes q on q.id=e.quote_id ";
    private static final RowMapper<Escalation> MAPPER = (r, n) -> new Escalation(
            r.getObject("id", UUID.class), r.getObject("quote_id", UUID.class), r.getObject("revision_id", UUID.class),
            r.getString("reference"), r.getObject("raised_by", UUID.class), r.getString("category"),
            r.getString("target_role"), r.getString("reason"), r.getString("status"), r.getString("resolution"),
            r.getTimestamp("created_at").toInstant(), r.getTimestamp("resolved_at") == null ? null : r.getTimestamp("resolved_at").toInstant());
    private final JdbcTemplate jdbc;
    private final QuoteRepository quotes;
    private final QuoteAccessPolicy access;
    private final ProfileRepository profiles;
    private final NotificationRepository notifications;
    private final AuditService audit;

    public DealEscalationService(JdbcTemplate jdbc, QuoteRepository quotes, QuoteAccessPolicy access,
            ProfileRepository profiles, NotificationRepository notifications, AuditService audit) {
        this.jdbc=jdbc; this.quotes=quotes; this.access=access; this.profiles=profiles;
        this.notifications=notifications; this.audit=audit;
    }

    @Transactional(readOnly=true)
    public List<Escalation> list(UUID quoteId, Actor actor) {
        if (!actor.isInternal()) throw ApiException.forbidden("Escalations are an internal workspace.");
        if (quoteId != null) access.requireRead(actor, quotes.findById(quoteId).orElseThrow(() -> ApiException.notFound("Quotation")));
        String scope;
        Object scopeValue;
        if (actor.isAdmin()) { scope="true"; scopeValue=null; }
        else if (actor.role()==Role.REP) { scope="q.owner_profile_id=?"; scopeValue=actor.profileId(); }
        else if (actor.role()==Role.MANAGER && actor.teamId()!=null) { scope="q.team_id=?"; scopeValue=actor.teamId(); }
        else { scope="true"; scopeValue=null; }
        List<Object> args=new ArrayList<>();
        if(scopeValue!=null) args.add(scopeValue);
        if(quoteId!=null) args.add(quoteId);
        return jdbc.query(SELECT+"where "+scope+(quoteId==null ? "" : " and e.quote_id=?")+" order by e.created_at desc limit 100", MAPPER, args.toArray());
    }

    @Transactional
    public Escalation create(Create input, Actor actor) {
        var quote=quotes.findByIdForUpdate(input.quoteId()).orElseThrow(() -> ApiException.notFound("Quotation"));
        access.requireRead(actor, quote);
        var prior=jdbc.query(SELECT+"where e.raised_by=? and e.request_key=?", MAPPER, actor.profileId(), input.requestKey());
        if(!prior.isEmpty()) {
            var old=prior.getFirst();
            if(!old.quoteId().equals(input.quoteId()) || !old.revisionId().equals(input.expectedRevisionId())
                    || !old.reason().equals(input.reason().trim()) || !old.category().equals(input.category().name()))
                throw new ApiException(ErrorCode.CONFLICTING_STATE,"Request key already used for different escalation details.");
            return old;
        }
        if(!quote.getCurrentRevisionId().equals(input.expectedRevisionId()))
            throw new ApiException(ErrorCode.CONFLICTING_STATE,"Quotation changed. Refresh before escalating.");
        if(!quote.getStage().isOpen()) throw new ApiException(ErrorCode.CONFLICTING_STATE,"This quotation is closed.");
        Role target=switch(input.category()) { case DISCOUNT -> Role.FINANCE; case POLICY -> Role.ADMIN; case REVIEW -> Role.MANAGER; };
        UUID id=UUID.randomUUID();
        jdbc.update("insert into dealflow.deal_escalations(id,quote_id,revision_id,raised_by,request_key,category,target_role,reason) values (?,?,?,?,?,?,?,?)",
                id,input.quoteId(),input.expectedRevisionId(),actor.profileId(),input.requestKey(),input.category().name(),target.name(),input.reason().trim());
        var recipients=profiles.findActiveByRole(target).stream().filter(p -> target!=Role.MANAGER || p.getTeamId()==null || Objects.equals(p.getTeamId(),quote.getTeamId())).toList();
        // Admin receives an unassigned case when no qualified recipient is available.
        if(recipients.isEmpty()) recipients=profiles.findActiveByRole(Role.ADMIN);
        for(var profile:recipients) {
            var note=new Notification(profile.getId(),"DEAL_ESCALATED","Review needed: "+quote.getReference());
            note.setBody(input.reason().trim()); note.setQuoteId(quote.getId());
            note.setDedupeKey("escalation:"+id+":"+profile.getId()); notifications.save(note);
        }
        audit.record(actor,"DEAL_ESCALATED","DealEscalation",id).quote(quote.getId()).revision(input.expectedRevisionId())
                .after(Map.of("targetRole",target.name(),"category",input.category().name())).reason(input.reason()).save();
        return jdbc.queryForObject(SELECT+"where e.id=?",MAPPER,id);
    }

    @Transactional
    public Escalation resolve(UUID id, Resolve input, Actor actor) {
        if(!actor.isInternal()) throw ApiException.forbidden("Internal review only.");
        var rows=jdbc.query(SELECT+"where e.id=? for update of e",MAPPER,id);
        if(rows.isEmpty()) throw ApiException.notFound("Escalation");
        var escalation=rows.getFirst();
        access.requireRead(actor,quotes.findById(escalation.quoteId()).orElseThrow());
        if(!actor.isAdmin() && !actor.role().name().equals(escalation.targetRole())) throw ApiException.forbidden("Resolve this case as "+escalation.targetRole()+" or ADMIN.");
        if(!escalation.status().equals("OPEN")) throw new ApiException(ErrorCode.CONFLICTING_STATE,"This escalation is already resolved.");
        jdbc.update("update dealflow.deal_escalations set status='RESOLVED',resolution=?,resolved_by=?,resolved_at=now() where id=?",
                input.resolution().trim(),actor.profileId(),id);
        audit.record(actor,"ESCALATION_RESOLVED","DealEscalation",id).quote(escalation.quoteId()).revision(escalation.revisionId()).reason(input.resolution()).save();
        var note=new Notification(escalation.raisedBy(),"ESCALATION_RESOLVED","Review completed: "+escalation.reference());
        note.setBody(input.resolution().trim()); note.setQuoteId(escalation.quoteId()); notifications.save(note);
        return jdbc.queryForObject(SELECT+"where e.id=?",MAPPER,id);
    }
}
