import store from "~/store"
import { typeDefinitionFilters } from "./type-filters"
import { getPluginOptions } from "~/utils/get-gatsby-api"
import { cloneDeep, merge } from "lodash"

export const buildInterfacesListForType = type => {
  let shouldAddNodeType = false

  const list = (type?.interfaces || [])
    .filter(interfaceType => {
      const interfaceTypeSettings = getTypeSettingsByType(interfaceType)

      return (
        !interfaceTypeSettings.exclude && fieldOfTypeWasFetched(interfaceType)
      )
    })
    .map(({ name }) => {
      if (name === `Node`) {
        shouldAddNodeType = true
      }
      return buildTypeName(name)
    })

  if (shouldAddNodeType) {
    list.push(`Node`)
  }

  return list
}

let ceIntCache = null
const isWpgqlOneThirteenZeroPlus = () => {
  if (ceIntCache !== null) {
    return ceIntCache
  }

  const { typeMap } = store.getState().remoteSchema

  const connectionInterface = !!typeMap.get(`Connection`)
  const edgeInterface = !!typeMap.get(`Edge`)

  const isWpgqlOneThirteenZeroPlus = connectionInterface || edgeInterface

  ceIntCache = isWpgqlOneThirteenZeroPlus

  return isWpgqlOneThirteenZeroPlus
}

/**
 * This function namespaces typenames with a prefix
 */
export const buildTypeName = name => {
  if (!name || typeof name !== `string`) {
    return null
  }

  const {
    schema: { typePrefix: prefix },
  } = getPluginOptions()

  // this is for our namespace type on the root { wp { ...fields } }
  if (name === prefix) {
    return name
  }

  // Gatsby makes the same type, so we need to rename it to prevent conflicts
  if (name === `Filter`) {
    name = `FilterType`
  }

  if (
    // Starting in WPGraphQL 1.13.0, Gatsby and WPGraphQL both generate types ending in these strings for every node type in the schema, so we need to rename types to prevent conflicts.
    // for users on older versions of WPGraphQL we should try to keep the schema how it was before
    isWpgqlOneThirteenZeroPlus() &&
    (name.endsWith(`Connection`) ||
      name.endsWith(`Edge`) ||
      name.endsWith(`PageInfo`))
  ) {
    name += `Type`
  }

  if (name.startsWith(prefix)) {
    return name
  }

  return prefix + name
}

/**
 * Find the first type kind of a Type definition pulled via introspection
 * @param {object} type
 */
export const findTypeKind = type => {
  if (type?.kind) {
    return type.kind
  }

  if (type?.ofType) {
    return findTypeKind(type.ofType)
  }

  return null
}

export const findNamedType = type => {
  if (!type) {
    return null
  }

  if (type.ofType) {
    return findNamedType(type.ofType)
  }

  return type
}

export const findNamedTypeName = type => {
  const namedType = findNamedType(type)

  return namedType?.name
}

export const fieldOfTypeWasFetched = type => {
  const { fetchedTypes } = store.getState().remoteSchema
  const typeName = findNamedTypeName(type)
  const typeWasFetched = !!fetchedTypes.get(typeName)

  return typeWasFetched
}

const implementingTypeCache = new Map()

export const getTypesThatImplementInterfaceType = type => {
  if (implementingTypeCache.has(type.name)) {
    return implementingTypeCache.get(type.name)
  }

  const state = store.getState()
  const { typeMap } = state.remoteSchema

  const allTypes = typeMap.values()

  const implementingTypes = Array.from(allTypes)
    .filter(
      ({ interfaces }) =>
        interfaces &&
        // find types that implement this interface type
        interfaces.find(singleInterface => singleInterface.name === type.name)
    )
    .map(type => typeMap.get(type.name))
    .filter(
      type =>
        type.kind !== `UNION` ||
        // if this is a union type, make sure the union type has one or more member types, otherwise schema customization will throw an error
        (!!type.possibleTypes && !!type.possibleTypes.length)
    )

  implementingTypeCache.set(type.name, implementingTypes)

  return implementingTypes
}

const supportedScalars = [
  `Int`,
  `Float`,
  `String`,
  `Boolean`,
  `ID`,
  `Date`,
  `JSON`,
]

export const typeIsABuiltInScalar = type =>
  // @todo the next function and this one are redundant.
  // see the next todo on how to fix the issue. If that todo is resolved, these functions will be identical. :(
  supportedScalars.includes(findNamedTypeName(type))

export const typeIsASupportedScalar = type => {
  if (findTypeKind(type) !== `SCALAR`) {
    // @todo returning true here seems wrong since a type that is not a scalar can't be a supported scalar... so there is some other logic elsewhere that is wrong
    // making this return false causes errors in the schema
    return true
  }

  return supportedScalars.includes(findNamedTypeName(type))
}

const typeSettingCache = new Map()

// retrieves plugin settings for the provided type
export const getTypeSettingsByType = type => {
  if (!type) {
    return {}
  }

  const typeName = findNamedTypeName(type)

  if (!typeName) {
    return {}
  }

  const cachedTypeSettings = typeSettingCache.get(typeName)

  if (cachedTypeSettings) {
    return cachedTypeSettings
  }

  // the plugin options object containing every type setting
  const allTypeSettings = store.getState().gatsbyApi.pluginOptions.type

  const typeSettings = cloneDeep(allTypeSettings[typeName] || {})

  // the type.__all plugin option which is applied to every type setting
  const __allTypeSetting = cloneDeep(allTypeSettings.__all || {})

  if (typeName === `MediaItem`) {
    delete __allTypeSetting.limit
    delete typeSettings.limit
  }

  if (typeSettings) {
    const mergedSettings = merge(__allTypeSetting, typeSettings)

    typeSettingCache.set(typeName, mergedSettings)

    return mergedSettings
  }

  typeSettingCache.set(typeName, __allTypeSetting)

  return __allTypeSetting
}

/**
 * This is used to filter the automatically generated type definitions before they're added to the schema customization api.
 */
export const filterTypeDefinition = (
  typeDefinition,
  typeBuilderApi,
  typeKind
) => {
  const filters = typeDefinitionFilters.filter(filter =>
    [typeBuilderApi.type.name, `__all`].includes(filter.typeName)
  )

  if (filters?.length) {
    filters.forEach(filter => {
      if (filter && typeof filter.typeDef === `function`) {
        typeDefinition = filter.typeDef(
          typeDefinition,
          typeBuilderApi,
          typeKind
        )
      }
    })
  }

  return typeDefinition
}

// we should be using graphql-js for this kind of thing, but unfortunately this project didn't use it from the beginning so it would be a huge lift to refactor to use it now. In the future we will be rewriting this plugin using a new Gatsby source plugin toolkit, and at that time we'll use graphql-js.
// from introspection field types this will return a value like:
// `String` or `[String]` or `[String!]!` or `[String]!` or `[[String]]` or `[[String]!]!` or `[[String]!]`, etc
export const introspectionFieldTypeToSDL = fieldType => {
  const openingTagsList = []
  const closingTagsList = []

  let reference = fieldType

  while (reference) {
    switch (reference.kind) {
      case `SCALAR`: {
        const normalizedTypeName = supportedScalars.includes(reference.name)
          ? reference.name
          : `JSON`

        openingTagsList.push(normalizedTypeName)
        break
      }
      case `OBJECT`:
      case `INTERFACE`:
      case `UNION`:
        openingTagsList.push(buildTypeName(reference.name))
        break
      case `NON_NULL`:
        closingTagsList.push(`!`)
        break
      case `LIST`:
        openingTagsList.push(`[`)
        closingTagsList.push(`]`)
        break
      default:
        break
    }

    reference = reference.ofType
  }

  return openingTagsList.join(``) + closingTagsList.reverse().join(``)
}
