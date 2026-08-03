import { motion } from "framer-motion";
import type { Message } from "@/lib/types";
import { countGenuineSources } from "@/lib/email-proposal";
import { EmailProposalCard } from "./EmailProposalCard";
import { TacitMark } from "./TacitMark";
import { TraceDisclosure } from "./TraceDisclosure";

const CLASSIFICATION_CHIP: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  actionable:  { label: "Recommended action",   bg: "var(--green-tint)", color: "var(--green-dark)" },
  needs_caleb: { label: "Needs your call",       bg: "#fef3c7",           color: "#92400e" },
  ignore:      { label: "No action suggested",   bg: "var(--bubble)",     color: "var(--gray-1)" },
};

export function MessageBubble({ message }: { message: Message }) {
  if (message.role === "them") {
    const proposal = message.proposal;
    const chip = proposal ? CLASSIFICATION_CHIP[proposal.classification] : null;
    const citedCount = countGenuineSources(proposal?.matched_documents);
    const hasDraft = !!proposal?.draft_reply;
    const replyOptional = proposal?.classification === "actionable" && proposal?.reply_required === false;

    return (
      <div className="flex gap-2.5 items-start">
        <div className="shrink-0 mt-[3px]">
          <TacitMark size={24} />
        </div>
        <div className="flex flex-col gap-3 min-w-0">
        {message.text && (
          <motion.p
            className="font-serif text-ink max-w-[84%]"
            style={{ fontSize: "17px", lineHeight: 1.6, whiteSpace: "pre-wrap" }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            {message.text}
          </motion.p>
        )}

        {/* Proposal summary chips — shown above the card */}
        {proposal && (
          <div className="flex items-center gap-2 flex-wrap">
            {chip && (
              <span
                className="px-2.5 py-[4px] rounded-full text-[11px] font-medium"
                style={{ background: chip.bg, color: chip.color }}
              >
                {chip.label}
              </span>
            )}
            {citedCount > 0 && (
              <span
                className="px-2.5 py-[4px] rounded-full text-[11px]"
                style={{ background: "var(--bubble)", color: "var(--gray-1)", border: "0.5px solid var(--line)" }}
              >
                {citedCount} cited {citedCount === 1 ? "page" : "pages"}
              </span>
            )}
            {hasDraft && (
              <span
                className="px-2.5 py-[4px] rounded-full text-[11px] font-medium"
                style={{ background: "var(--green-tint)", color: "var(--green-dark)" }}
              >
                Draft ready
              </span>
            )}
            {replyOptional && (
              <span
                className="px-2.5 py-[4px] rounded-full text-[11px]"
                style={{ background: "var(--bubble)", color: "var(--gray-1)", border: "0.5px solid var(--line)" }}
              >
                No reply needed
              </span>
            )}
          </div>
        )}

        {proposal && <EmailProposalCard proposal={proposal} />}

        {message.runId && <TraceDisclosure runId={message.runId} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-end">
      <motion.p
        className="max-w-[84%] text-[15px] leading-relaxed text-ink/80"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        style={{
          background: "var(--bubble)",
          padding: "11px 16px",
          borderRadius: "15px 4px 15px 15px",
          whiteSpace: "pre-wrap",
          border: "0.5px solid var(--line-2)",
        }}
      >
        {message.text}
      </motion.p>
    </div>
  );
}
