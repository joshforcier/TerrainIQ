import { onMounted, onUnmounted, nextTick, shallowRef, watch, type Ref } from 'vue'
import L from 'leaflet'
import { useMapStore, type BaseLayer } from '@/stores/map'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string
const MAPBOX_TOPO_STYLE = (import.meta.env.VITE_MAPBOX_TOPO_STYLE as string | undefined)
  || 'mapbox://styles/joshforcier/cmolyfzwi008901s72vbdddmd'
const MAPBOX_HYBRID_STYLE = 'joshforcier/cmnyygiw9006x01qv8bpg574v'

interface LayerDef {
  kind?: 'tile' | 'arcgis-export'
  url: string
  attribution: string
  tileSize: number
  zoomOffset: number
  maxZoom: number
  maxNativeZoom?: number
  opacity?: number
}

type TileCoords = { x: number; y: number; z: number }

function mapboxLayer(style: string, opacity?: number): LayerDef {
  const stylePath = style.replace(/^mapbox:\/\/styles\//, '')
  return {
    url: `https://api.mapbox.com/styles/v1/${stylePath}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a>',
    tileSize: 512,
    zoomOffset: -1,
    maxZoom: 22,
    opacity,
  }
}

const layerDefs: Record<BaseLayer, LayerDef[]> = {
  streets: [mapboxLayer('mapbox/streets-v12')],
  satellite: [mapboxLayer('mapbox/satellite-v9')],
  outdoors: [mapboxLayer(MAPBOX_TOPO_STYLE)],
  hybrid: [mapboxLayer(MAPBOX_HYBRID_STYLE)],
  // USGS 3DEP LIDAR-derived shaded relief. The cached `/tile/{z}/{y}/{x}`
  // endpoint advertises deep zoom levels but returns 404 for many normal
  // Web Mercator tile coordinates, which makes Leaflet show grey tiles.
  // The dynamic `/export` endpoint is bbox-based and returns imagery for the
  // same map area, so we use it through a lightweight GridLayer-style tile URL.
  lidar: [{
    kind: 'arcgis-export',
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/export',
    attribution: 'Shaded relief &copy; <a href="https://www.usgs.gov/">USGS 3DEP</a>',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 22,
  }],
}

function createArcGisExportLayer(def: LayerDef): L.TileLayer {
  const layer = L.tileLayer('', {
    tileSize: def.tileSize,
    zoomOffset: def.zoomOffset,
    maxZoom: def.maxZoom,
    opacity: def.opacity ?? 1,
    attribution: def.attribution,
  })

  layer.getTileUrl = function getArcGisExportTileUrl(coords: TileCoords): string {
    const map = this._map
    const tileSize = this.getTileSize()
    const nwPoint = L.point(coords.x * tileSize.x, coords.y * tileSize.y)
    const sePoint = nwPoint.add(tileSize)
    const nw = map.unproject(nwPoint, coords.z)
    const se = map.unproject(sePoint, coords.z)
    const bounds = L.latLngBounds(se, nw)
    const sw3857 = L.CRS.EPSG3857.project(bounds.getSouthWest())
    const ne3857 = L.CRS.EPSG3857.project(bounds.getNorthEast())

    const params = new URLSearchParams({
      bbox: `${sw3857.x},${sw3857.y},${ne3857.x},${ne3857.y}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${tileSize.x},${tileSize.y}`,
      format: 'png',
      transparent: 'false',
      f: 'image',
    })

    return `${def.url}?${params.toString()}`
  }

  return layer
}

export function useMap(containerRef: Ref<HTMLElement | null>) {
  const map = shallowRef<L.Map | null>(null)
  const mapStore = useMapStore()
  let currentTileLayers: L.TileLayer[] = []

  function applyTileLayer(instance: L.Map, layer: BaseLayer) {
    for (const tl of currentTileLayers) {
      instance.removeLayer(tl)
    }
    currentTileLayers = []

    for (const def of layerDefs[layer]) {
      const tl = def.kind === 'arcgis-export'
        ? createArcGisExportLayer(def)
        : L.tileLayer(def.url, {
          tileSize: def.tileSize,
          zoomOffset: def.zoomOffset,
          maxZoom: def.maxZoom,
          maxNativeZoom: def.maxNativeZoom,
          opacity: def.opacity ?? 1,
          attribution: def.attribution,
        })
      tl.addTo(instance)
      currentTileLayers.push(tl)
    }
  }

  onMounted(() => {
    if (!containerRef.value) return

    const instance = L.map(containerRef.value, {
      attributionControl: false,
    }).setView(
      [mapStore.center.lat, mapStore.center.lng],
      mapStore.zoom
    )

    applyTileLayer(instance, mapStore.baseLayer)

    L.control.scale({ imperial: true, metric: false, position: 'bottomright' }).addTo(instance)

    instance.on('moveend', () => {
      const center = instance.getCenter()
      mapStore.setView(
        { lat: center.lat, lng: center.lng },
        instance.getZoom()
      )
    })

    map.value = instance

    nextTick(() => {
      instance.invalidateSize()
    })
  })

  watch(
    () => mapStore.baseLayer,
    (layer) => {
      if (map.value) {
        applyTileLayer(map.value, layer)
      }
    }
  )

  onUnmounted(() => {
    if (map.value) {
      map.value.remove()
      map.value = null
    }
  })

  function setView(lat: number, lng: number, zoom: number) {
    map.value?.setView([lat, lng], zoom)
  }

  function invalidateSize() {
    map.value?.invalidateSize()
  }

  return { map, setView, invalidateSize }
}
