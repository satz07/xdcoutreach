import { useEffect } from 'react';
import { logoUrl } from './api';
import PulsePanel from './PulsePanel';

export default function PublicPulsePage({ token }) {
  useEffect(() => {
    document.title = 'XDC Market Pulse';
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow';
    document.head.appendChild(robots);
    return () => robots.remove();
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <img src={logoUrl('xdc.png')} alt="XDC Network" className="brand-xdc" />
            <span className="brand-divider" aria-hidden="true" />
            <div>
              <p className="eyebrow">Founder view</p>
              <h1>Market Pulse</h1>
            </div>
          </div>
          <div className="topbar-meta">
            <div className="topbar-status">
              <span className="pill ok">
                <span className="pill-dot" aria-hidden="true" />
                Read-only · updates automatically
              </span>
            </div>
          </div>
        </div>
      </header>
      <PulsePanel shareToken={token} />
    </div>
  );
}
