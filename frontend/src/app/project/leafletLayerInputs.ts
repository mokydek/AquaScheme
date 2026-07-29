/**
 * Leaflet creates the layer-switcher inputs outside React and omits ids on
 * every control (and names on overlay checkboxes). Normalize that generated
 * markup so browser form diagnostics and assistive technology see the same
 * explicit contract as the rest of the application.
 */
export function normalizeLeafletLayerInputs(container: ParentNode, scope: string): number {
  const safeScope = scope.replace(/[^a-zA-Z0-9_-]/g, '-') || 'situation-map'
  const inputs = Array.from(
    container.querySelectorAll<HTMLInputElement>('.leaflet-control-layers-selector'),
  )
  let baseIndex = 0
  let overlayIndex = 0

  for (const input of inputs) {
    const isBaseLayer = input.type === 'radio'
    const index = isBaseLayer ? ++baseIndex : ++overlayIndex
    const kind = isBaseLayer ? 'base' : 'overlay'
    const id = `${safeScope}-${kind}-${index}`
    input.id = id
    input.name = isBaseLayer ? `${safeScope}-base-layer` : `${safeScope}-overlay-${index}`
    input.closest('label')?.setAttribute('for', id)
  }

  return inputs.length
}
