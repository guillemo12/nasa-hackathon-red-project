import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Tipografías servidas por la propia consola: la demo no depende de la red.
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import './index.css';
import { applyThemeVars } from './theme';

applyThemeVars();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
