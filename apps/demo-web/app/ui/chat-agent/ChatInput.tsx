"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (content: string) => void;
  onStop: () => void;
  disabled?: boolean;
  isAgentRunning?: boolean;
}

export function ChatInput({ onSend, onStop, disabled, isAgentRunning }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue("");

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, []);

  return (
    <div className="chatInputContainer" id="chat-input-container">
      <div className="chatInputWrapper">
        <textarea
          ref={textareaRef}
          className="chatInputField"
          id="chat-input-field"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled}
        />
        <div className="chatInputActions">
          {isAgentRunning ? (
            <button
              className="chatStopBtn"
              id="chat-stop-btn"
              onClick={onStop}
              title="Stop agent"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button
              className="chatSendBtn"
              id="chat-send-btn"
              onClick={handleSend}
              disabled={!value.trim() || disabled}
              title="Send message"
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2.5 8L13.5 8M13.5 8L8.5 3M13.5 8L8.5 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
