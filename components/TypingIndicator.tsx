import { motion } from "framer-motion";

export function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-[5px] py-[6px]">
        {[0, 0.2, 0.4].map((delay) => (
          <motion.span
            key={delay}
            style={{
              display: "inline-block",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--gray-2)",
            }}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity, delay }}
          />
        ))}
      </div>
    </div>
  );
}
