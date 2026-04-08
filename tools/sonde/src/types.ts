export type ModuleId =
  | 'solar'
  | 'wind'
  | 'climate'
  | 'flood'
  | 'basemap'
  | 'export'

export type StatusTone = 'green' | 'amber' | 'red'

export interface SiteLocation {
  lat: number
  lng: number
  address: string
  name: string
}

export interface SolarDayCurve {
  seasonKey: 'winter' | 'spring' | 'summer' | 'autumn'
  label: string
  color: string
  points: { alt: number; azimuthFromNorth: number; t: Date }[]
}

export interface SolarSummary {
  curves: SolarDayCurve[]
  sunrise: Date
  sunset: Date
  solarNoonElevationDeg: number
  daylightHours: number
}

export interface WindRoseBin {
  sectorIndex: number
  dirDeg: number
  frequency: number
  avgSpeed: number
  count: number
}

export interface WindData {
  bins: WindRoseBin[]
  prevailingDirDeg: number
  prevailingAvgSpeed: number
  hourlySpeed: number[]
  hourlyDir: number[]
}

export interface ClimateMonthPoint {
  month: number
  label: string
  tempMean: number
  precipMm: number
  radiationKwhM2: number
}

export interface ClimateData {
  months: ClimateMonthPoint[]
}

export interface OSMBuilding {
  rings: [number, number][][]
  levels?: number
}

export interface OSMRoad {
  coords: [number, number][]
  highway: string
}

export interface OSMPlanData {
  buildings: OSMBuilding[]
  roads: OSMRoad[]
}

export interface FloodAreaItem {
  id: string
  label: string
  riverOrSea?: string
}

export interface FloodData {
  areas: FloodAreaItem[]
  rawCount: number
}
