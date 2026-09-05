import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Modal({ isOpen, onClose, title, subtitle, children, maxWidth = 'max-w-lg' }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (isOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [isOpen]);
  return <dialog ref={dialog} aria-modal="true" aria-labelledby={titleId}
    onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    className={`common-dialog m-auto max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-xl bg-white text-left shadow-2xl ${maxWidth}`}>
    <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
      <div><h2 id={titleId} className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}</div>
      <button type="button" onClick={onClose} aria-label="Close dialog" className="text-slate-500 rounded-lg p-2 hover:bg-slate-100"><X size={20} /></button>
    </div>
    {isOpen && <div className="p-6">{children}</div>}
  </dialog>;
}
