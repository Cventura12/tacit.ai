"use client";

import { useState, useRef } from "react";
import { SUGGESTED_QUESTIONS } from "@/lib/knowledge";
import { CommandMenu } from "./CommandMenu";

interface Props {
  onSend: (text: string) => void;
  disabled: boolean;
  showChips: boolean;
}

const IcoAttach = () => (
  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
    <path
      d="M12.5 7.5l-5.5 5.5a3.5 3.5 0 01-4.95-4.95l6-6a2.5 2.5 0 013.54 3.54L5.6 11.1a1.5 1.5 0 01-2.12-2.12l5-5"
      stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"
    />
  </svg>
);

export function Composer({ onSend, disabled, showChips }: Props) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/owner/documents/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error ?? "Upload failed");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div
      className="shrink-0 bg-bg/95 backdrop-blur-sm"
      style={{ borderTop: "0.5px solid var(--line)" }}
    >
      {/* Suggested question chips */}
      {showChips && (
        <div className="flex flex-wrap gap-2 px-4 sm:px-5 pt-3 pb-1">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              disabled={disabled}
              className="
                px-3 py-[6px] rounded-full text-[12px]
                border border-line text-gray-1
                hover:border-green hover:text-green
                transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Hidden file input — lives outside the box so it survives re-renders */}
      <input
        ref={uploadInputRef}
        type="file"
        accept="application/pdf"
        className="sr-only"
        onChange={handleFileChange}
      />

      <div className="px-4 sm:px-5 py-3">
        {/* Bordered composer box */}
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "0.5px solid var(--line)" }}
        >
          {/* Textarea */}
          <label htmlFor="chat-input" className="sr-only">
            Ask about a document or paste another email
          </label>
          <textarea
            id="chat-input"
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask about a document or paste another email…"
            rows={2}
            disabled={disabled}
            className="
              w-full resize-none bg-bg px-4 pt-3 pb-2
              text-[14px] text-ink placeholder:text-gray-2 leading-relaxed
              overflow-y-auto focus:outline-none
              disabled:opacity-50
            "
            style={{ maxHeight: "180px" }}
          />

          {/* Bottom toolbar */}
          <div
            className="flex items-center gap-1.5 px-3 py-2"
            style={{ borderTop: "0.5px solid var(--line-2)" }}
          >
            {/* Left: command menu + attach + grounded mode pill */}
            <div className="flex items-center gap-1">
              <CommandMenu
                onUploadClick={() => uploadInputRef.current?.click()}
                uploading={uploading}
                uploadError={uploadError}
              />
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                disabled={uploading}
                aria-label="Attach PDF"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-2 hover:text-ink hover:bg-ink/[0.07] transition-colors disabled:opacity-40"
              >
                <IcoAttach />
              </button>
            </div>

            {/* Grounded mode pill — informational, always active in owner context */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-full"
              style={{ border: "0.5px solid var(--line)", background: "var(--bubble)" }}
              aria-label="Grounded mode active"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <circle cx="5.5" cy="5.5" r="4.5" stroke="var(--green)" strokeWidth="1.1" />
                <circle cx="5.5" cy="5.5" r="2" stroke="var(--green)" strokeWidth="1.1" />
                <path d="M5.5 1v9M1 5.5h9" stroke="var(--green)" strokeWidth="0.8" strokeOpacity="0.5" />
              </svg>
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--green)" }}
              >
                Grounded mode
              </span>
            </div>

            {uploadError && (
              <p className="text-[11px] text-red-600 truncate ml-1">{uploadError}</p>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Send button */}
            <button
              onClick={() => send(input)}
              disabled={disabled}
              aria-label="Send"
              className="
                w-[34px] h-[34px] rounded-lg bg-green shrink-0
                flex items-center justify-center
                hover:bg-navy-soft transition-colors
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-green focus-visible:outline-offset-2
                disabled:opacity-40 disabled:cursor-not-allowed
              "
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2 8h12M9 3.5l4.5 4.5L9 12.5"
                  stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <p className="mt-2 text-center text-[10px] text-gray-3 tracking-wide">
          TACIT retrieves and cites. you decide what the evidence means.
        </p>
      </div>
    </div>
  );
}
