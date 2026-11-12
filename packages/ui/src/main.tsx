import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import App from './App';

const container = document.getElementById('root');
if (!container) throw new Error('SS14 Studio: #root element is missing.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
