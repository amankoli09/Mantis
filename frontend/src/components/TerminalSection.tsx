'use client';

import React, { useState } from 'react';
import { Terminal } from '@/components/ui/terminal';

export function TerminalSection() {
  const [activeTab, setActiveTab] = useState<'scan' | 'test'>('scan');

  const scanCommands = ['mantis scan ./backend'];
  const scanOutputs = {
    0: [
      'DevGuard Scanner — Express (javascript) | Root: backend',
      '',
      'Endpoints (6 discovered: 6 confirmed, 0 uncertain):',
      '  ✓ GET     /health               backend/app.js:10',
      '  ✓ GET     /users                backend/app.js:15',
      '  ✓ POST    /users                backend/app.js:26 (reads req.body.email)',
      '  ✓ GET     /users/:id            backend/app.js:20',
      '  ✓ PUT     /users/:id            backend/app.js:32 (reads req.body.email)',
      '  ✓ DELETE  /users/:id            backend/app.js:39',
      '',
      'Scan complete in 38ms. 6/6 endpoints mapped with line provenance.',
    ],
  };

  const testCommands = ['mantis test ./backend --base-url http://127.0.0.1:3000'];
  const testOutputs = {
    0: [
      'Target: http://127.0.0.1:3000 | Allowed: read | Planned: 2 | Skipped: 4',
      '',
      'Executing contract test cases...',
      '  ✓ GET /health::valid-baseline (200 OK - 11ms)',
      '  ✓ GET /users::valid-baseline (200 OK - 16ms)',
      '  ⚠ POST /users::empty-body (Skipped: safe read mode)',
      '  ⚠ POST /users::missing-field (Skipped: safe read mode)',
      '  ⚠ PUT /users/:id::valid-baseline (Skipped: safe read mode)',
      '  ⚠ DELETE /users/:id::valid-baseline (Skipped: safe read mode)',
      '',
      'Summary: 6 tests | ✓ 2 Passed | ✕ 0 Failed | ⚠ 4 Skipped',
      'All live routes verified against static AST. Clean exit.',
    ],
  };

  return (
    <section className="terminal-section" id="terminal">
      <div className="terminal-section-inner">
        {/* Section Heading & Subtitle matching reference */}
        <div className="terminal-heading-block">
          <h2 className="terminal-heading">
            From source code to a tested API in two commands.
          </h2>
          <p className="terminal-subheading">
            There is no OpenAPI file to write or keep up to date. Mantis works from
            the code you already have.
          </p>

          {/* Interactive Pill Switcher [Scan] [Test] */}
          <div className="tab-pill-group" role="tablist" aria-label="Command Mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'scan'}
              className={`pill-btn ${activeTab === 'scan' ? 'active' : ''}`}
              onClick={() => setActiveTab('scan')}
            >
              Scan
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'test'}
              className={`pill-btn ${activeTab === 'test' ? 'active' : ''}`}
              onClick={() => setActiveTab('test')}
            >
              Test
            </button>
          </div>
        </div>

        {/* Terminal Window */}
        <div className="terminal-wrapper-outer">
          <Terminal
            key={activeTab}
            title={activeTab === 'scan' ? 'mantis scan ./backend' : 'mantis test'}
            commands={activeTab === 'scan' ? scanCommands : testCommands}
            outputs={activeTab === 'scan' ? scanOutputs : testOutputs}
            typingSpeed={35}
            delayBetweenCommands={1000}
          />
        </div>
      </div>
    </section>
  );
}

// User-provided export wrapper
export function TerminalDemo() {
  return <TerminalSection />;
}
