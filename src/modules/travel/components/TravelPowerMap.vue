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

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const mapContainer = ref<HTMLElement>()
let map: L.Map | null = null
let geoLayers: L.GeoJSON[] = []
const isLoading = ref(true)

type Granularity = 'country' | 'province' | 'city' | 'county'
const granularity = ref<Granularity>('county')
const geoCache = new Map<string, any>()

const granularities: { value: Granularity; label: string }[] = [
  { value: 'country', label: '国家' },
  { value: 'province', label: '省/州' },
  { value: 'city', label: '市' },
  { value: 'county', label: '县' },
]

// ─── Note filtering ──────────────────────────────────────────────────────────
const chinaBounds = { minLat: 18, maxLat: 54, minLng: 73, maxLng: 135 }

function isInChina(lat: number, lng: number): boolean {
  return (
    lat >= chinaBounds.minLat &&
    lat <= chinaBounds.maxLat &&
    lng >= chinaBounds.minLng &&
    lng <= chinaBounds.maxLng
  )
}

function getAllValidNotes(): TravelNoteMeta[] {
  return props.notes.filter((n) => n.status !== 'upcoming' && !(n.lat === 0 && n.lng === 0))
}

function getChinaNotes(): TravelNoteMeta[] {
  return getAllValidNotes().filter((n) => isInChina(n.lat, n.lng))
}

function getNonChinaNotes(): TravelNoteMeta[] {
  return getAllValidNotes().filter((n) => !isInChina(n.lat, n.lng))
}

// ─── Feature key / name helpers ──────────────────────────────────────────────
// China data (province / city / county)
type ChinaLevel = 'province' | 'city' | 'county'

function getKeyChina(f: any, g: ChinaLevel): string {
  const p = f.properties || {}
  const raw = g === 'county' ? p.code : p.id || p['区划码']
  return raw ? `cn_${raw}` : ''
}

function getNameChina(f: any, g: ChinaLevel): string {
  const p = f.properties || {}
  return g === 'county' ? p.name || '' : p['地名'] || p.name || ''
}

// World countries (country level)
function getKeyCountry(f: any): string {
  const p = f.properties || {}
  const code = p.ADM0_A3 || p.ISO_A2 || ''
  if (!code || code === '-99') return ''
  // Taiwan is part of China
  if (code === 'TWN') return 'ctry_CHN'
  return `ctry_${code}`
}

function getNameCountry(f: any): string {
  const p = f.properties || {}
  if (p.ADM0_A3 === 'TWN') return '台湾（中华人民共和国）'
  return p.NAME_ZH || p.ADMIN || ''
}

// World admin1 (non-China province/state level)
function getKeyAdmin1(f: any): string {
  const p = f.properties || {}
  const code = p.adm1_code || p.iso_3166_2 || ''
  return code ? `w1_${code}` : ''
}

function getNameAdmin1(f: any): string {
  const p = f.properties || {}
  const name = p.name_zh || p.name || ''
  const country = p.admin || ''
  return country ? `${name}（${country}）` : name
}

// ─── GeoJSON / TopoJSON loading ───────────────────────────────────────────────
function cleanFeatures(raw: any): any {
  const cleaned = raw.features
    .map((f: any) => {
      const geom = f.geometry
      if (!geom) return null
      if (geom.type === 'Polygon') {
        if (!geom.coordinates?.[0]?.length) return null
        // Drop holes to avoid polygon winding issues
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
  return { ...raw, features: cleaned }
}

async function loadGeoData(key: string): Promise<any> {
  if (geoCache.has(key)) return geoCache.get(key)!

  let raw: any
  if (key === 'county') {
    const res = await fetch('/china-counties.topojson')
    const topo: Topology = await res.json()
    raw = feature(topo, topo.objects.china_county)
  } else if (key === 'city') {
    const res = await fetch('/china-prefectures.json')
    raw = await res.json()
  } else if (key === 'province') {
    const res = await fetch('/china-provinces.json')
    raw = await res.json()
  } else if (key === 'country') {
    const res = await fetch('/world-countries.json')
    raw = await res.json()
  } else if (key === 'world-admin1') {
    const res = await fetch('/world-admin1.topojson')
    const topo: Topology = await res.json()
    raw = feature(topo, Object.values(topo.objects)[0] as any)
  } else {
    throw new Error(`Unknown geo key: ${key}`)
  }

  const result = cleanFeatures(raw)
  geoCache.set(key, result)
  return result
}

// ─── Match notes to features ─────────────────────────────────────────────────
function matchNotes(
  features: any[],
  notes: TravelNoteMeta[],
  getKey: (f: any) => string,
): { visitMap: Map<string, number>; notesMap: Map<string, TravelNoteMeta[]> } {
  const visitMap = new Map<string, number>()
  const notesMap = new Map<string, TravelNoteMeta[]>()

  for (const f of features) {
    const key = getKey(f)
    if (!key) continue
    const matching: TravelNoteMeta[] = []
    for (const note of notes) {
      try {
        if (booleanPointInPolygon([note.lng, note.lat], f.geometry)) {
          matching.push(note)
        }
      } catch {
        // ignore invalid geometries
      }
    }
    if (matching.length > 0) {
      visitMap.set(key, matching.length)
      notesMap.set(key, matching)
    }
  }
  return { visitMap, notesMap }
}

// ─── Build a Leaflet GeoJSON layer ───────────────────────────────────────────
function makeGeoLayer(
  data: any,
  visitMap: Map<string, number>,
  notesMap: Map<string, TravelNoteMeta[]>,
  getKey: (f: any) => string,
  getName: (f: any) => string,
): L.GeoJSON {
  return L.geoJSON(data, {
    style: (f) => {
      const key = getKey(f!)
      const count = visitMap.get(key) || 0
      if (count > 0) {
        return {
          fillColor: '#f59e0b',
          fillOpacity: Math.min(0.4 + count * 0.12, 0.95),
          color: '#b45309',
          weight: 1.2,
          opacity: 1,
          className: 'power-map-visited',
        }
      }
      return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0, opacity: 0 }
    },
    onEachFeature: (f, lyr) => {
      const pathLayer = lyr as L.Path
      const key = getKey(f)
      const count = visitMap.get(key) || 0
      const name = getName(f)

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
        if (count > 0) pathLayer.setStyle({ weight: 2, color: '#78350f' })
      })
      pathLayer.on('mouseout', () => {
        const c = visitMap.get(key) || 0
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

      const regionNotes = notesMap.get(key)
      if (regionNotes && regionNotes.length > 0) {
        pathLayer.on('click', () => {
          const sorted = [...regionNotes].sort((a, b) =>
            (b.updatedAt ?? b.date).localeCompare(a.updatedAt ?? a.date),
          )
          emit('select', sorted[0].id)
        })
      }
    },
  })
}

// ─── Main render function ────────────────────────────────────────────────────
async function loadCounties() {
  if (!map) return
  isLoading.value = true

  for (const lyr of geoLayers) map.removeLayer(lyr)
  geoLayers = []

  try {
    const g = granularity.value
    const allBounds: L.LatLngBounds[] = []

    if (g === 'country') {
      // World countries — all valid notes
      const data = await loadGeoData('country')
      const { visitMap, notesMap } = matchNotes(data.features, getAllValidNotes(), getKeyCountry)
      const layer = makeGeoLayer(data, visitMap, notesMap, getKeyCountry, getNameCountry)
      layer.addTo(map)
      geoLayers.push(layer)
      const b = layer.getBounds()
      if (b.isValid()) allBounds.push(b)
    } else if (g === 'province') {
      // China: use china-provinces.json (higher detail)
      const chinaData = await loadGeoData('province')
      const chinaKey = (f: any) => getKeyChina(f, 'province')
      const chinaName = (f: any) => getNameChina(f, 'province')
      const chinaResult = matchNotes(chinaData.features, getChinaNotes(), chinaKey)
      const chinaLayer = makeGeoLayer(
        chinaData,
        chinaResult.visitMap,
        chinaResult.notesMap,
        chinaKey,
        chinaName,
      )
      chinaLayer.addTo(map)
      geoLayers.push(chinaLayer)
      const cb = chinaLayer.getBounds()
      if (cb.isValid()) allBounds.push(cb)

      // Non-China: use world-admin1.topojson (covers all other countries)
      const nonChinaNotes = getNonChinaNotes()
      if (nonChinaNotes.length > 0) {
        try {
          const worldData = await loadGeoData('world-admin1')
          const worldResult = matchNotes(worldData.features, nonChinaNotes, getKeyAdmin1)
          if (worldResult.visitMap.size > 0) {
            const worldLayer = makeGeoLayer(
              worldData,
              worldResult.visitMap,
              worldResult.notesMap,
              getKeyAdmin1,
              getNameAdmin1,
            )
            worldLayer.addTo(map)
            geoLayers.push(worldLayer)
            const wb = worldLayer.getBounds()
            if (wb.isValid()) allBounds.push(wb)
          }
        } catch {
          // world-admin1.topojson not available
        }
      }
    } else {
      // city / county — China only
      const data = await loadGeoData(g)
      const getKey = (f: any) => getKeyChina(f, g as ChinaLevel)
      const getName = (f: any) => getNameChina(f, g as ChinaLevel)
      const { visitMap, notesMap } = matchNotes(data.features, getChinaNotes(), getKey)
      const layer = makeGeoLayer(data, visitMap, notesMap, getKey, getName)
      layer.addTo(map)
      geoLayers.push(layer)
      const b = layer.getBounds()
      if (b.isValid()) allBounds.push(b)
    }

    // Fit to all visited regions
    if (allBounds.length > 0) {
      const combined = allBounds.reduce((acc, b) => acc.extend(b))
      if (combined.isValid()) {
        map.fitBounds(combined, { padding: [60, 60], maxZoom: 8, animate: true })
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
  { deep: true },
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
    minZoom: 2,
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
.power-map-visited {
  cursor: pointer;
}

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
