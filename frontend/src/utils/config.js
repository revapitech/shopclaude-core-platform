// Single source of truth for backend URLs (previously duplicated in main.jsx and LandingPage.jsx).
export const API     = import.meta.env.VITE_API_URL     ?? 'http://localhost:8080/gosuas-core/api';
export const BACKEND = import.meta.env.VITE_BACKEND_URL ?? API.replace(/\/api$/, '');
