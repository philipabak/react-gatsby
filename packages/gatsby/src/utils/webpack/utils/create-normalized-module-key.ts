import path from "path"
import { slash } from "gatsby-core-utils"

/**
 * Create a normalized module key that is referenced in both the partial hydration webpack loader and plugin.
 * This solves for module imports that may be differently bundled for different environments (e.g. browser, node).
 *
 * If the module is a local module, the key is the relative path from the project root (e.g. `file://src/components/index.js`).
 * If the module is a node module, the key is the relative path to the module name in `node_modules` (e.g. `file://node_modules/react`).
 *
 * @param resourcePath Absolute path to the resource
 * @param rootContext Absolute path to project root
 * @returns Normalized module key
 */
export function createNormalizedModuleKey(
  resourcePath: string,
  rootContext: string
): string {
  const rootRelativeFilePath = resourcePath.replace(rootContext, ``)
  const [rootRelativeDir, potentialModuleName] = rootRelativeFilePath
    .split(path.sep)
    .filter(Boolean)
  const normalizedModuleKey =
    rootRelativeDir === `node_modules`
      ? `file://${path.join(rootRelativeDir, potentialModuleName)}`
      : `file://${rootRelativeFilePath.slice(1)}`
  return slash(normalizedModuleKey)
}
