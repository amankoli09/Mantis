'use client';

import React, { useState } from 'react';
import Image from 'next/image';

interface TechItem {
  id: string;
  name: string;
  category: string;
  status?: 'available' | 'planned';
  statusLabel?: string;
  logoUrl?: string;
  svgIcon?: React.ReactNode;
  packageName?: string;
  version?: string;
  role: string;
  description: string;
  codeSnippet: string;
}

const techItems: TechItem[] = [
  // Row 1: Frameworks
  {
    id: 'express',
    name: 'Express',
    category: 'Framework',
    status: 'available',
    statusLabel: 'Available now',
    logoUrl: '/assets/logos/Expressjs.png',
    packageName: 'express',
    version: '>= 4.18',
    role: 'Primary Supported Framework',
    description:
      'Mantis statically traces your Express application structure, following router mounts, route regexes, and middleware chains to map every endpoint with exact source file and line numbers.',
    codeSnippet: `// Express Route Discovery
app.use('/api/v1', userRouter);
// Discovered: GET /api/v1/users/:id -> routes/user.js:20`,
  },
  {
    id: 'typescript-fw',
    name: 'TypeScript',
    category: 'Framework',
    status: 'available',
    statusLabel: 'Available now',
    logoUrl: '/assets/logos/Typescript.png',
    packageName: 'typescript',
    version: '>= 5.0',
    role: 'Express with TypeScript',
    description:
      'Mantis reads typed request parameters, query interfaces, and body definitions directly from AST type annotations without requiring ahead-of-time compilation.',
    codeSnippet: `// TypeScript AST Extraction
interface UserParams { id: string; }
router.get<UserParams>('/users/:id', handler);`,
  },
  {
    id: 'python',
    name: 'Python',
    category: 'Framework',
    status: 'planned',
    statusLabel: 'Planned',
    logoUrl: '/assets/logos/python.png',
    packageName: 'flask / fastapi',
    version: 'Planned Q2',
    role: 'Flask & FastAPI Support',
    description:
      'Planned AST blueprint traversal for Flask and Pydantic schema inspection for FastAPI, providing full line provenance for Python backends.',
    codeSnippet: `# Planned: Python Blueprint Traversal
@app.route('/users/<int:user_id>', methods=['GET'])
def get_user(user_id): ...`,
  },
  {
    id: 'java',
    name: 'Java',
    category: 'Framework',
    status: 'planned',
    statusLabel: 'Planned',
    logoUrl: '/assets/logos/java.png',
    packageName: 'spring-boot',
    version: 'Planned Q3',
    role: 'Spring Boot Support',
    description:
      'Planned annotation parser for Spring Boot @RestController, @GetMapping, and @PostMapping endpoint declarations.',
    codeSnippet: `// Planned: Spring Boot Annotation Parser
@GetMapping("/users/{id}")
public User getUser(@PathVariable String id) { ... }`,
  },

  // Row 2: Core Engines
  {
    id: 'babel',
    name: 'Babel',
    category: 'AST Parser',
    logoUrl: '/assets/logos/Babel.png',
    packageName: '@babel/parser',
    version: '^7.29.9',
    role: 'Static AST Traversal Engine',
    description:
      'Mantis uses Babel in @devguard/adapter-express to parse your JavaScript code into an abstract syntax tree. It identifies every endpoint and router mount without executing untrusted code.',
    codeSnippet: `import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

traverse(ast, {
  CallExpression(path) {
    if (isRouteRegistration(path)) {
      registry.record(extractRoute(path));
    }
  }
});`,
  },
  {
    id: 'zod',
    name: 'Zod',
    category: 'Invariant Engine',
    logoUrl: '/assets/logos/zod.png',
    packageName: 'zod',
    version: '^3.24.2',
    role: 'Runtime Contract Synthesis',
    description:
      'In @devguard/core, Mantis synthesizes runtime schema contracts from AST parameter types, ensuring response payloads never violate contract invariants.',
    codeSnippet: `export const UserContract = z.object({
  id: z.string().uuid(),
  status: z.enum(['active', 'pending'])
});

const verified = UserContract.safeParse(res.body);`,
  },
  {
    id: 'vitest',
    name: 'Vitest',
    category: 'Test Runner',
    logoUrl: '/assets/logos/Vitest.png',
    packageName: 'vitest',
    version: '^3.0.5',
    role: 'Sub-40ms Verification Runner',
    description:
      'Mantis executes parallel verification checks with Vitest, testing response times, status invariants, and safety boundaries in under 40 milliseconds.',
    codeSnippet: `$ mantis test --port 3000
✓ GET  /health      12ms  (Status 200 OK)
✓ GET  /users/:id   18ms  (Invariant validated)
All 6 endpoints verified in 38ms.`,
  },
  {
    id: 'nodejs',
    name: 'Node.js',
    category: 'Runtime',
    logoUrl: '/assets/logos/nodejs.png',
    packageName: 'node',
    version: '>= 20.0.0',
    role: 'Native Process & Network Engine',
    description:
      'Mantis runs natively on Node.js 20+, spawning isolated sandboxed child processes to send non-destructive requests against your local server without touching production data.',
    codeSnippet: `const proc = spawn('node', ['app.js'], {
  env: { ...process.env, MANTIS_ENV: 'test', PORT: '3001' }
});
await waitForServer(3001);`,
  },

  // Row 3: Toolchain & Core
  {
    id: 'pnpm',
    name: 'pnpm',
    category: 'Monorepo',
    logoUrl: '/assets/logos/pnpm.png',
    packageName: 'pnpm',
    version: '>= 9.0.0',
    role: 'Content-Addressable Workspaces',
    description:
      'Mantis is organized as an efficient monorepo using pnpm workspaces, isolating CLI, core invariant engine, and adapters with zero bundle duplication.',
    codeSnippet: `# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'frontend'`,
  },
  {
    id: 'undici',
    name: 'undici',
    category: 'HTTP Client',
    svgIcon: (
      <svg viewBox="0 0 32 32" width="36" height="36" fill="none" className="apple-brand-svg">
        <rect width="32" height="32" rx="8" fill="#0f172a" />
        <path d="M10 11v6a6 6 0 0 0 12 0v-6" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    ),
    packageName: 'undici',
    version: '^8.11.2',
    role: 'High-Throughput HTTP Client',
    description:
      'Used inside @devguard/runner for fast connection pooling and synthetic contract requests against running server endpoints.',
    codeSnippet: `import { Client } from 'undici';
const client = new Client('http://localhost:3000');
const { statusCode } = await client.request({
  method: 'GET',
  path: '/health'
});`,
  },
  {
    id: 'mantis',
    name: 'Mantis Core',
    category: 'Engine',
    logoUrl: '/assets/icons/Mantisicon.png',
    packageName: '@devguard/core',
    version: '0.1.0 (Alpha)',
    role: 'Spec-Free Testing Architecture',
    description:
      'The unified Mantis engine reconciles static AST code discovery with dynamic contract execution, giving developers zero-spec automated testing with exact line provenance.',
    codeSnippet: `$ npx mantis-test
✔ 6/6 endpoints mapped from Express AST
✔ All response invariants verified
Line provenance: routes/user.js:20`,
  },
  {
    id: 'github',
    name: 'Open Source',
    category: 'GitHub',
    svgIcon: (
      <svg viewBox="0 0 24 24" width="36" height="36" fill="#18181b" className="apple-brand-svg">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    ),
    packageName: 'MIT License',
    version: 'Public Repo',
    role: 'Transparent & Extensible',
    description:
      'Mantis is 100% open source under the MIT license. Check out the source code, contribute adapters, and audit our AST engine on GitHub.',
    codeSnippet: `git clone https://github.com/amankoli1206/Mantis.git
cd Mantis && pnpm install
pnpm devguard --help`,
  },
];

export function WhereItWorksSection() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeItem = techItems.find((item) => item.id === selectedId);

  const handleToggle = (id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  };

  return (
    <section className="apple-ecosystem-section" id="where-it-works">
      <div className="apple-ecosystem-container">
        {/* Left Column: Bold Title with Vertical Divider (Matching Reference Image) */}
        <div className="apple-left-col">
          <h2 className="apple-title">
            Where it works
            <br />
            &amp; what powers it
          </h2>
          <p className="apple-subtitle">
            Express is supported today.
            <br />
            Click any technology for project details.
          </p>
        </div>

        {/* Right Column: Clean Divided Rows (Matching Reference Image) */}
        <div className="apple-right-col">
          {/* Row 1: Frameworks */}
          <div className="apple-row">
            {techItems.slice(0, 4).map((item) => {
              const isSelected = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleToggle(item.id)}
                  className={`apple-item-btn ${isSelected ? 'is-selected' : ''}`}
                  aria-expanded={isSelected}
                  title={`Click to view info about ${item.name}`}
                >
                  <div className="apple-logo-slot">
                    {item.logoUrl ? (
                      <Image
                        src={item.logoUrl}
                        alt={item.name}
                        width={48}
                        height={48}
                        unoptimized
                        className="apple-logo-img"
                      />
                    ) : (
                      item.svgIcon
                    )}
                  </div>
                  <div className="apple-item-text">
                    <span className="apple-item-name">{item.name}</span>
                    {item.status && (
                      <span
                        className={`apple-status-pill ${
                          item.status === 'available' ? 'pill-available' : 'pill-planned'
                        }`}
                      >
                        {item.status === 'available' && <span className="pill-dot" />}
                        {item.statusLabel}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Row 2: Core Engines */}
          <div className="apple-row">
            {techItems.slice(4, 8).map((item) => {
              const isSelected = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleToggle(item.id)}
                  className={`apple-item-btn ${isSelected ? 'is-selected' : ''}`}
                  aria-expanded={isSelected}
                  title={`Click to view info about ${item.name}`}
                >
                  <div className="apple-logo-slot">
                    {item.logoUrl ? (
                      <Image
                        src={item.logoUrl}
                        alt={item.name}
                        width={48}
                        height={48}
                        unoptimized
                        className="apple-logo-img"
                      />
                    ) : (
                      item.svgIcon
                    )}
                  </div>
                  <div className="apple-item-text">
                    <span className="apple-item-name">{item.name}</span>
                    <span className="apple-item-category">{item.category}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Row 3: Toolchain & Core */}
          <div className="apple-row">
            {techItems.slice(8, 12).map((item) => {
              const isSelected = selectedId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleToggle(item.id)}
                  className={`apple-item-btn ${isSelected ? 'is-selected' : ''}`}
                  aria-expanded={isSelected}
                  title={`Click to view info about ${item.name}`}
                >
                  <div className="apple-logo-slot">
                    {item.logoUrl ? (
                      <Image
                        src={item.logoUrl}
                        alt={item.name}
                        width={48}
                        height={48}
                        unoptimized
                        className="apple-logo-img"
                      />
                    ) : (
                      item.svgIcon
                    )}
                  </div>
                  <div className="apple-item-text">
                    <span className="apple-item-name">{item.name}</span>
                    <span className="apple-item-category">{item.category}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Interactive Apple-Style Info Drawer (opens below on click) */}
          {activeItem && (
            <div className="apple-info-card" role="region" aria-live="polite">
              <div className="apple-card-top">
                <div className="apple-card-brand">
                  <div className="apple-card-logo">
                    {activeItem.logoUrl ? (
                      <Image
                        src={activeItem.logoUrl}
                        alt={activeItem.name}
                        width={48}
                        height={48}
                        unoptimized
                        className="apple-card-img"
                      />
                    ) : (
                      activeItem.svgIcon
                    )}
                  </div>
                  <div>
                    <h3 className="apple-card-title">{activeItem.name}</h3>
                    <p className="apple-card-role">
                      {activeItem.role}{' '}
                      {activeItem.packageName && (
                        <span className="apple-card-pkg">({activeItem.packageName} {activeItem.version})</span>
                      )}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="apple-card-close"
                  aria-label="Close details"
                >
                  ✕
                </button>
              </div>

              <p className="apple-card-desc">{activeItem.description}</p>

              <div className="apple-card-code">
                <pre className="apple-code-pre">
                  <code>{activeItem.codeSnippet}</code>
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default WhereItWorksSection;
