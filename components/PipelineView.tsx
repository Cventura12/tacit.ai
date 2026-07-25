"use client";

import { motion } from "framer-motion";
import type { TraceStep } from "@/lib/types";
import { TacitMark } from "./TacitMark";

function IcoCheck() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path d="M1.5 4l1.8 1.8L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <motion.span
      aria-hidden="true"
      style={{
        display: "block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--ink)",
        flexShrink: 0,
      }}
      animate={{ opacity: [0.2, 0.8, 0.2] }}
      transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
    />
  );
}

export function PipelineView({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="flex gap-2.5 items-start" role="status" aria-label="Agent pipeline">
      <div className="shrink-0 mt-[3px]">
        <TacitMark size={24} />
      </div>

      <div className="flex flex-col gap-[9px] pt-[3px]">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            className="flex items-center gap-[7px]"
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            {step.status === "done" ? (
              <span
                className="w-[14px] h-[14px] rounded-full flex items-center justify-center shrink-0"
                style={{ background: "var(--green)" }}
              >
                <IcoCheck />
              </span>
            ) : (
              <span className="w-[14px] h-[14px] flex items-center justify-center shrink-0">
                <Spinner />
              </span>
            )}
            <span
              className="text-[12px] leading-none"
              style={{
                color: step.status === "done" ? "var(--gray-2)" : "var(--gray-1)",
                fontStyle: step.status === "active" ? "italic" : "normal",
              }}
            >
              {step.label}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
