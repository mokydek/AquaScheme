/**
 * Core domain types of the calculation engine.
 * The engine is pure TypeScript: no React, no DOM, no Supabase.
 */

/** A topographic survey point. Coordinates in meters, Z is ground elevation. */
export interface SurveyPoint {
  x: number
  y: number
  z: number
}

/** A water consumer: a building placed on the map. */
export interface Building {
  id: string
  x: number
  y: number
  /** Number of floors above ground. */
  floors: number
  /** Number of residents; drives design flow per SP RK 4.01-101. */
  residents: number
}

/** The water source (point A): treatment plant, pump station or intake. */
export interface WaterSource {
  id: string
  x: number
  y: number
  /** Ground elevation at the source, m. */
  groundElevation: number
  /** Available head at the source, m (pump head or clean water reservoir level). */
  availableHead: number
}
