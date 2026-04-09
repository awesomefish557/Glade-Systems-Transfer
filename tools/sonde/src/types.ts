export type ModuleId =
  | 'solar'
  | 'wind'
  | 'climate'
  | 'flood'
  | 'ground'
  | 'lasercut'
  | 'planning'
  | 'demographics'
  | 'movement'
  | 'ecology'
  | 'built'
  | 'templates'
  | 'precedents'
  | 'basemap'
  | 'localIntel'
  | 'export'

export type StatusTone = 'green' | 'amber' | 'red'

export interface SiteLocation {
  lat: number
  lng: number
  address: string
  name: string
}

export interface SavedSite {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  savedAt: string
  notes: string
  files: string[]
  groundSnapshot?: GroundSnapshot
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
  id?: string
  rings: [number, number][][]
  levels?: number
  heightM?: number
  name?: string
  buildingType?: string
  roofShape?: string
}

export interface OSMRoad {
  coords: [number, number][]
  highway: string
}

export interface OSMTree {
  id: string
  lat: number
  lng: number
  height: number
  crownDiameter: number
  leafCycle: 'deciduous' | 'evergreen' | 'unknown'
  leafType: 'broadleaved' | 'needleleaved' | 'unknown'
  species?: string
}

export interface OSMWoodland {
  id: string
  ring: [number, number][]
}

export interface OSMPlanData {
  buildings: OSMBuilding[]
  roads: OSMRoad[]
  trees: OSMTree[]
  woodlands: OSMWoodland[]
}

export interface FloodAreaItem {
  id: string
  label: string
  riverOrSea?: string
}

export interface FloodData {
  provider: 'ea' | 'nrw'
  region: 'england' | 'wales'
  radiusKm: number
  areas: FloodAreaItem[]
  rawCount: number
  floodZone: '1' | '2' | '3'
  historicalEvents: string
  climateProjection2050: string
  nearestWatercourse?: string
  surfaceWaterRisk: 'Low' | 'Medium' | 'High'
  mapUrl: string
}

export interface SourceNote {
  label: string
  url: string
  mode: 'live' | 'partial' | 'fallback'
}

export interface PlanningData {
  zone: string
  conservationArea: string
  listedBuildings: Array<{ id: string; name: string; grade: string; distanceM: number; lat: number; lng: number }>
  recentApplications: Array<{ id: string; description: string; date: string }>
  brownfieldStatus: string
  portalUrl: string
  sources: SourceNote[]
}

export interface DemographicsData {
  areaCode: string
  totalPopulation: number
  densityPerKm2?: number
  under5: number
  under16: number
  households: string
  imdScore?: number
  imdDecile?: number
  socialRentPct?: number
  ownerOccupiedPct?: number
  ageBands: Array<{ label: string; count: number }>
  sources: SourceNote[]
}

export interface MovementData {
  walkIsochrones: GeoJSON.FeatureCollection
  cycleIsochrones: GeoJSON.FeatureCollection
  busStops: Array<{ id: string; name: string; lat: number; lng: number; distanceM: number; routes: string[] }>
  cycleways: GeoJSON.FeatureCollection
  keyDistances: Array<{ label: string; distanceM: number; note?: string }>
  sources: SourceNote[]
}

export interface EcologyData {
  nearestStation?: string
  no2Annual?: number
  pm25Annual?: number
  treesCount: number
  greenInfraPct: number
  rag: 'Good' | 'Moderate' | 'Poor'
  parks: GeoJSON.FeatureCollection
  trees: GeoJSON.FeatureCollection
  sources: SourceNote[]
}

export interface BuiltEnvironmentData {
  periodSummary: string
  epcSummary: string
  avgHeightM?: number
  buildingCount: number
  ageBuckets: Array<{ label: string; count: number }>
  heights: number[]
  sources: SourceNote[]
}

export interface ObservationTemplateInfo {
  id: 'active-frontage' | 'desire-lines' | 'noise-map' | 'social-observation'
  title: string
  description: string
}

export interface PrecedentCard {
  name: string
  architect: string
  year: number
  location: string
  whyRelevant: string
  keyMoves: string[]
  lookAt: string
  searchQuery: string
}

export interface GroundBearingEstimate {
  classLabel: 'Excellent' | 'Good' | 'Moderate' | 'Poor' | 'Unknown'
  rag: 'green' | 'amber' | 'red'
  capacityKpa: string
  rationale: string
}

export interface GroundBorehole {
  id: string
  distanceM: number
  depthM?: number
  date?: string
  url: string
}

export interface GroundMovementSeriesPoint {
  label: string
  displacementMm: number
}

export interface GroundData {
  dtmAodM?: number
  dsmAodM?: number
  buildingHeightM?: number
  slopePct50m?: number
  surveyedDate?: string
  superficialType: string
  superficialThickness?: string
  superficialEngineering?: string
  madeGroundDetected: boolean
  bedrockType: string
  bedrockAge?: string
  depthToBedrock?: string
  bearing: GroundBearingEstimate
  boreholes: GroundBorehole[]
  movementMeanMmYr?: number
  movementClassification: 'Stable' | 'Slow movement' | 'Active movement'
  movementRag: 'green' | 'amber' | 'red'
  seasonalAmplitudeMm?: number
  movementPoints: number
  movementDateRange?: string
  movementSeries: GroundMovementSeriesPoint[]
  designImplications: string[]
}

export interface GroundSnapshot {
  updatedAt: string
  summary: string
  bearing: string
  movement: string
  madeGround: boolean
}
