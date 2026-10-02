import { mount } from 'svelte';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });
// The shell is in the DOM now; the browser paints it on the next frame.
requestAnimationFrame(() => requestAnimationFrame(() => performance.mark('gev:shell-visible')));

export default app;
