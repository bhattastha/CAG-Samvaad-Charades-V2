import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { t } from "../lib/strings";
import { announce, stop, useVoice, type Line } from "../lib/voice";
import { SahayikaAvatar } from "./SahayikaAvatar";
import { Icon } from "./Icon";

/** Sahayika's welcome briefing (script W-01 … W-11): one line per subtitle, advancing when her voice finishes. */
export function Briefing({ lines, open, onClose }: { lines: Line[]; open: boolean; onClose(): void }) {
  const [i, setI] = useState(0);
  const st = useVoice();
  const played = useRef(false);
  const cur = lines[i];
  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => { if (open && cur) { played.current = false; announce(cur); } }, [open, i, cur?.id]);
  useEffect(() => {
    if (!open || !cur) return;
    if (st.line?.id === cur.id && st.status === "playing") played.current = true;
    if (played.current && st.status === "idle" && i < lines.length - 1) { const tm = window.setTimeout(() => setI((n) => n + 1), 600); return () => window.clearTimeout(tm); }
  }, [st.status, st.line?.id]);
  const close = () => { stop(); onClose(); };
  return createPortal(
    <AnimatePresence>
      {open && cur && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[96] bg-navy/60 grid place-items-center p-4" role="dialog" aria-modal="true" data-testid="briefing-modal">
          <motion.div initial={{ scale: 0.92, y: 16 }} animate={{ scale: 1, y: 0 }} className="card max-w-xl w-full p-6">
            <div className="flex items-center gap-3">
              <SahayikaAvatar size={64} />
              <div className="flex-1">
                <div className="kicker">{t("ob.briefing.kicker")}</div>
                <div className="text-sm text-muted tnum" data-testid="briefing-progress">{i + 1} / {lines.length}</div>
              </div>
              <button onClick={close} aria-label={t("common.close")} className="w-9 h-9 rounded-full grid place-items-center hover:bg-slate-100" data-testid="briefing-close"><Icon name="x" size={18} /></button>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={cur.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-4 min-h-[8rem]">
                <p className="text-[17px] font-semibold text-navy leading-snug" data-testid="briefing-line-en">{cur.en}</p>
                <p className="mt-2 text-[15px] text-muted leading-relaxed">{cur.hi}</p>
              </motion.div>
            </AnimatePresence>
            <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${((i + 1) / lines.length) * 100}%` }} /></div>
            <div className="mt-5 flex justify-between gap-3">
              <button className="btn-ghost" disabled={i === 0} onClick={() => setI(i - 1)} data-testid="briefing-prev"><Icon name="chevronLeft" size={16} /> {t("common.back")}</button>
              {i < lines.length - 1
                ? <button className="btn-primary" onClick={() => setI(i + 1)} data-testid="briefing-next">{t("common.next")} <Icon name="arrowRight" size={16} /></button>
                : <button className="btn-primary" onClick={close} data-testid="briefing-done">{t("ob.briefing.done")} <Icon name="check" size={16} /></button>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
