// Modules made at build time by vite.config.js plugins.

// Chord charts for the starting tune list, by tune name (see charts.ts).
declare module 'virtual:seed-charts' {
  const charts: Record<string, import('./types.js').Chart>;
  export default charts;
}
