import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem' }}>
      <h1 style={{ fontSize: '3rem', fontFamily: 'var(--font-serif)', marginBottom: '1rem' }}>404</h1>
      <p style={{ color: '#64748b', marginBottom: '2rem' }}>Page not found.</p>
      <Link href="/" style={{ color: '#16a34a', textDecoration: 'underline' }}>
        Return home
      </Link>
    </div>
  );
}
