import { mount } from 'svelte';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.svelte';
import { configureApi } from './api/index.ts';
import { currentFlags } from './lib/flags.ts';

// Fixture mode (development only) applies to this thread as well as the snapshot worker.
configureApi(currentFlags());

const app = mount(App, { target: document.getElementById('app')! });
// The shell is in the DOM now; the browser paints it on the next frame.
requestAnimationFrame(() => requestAnimationFrame(() => performance.mark('gev:shell-visible')));

export default app;
