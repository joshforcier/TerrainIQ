import { onMounted, onUnmounted, nextTick, shallowRef, watch, type Ref } from 'vue'
import L from 'leaflet'
import { useMapStore, type BaseLayer } from '@/stores/map'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string

interface LayerDef {
  url: string
  attribution: string
  tileSize: number
  zoomOffset: number
  maxZoom: number
  maxNativeZoom?: number
  opacity?: number
}

function mapboxLayer(style: string, opacity?: number): LayerDef {
  return {
    url: `https://api.mapbox.com/styles/v1/${style}/tiles/512/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
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
  outdoors: [mapboxLayer('mapbox/outdoors-v12')],
  hybrid: [mapboxLayer('joshforcier/cmnyygiw9006x01qv8bpg574v')],
  // USGS 3DEP LIDAR-derived shaded relief — ~1m resolution over most of the
  // US West. Reveals benches, drainages, and blowdown hidden under canopy.
  // USGS caps native tiles at zoom 16; we allow rendering beyond that so
  // Leaflet up-samples the z16 tiles instead of going blank.
  lidar: [{
    url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Shaded relief &copy; <a href="https://www.usgs.gov/">USGS 3DEP</a>',
    tileSize: 256,
    zoomOffset: 0,
    maxZoom: 22,
    maxNativeZoom: 16,
  }],
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
      const tl = L.tileLayer(def.url, {
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
