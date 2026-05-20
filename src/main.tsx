import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

// Bloqueia o botão direito e atalhos de inspeção/recarregamento
if (typeof window !== 'undefined') {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('keydown', (e) => {
    // Bloqueia F5, Ctrl+R (Reload) e Ctrl+Shift+I (Inspect)
    if (
      e.key === 'F5' || 
      (e.ctrlKey && (e.key === 'r' || e.key === 'R')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'i' || e.key === 'I')) ||
      (e.ctrlKey && e.shiftKey && (e.key === 'j' || e.key === 'J')) ||
      (e.key === 'F12')
    ) {
      e.preventDefault();
    }
  });
}


import { DraftProvider } from './context/DraftContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DraftProvider>
      <App />
    </DraftProvider>
  </React.StrictMode>
);
