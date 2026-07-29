import {
  stormDemoAxisAt,
  STORM_DEMO_STEP_M,
  STORM_DEMO_TOTAL_M,
} from '@aquascheme/engine'

/**
 * Visible but explicitly synthetic plan context for the demo. It exercises
 * the same rendering pipeline as a classified DWG without masquerading as
 * survey data that could be issued for construction.
 */
export function buildSyntheticStormPlanContext() {
  const stations = Array.from(
    { length: Math.floor(STORM_DEMO_TOTAL_M / STORM_DEMO_STEP_M) + 1 },
    (_, index) => index * STORM_DEMO_STEP_M,
  )
  const leftRoad = stations.map((station) => {
    const axis = stormDemoAxisAt(station)
    return { x: axis.x - 22, y: axis.y }
  })
  const rightRoad = stations.map((station) => {
    const axis = stormDemoAxisAt(station)
    return { x: axis.x + 22, y: axis.y }
  })
  const terrainLines = stations.map((station, index) => {
    const axis = stormDemoAxisAt(station)
    return {
      layer: 'DEMO-RELIEF',
      sourceHandle: `DEMO-TERRAIN-${index}`,
      points: [
        { x: axis.x - 55, y: axis.y - 3 },
        { x: axis.x, y: axis.y + (index % 2 === 0 ? 2 : -2) },
        { x: axis.x + 55, y: axis.y + 3 },
      ],
    }
  })
  const parcelLines = stations
    .filter((_, index) => index % 2 === 0)
    .map((station, index) => {
      const axis = stormDemoAxisAt(station)
      return {
        layer: 'DEMO-PARCELS',
        sourceHandle: `DEMO-PARCEL-${index}`,
        points: [{ x: axis.x - 58, y: axis.y }, { x: axis.x + 58, y: axis.y }],
      }
    })
  return {
    cadContextLines: [
      { layer: 'DEMO-ROAD-EDGE', sourceHandle: 'DEMO-ROAD-L', points: leftRoad },
      { layer: 'DEMO-ROAD-EDGE', sourceHandle: 'DEMO-ROAD-R', points: rightRoad },
      ...parcelLines,
    ],
    terrainLines,
    cadTextEntities: stations
      .filter((_, index) => index % 3 === 0)
      .map((station, index) => {
        const axis = stormDemoAxisAt(station)
        return {
          x: axis.x + 28,
          y: axis.y + 5,
          text: `УЧЕБНАЯ ПОДОСНОВА · ПК${Math.floor(station / 100)}`,
          layer: 'DEMO-TEXT',
          sourceHandle: `DEMO-TEXT-${index}`,
        }
      }),
    cadBlockEntities: stations
      .filter((_, index) => index % 4 === 0)
      .map((station, index) => {
        const axis = stormDemoAxisAt(station)
        return {
          x: axis.x - 32,
          y: axis.y,
          name: 'DEMO-GEODETIC-MARK',
          layer: 'DEMO-BLOCKS',
          sourceHandle: `DEMO-BLOCK-${index}`,
        }
      }),
    roadLines: [
      { id: 'DEMO-ROAD-LEFT', points: leftRoad, source: 'synthetic-demo' },
      { id: 'DEMO-ROAD-RIGHT', points: rightRoad, source: 'synthetic-demo' },
    ],
  }
}
