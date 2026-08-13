declare module 'leaflet.markercluster' {
  import * as L from 'leaflet'

  export interface MarkerClusterOptions extends L.MarkerOptions {
    maxClusterRadius?: number
    spiderfyOnMaxZoom?: boolean
    showCoverageOnHover?: boolean
    zoomToBoundsOnClick?: boolean
    iconCreateFunction?: (cluster: MarkerCluster) => L.DivIcon
  }

  export class MarkerClusterGroup extends L.FeatureGroup {
    constructor(options?: MarkerClusterOptions)
    addLayer(layer: L.Layer): this
    removeLayer(layer: L.Layer): this
    clearLayers(): this
    refreshClusters?: () => void
  }

  export class MarkerCluster extends L.Marker {
    getChildCount(): number
    getAllChildMarkers(): L.Marker[]
  }
}
