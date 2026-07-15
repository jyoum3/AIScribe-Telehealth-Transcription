/**
 * AIScribe Web — Vite Entry Point
 *
 * Mounts the React application into the #root div in index.html.
 * React.StrictMode is enabled to surface potential double-render bugs
 * and deprecated API usage during development.
 *
 * index.css is imported here (not in App.jsx) so the global reset and
 * CSS custom properties are applied before any component renders.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
