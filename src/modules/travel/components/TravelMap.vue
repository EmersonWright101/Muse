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

const mapContainer = ref<HTMLElement>()
let map: L.Map | null = null
let markers: Map<string, L.Marker> = new Map()

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

function makeIcon(active: boolean): L.DivIcon {
  return L.divIcon({
    className: active ? 'travel-marker active' : 'travel-marker',
    html: `<div class="marker-pin${active ? ' active' : ''}"></div>`,
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
  updateMarkers()
}

function updateMarkers() {
  if (!map) return

  // Remove old markers not in current list
  const currentIds = new Set(props.notes.map(n => n.id))
  for (const [id, marker] of markers) {
    if (!currentIds.has(id)) {
      map.removeLayer(marker)
      markers.delete(id)
    }
  }

  // Add or update markers
  for (const note of props.notes) {
    if (note.lat === 0 && note.lng === 0) continue
    const existing = markers.get(note.id)
    const isActive = props.activeNoteId === note.id
    const icon = makeIcon(isActive)

    if (existing) {
      existing.setLatLng([note.lat, note.lng])
      existing.setIcon(icon)
      existing.setTooltipContent(buildTooltipHtml(note))
    } else {
      const marker = L.marker([note.lat, note.lng], { icon })
        .addTo(map)
        .bindTooltip(buildTooltipHtml(note), {
          permanent: false,
          direction: 'top',
          className: 'travel-tooltip',
          offset: [0, -36],
          opacity: 1,
        })
      marker.on('click', () => emit('select', note.id))
      markers.set(note.id, marker)
    }
  }

  // Pan to active note
  if (props.activeNoteId) {
    const active = props.notes.find(n => n.id === props.activeNoteId)
    if (active && active.lat !== 0 && active.lng !== 0) {
      map.setView([active.lat, active.lng], Math.max(map.getZoom(), 10), {
        animate: true,
        duration: 0.5,
      })
      const m = markers.get(active.id)
      if (m) m.openTooltip()
    }
  }
}

watch(() => props.notes, updateMarkers, { deep: true })
watch(() => props.activeNoteId, updateMarkers)

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
