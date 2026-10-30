import React from 'react';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
export const load = () => axios.get('/api/items');
export const mount = (el: HTMLElement) => createRoot(el).render(React.createElement('div'));
