<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import L from 'leaflet'
import type { TravelNoteMeta } from '../../../stores/travel'
import { resolveImageUrl } from '../../../utils/imageAsset'

const props = defineProps<{
  notes: TravelNoteMeta[]
  activeNoteId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const CLUSTER_RADIUS_PX = 40

const mapContainer = ref<HTMLElement>()
let map: L.Map | null = null
let markers: Map<string, L.Marker> = new Map() // key = seed note id

interface Cluster {
  key: string
  notes: TravelNoteMeta[]
  lat: number
  lng: number
}

function buildDynamicClusters(): Cluster[] {
  if (!map) return []
  const valid = props.notes.filter(n => n.lat !== 0 || n.lng !== 0)
  const assigned = new Set<string>()
  const clusters: Cluster[] = []

  for (const seed of valid) {
    if (assigned.has(seed.id)) continue
    const pos = map.latLngToContainerPoint([seed.lat, seed.lng])
    const group: TravelNoteMeta[] = [seed]
    assigned.add(seed.id)

    for (const other of valid) {
      if (assigned.has(other.id)) continue
      const opos = map.latLngToContainerPoint([other.lat, other.lng])
      if (Math.hypot(pos.x - opos.x, pos.y - opos.y) <= CLUSTER_RADIUS_PX) {
        group.push(other)
        assigned.add(other.id)
      }
    }

    const lat = group.reduce((s, n) => s + n.lat, 0) / group.length
    const lng = group.reduce((s, n) => s + n.lng, 0) / group.length
    clusters.push({ key: seed.id, notes: group, lat, lng })
  }

  return clusters
}

function buildCoverHtml(cover: string): string {
  if (cover && (cover.startsWith('http') || cover.startsWith('/') || cover.includes('.'))) {
    return `<img src="${resolveImageUrl(cover)}" class="tt-cover-img" alt="" />`
  }
  return cover || '📍'
}

function buildTooltipHtml(note: TravelNoteMeta): string {
  return `
    <div class="tt-card">
      <div class="tt-cover">${buildCoverHtml(note.cover)}</div>
      <div class="tt-body">
        <div class="tt-title">${note.title}</div>
        <div class="tt-preview">${note.preview || ''}</div>
      </div>
    </div>
  `
}

function buildClusterTooltip(notes: TravelNoteMeta[]): string {
  if (notes.length === 1) return buildTooltipHtml(notes[0])
  const items = notes.map(n => `
    <div class="tt-cluster-item">
      <div class="tt-cluster-cover">${buildCoverHtml(n.cover)}</div>
      <span class="tt-cluster-title">${n.title}</span>
    </div>
  `).join('')
  return `<div class="tt-cluster">${items}</div>`
}

function makeIcon(active: boolean, count: number = 1): L.DivIcon {
  const clustered = count > 1
  const badge = clustered ? `<span class="marker-count">${count}</span>` : ''
  const pinClass = `marker-pin${active ? ' active' : ''}${clustered ? ' clustered' : ''}`
  return L.divIcon({
    className: active ? 'travel-marker active' : 'travel-marker',
    html: `<div class="${pinClass}">${badge}</div>`,
    iconSize: active ? [32, 42] : [28, 38],
    iconAnchor: active ? [16, 40] : [14, 36],
    popupAnchor: [0, -36],
  })
}

function initMap() {
  if (!mapContainer.value) return
  map = L.map(mapContainer.value, {
    zoomControl: false,
    attributionControl: false,
  }).setView([35.8617, 104.1954], 3)

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map)

  L.control.zoom({ position: 'bottomright' }).addTo(map)
  map.on('zoomend', rebuildMarkers)
  rebuildMarkers()
}

function rebuildMarkers() {
  if (!map) return

  // Clear all existing markers — cluster composition changes on each zoom
  for (const m of markers.values()) map.removeLayer(m)
  markers.clear()

  const clusters = buildDynamicClusters()

  for (const { key, notes, lat, lng } of clusters) {
    const isActive = notes.some(n => n.id === props.activeNoteId)
    const icon = makeIcon(isActive, notes.length)
    const tooltip = buildClusterTooltip(notes)

    const marker = L.marker([lat, lng], { icon })
      .addTo(map)
      .bindTooltip(tooltip, {
        permanent: false,
        direction: 'top',
        className: 'travel-tooltip',
        offset: [0, -36],
        opacity: 1,
      })
    marker.on('click', () => emit('select', notes[0].id))
    markers.set(key, marker)
  }

  // Pan to active note and open its cluster tooltip
  if (props.activeNoteId) {
    const active = props.notes.find(n => n.id === props.activeNoteId)
    if (active && active.lat !== 0 && active.lng !== 0) {
      map.setView([active.lat, active.lng], Math.max(map.getZoom(), 10), {
        animate: true,
        duration: 0.5,
      })
      const cluster = clusters.find(c => c.notes.some(n => n.id === props.activeNoteId))
      if (cluster) markers.get(cluster.key)?.openTooltip()
    }
  }
}

watch(() => props.notes, rebuildMarkers, { deep: true })
watch(() => props.activeNoteId, rebuildMarkers)

onMounted(initMap)
onUnmounted(() => {
  if (map) {
    map.remove()
    map = null
  }
  markers.clear()
})
</script>

<template>
  <div ref="mapContainer" class="travel-map" />
</template>

<style>
.travel-map {
  width: 100%;
  height: 100%;
  background: #e5e7eb;
}

/* Blue pin marker */
.travel-marker .marker-pin {
  width: 28px;
  height: 28px;
  border-radius: 50% 50% 50% 0;
  background: #2563eb;
  position: absolute;
  transform: rotate(-45deg);
  left: 50%;
  top: 50%;
  margin: -14px 0 0 -14px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  transition: all 0.2s;
}

.travel-marker .marker-pin::after {
  content: '';
  width: 10px;
  height: 10px;
  margin: 9px 0 0 9px;
  background: #fff;
  position: absolute;
  border-radius: 50%;
}

.travel-marker.active .marker-pin {
  width: 32px;
  height: 32px;
  margin: -16px 0 0 -16px;
  background: #1d4ed8;
  box-shadow: 0 3px 8px rgba(0,0,0,0.35);
}

.travel-marker.active .marker-pin::after {
  width: 12px;
  height: 12px;
  margin: 10px 0 0 10px;
}

.marker-pin.clustered::after {
  display: none;
}

.marker-count {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) rotate(45deg);
  font-size: 11px;
  font-weight: 700;
  color: white;
  line-height: 1;
  z-index: 1;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}

.tt-cluster {
  background: white;
  border-radius: 10px;
  padding: 6px 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 140px;
  max-width: 220px;
}

.tt-cluster-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tt-cluster-cover {
  font-size: 16px;
  width: 24px;
  height: 24px;
  background: rgba(120, 120, 128, 0.1);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.tt-cluster-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tt-cluster-title {
  font-size: 12px;
  font-weight: 500;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Tooltip card */
.travel-tooltip {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
}

.leaflet-tooltip-top.travel-tooltip::before {
  display: none !important;
}

.tt-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: white;
  border-radius: 10px;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 160px;
  max-width: 240px;
}

.tt-cover {
  font-size: 28px;
  width: 40px;
  height: 40px;
  background: rgba(120, 120, 128, 0.1);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.tt-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tt-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.tt-title {
  font-size: 13px;
  font-weight: 600;
  color: #1c1c1e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tt-preview {
  font-size: 11px;
  color: #8e8e93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
