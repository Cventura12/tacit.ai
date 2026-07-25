"use client";

import { useEffect, useRef } from "react";
import type { Message, TraceStep } from "@/lib/types";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";
import { PipelineView } from "./PipelineView";

interface Props {
  messages: Message[];
  isTyping: boolean;
  toolStatus: string | null;
  traceSteps: TraceStep[];
}

export function MessageList({ messages, isTyping, toolStatus, traceSteps }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isTyping, toolStatus, traceSteps.length]);

  return (
    <div className="flex flex-col gap-[22px] px-4 sm:px-8 pt-7 pb-4">
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      {isTyping && (
        traceSteps.length > 0
          ? <PipelineView steps={traceSteps} />
          : <TypingIndicator />
      )}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
}
