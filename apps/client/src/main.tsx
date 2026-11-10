import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';
import './ui/app.css';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);

if (import.meta.env.DEV && new URLSearchParams(location.search).has('gallery')) {
  // Galeria de telas de jogo sem servidor (só em dev) — ver src/dev/Gallery.tsx
  void import('./dev/Gallery').then(({ Gallery }) => root.render(<Gallery />));
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
