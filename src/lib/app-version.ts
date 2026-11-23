/** The build's version and commit for a bug report: vite.config.ts defines both from the root package.json and `git rev-parse`; the test runner reads "dev". */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';
export const APP_COMMIT: string = import.meta.env.VITE_APP_COMMIT ?? 'dev';
