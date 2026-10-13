'use client';

import React, { useState, useEffect, useRef } from 'react';

export interface TerminalProps {
  commands?: string[];
  outputs?: Record<number, string[]>;
  typingSpeed?: number;
  delayBetweenCommands?: number;
  className?: string;
  title?: string;
  autoStart?: boolean;
}

export function Terminal({
  commands = [
    'mantis scan ./backend',
    'mantis test ./backend --base-url http://127.0.0.1:3000',
  ],
  outputs = {
    0: [
      'Mantis Scanner — Express (javascript) | Root: backend',
      'Endpoints (6 discovered: 6 confirmed, 0 uncertain)',
      '  ✓ GET     /health               backend/app.js:10',
      '  ✓ GET     /users                backend/app.js:15',
      '  ✓ POST    /users                backend/app.js:26 (reads req.body.email)',
      '  ✓ GET     /users/:id            backend/app.js:20',
      '  ✓ PUT     /users/:id            backend/app.js:32 (reads req.body.email)',
      '  ✓ DELETE  /users/:id            backend/app.js:39',
      'Scan complete in 42ms. Clean model generated.',
    ],
    1: [
      'Target: http://127.0.0.1:3000 | Allowed: read | Planned: 2 | Skipped: 4',
      'Executing contract test cases...',
      '  ✓ GET /health::valid-baseline (200 OK - 11ms)',
      '  ✓ GET /users::valid-baseline (200 OK - 16ms)',
      '  ⚠ POST /users::empty-body (Skipped: safe read mode)',
      '  ⚠ PUT /users/:id::valid-baseline (Skipped: safe read mode)',
      'Summary: 6 tests | ✓ 2 Passed | ✕ 0 Failed | ⚠ 4 Skipped',
      'All tests verified. Zero findings.',
    ],
  },
  typingSpeed = 38,
  delayBetweenCommands = 1200,
  className = '',
  title,
  autoStart = true,
}: TerminalProps) {
  const [currentCmdIndex, setCurrentCmdIndex] = useState(0);
  const [typedChars, setTypedChars] = useState(0);
  const [isTyping, setIsTyping] = useState(true);
  const [completedSteps, setCompletedSteps] = useState<
    { command: string; output: string[] }[]
  >([]);
  const [copied, setCopied] = useState(false);

  const terminalContentRef = useRef<HTMLDivElement>(null);

  // Restart typing if commands change
  useEffect(() => {
    setCompletedSteps([]);
    setCurrentCmdIndex(0);
    setTypedChars(0);
    setIsTyping(true);
  }, [commands]);

  // Main typing engine
  useEffect(() => {
    if (!autoStart || currentCmdIndex >= commands.length) return;

    const targetCmd = commands[currentCmdIndex];

    if (typedChars < targetCmd.length) {
      const timer = setTimeout(() => {
        setTypedChars((prev) => prev + 1);
      }, typingSpeed + (Math.random() * 25 - 12));
      return () => clearTimeout(timer);
    }

    // Command finished typing -> reveal output after small pause
    setIsTyping(false);
    const outputTimer = setTimeout(() => {
      const cmdOutput = outputs[currentCmdIndex] || [];
      setCompletedSteps((prev) => [
        ...prev,
        { command: targetCmd, output: cmdOutput },
      ]);

      // Move to next command
      const nextTimer = setTimeout(() => {
        setCurrentCmdIndex((prev) => prev + 1);
        setTypedChars(0);
        setIsTyping(true);
      }, delayBetweenCommands);

      return () => clearTimeout(nextTimer);
    }, 450);

    return () => clearTimeout(outputTimer);
  }, [
    autoStart,
    currentCmdIndex,
    typedChars,
    commands,
    outputs,
    typingSpeed,
    delayBetweenCommands,
  ]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalContentRef.current) {
      terminalContentRef.current.scrollTop = terminalContentRef.current.scrollHeight;
    }
  }, [completedSteps, typedChars]);

  const handleCopy = () => {
    const fullText = commands.join('\n');
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const currentCommand = commands[currentCmdIndex] || '';
  const displayedTypedCommand = currentCommand.slice(0, typedChars);
  const displayTitle = title || commands[currentCmdIndex] || 'mantis terminal';

  return (
    <div
      className={`terminal-frame ${className}`}
      role="region"
      aria-label="Interactive CLI Terminal"
    >
      {/* Terminal Title Bar */}
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="dot dot-red" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>

        <div className="terminal-title">{displayTitle}</div>

        <div className="terminal-actions">
          {/* Copy Button */}
          <button
            type="button"
            onClick={handleCopy}
            className="terminal-btn"
            title="Copy command"
            aria-label="Copy command"
          >
            {copied ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Terminal Content Body */}
      <div className="terminal-body" ref={terminalContentRef}>
        {/* Render already completed commands & outputs */}
        {completedSteps.map((step, idx) => (
          <div key={idx} className="terminal-step">
            <div className="terminal-command-line">
              <span className="terminal-prompt">$</span>
              <span className="terminal-command-text">{step.command}</span>
            </div>
            <div className="terminal-output-block">
              {step.output.map((line, lIdx) => (
                <div key={lIdx} className="terminal-output-line">
                  {formatOutputLine(line)}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Currently typing command */}
        {currentCmdIndex < commands.length && (
          <div className="terminal-active-line">
            <span className="terminal-prompt">$</span>
            <span className="terminal-command-text">
              {displayedTypedCommand}
              <span className={`terminal-cursor ${isTyping ? 'typing' : ''}`}>█</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Syntax highlight helper for CLI status checks and outputs
function formatOutputLine(line: string) {
  if (line.includes('✓')) {
    const parts = line.split('✓');
    return (
      <>
        {parts[0]}
        <span className="text-emerald font-semibold">✓</span>
        <span className="text-slate">{parts[1]}</span>
      </>
    );
  }
  if (line.includes('⚠')) {
    const parts = line.split('⚠');
    return (
      <>
        {parts[0]}
        <span className="text-amber font-semibold">⚠</span>
        <span className="text-slate-muted">{parts[1]}</span>
      </>
    );
  }
  if (line.startsWith('Endpoints') || line.startsWith('Target:') || line.startsWith('Summary:')) {
    return <span className="text-highlight">{line}</span>;
  }
  return <span className="text-dim">{line}</span>;
}
