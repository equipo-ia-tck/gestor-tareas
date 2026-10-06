import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { requestPersistentStorage } from './data/backup';
import { autosave, repo } from './data/services';
import './index.css';

void requestPersistentStorage();
void autosave.init();
void repo.purgeDeleted(30);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
