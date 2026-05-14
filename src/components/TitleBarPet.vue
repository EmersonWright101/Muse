<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const scene = computed(() => {
  const p = route.path
  if (p.startsWith('/chat'))       return 'chat'
  if (p.startsWith('/notes'))      return 'notes'
  if (p.startsWith('/travel'))     return 'travel'
  if (p.startsWith('/ebook'))      return 'ebook'
  if (p.startsWith('/todo'))       return 'todo'
  if (p.startsWith('/assistant'))  return 'assistant'
  if (p.startsWith('/statistics')) return 'stats'
  if (p.startsWith('/settings'))   return 'settings'
  if (p.startsWith('/tools'))      return 'tools'
  return null
})
</script>

<template>
  <div v-if="scene" class="pet-wrap" aria-hidden="true">
    <Transition name="pet" mode="out-in">

      <!-- Chat -->
      <svg v-if="scene === 'chat'" key="chat" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <g class="n-msg n-m1"><rect x="68" y="6" width="60" height="14" rx="7" fill="#003D7C"/><circle cx="86" cy="13" r="1.3" fill="white"/><circle cx="98" cy="13" r="1.3" fill="white"/><circle cx="110" cy="13" r="1.3" fill="white"/></g>
        <g class="n-msg n-m2"><rect x="118" y="24" width="88" height="14" rx="7" fill="#EF7C00"/><rect x="130" y="29" width="40" height="1.6" rx="0.8" fill="white" opacity="0.9"/><rect x="130" y="33" width="62" height="1.6" rx="0.8" fill="white" opacity="0.9"/></g>
        <g class="n-msg n-m3"><rect x="72" y="42" width="70" height="14" rx="7" fill="#003D7C"/><rect x="84" y="47" width="36" height="1.6" rx="0.8" fill="white" opacity="0.9"/><rect x="84" y="51" width="48" height="1.6" rx="0.8" fill="white" opacity="0.9"/></g>
      </svg>

      <!-- Notes -->
      <svg v-else-if="scene === 'notes'" key="notes" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <rect x="56" y="6" width="178" height="48" rx="2" fill="none" stroke="#003D7C" stroke-width="0.7" opacity="0.55"/>
        <line x1="66" y1="6" x2="66" y2="54" stroke="#EF7C00" stroke-width="0.6" opacity="0.45"/>
        <circle cx="61" cy="15" r="0.8" fill="#003D7C" opacity="0.35"/>
        <circle cx="61" cy="30" r="0.8" fill="#003D7C" opacity="0.35"/>
        <circle cx="61" cy="45" r="0.8" fill="#003D7C" opacity="0.35"/>
        <rect x="72" y="14" width="120" height="2" rx="1" fill="#003D7C" opacity="0.6" class="n-nl n-nl1"/>
        <rect x="72" y="22" width="140" height="2" rx="1" fill="#003D7C" opacity="0.6" class="n-nl n-nl2"/>
        <rect x="72" y="30" width="108" height="2" rx="1" fill="#003D7C" opacity="0.6" class="n-nl n-nl3"/>
        <rect x="72" y="38" width="128" height="2" rx="1" fill="#003D7C" opacity="0.6" class="n-nl n-nl1"/>
        <g class="n-pen" transform="translate(206,28)">
          <rect x="-1" y="-10" width="2.5" height="15" rx="1" fill="#EF7C00" transform="rotate(40)"/>
          <path d="M7,-3 L9,0 L4,4 Z" fill="#003D7C" transform="rotate(40)"/>
        </g>
      </svg>

      <!-- Ebook -->
      <svg v-else-if="scene === 'ebook'" key="ebook" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <g class="n-scan">
            <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
            <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
            <circle cx="-3" cy="-12" r="0.5" fill="white"/>
            <circle cx="4" cy="-12" r="0.5" fill="white"/>
          </g>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <path d="M148,8 L74,12 L74,52 L148,49 Z" fill="none" stroke="#003D7C" stroke-width="0.7" opacity="0.6"/>
        <g class="n-page">
          <path d="M148,8 L222,12 L222,52 L148,49 Z" fill="none" stroke="#003D7C" stroke-width="0.7" opacity="0.6"/>
          <line x1="157" y1="18" x2="214" y2="20" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
          <line x1="157" y1="26" x2="216" y2="28" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
          <line x1="157" y1="34" x2="214" y2="36" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
          <line x1="157" y1="42" x2="208" y2="44" stroke="#EF7C00" stroke-width="0.7" opacity="0.65"/>
        </g>
        <line x1="148" y1="8" x2="148" y2="49" stroke="#003D7C" stroke-width="0.7" opacity="0.6"/>
        <line x1="84" y1="18" x2="140" y2="16" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
        <line x1="84" y1="26" x2="143" y2="24" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
        <line x1="84" y1="34" x2="138" y2="32" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
        <line x1="84" y1="42" x2="134" y2="40" stroke="#003D7C" stroke-width="0.5" opacity="0.5"/>
      </svg>

      <!-- Todo -->
      <svg v-else-if="scene === 'todo'" key="todo" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <rect x="60" y="9" width="11" height="11" rx="1.5" fill="none" stroke="#003D7C" stroke-width="1.1"/>
        <rect x="78" y="13" width="152" height="2.5" rx="1.2" fill="#003D7C" opacity="0.5"/>
        <path d="M62,15 L65,18 L70,11" stroke="#EF7C00" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" class="n-chk n-chk1"/>
        <rect x="60" y="25" width="11" height="11" rx="1.5" fill="none" stroke="#003D7C" stroke-width="1.1"/>
        <rect x="78" y="29" width="136" height="2.5" rx="1.2" fill="#003D7C" opacity="0.5"/>
        <path d="M62,31 L65,34 L70,27" stroke="#EF7C00" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" class="n-chk n-chk2"/>
        <rect x="60" y="41" width="11" height="11" rx="1.5" fill="none" stroke="#003D7C" stroke-width="1.1"/>
        <rect x="78" y="45" width="144" height="2.5" rx="1.2" fill="#003D7C" opacity="0.5"/>
        <path d="M62,47 L65,50 L70,43" stroke="#EF7C00" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" class="n-chk n-chk3"/>
      </svg>

      <!-- Assistant -->
      <svg v-else-if="scene === 'assistant'" key="assistant" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <g class="n-gls">
            <circle cx="-3.5" cy="-11" r="3.5" fill="none" stroke="#003D7C" stroke-width="1.1"/>
            <circle cx="3.5" cy="-11" r="3.5" fill="none" stroke="#003D7C" stroke-width="1.1"/>
            <path d="M-7,-11 L-9,-11.5" stroke="#003D7C" stroke-width="1"/>
            <path d="M7,-11 L9,-11.5" stroke="#003D7C" stroke-width="1"/>
          </g>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M-2,-4 Q0,-2 2,-4" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <rect x="56" y="6" width="178" height="48" rx="2" fill="none" stroke="#003D7C" stroke-width="0.7" opacity="0.55"/>
        <rect x="63" y="11" width="80" height="3" rx="1" fill="#003D7C"/>
        <rect x="63" y="19" width="162" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl1"/>
        <rect x="63" y="24" width="146" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl2"/>
        <rect x="63" y="29" width="154" height="2" rx="1" fill="#EF7C00" opacity="0.75" class="n-pl3"/>
        <rect x="63" y="34" width="138" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl4"/>
        <rect x="63" y="39" width="166" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl5"/>
        <rect x="63" y="44" width="128" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl6"/>
        <rect x="63" y="49" width="150" height="1.5" rx="0.7" fill="#003D7C" opacity="0.5" class="n-pl1"/>
      </svg>

      <!-- Travel -->
      <svg v-else-if="scene === 'travel'" key="travel" viewBox="0 0 240 60" class="pet-svg">
        <line x1="0" y1="54" x2="240" y2="54" stroke="#003D7C" stroke-width="0.5" opacity="0.25"/>
        <g class="n-cl1">
          <ellipse cx="0" cy="10" rx="10" ry="3.5" fill="#003D7C" opacity="0.2"/>
          <ellipse cx="6" cy="7" rx="7" ry="3" fill="#003D7C" opacity="0.2"/>
        </g>
        <g class="n-walk">
          <g transform="translate(68,32)">
            <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
            <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
            <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
            <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
            <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
            <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
            <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
            <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
            <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
            <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
            <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
            <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
            <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
            <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
            <circle cx="-3" cy="-12" r="0.5" fill="white"/>
            <circle cx="4" cy="-12" r="0.5" fill="white"/>
            <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
            <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
            <rect x="11" y="-3" width="5" height="11" rx="2" fill="#EF7C00"/>
            <line x1="17" y1="1" x2="30" y2="10" stroke="#5C5C5C" stroke-width="1.2" stroke-linecap="round"/>
          </g>
          <rect x="118" y="22" width="34" height="24" rx="2.5" fill="#003D7C"/>
          <rect x="123" y="26" width="24" height="2.5" rx="1" fill="#EF7C00"/>
          <rect x="129" y="15" width="11" height="8" rx="1.5" fill="none" stroke="#003D7C" stroke-width="1.3"/>
          <rect x="123" y="32" width="4" height="2.5" fill="#FFC480"/>
          <rect x="141" y="32" width="4" height="2.5" fill="#FFC480"/>
          <g class="n-wh"><circle cx="124" cy="47" r="2.5" fill="#1F2937"/><line x1="124" y1="44.7" x2="124" y2="49.3" stroke="#FFC480" stroke-width="0.6"/></g>
          <g class="n-wh"><circle cx="145" cy="47" r="2.5" fill="#1F2937"/><line x1="145" y1="44.7" x2="145" y2="49.3" stroke="#FFC480" stroke-width="0.6"/></g>
        </g>
      </svg>

      <!-- Stats -->
      <svg v-else-if="scene === 'stats'" key="stats" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-4" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3.5" cy="-12" r="0.5" fill="white"/>
          <circle cx="2.5" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <line x1="56" y1="52" x2="232" y2="52" stroke="#003D7C" stroke-width="0.6" opacity="0.4"/>
        <line x1="56" y1="6" x2="56" y2="52" stroke="#003D7C" stroke-width="0.6" opacity="0.4"/>
        <rect x="65" y="38" width="15" height="14" fill="#003D7C" class="n-bar n-b1"/>
        <rect x="95" y="28" width="15" height="24" fill="#EF7C00" class="n-bar n-b2"/>
        <rect x="125" y="32" width="15" height="20" fill="#003D7C" class="n-bar n-b3"/>
        <rect x="155" y="20" width="15" height="32" fill="#EF7C00" class="n-bar n-b4"/>
        <rect x="185" y="14" width="15" height="38" fill="#003D7C" class="n-bar n-b5"/>
        <rect x="215" y="24" width="15" height="28" fill="#EF7C00" class="n-bar n-b6"/>
        <g class="n-pt" transform="translate(186,7)">
          <path d="M0,8 L-8,0 L-2,1 L-6,-4 L-4,-6 L0,-1 L1,-6 Z" fill="#EF7C00"/>
        </g>
      </svg>

      <!-- Settings -->
      <svg v-else-if="scene === 'settings'" key="settings" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <!-- Large gear (CW) -->
        <g transform="translate(122,31)">
          <g class="n-gear-big">
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65"/>
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65" transform="rotate(60)"/>
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65" transform="rotate(120)"/>
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65" transform="rotate(180)"/>
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65" transform="rotate(240)"/>
            <rect x="-3" y="-17" width="6" height="7" rx="1.5" fill="#003D7C" opacity="0.65" transform="rotate(300)"/>
            <circle cx="0" cy="0" r="11" fill="none" stroke="#003D7C" stroke-width="1.5" opacity="0.65"/>
            <circle cx="0" cy="0" r="4" fill="#003D7C" opacity="0.65"/>
          </g>
        </g>
        <!-- Small gear (CCW) -->
        <g transform="translate(178,22)">
          <g class="n-gear-sm">
            <rect x="-2" y="-12" width="4" height="6" rx="1" fill="#EF7C00" opacity="0.7"/>
            <rect x="-2" y="-12" width="4" height="6" rx="1" fill="#EF7C00" opacity="0.7" transform="rotate(72)"/>
            <rect x="-2" y="-12" width="4" height="6" rx="1" fill="#EF7C00" opacity="0.7" transform="rotate(144)"/>
            <rect x="-2" y="-12" width="4" height="6" rx="1" fill="#EF7C00" opacity="0.7" transform="rotate(216)"/>
            <rect x="-2" y="-12" width="4" height="6" rx="1" fill="#EF7C00" opacity="0.7" transform="rotate(288)"/>
            <circle cx="0" cy="0" r="7.5" fill="none" stroke="#EF7C00" stroke-width="1.3" opacity="0.7"/>
            <circle cx="0" cy="0" r="2.5" fill="#EF7C00" opacity="0.7"/>
          </g>
        </g>
      </svg>

      <!-- Tools -->
      <svg v-else-if="scene === 'tools'" key="tools" viewBox="0 0 240 60" class="pet-svg">
        <g transform="translate(28,32)">
          <path d="M14,5 Q24,-3 18,-12" stroke="#EF7C00" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <ellipse cx="0" cy="6" rx="12" ry="14" fill="#EF7C00"/>
          <ellipse cx="0" cy="10" rx="6.5" ry="8" fill="#FFC480"/>
          <ellipse cx="-6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <ellipse cx="6" cy="18" rx="3.5" ry="2" fill="#EF7C00"/>
          <path d="M-7,-2 Q0,1 7,-2" stroke="#003D7C" stroke-width="2.2" fill="none" stroke-linecap="round"/>
          <circle cx="0" cy="0.5" r="1.1" fill="#FFD580"/>
          <circle cx="0" cy="-11" r="10" fill="#EF7C00"/>
          <path d="M-8,-16 L-6,-22 L-2,-17 Z" fill="#EF7C00"/>
          <path d="M2,-17 L6,-22 L8,-16 Z" fill="#EF7C00"/>
          <path d="M-6,-17 L-6,-20 L-4,-17 Z" fill="#F4A6A6"/>
          <path d="M4,-17 L6,-20 L6,-17 Z" fill="#F4A6A6"/>
          <ellipse cx="-3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <ellipse cx="3.5" cy="-11" rx="1.8" ry="2.2" fill="#003D7C"/>
          <circle cx="-3" cy="-12" r="0.5" fill="white"/>
          <circle cx="4" cy="-12" r="0.5" fill="white"/>
          <path d="M-1.3,-7 L1.3,-7 L0,-5.5 Z" fill="#D88B95"/>
          <path d="M0,-5.5 Q-1.5,-3.5 -2.5,-4.2 M0,-5.5 Q1.5,-3.5 2.5,-4.2" stroke="#2C3E50" stroke-width="0.6" fill="none" stroke-linecap="round"/>
        </g>
        <!-- Wrench (swings about bottom) -->
        <g transform="translate(118,30)">
          <g class="n-wrench">
            <rect x="-2.5" y="-3" width="5" height="22" rx="2.5" fill="#003D7C" opacity="0.65"/>
            <circle cx="0" cy="-10" r="8.5" fill="#003D7C" opacity="0.65"/>
            <circle cx="0" cy="-10" r="5.5" fill="white"/>
            <circle cx="0" cy="-10" r="2.2" fill="#003D7C" opacity="0.65"/>
            <path d="M-4.5,20 Q-5,24 0,24 Q5,24 4.5,20" stroke="#003D7C" stroke-width="3" fill="none" stroke-linecap="round" opacity="0.65"/>
          </g>
        </g>
        <!-- Sparkle star -->
        <g transform="translate(196,24)">
          <g class="n-sparkle">
            <path d="M0,-11 L2.8,-4 L10,-4 L4.5,0.5 L6.5,8 L0,4 L-6.5,8 L-4.5,0.5 L-10,-4 L-2.8,-4 Z" fill="#EF7C00" opacity="0.75"/>
          </g>
        </g>
      </svg>

    </Transition>
  </div>
</template>

<style scoped>
.pet-wrap {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 4px 0 6px;
  user-select: none;
  pointer-events: none;
  flex-shrink: 0;
}

.pet-svg {
  height: 28px;
  width: auto;
  display: block;
  overflow: visible;
}

/* ── Scene transitions ─────────────────────────────── */
.pet-enter-active,
.pet-leave-active { transition: opacity 0.25s, transform 0.25s; }
.pet-enter-from   { opacity: 0; transform: translateY(3px); }
.pet-leave-to     { opacity: 0; transform: translateY(-3px); }

/* ══ CHAT ══════════════════════════════════════════════ */
@keyframes nus-msg {
  0%, 6%   { opacity: 0; transform: translateY(2px) scale(0.88); }
  18%, 72% { opacity: 1; transform: translateY(0) scale(1); }
  84%, 100%{ opacity: 0; }
}
.n-msg { transform-origin: left center; transform-box: fill-box; }
.n-m1  { animation: nus-msg 4s ease-in-out infinite 0s; }
.n-m2  { animation: nus-msg 4s ease-in-out infinite 1.3s; }
.n-m3  { animation: nus-msg 4s ease-in-out infinite 2.6s; }

/* ══ NOTES ═════════════════════════════════════════════ */
@keyframes nus-pen {
  0%, 100% { transform: translate(-2px,-1px) rotate(-12deg); }
  50%      { transform: translate(2px,1px) rotate(10deg); }
}
@keyframes nus-line {
  0%, 10%  { transform: scaleX(0); }
  32%, 92% { transform: scaleX(1); }
  100%     { transform: scaleX(0); }
}
.n-pen { animation: nus-pen 1.3s ease-in-out infinite; transform-origin: top right; transform-box: fill-box; }
.n-nl  { transform-origin: left center; transform-box: fill-box; }
.n-nl1 { animation: nus-line 4s ease-in-out infinite 0.1s; }
.n-nl2 { animation: nus-line 4s ease-in-out infinite 0.7s; }
.n-nl3 { animation: nus-line 4s ease-in-out infinite 1.3s; }

/* ══ EBOOK ═════════════════════════════════════════════ */
@keyframes nus-pgflip {
  0%, 60%  { transform: scaleX(1); }
  74%      { transform: scaleX(-1); }
  88%, 100%{ transform: scaleX(1); }
}
@keyframes nus-scan {
  0%, 100% { transform: translateX(-1.2px); }
  50%      { transform: translateX(1.2px); }
}
/* transform-origin: 0% 50% with fill-box = left-edge (spine) × vertical-center — no overflow */
.n-page { animation: nus-pgflip 4s ease-in-out infinite; transform-box: fill-box; transform-origin: 0% 50%; }
.n-scan { animation: nus-scan 1.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }

/* ══ TODO ══════════════════════════════════════════════ */
@keyframes nus-chk {
  0%, 25%  { opacity: 0; transform: scale(0.2); }
  42%, 92% { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; }
}
.n-chk  { transform-origin: center; transform-box: fill-box; }
.n-chk1 { animation: nus-chk 4s ease-out infinite 0.2s; }
.n-chk2 { animation: nus-chk 4s ease-out infinite 0.9s; }
.n-chk3 { animation: nus-chk 4s ease-out infinite 1.6s; }

/* ══ ASSISTANT ═════════════════════════════════════════ */
@keyframes nus-gls {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1px); }
}
@keyframes nus-pl {
  0%, 12%  { opacity: 0; }
  32%, 88% { opacity: 1; }
  100%     { opacity: 0; }
}
.n-gls { animation: nus-gls 2s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }
.n-pl1 { animation: nus-pl 3.5s ease-in-out infinite 0s; }
.n-pl2 { animation: nus-pl 3.5s ease-in-out infinite 0.3s; }
.n-pl3 { animation: nus-pl 3.5s ease-in-out infinite 0.6s; }
.n-pl4 { animation: nus-pl 3.5s ease-in-out infinite 0.9s; }
.n-pl5 { animation: nus-pl 3.5s ease-in-out infinite 1.2s; }
.n-pl6 { animation: nus-pl 3.5s ease-in-out infinite 1.5s; }

/* ══ TRAVEL ════════════════════════════════════════════ */
@keyframes nus-walk {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-1.8px); }
}
@keyframes nus-wheel {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes nus-cld {
  0%   { transform: translateX(-25px); }
  100% { transform: translateX(265px); }
}
.n-walk { animation: nus-walk 0.55s ease-in-out infinite; transform-origin: center bottom; transform-box: fill-box; }
.n-wh   { animation: nus-wheel 0.5s linear infinite; transform-box: fill-box; transform-origin: center; }
.n-cl1  { animation: nus-cld 6s linear infinite; }

/* ══ STATS ═════════════════════════════════════════════ */
@keyframes nus-bar {
  0%, 5%   { transform: scaleY(0); }
  28%, 88% { transform: scaleY(1); }
  100%     { transform: scaleY(0); }
}
@keyframes nus-pt {
  0%, 100% { transform: translate(0,0); }
  50%      { transform: translate(-2px,-2px); }
}
.n-bar { transform-origin: center bottom; transform-box: fill-box; }
.n-b1  { animation: nus-bar 3.5s ease-out infinite 0s; }
.n-b2  { animation: nus-bar 3.5s ease-out infinite 0.15s; }
.n-b3  { animation: nus-bar 3.5s ease-out infinite 0.3s; }
.n-b4  { animation: nus-bar 3.5s ease-out infinite 0.45s; }
.n-b5  { animation: nus-bar 3.5s ease-out infinite 0.6s; }
.n-b6  { animation: nus-bar 3.5s ease-out infinite 0.75s; }
.n-pt  { animation: nus-pt 1.1s ease-in-out infinite; transform-origin: center; transform-box: fill-box; }

/* ══ SETTINGS ══════════════════════════════════════════ */
@keyframes nus-gear-cw  { from { transform: rotate(0deg);   } to { transform: rotate(360deg);  } }
@keyframes nus-gear-ccw { from { transform: rotate(0deg);   } to { transform: rotate(-360deg); } }
.n-gear-big { animation: nus-gear-cw  5s linear infinite;   transform-box: fill-box; transform-origin: center; }
.n-gear-sm  { animation: nus-gear-ccw 3.3s linear infinite; transform-box: fill-box; transform-origin: center; }

/* ══ TOOLS ═════════════════════════════════════════════ */
@keyframes nus-wrench {
  0%, 100% { transform: rotate(0deg); }
  35%      { transform: rotate(-28deg); }
  65%      { transform: rotate(18deg); }
}
@keyframes nus-sparkle {
  0%, 100% { transform: scale(1) rotate(0deg);    opacity: 0.75; }
  25%      { transform: scale(1.25) rotate(18deg); opacity: 1; }
  50%      { transform: scale(0.75) rotate(0deg);  opacity: 0.45; }
  75%      { transform: scale(1.15) rotate(-15deg); opacity: 0.9; }
}
.n-wrench  { animation: nus-wrench 2.8s ease-in-out infinite; transform-box: fill-box; transform-origin: center bottom; }
.n-sparkle { animation: nus-sparkle 2.5s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
</style>
