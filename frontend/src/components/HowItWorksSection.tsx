'use client';

import React, { useState, useEffect } from 'react';
import ScrollExpand from '@/components/ui/ScrollExpand';

function LiveScanWidget() {
  const [phase, setPhase] = useState(0);

  const batches = [
    {
      count: 2,
      label: 'scanning routes...',
      routes: [
        { method: 'GET', path: '/health', scanning: false },
        { method: 'GET', path: '/users', scanning: false },
        { method: '...', path: 'scanning routes/user.js', scanning: true },
      ],
    },
    {
      count: 4,
      label: 'endpoints mapped',
      routes: [
        { method: 'GET', path: '/health', scanning: false },
        { method: 'GET', path: '/users', scanning: false },
        { method: 'POST', path: '/users', scanning: false },
      ],
    },
    {
      count: 6,
      label: 'endpoints mapped',
      routes: [
        { method: 'GET', path: '/users/:id', scanning: false },
        { method: 'POST', path: '/api/auth/login', scanning: false },
        { method: 'DELETE', path: '/users/:id', scanning: false },
      ],
    },
    {
      count: 6,
      label: 'AST scan complete',
      routes: [
        { method: 'GET', path: '/health', scanning: false },
        { method: 'GET', path: '/users', scanning: false },
        { method: 'POST', path: '/users', scanning: false },
      ],
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setPhase((prev) => (prev + 1) % batches.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [batches.length]);

  const current = batches[phase];

  return (
    <div className="hiw-card-widget">
      <div className="hiw-widget-header">
        <span className="hiw-status-dot dot-pulse" />
        <span className="hiw-widget-label">AST Route Discovery</span>
      </div>
      <div className="hiw-widget-metric">
        <span className="hiw-metric-val">{current.count}</span>
        <span className="hiw-metric-text">{current.label}</span>
      </div>
      <div className="hiw-widget-pills">
        {current.routes.map((r, i) => (
          <span key={`${phase}-${i}`} className={`hiw-pill ${r.scanning ? 'hiw-pill-scanning' : ''}`}>
            <span className="hiw-pill-method">{r.method}</span> {r.path}
          </span>
        ))}
      </div>
    </div>
  );
}

function LiveMapWidget() {
  const [index, setIndex] = useState(0);

  const endpoints = [
    {
      method: 'GET',
      badgeClass: 'badge-blue',
      path: '/users/:id',
      origin: 'backend/routes/user.js:20',
      paramKey: 'Params:',
      paramVal: 'id (string)',
    },
    {
      method: 'POST',
      badgeClass: 'badge-emerald',
      path: '/api/auth/login',
      origin: 'controllers/auth.ts:42',
      paramKey: 'Body:',
      paramVal: '{ email, password }',
    },
    {
      method: 'GET',
      badgeClass: 'badge-cyan',
      path: '/health',
      origin: 'backend/server.js:12',
      paramKey: 'Contract:',
      paramVal: '200 { status: ok }',
    },
    {
      method: 'PUT',
      badgeClass: 'badge-amber',
      path: '/projects/:slug',
      origin: 'routes/project.js:58',
      paramKey: 'Auth:',
      paramVal: 'Bearer (required)',
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % endpoints.length);
    }, 2800);
    return () => clearInterval(timer);
  }, [endpoints.length]);

  const item = endpoints[index];

  return (
    <div className="hiw-card-widget">
      <div className="hiw-widget-header">
        <span className="hiw-status-dot dot-cyan dot-pulse" />
        <span className="hiw-widget-label">Route Provenance</span>
      </div>
      <div className="hiw-widget-route" key={item.path}>
        <span className={`hiw-method-badge ${item.badgeClass}`}>{item.method}</span>
        <span className="hiw-route-path">{item.path}</span>
      </div>
      <div className="hiw-widget-details" key={`details-${item.path}`}>
        <div className="hiw-detail-row">
          <span className="hiw-detail-key">Origin:</span>
          <span className="hiw-detail-val">{item.origin}</span>
        </div>
        <div className="hiw-detail-row">
          <span className="hiw-detail-key">{item.paramKey}</span>
          <span className="hiw-detail-val">{item.paramVal}</span>
        </div>
      </div>
    </div>
  );
}

function LiveTestWidget() {
  const [step, setStep] = useState(0);

  const testSteps = [
    {
      title: 'Testing GET /health',
      latency: '12ms',
      passed: '1 Passed',
      failed: '0 Failed',
      thirdChip: '5 Queued',
      thirdClass: 'chip-dim',
      icon: '✓',
    },
    {
      title: 'Testing GET /users/:id',
      latency: '18ms',
      passed: '3 Passed',
      failed: '0 Failed',
      thirdChip: '3 Queued',
      thirdClass: 'chip-dim',
      icon: '✓',
    },
    {
      title: 'Testing POST /users',
      latency: '24ms',
      passed: '5 Passed',
      failed: '0 Failed',
      thirdChip: '1 Queued',
      thirdClass: 'chip-dim',
      icon: '✓',
    },
    {
      title: 'All Invariants Verified',
      latency: '38ms total',
      passed: '6 Passed',
      failed: '0 Failed',
      thirdChip: '4 Skipped (Safe)',
      thirdClass: 'chip-amber',
      icon: '✓',
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % testSteps.length);
    }, 2600);
    return () => clearInterval(timer);
  }, [testSteps.length]);

  const current = testSteps[step];

  return (
    <div className="hiw-card-widget">
      <div className="hiw-widget-header">
        <span className="hiw-status-dot dot-emerald dot-pulse" />
        <span className="hiw-widget-label">Contract Safety Engine</span>
        <span className="hiw-widget-latency">{current.latency}</span>
      </div>
      <div className="hiw-widget-verdict" key={current.title}>
        <span className="hiw-check-mark">{current.icon}</span>
        <span className="hiw-verdict-title">{current.title}</span>
      </div>
      <div className="hiw-widget-stats-bar">
        <div className="hiw-stats-chip chip-passed">{current.passed}</div>
        <div className="hiw-stats-chip chip-dim">{current.failed}</div>
        <div className={`hiw-stats-chip ${current.thirdClass}`}>{current.thirdChip}</div>
      </div>
    </div>
  );
}

interface StepCardProps {
  step: string;
  title: string;
  description: string;
  imageSrc: string;
  badgeContent: React.ReactNode;
}

const stepsData: StepCardProps[] = [
  {
    step: '01',
    title: 'Scan',
    description:
      'Mantis reads your Express code and follows routers, mounts and imports across files. No spec file needed.',
    imageSrc: '/assets/images/Howitworks.png',
    badgeContent: <LiveScanWidget />,
  },
  {
    step: '02',
    title: 'Map',
    description:
      'Each endpoint gets its method, full path, parameters and auth hints, plus the file and line each fact came from.',
    imageSrc: '/assets/images/Howitworks.png',
    badgeContent: <LiveMapWidget />,
  },
  {
    step: '03',
    title: 'Test',
    description:
      'Mantis sends safe requests to your running app and checks the responses. Every failure links back to your code.',
    imageSrc: '/assets/images/Howitworks.png',
    badgeContent: <LiveTestWidget />,
  },
];

export function HowItWorksSection() {
  return (
    <section className="how-it-works-section" id="how-it-works">
      <ScrollExpand
        src="/assets/images/Howitworks.png"
        alt="How it works media"
        title="How it works"
        scrollHint="Scroll to expand"
        useWindowScroll
        startWidth={50}
        startHeight={62}
        startRadius={28}
        endRadius={0}
        mediaZoom={1.22}
        scrollDistance={0.72}
        holdDistance={0}
        smoothing={0.05}
        overlayScrim={1}
        blurMedia
        noiseOverlay
        enabled
      >
        <div className="how-it-works-inner">
          {/* Header Row matching reference */}
          <div className="hiw-header-row">
            <div className="hiw-title-wrap">
              <h2 className="hiw-title">How it works</h2>
            </div>
            <div className="hiw-sub-wrap">
              <p className="hiw-subtitle">
                Mantis reads your code directly from the abstract syntax tree, creates a
                rigorous endpoint contract, and executes non-destructive safety checks in
                seconds.
              </p>
            </div>
          </div>

          {/* 3 Feature Cards */}
          <div className="hiw-cards-grid">
            {stepsData.map((item, index) => (
              <div key={index} className="hiw-card-item">
                {/* Visual Card Canvas with blurred image & noise */}
                <div className="hiw-visual-box">
                  {/* Blurred background image */}
                  <div
                    className="hiw-card-bg-image"
                    style={{ backgroundImage: `url(${item.imageSrc})` }}
                    aria-hidden="true"
                  />
                  {/* Noise overlay texture */}
                  <div className="hiw-noise-layer" aria-hidden="true" />
                  {/* Vignette / subtle tint */}
                  <div className="hiw-tint-layer" aria-hidden="true" />

                  {/* Floating Frosted Glass UI Widget */}
                  <div className="hiw-floating-widget-wrapper">
                    {item.badgeContent}
                  </div>
                </div>

                {/* Card Meta Content */}
                <div className="hiw-card-content">
                  <span className="hiw-step-number">{item.step}</span>
                  <h3 className="hiw-step-title">{item.title}</h3>
                  <p className="hiw-step-description">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </ScrollExpand>
    </section>
  );
}
