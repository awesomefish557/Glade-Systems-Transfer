import React from 'react';
import { createRoot } from 'react-dom/client';

const App = () => (
  <div style={{ padding: 40 }}>
    <h1>Lighthouse Dashboard</h1>
    <p>Welcome! This is your Electron + React + TypeScript app scaffold.</p>
    <p>More features coming soon...</p>
  </div>
);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
