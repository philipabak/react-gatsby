import _ from "lodash"
import slugify, { Options as ISlugifyOptions } from "@sindresorhus/slugify"
import type { Reporter } from "gatsby/reporter"
import {
  extractFieldWithoutUnion,
  extractAllCollectionSegments,
  switchToPeriodDelimiters,
  removeFileExtension,
} from "./path-utils"

const doubleForwardSlashes = /\/\/+/g
// Match 0 or 1 of "/"
const indexRoute = /^\/?$/

// Generates the path for the page from the file path
// product/{Product.id} => /product/:id, pulls from nodes.id
// product/{Product.sku__en} => product/:sku__en pulls from nodes.sku.en
// blog/{MarkdownRemark.parent__(File)__relativePath}} => blog/:slug pulls from nodes.parent.relativePath
export async function derivePath(
  path: string,
  node: Record<string, any>,
  reporter: Reporter,
  slugifyOptions?: ISlugifyOptions,
  getFieldValue?: (node: Record<string, any>, fieldPath: string) => any
): Promise<{ errors: number; derivedPath: string }> {
  // 0. Since this function will be called for every path times count of nodes the errors will be counted and then the calling function will throw the error once
  let errors = 0

  // 1. Incoming path can optionally contain file extension
  let modifiedPath = removeFileExtension(path)

  // 2. Pull out the slug parts that are within { } brackets.
  const slugParts = extractAllCollectionSegments(path)

  // 3. For each slug parts get the actual value from the node data
  for (const slugPart of slugParts) {
    // 3.a. This transforms foo__bar into foo.bar
    const cleanedField = extractFieldWithoutUnion(slugPart)[0]
    const key = switchToPeriodDelimiters(cleanedField)

    // 3.b We do node.nodes here because we support the special group graphql field, which then moves nodes in another depth
    const groupNodes = _.get(node.nodes, `[0]${key}`)
    // In case not all nodes are materialized yet (e.g. in setFieldsOnGraphQLNodeType or createResolvers) it's not enough to just _.get the node value, but to call the helper function nodeModel.getFieldValue. nodeModel is not always accessible (not passed, not available, etc.) so the argument is optional and falls back to _.get.
    const singleNode = getFieldValue
      ? await getFieldValue(node, key)
      : _.get(node, key)
    const nodeValue = groupNodes || singleNode

    // 3.c log error if the key does not exist on node
    if (nodeValue === undefined) {
      if (process.env.gatsby_log_level === `verbose`) {
        reporter.verbose(
          `Could not find value in the following node for key ${slugPart} (transformed to ${key}) for node:
    
            ${JSON.stringify(node, null, 2)}`
        )
      }

      errors++

      continue
    }

    // 3.d Safely slugify all values (to keep URL structures)
    const value = safeSlugify(nodeValue, slugifyOptions)

    // 3.e replace the part of the slug with the actual value
    modifiedPath = modifiedPath.replace(slugPart, value)
  }

  // 4. Remove double forward slashes that could occur in the final URL
  modifiedPath = modifiedPath.replace(doubleForwardSlashes, `/`)

  // 5.a If the final URL appears to be an index path, use the "index" file naming convention
  if (indexRoute.test(modifiedPath)) {
    modifiedPath = `index`
  }

  const derivedPath = modifiedPath

  return {
    errors,
    derivedPath,
  }
}

// If the node value is meant to be a slug, like `foo/bar`, the slugify
// function will remove the slashes. This is a hack to make sure the slashes
// stick around in the final url structuring
function safeSlugify(
  nodeValue: string,
  slugifyOptions?: ISlugifyOptions
): string {
  // The incoming GraphQL data can also be a number
  const input = String(nodeValue)
  const tempArr = input.split(`/`)

  return tempArr.map(v => slugify(v, slugifyOptions)).join(`/`)
}
