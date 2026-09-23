import { SIM_CORE_VERSION } from '@robots/sim-core';

const hud = document.getElementById('hud');
if (hud) hud.textContent = `robots app, sim-core ${SIM_CORE_VERSION}`;
