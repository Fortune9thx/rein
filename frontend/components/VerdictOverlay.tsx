"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { Verdict } from "@/lib/contracts";

const LABEL: Record<Verdict, string> = {
  IN_MANDATE: "IN MANDATE",
  DRIFT: "DRIFT",
  VIOLATION: "VIOLATION",
  PENDING: "PENDING",
};

export function VerdictOverlay({ verdict, onClose }: { verdict: Verdict | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {verdict && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ rotate: -8, scale: 0.6, opacity: 0 }}
            animate={{ rotate: -4, scale: 1, opacity: 1 }}
            exit={{ scale: 1.3, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="border-8 border-yellow px-10 py-6"
          >
            <span className="font-display text-6xl md:text-8xl text-yellow">{LABEL[verdict]}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
