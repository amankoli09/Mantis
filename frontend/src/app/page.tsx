import Image from 'next/image';
import Link from 'next/link';
import { TerminalSection } from '@/components/TerminalSection';
import { HowItWorksSection } from '@/components/HowItWorksSection';
import { WhereItWorksSection } from '@/components/WhereItWorksSection';
import { AlphaCtaSection } from '@/components/AlphaCtaSection';
import { FooterSection } from '@/components/FooterSection';

export default function HomePage() {
  return (
    <>
      <main className="landing-wrapper">
        <div className="content-layer">
          {/* Navigation Bar */}
          <header className="top-nav">
            <Link href="/" className="brand-link" aria-label="Mantis Home">
              <Image
                src="/assets/logos/mantislogo.png"
                alt="Mantis Logo"
                width={140}
                height={36}
                priority
                className="brand-logo-img"
              />
            </Link>

            <Link
              href="https://github.com/amankoli1206/Mantis"
              target="_blank"
              rel="noopener noreferrer"
              className="nav-link"
            >
              GitHub
            </Link>
          </header>

          {/* Hero Section */}
          <section className="hero-container">
            <div className="hero-center-group">
              <p className="hero-kicker">Spec-free API testing for Node.js and Express</p>

              <h1 className="hero-title">Mantis</h1>

              <p className="hero-description">
                Point Mantis at your backend. It reads the code, maps every endpoint, and
                tests them safely. Then it shows you where your API breaks and the exact line
                to look at.
              </p>
            </div>

            <footer className="release-badge">
              Alpha release. Node.js and Express today.
            </footer>
          </section>
        </div>
      </main>

      {/* Terminal Section (White Background) */}
      <TerminalSection />

      {/* How It Works Section (3 Cards) */}
      <HowItWorksSection />

      {/* Where It Works Section (Frameworks & Interactive Tech Stack White Card) */}
      <WhereItWorksSection />

      {/* Alpha CTA Card Section */}
      <AlphaCtaSection />

      {/* Footer Section (Scenic Landing Art + Navigation) */}
      <FooterSection />
    </>
  );
}
