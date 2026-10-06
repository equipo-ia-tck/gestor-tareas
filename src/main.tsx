import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { captureInstallPrompt } from './app/install';
import { requestPersistentStorage } from './data/backup';
import { autosave, repo } from './data/services';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

captureInstallPrompt();
void requestPersistentStorage();
void autosave.init();
void repo.purgeDeleted(30);
// Service worker para funcionar sin conexión (solo en producción; en desarrollo no se registra).
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
