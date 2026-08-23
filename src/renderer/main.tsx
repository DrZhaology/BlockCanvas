import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from '@comp/ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="BlockCanvas">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
