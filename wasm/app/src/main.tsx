// Keep every app/engine import behind the optional authorization boundary.
if (import.meta.env.VITE_ALPHA_GATE_ENABLED === '1') {
  void import('./alpha/bootstrap').then(({ authorizeApp }) => authorizeApp(() => import('./appEntry').then(({ start }) => start())));
} else {
  void import('./appEntry').then(({ start }) => start());
}
