'use client';

import React from 'react';
import Link from 'next/link';

export function AlphaCtaSection() {
  return (
    <section className="alpha-cta-section" id="try-alpha">
      <div className="alpha-cta-container">
        <div className="alpha-cta-card">
          <div className="alpha-cta-content">
            <h2 className="alpha-cta-title">
              Try the alpha on a project you own.
            </h2>
            <p className="alpha-cta-subtitle">
              Mantis is early. Run it on your own backend and tell us what it gets wrong.
            </p>
            <div className="alpha-cta-actions">
              <Link
                href="https://github.com/amankoli1206/Mantis"
                target="_blank"
                rel="noopener noreferrer"
                className="alpha-cta-btn"
              >
                View on GitHub
              </Link>
              <Link
                href="https://github.com/amankoli1206/Mantis#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="alpha-cta-link"
              >
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AlphaCtaSection;
