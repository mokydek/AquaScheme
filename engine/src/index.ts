export const ENGINE_VERSION = '0.1.0'

export * from './types'
export * from './systems'
export * from './units'
export * from './csv'
export * from './topography'
export * from './buildings'
export * from './norms'
export * from './demand'
export * from './presets'
export * from './catalog'
export * from './trace'
export * from './importnet'
export * from './georef'
export * from './parcels'
export * from './equipment'
export * from './recommendations'
export * from './exportdata'
export * from './specification'
export * from './note'
export * from './demo'
// Note: ./dxf is a subpath export only (it pulls in @tarikjabiri/dxf), so the
// DXF library stays out of bundles that do not generate drawings.
export * from './geo'
// Note: ./terrain is exported as the subpath @aquascheme/engine/terrain only,
// so that turf.js stays out of the main frontend bundle (it is worker only).
