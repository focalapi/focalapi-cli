declare const __FOCALAPI_VERSION__: string | undefined;

/** 构建时由 tsup define 注入 package.json 版本；dev/test 环境回退为 dev 占位。 */
export const VERSION: string =
  typeof __FOCALAPI_VERSION__ !== 'undefined' ? __FOCALAPI_VERSION__ : '0.0.0-dev';
