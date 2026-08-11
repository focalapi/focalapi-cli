declare const __FOCALAPI_VERSION__: string | undefined;

/** tsup injects the package.json version at build time; development and tests fall back to "dev". */
export const VERSION: string =
  typeof __FOCALAPI_VERSION__ !== 'undefined' ? __FOCALAPI_VERSION__ : '0.0.0-dev';
