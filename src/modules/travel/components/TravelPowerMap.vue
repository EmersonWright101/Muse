<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { feature } from 'topojson-client'
import type { Topology } from 'topojson-specification'
import type { TravelNoteMeta } from '../../../stores/travel'

const props = defineProps<{
  notes: TravelNoteMeta[]
}>()

const mapContainer = ref<HTMLElement>()
let map: L.Map | null = null
let geoLayer: L.GeoJSON | null = null
const isLoading = ref(true)

type Granularity = 'province' | 'city' | 'county'
const granularity = ref<Granularity>('county')
const geoCache = new Map<Granularity, any>()

const granularities: { value: Granularity; label: string }[] = [
  { value: 'province', label: '省' },
  { value: 'city', label: '市' },
  { value: 'county', label: '县' },
]

function getCode(f: any, g: Granularity): string {
  const p = f.properties || {}
  if (g === 'county') return p.code || ''
  return p.id || p.区划码 || ''
}

function getName(f: any, g: Granularity): string {
  const p = f.properties || {}
  if (g === 'county') return p.name || ''
  return p.地名 || p.name || ''
}

// Pre-filter notes with valid coords inside rough China bounds
const chinaBounds = { minLat: 18, maxLat: 54, minLng: 73, maxLng: 135 }
function getValidNotes(): TravelNoteMeta[] {
  return props.notes.filter((n) => {
    if (n.lat === 0 && n.lng === 0) return false
    return (
      n.lat >= chinaBounds.minLat &&
      n.lat <= chinaBounds.maxLat &&
      n.lng >= chinaBounds.minLng &&
      n.lng <= chinaBounds.maxLng
    )
  })
}

async function loadGeoData(g: Granularity): Promise<any> {
  if (geoCache.has(g)) return geoCache.get(g)!

  let raw: any
  if (g === 'county') {
    const res = await fetch('/china-counties.topojson')
    const topo: Topology = await res.json()
    raw = feature(topo, topo.objects.china_county)
  } else if (g === 'city') {
    const res = await fetch('/china-prefectures.json')
    raw = await res.json()
  } else {
    const res = await fetch('/china-provinces.json')
    raw = await res.json()
  }

  // Clean: remove empty geometries and fill holes (keep outer ring only)
  const cleanedFeatures = raw.features
    .map((f: any) => {
      const geom = f.geometry
      if (!geom) return null
      if (geom.type === 'Polygon') {
        if (!geom.coordinates?.[0]?.length) return null
        if (geom.coordinates.length > 1) {
          return { ...f, geometry: { ...geom, coordinates: [geom.coordinates[0]] } }
        }
        return f
      }
      if (geom.type === 'MultiPolygon') {
        if (!geom.coordinates?.length) return null
        const parts = geom.coordinates
          .filter((p: any) => p.length > 0 && p[0].length >= 4)
          .map((p: any) => [p[0]])
        if (!parts.length) return null
        return { ...f, geometry: { ...geom, coordinates: parts } }
      }
      return null
    })
    .filter(Boolean)

  const result = { ...raw, features: cleanedFeatures }
  geoCache.set(g, result)
  return result
}

async function loadCounties() {
  if (!map) return
  isLoading.value = true

  try {
    const data = await loadGeoData(granularity.value)
    const validNotes = getValidNotes()
    const g = granularity.value

    // Build a map: region code -> visit count
    const visitMap = new Map<string, number>()

    for (const f of data.features) {
      const code = getCode(f, g)
      if (!code) continue
      let count = 0
      for (const note of validNotes) {
        try {
          if (booleanPointInPolygon([note.lng, note.lat], f.geometry)) {
            count++
          }
        } catch {
          // ignore invalid geometries
        }
      }
      if (count > 0) {
        visitMap.set(String(code), count)
      }
    }

    if (geoLayer) {
      map.removeLayer(geoLayer)
      geoLayer = null
    }

    geoLayer = L.geoJSON(data, {
      style: (feature) => {
        const code = String(getCode(feature, g) || '')
        const count = visitMap.get(code) || 0
        const visited = count > 0

        if (visited) {
          const opacity = Math.min(0.4 + count * 0.12, 0.95)
          return {
            fillColor: '#f59e0b',
            fillOpacity: opacity,
            color: '#b45309',
            weight: 1.2,
            opacity: 1,
          }
        }
        // Unvisited: transparent, let the grey basemap show through
        return {
          fillColor: 'transparent',
          fillOpacity: 0,
          color: 'transparent',
          weight: 0,
          opacity: 0,
        }
      },
      onEachFeature: (feature, layer) => {
        const pathLayer = layer as L.Path
        const code = String(getCode(feature, g) || '')
        const count = visitMap.get(code) || 0
        const name = getName(feature, g)

        const tooltipHtml =
          count > 0
            ? `<div style="font-size:12px;font-weight:600;color:#1c1c1e;">${name}</div><div style="font-size:11px;color:#b45309;margin-top:2px;">已打卡 ${count} 篇日记</div>`
            : `<div style="font-size:12px;font-weight:500;color:#1c1c1e;">${name}</div>`

        pathLayer.bindTooltip(tooltipHtml, {
          direction: 'top',
          className: 'power-map-tooltip',
          offset: [0, -4],
        })

        pathLayer.on('mouseover', () => {
          pathLayer.setStyle({ weight: 2, color: '#78350f' })
        })
        pathLayer.on('mouseout', () => {
          const c = visitMap.get(code) || 0
          if (c > 0) {
            pathLayer.setStyle({
              fillColor: '#f59e0b',
              fillOpacity: Math.min(0.4 + c * 0.12, 0.95),
              color: '#b45309',
              weight: 1.2,
              opacity: 1,
            })
          } else {
            pathLayer.setStyle({
              fillColor: 'transparent',
              fillOpacity: 0,
              color: 'transparent',
              weight: 0,
              opacity: 0,
            })
          }
        })
      },
    }).addTo(map)

    // Fit to visited bounds if any
    if (visitMap.size > 0 && geoLayer) {
      const bounds = geoLayer.getBounds()
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 8, animate: true })
      }
    }
  } catch (err) {
    console.error('Failed to load power map:', err)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => [props.notes, granularity.value] as const,
  () => {
    loadCounties()
  },
  { deep: true }
)

async function initMap() {
  if (!mapContainer.value) return

  map = L.map(mapContainer.value, {
    zoomControl: false,
    attributionControl: false,
    preferCanvas: true,
  }).setView([36.5, 105.0], 4)

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 12,
    minZoom: 3,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: 'abcd',
  }).addTo(map)

  L.control.zoom({ position: 'bottomright' }).addTo(map)

  await loadCounties()
}

onMounted(initMap)
onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="power-map-wrap">
    <!-- Granularity selector -->
    <div class="granularity-bar">
      <button
        v-for="g in granularities"
        :key="g.value"
        class="granularity-btn"
        :class="{ active: granularity === g.value }"
        @click="granularity = g.value"
      >
        {{ g.label }}
      </button>
    </div>

    <div ref="mapContainer" class="travel-power-map" />
    <div v-if="isLoading" class="power-map-loading">
      <div class="loading-spinner" />
      <span>加载行政区划数据中…</span>
    </div>
  </div>
</template>

<style scoped>
.power-map-wrap {
  width: 100%;
  height: 100%;
  position: relative;
}
.travel-power-map {
  width: 100%;
  height: 100%;
  background: #f8f9fa;
}

/* Granularity selector */
.granularity-bar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 900;
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-radius: 8px;
  padding: 3px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10), 0 0 0 0.5px rgba(0, 0, 0, 0.06) inset;
}

.granularity-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: #8e8e93;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.12s;
  font-weight: 500;
}

.granularity-btn.active {
  background: white;
  color: #1c1c1e;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
}

.power-map-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: #8e8e93;
  font-size: 13px;
  pointer-events: none;
}
.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(0, 0, 0, 0.08);
  border-top-color: #f59e0b;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>

<style>
.power-map-tooltip {
  background: rgba(255, 255, 255, 0.96) !important;
  border: 1px solid rgba(0, 0, 0, 0.08) !important;
  border-radius: 8px !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12) !important;
  padding: 6px 10px !important;
  color: #1c1c1e !important;
  white-space: nowrap;
}
.leaflet-tooltip-top.power-map-tooltip::before {
  display: none !important;
}
</style>
