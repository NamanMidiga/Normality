import React from 'react';
import './global.css';
import { createRoot } from 'react-dom/client';
import App from './ui/App.jsx';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
