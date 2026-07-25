import { motion } from "framer-motion";

export function StatusLine({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[7px] px-1" role="status" aria-live="polite">
      <motion.span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--gray-2)",
          flexShrink: 0,
        }}
        animate={{ opacity: [0.2, 0.7, 0.2] }}
        transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity }}
      />
      <span className="text-[13.5px] italic text-gray-1 leading-none">{label}</span>
    </div>
  );
}
