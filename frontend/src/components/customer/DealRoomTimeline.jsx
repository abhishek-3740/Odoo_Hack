import React, { useState } from 'react';
import { formatDateTime } from '../../services/api';
import { MessageSquare, Send, Reply, Handshake, Ban, CheckCircle2, Clock } from 'lucide-react';

const TYPE_CHIP = {
  COMMENT: 'bg-slate-100 text-slate-700 border-slate-200',
  CHANGE: 'bg-amber-50 text-amber-800 border-amber-200',
  COUNTER: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const STATUS_META = {
  OPEN: { chip: 'bg-slate-50 text-slate-600 border-slate-200', icon: Clock, label: 'Open' },
  ANSWERED: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: Reply, label: 'Answered' },
  ADOPTED: { chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', icon: Handshake, label: 'Adopted' },
  DECLINED: { chip: 'bg-rose-50 text-rose-700 border-rose-200', icon: Ban, label: 'Declined' },
  SUPERSEDED: { chip: 'bg-slate-100 text-slate-500 border-slate-200', icon: CheckCircle2, label: 'Superseded' },
};

function Chip({ className, children }) {
  return (
    <span className={`inline-flex items-center space-x-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${className}`}>
      {children}
    </span>
  );
}

/**
 * Chat-style negotiation trail. Customer messages sit on the right, the
 * seller's replies on the left. `activity` is the portal's PortalActivity[]
 * (newest first from the API; rendered oldest first here).
 */
export function DealRoomTimeline({ activity, onQuickComment, sending, disabled, error }) {
  const [draft, setDraft] = useState('');
  const ordered = [...(activity || [])].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  const submit = async (e) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    const ok = await onQuickComment(message);
    if (ok) setDraft('');
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs flex flex-col overflow-hidden">
      <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between">
        <h3 className="font-semibold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
          <MessageSquare className="w-4 h-4 text-indigo-600" />
          <span>Deal room</span>
        </h3>
        <span className="text-[11px] text-slate-500">{ordered.length} {ordered.length === 1 ? 'message' : 'messages'}</span>
      </div>

      <div className="p-4 space-y-4 max-h-[520px] overflow-y-auto" aria-live="polite">
        {ordered.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs">
            No messages yet. Ask a question or counter a line — your account manager replies here.
          </div>
        ) : (
          ordered.map((act) => {
            const status = STATUS_META[act.status] || STATUS_META.OPEN;
            const StatusIcon = status.icon;
            return (
              <div key={act.id} className="space-y-2">
                {/* Customer message: right aligned */}
                <div className="flex justify-end">
                  <div className="max-w-[85%]">
                    <div className="flex items-center justify-end space-x-1.5 mb-1">
                      <Chip className={TYPE_CHIP[act.requestType] || TYPE_CHIP.COMMENT}>{act.requestType}</Chip>
                      {act.lineKey && (
                        <span className="text-[10px] text-slate-400 font-mono">line {act.lineKey}</span>
                      )}
                      <Chip className={status.chip}>
                        <StatusIcon className="w-3 h-3" />
                        <span>{status.label}</span>
                      </Chip>
                    </div>
                    <div className="bg-indigo-600 text-white text-xs rounded-2xl rounded-tr-sm px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap">
                      {act.message || <em className="opacity-80">(no message)</em>}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1 text-right">You · {formatDateTime(act.createdAt)}</div>
                  </div>
                </div>

                {/* Seller reply: left aligned */}
                {act.responseMessage && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%]">
                      <div className="bg-slate-100 text-slate-800 text-xs rounded-2xl rounded-tl-sm px-3.5 py-2.5 leading-relaxed whitespace-pre-wrap border border-slate-200">
                        {act.responseMessage}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        Account manager · {formatDateTime(act.respondedAt)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={submit} className="p-3 border-t border-slate-200 bg-slate-50/60">
        {error && (
          <div role="alert" className="mb-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5">
            {error}
          </div>
        )}
        <label htmlFor="deal-room-composer" className="sr-only">
          Message your account manager
        </label>
        <div className="flex items-end space-x-2">
          <textarea
            id="deal-room-composer"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
            disabled={disabled || sending}
            maxLength={2000}
            placeholder={disabled ? 'This deal room is closed.' : 'Ask a question or leave a note… (Ctrl+Enter to send)'}
            className="flex-1 text-xs p-2.5 rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60 disabled:bg-slate-100 resize-none"
          />
          <button
            type="submit"
            disabled={disabled || sending || !draft.trim()}
            aria-label="Send message"
            className="h-9 px-3.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-semibold inline-flex items-center space-x-1.5 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/60"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{sending ? 'Sending…' : 'Send'}</span>
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-1.5">
          Text never changes your terms. Use <strong>Counter discount</strong> on a line to propose numbers.
        </p>
      </form>
    </div>
  );
}
