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
  return null
})
</script>

<template>
  <div v-if="scene" class="pet-wrap" aria-hidden="true">
    <Transition name="pet" mode="out-in">

      <!-- Chat: cat + robot with travelling dots -->
      <svg v-if="scene === 'chat'" key="chat" viewBox="0 0 80 32" class="pet-svg">
        <g class="c-cat-nod">
          <polygon points="11,12 14,6 17,12" fill="#FF9B50"/>
          <polygon points="19,12 22,6 25,12" fill="#FF9B50"/>
          <polygon points="12,12 14,8 16,12"  fill="#FFB8C6"/>
          <polygon points="20,12 22,8 24,12"  fill="#FFB8C6"/>
          <circle cx="18" cy="17" r="7"   fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <circle cx="15" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="21" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="15.5" cy="15" r="0.4" fill="white"/>
          <circle cx="21.5" cy="15" r="0.4" fill="white"/>
          <circle cx="18"   cy="18.5" r="0.7" fill="#FF6B9D"/>
          <path d="M16.2,19.5 Q18,21 19.8,19.5" stroke="#3D2B1F" stroke-width="0.7" fill="none" stroke-linecap="round"/>
        </g>

        <g class="c-dots">
          <circle cx="34" cy="16" r="1.9" fill="#C4C4D4"/>
          <circle cx="40" cy="16" r="1.9" fill="#C4C4D4"/>
          <circle cx="46" cy="16" r="1.9" fill="#C4C4D4"/>
        </g>

        <g class="c-bot-nod">
          <line x1="62" y1="8" x2="62" y2="4" stroke="#FFD43B" stroke-width="1.6" stroke-linecap="round"/>
          <circle cx="62" cy="3"   r="2"   fill="#FFD43B"/>
          <rect   x="54" y="8" width="16" height="14" rx="2.5" fill="#5B9BD5" stroke="#3070B0" stroke-width="0.8"/>
          <rect   x="56.5" y="11" width="4" height="3" rx="1" fill="#00E676"/>
          <rect   x="63.5" y="11" width="4" height="3" rx="1" fill="#00E676"/>
          <circle cx="54"   cy="15" r="1.3" fill="#3A6090"/>
          <circle cx="70"   cy="15" r="1.3" fill="#3A6090"/>
          <path d="M57,19.5 L59,21 L62,19.5 L65,21 L67,19.5" stroke="#3070B0" stroke-width="0.9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </svg>

      <!-- Notes: cat writing, lines appear on paper -->
      <svg v-else-if="scene === 'notes'" key="notes" viewBox="0 0 80 32" class="pet-svg">
        <rect x="40" y="5" width="28" height="24" rx="2" fill="white" stroke="#D8D8E0" stroke-width="1"/>
        <line x1="44" y1="11" x2="64" y2="11" stroke="#B0B8D0" stroke-width="1.1" stroke-linecap="round" class="c-ln1" stroke-dasharray="20" stroke-dashoffset="20"/>
        <line x1="44" y1="16" x2="64" y2="16" stroke="#B0B8D0" stroke-width="1.1" stroke-linecap="round" class="c-ln2" stroke-dasharray="20" stroke-dashoffset="20"/>
        <line x1="44" y1="21" x2="57" y2="21" stroke="#B0B8D0" stroke-width="1.1" stroke-linecap="round" class="c-ln3" stroke-dasharray="13" stroke-dashoffset="13"/>

        <g class="c-cat-bob">
          <polygon points="11,12 14,6 17,12" fill="#FF9B50"/>
          <polygon points="19,12 22,6 25,12" fill="#FF9B50"/>
          <polygon points="12,12 14,8 16,12"  fill="#FFB8C6"/>
          <polygon points="20,12 22,8 24,12"  fill="#FFB8C6"/>
          <circle cx="18" cy="17" r="7"   fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <circle cx="15" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="21" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="15.5" cy="15" r="0.4" fill="white"/>
          <circle cx="21.5" cy="15" r="0.4" fill="white"/>
          <circle cx="18"   cy="18.5" r="0.7" fill="#FF6B9D"/>
          <path d="M16.2,19.5 Q18,21 19.8,19.5" stroke="#3D2B1F" stroke-width="0.7" fill="none" stroke-linecap="round"/>
          <path d="M25,17 Q31,14 37,12" stroke="#D4711E" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        </g>

        <g class="c-pencil">
          <rect   x="34.5" y="5"  width="3.5" height="12" rx="1" fill="#FFD43B"/>
          <rect   x="34.5" y="5"  width="3.5" height="3"  rx="1" fill="#C8B0A8"/>
          <rect   x="34.8" y="16.5" width="2.9" height="1.5" fill="#F5CBA0"/>
          <polygon points="34.5,18 38,18 36.25,22" fill="#FFAA00"/>
        </g>
      </svg>

      <!-- Travel: cat riding a paper plane -->
      <svg v-else-if="scene === 'travel'" key="travel" viewBox="0 0 80 32" class="pet-svg">
        <g class="c-fly-group">
          <polygon points="73,18 22,10 34,19 22,26" fill="#A8D8F0" stroke="#5B9BD5" stroke-width="0.8" stroke-linejoin="round"/>
          <polygon points="73,18 22,10 42,18"        fill="#D4EEFA" stroke="#5B9BD5" stroke-width="0.6" stroke-linejoin="round"/>
          <line x1="34" y1="19" x2="73" y2="18" stroke="#8EC4E0" stroke-width="0.5"/>
          <g transform="translate(31,-2)">
            <polygon points="-2,11 1,5  4,11" fill="#FF9B50"/>
            <polygon points=" 5,11 8,5 11,11" fill="#FF9B50"/>
            <polygon points="-1,11 1,7  3,11" fill="#FFB8C6"/>
            <polygon points=" 6,11 8,7 10,11" fill="#FFB8C6"/>
            <circle cx="4.5" cy="15" r="6" fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
            <path d="M2,14 Q3.5,15.5 5,14" stroke="#3D2B1F" stroke-width="0.9" fill="none" stroke-linecap="round"/>
            <path d="M6,14 Q7.5,15.5 9,14" stroke="#3D2B1F" stroke-width="0.9" fill="none" stroke-linecap="round"/>
            <circle cx="4.5" cy="17" r="0.7" fill="#FF6B9D"/>
          </g>
        </g>
      </svg>

      <!-- Ebook: cat peeking over an open book -->
      <svg v-else-if="scene === 'ebook'" key="ebook" viewBox="0 0 80 32" class="pet-svg">
        <path d="M10,23 Q40,18 70,23 L70,30 Q40,25 10,30 Z" fill="#F5E6D3" stroke="#C49A6C" stroke-width="0.9"/>
        <line x1="40" y1="18.5" x2="40" y2="30" stroke="#C49A6C" stroke-width="0.9"/>
        <line x1="14" y1="25"   x2="36" y2="23"  stroke="#C49A6C" stroke-width="0.7" opacity="0.5"/>
        <line x1="14" y1="27.5" x2="36" y2="25.5" stroke="#C49A6C" stroke-width="0.7" opacity="0.5"/>
        <line x1="44" y1="23"   x2="66" y2="25"   stroke="#C49A6C" stroke-width="0.7" opacity="0.5"/>
        <line x1="44" y1="25.5" x2="66" y2="27.5" stroke="#C49A6C" stroke-width="0.7" opacity="0.5"/>

        <g class="c-cat-peek">
          <polygon points="33,14 36,7  39,14" fill="#FF9B50"/>
          <polygon points="41,14 44,7  47,14" fill="#FF9B50"/>
          <polygon points="34.5,14 36,9  37.5,14" fill="#FFB8C6"/>
          <polygon points="42.5,14 44,9  45.5,14" fill="#FFB8C6"/>
          <circle cx="40" cy="19" r="7" fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <ellipse cx="37" cy="18.5" rx="1.4" ry="1.1" fill="#3D2B1F"/>
          <ellipse cx="43" cy="18.5" rx="1.4" ry="1.1" fill="#3D2B1F"/>
          <circle  cx="37.5" cy="18" r="0.4" fill="white"/>
          <circle  cx="43.5" cy="18" r="0.4" fill="white"/>
          <circle  cx="40"   cy="21" r="0.7" fill="#FF6B9D"/>
        </g>
      </svg>

      <!-- Todo: cat bouncing, checkmark draws itself -->
      <svg v-else-if="scene === 'todo'" key="todo" viewBox="0 0 80 32" class="pet-svg">
        <rect x="43" y="8" width="24" height="22" rx="2" fill="white" stroke="#D0D0D8" stroke-width="1"/>
        <rect x="50" y="5" width="10" height="6"  rx="2.5" fill="#D8D8E0"/>
        <circle cx="55" cy="6.5" r="1.5" fill="white" stroke="#C8C8D0" stroke-width="0.8"/>
        <rect x="47"   y="15" width="7.5" height="7.5" rx="1.5" fill="none" stroke="#B0BCC8" stroke-width="1.2"/>
        <path d="M48.5,18.8 L51,21.5 L56,15.5"
              stroke="#34C759" stroke-width="2" fill="none"
              stroke-linecap="round" stroke-linejoin="round"
              class="c-check"/>
        <line x1="58" y1="17.5" x2="64" y2="17.5" stroke="#C8D0DC" stroke-width="1.1" stroke-linecap="round"/>
        <line x1="58" y1="21"   x2="62" y2="21"   stroke="#C8D0DC" stroke-width="1.1" stroke-linecap="round"/>

        <g class="c-cat-happy">
          <polygon points="10,12 13,5 16,12" fill="#FF9B50"/>
          <polygon points="18,12 21,5 24,12" fill="#FF9B50"/>
          <polygon points="11.5,12 13,7.5 14.5,12" fill="#FFB8C6"/>
          <polygon points="19.5,12 21,7.5 22.5,12" fill="#FFB8C6"/>
          <circle cx="17" cy="17" r="7" fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <path d="M13.5,15.5 Q15,17 16.5,15.5" stroke="#3D2B1F" stroke-width="1"   fill="none" stroke-linecap="round"/>
          <path d="M18.5,15.5 Q20,17 21.5,15.5" stroke="#3D2B1F" stroke-width="1"   fill="none" stroke-linecap="round"/>
          <circle cx="17" cy="19.5" r="0.8" fill="#FF6B9D"/>
          <path d="M15,20.5 Q17,22 19,20.5"    stroke="#3D2B1F" stroke-width="0.7" fill="none" stroke-linecap="round"/>
        </g>
      </svg>

      <!-- Assistant: cat thinking, stars twinkling -->
      <svg v-else-if="scene === 'assistant'" key="assistant" viewBox="0 0 80 32" class="pet-svg">
        <g class="c-star1">
          <path d="M58,4 L59.4,7.8 L63.5,7.8 L60.3,10 L61.7,13.8 L58,11.6 L54.3,13.8 L55.7,10 L52.5,7.8 L56.6,7.8 Z" fill="#FFD43B"/>
        </g>
        <g class="c-star2">
          <path d="M71,14 L71.8,16.4 L74.5,16.4 L72.5,17.8 L73.3,20.2 L71,18.8 L68.7,20.2 L69.5,17.8 L67.5,16.4 L70.2,16.4 Z" fill="#FF9B50"/>
        </g>

        <g class="c-cat-think">
          <polygon points="11,12 14,6 17,12" fill="#FF9B50"/>
          <polygon points="19,12 22,6 25,12" fill="#FF9B50"/>
          <polygon points="12,12 14,8 16,12"  fill="#FFB8C6"/>
          <polygon points="20,12 22,8 24,12"  fill="#FFB8C6"/>
          <circle cx="18" cy="17" r="7"   fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <circle cx="15" cy="15"   r="1.2" fill="#3D2B1F"/>
          <circle cx="21" cy="15"   r="1.2" fill="#3D2B1F"/>
          <circle cx="15.7" cy="14.4" r="0.4" fill="white"/>
          <circle cx="21.7" cy="14.4" r="0.4" fill="white"/>
          <circle cx="18"   cy="18.5" r="0.7" fill="#FF6B9D"/>
          <path d="M16.2,19.5 Q18,21 19.8,19.5" stroke="#3D2B1F" stroke-width="0.7" fill="none" stroke-linecap="round"/>
        </g>
        <circle cx="28" cy="10" r="1.2" fill="#D8D8E8" class="c-bubble1"/>
        <circle cx="32" cy="7"  r="1.6" fill="#D8D8E8" class="c-bubble2"/>
        <circle cx="37" cy="5"  r="2"   fill="#D8D8E8" class="c-bubble3"/>
      </svg>

      <!-- Stats: cat watching animated bar chart -->
      <svg v-else-if="scene === 'stats'" key="stats" viewBox="0 0 80 32" class="pet-svg">
        <line x1="37" y1="9"  x2="37" y2="30" stroke="#E0E0E8" stroke-width="1" stroke-linecap="round"/>
        <line x1="37" y1="30" x2="72" y2="30" stroke="#E0E0E8" stroke-width="1" stroke-linecap="round"/>
        <rect x="40" y="20" width="7" height="10" rx="1.5" fill="#5B9BD5" class="c-bar1"/>
        <rect x="51" y="14" width="7" height="16" rx="1.5" fill="#FF9B50" class="c-bar2"/>
        <rect x="62" y="17" width="7" height="13" rx="1.5" fill="#34C759" class="c-bar3"/>

        <g class="c-cat-bob">
          <polygon points="10,12 13,6 16,12" fill="#FF9B50"/>
          <polygon points="18,12 21,6 24,12" fill="#FF9B50"/>
          <polygon points="11,12 13,8 15,12"  fill="#FFB8C6"/>
          <polygon points="19,12 21,8 23,12"  fill="#FFB8C6"/>
          <circle cx="17" cy="17" r="7"   fill="#FF9B50" stroke="#D4711E" stroke-width="0.8"/>
          <circle cx="14.5" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="20.5" cy="15.5" r="1.2" fill="#3D2B1F"/>
          <circle cx="15.3" cy="15"   r="0.4" fill="white"/>
          <circle cx="21.3" cy="15"   r="0.4" fill="white"/>
          <circle cx="17"   cy="18.5" r="0.7" fill="#FF6B9D"/>
          <path d="M15.2,19.5 Q17,21 18.8,19.5" stroke="#3D2B1F" stroke-width="0.7" fill="none" stroke-linecap="round"/>
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

/* ══════════════════════════════════════════════════════
   CHAT
══════════════════════════════════════════════════════ */
@keyframes cat-nod {
  0%, 55%, 100% { transform: rotate(0deg); }
  15%           { transform: rotate(-10deg) translateY(-1px); }
  35%           { transform: rotate(0deg); }
}
@keyframes bot-nod {
  0%, 49%, 100% { transform: rotate(0deg); }
  65%           { transform: rotate(10deg) translateY(-1px); }
  82%           { transform: rotate(0deg); }
}
@keyframes dots-travel {
  0%        { transform: translateX(0);    opacity: 0; }
  8%        { transform: translateX(0);    opacity: 1; }
  42%       { transform: translateX(22px); opacity: 1; }
  52%       { transform: translateX(22px); opacity: 0; }
  53%       { transform: translateX(-8px); opacity: 0; }
  62%       { transform: translateX(-8px); opacity: 1; }
  90%       { transform: translateX(0);    opacity: 1; }
  100%      { transform: translateX(0);    opacity: 0; }
}

.c-cat-nod {
  animation: cat-nod 3.2s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 90%;
}
.c-bot-nod {
  animation: bot-nod 3.2s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 90%;
}
.c-dots { animation: dots-travel 3.2s ease-in-out infinite; transform-box: fill-box; }

/* ══════════════════════════════════════════════════════
   NOTES
══════════════════════════════════════════════════════ */
@keyframes cat-bob {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-2px); }
}
@keyframes write-l1 {
  0%, 10%  { stroke-dashoffset: 20; }
  38%, 88% { stroke-dashoffset: 0;  }
  98%, 100%{ stroke-dashoffset: 20; }
}
@keyframes write-l2 {
  0%, 28%  { stroke-dashoffset: 20; }
  55%, 88% { stroke-dashoffset: 0;  }
  98%, 100%{ stroke-dashoffset: 20; }
}
@keyframes write-l3 {
  0%, 44%  { stroke-dashoffset: 13; }
  66%, 88% { stroke-dashoffset: 0;  }
  98%, 100%{ stroke-dashoffset: 13; }
}
@keyframes pencil-scratch {
  0%        { transform: translate(0px, 0px) rotate(-20deg); }
  35%       { transform: translate(20px, 0px) rotate(-20deg); }
  36%       { transform: translate(0px, 5px) rotate(-20deg); }
  68%       { transform: translate(20px, 5px) rotate(-20deg); }
  69%       { transform: translate(0px, 10px) rotate(-20deg); }
  86%       { transform: translate(13px, 10px) rotate(-20deg); }
  92%, 100% { transform: translate(0px, 0px) rotate(-20deg); }
}

.c-cat-bob { animation: cat-bob 1.8s ease-in-out infinite; transform-box: fill-box; }
.c-ln1     { animation: write-l1 4.2s ease-in-out infinite; }
.c-ln2     { animation: write-l2 4.2s ease-in-out infinite; }
.c-ln3     { animation: write-l3 4.2s ease-in-out infinite; }
.c-pencil  { animation: pencil-scratch 4.2s ease-in-out infinite; transform-box: fill-box; transform-origin: 0% 100%; }

/* ══════════════════════════════════════════════════════
   TRAVEL
══════════════════════════════════════════════════════ */
@keyframes fly-wave {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  30%      { transform: translateY(-3px) rotate(1.5deg); }
  70%      { transform: translateY(2px) rotate(-1deg); }
}
.c-fly-group { animation: fly-wave 2.6s ease-in-out infinite; transform-box: fill-box; }

/* ══════════════════════════════════════════════════════
   EBOOK
══════════════════════════════════════════════════════ */
@keyframes cat-peek {
  0%, 100% { transform: translateY(0); }
  20%      { transform: translateY(-2.5px); }
  55%      { transform: translateY(0); }
  72%      { transform: translateY(-1.5px); }
  85%      { transform: translateY(0); }
}
.c-cat-peek { animation: cat-peek 3.4s ease-in-out infinite; transform-box: fill-box; }

/* ══════════════════════════════════════════════════════
   TODO
══════════════════════════════════════════════════════ */
@keyframes check-draw {
  0%, 15%  { stroke-dashoffset: 16; stroke-dasharray: 16; opacity: 0.25; }
  48%, 72% { stroke-dashoffset: 0;  stroke-dasharray: 16; opacity: 1; }
  90%, 100%{ stroke-dashoffset: 16; stroke-dasharray: 16; opacity: 0.25; }
}
@keyframes cat-happy-bounce {
  0%, 20%, 100% { transform: translateY(0) rotate(0deg); }
  42%           { transform: translateY(-4px) rotate(-6deg); }
  60%           { transform: translateY(-2px) rotate(5deg); }
  78%           { transform: translateY(0) rotate(0deg); }
}
.c-check     { animation: check-draw 2.8s ease-in-out infinite; }
.c-cat-happy {
  animation: cat-happy-bounce 2.8s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 95%;
}

/* ══════════════════════════════════════════════════════
   ASSISTANT
══════════════════════════════════════════════════════ */
@keyframes star-twinkle1 {
  0%, 100% { transform: scale(1)   rotate(0deg);    opacity: 1; }
  25%      { transform: scale(1.3) rotate(18deg);   opacity: 1; }
  50%      { transform: scale(0.65) rotate(0deg);   opacity: 0.35; }
  75%      { transform: scale(1.2) rotate(-12deg);  opacity: 1; }
}
@keyframes star-twinkle2 {
  0%, 100% { transform: scale(1)   rotate(0deg);   opacity: 0.85; }
  38%      { transform: scale(0.55) rotate(0deg);  opacity: 0.2; }
  68%      { transform: scale(1.35) rotate(22deg); opacity: 0.85; }
}
@keyframes cat-think {
  0%, 100% { transform: rotate(0deg); }
  30%      { transform: rotate(-5deg) translateY(-1px); }
  70%      { transform: rotate(4deg)  translateY(-0.5px); }
}
@keyframes bubble-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 0.9; }
}
.c-star1 {
  animation: star-twinkle1 2.2s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.c-star2 {
  animation: star-twinkle2 1.8s ease-in-out 0.45s infinite;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}
.c-cat-think {
  animation: cat-think 3s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: 50% 90%;
}
.c-bubble1 { animation: bubble-pulse 1.8s ease-in-out 0s   infinite; }
.c-bubble2 { animation: bubble-pulse 1.8s ease-in-out 0.2s infinite; }
.c-bubble3 { animation: bubble-pulse 1.8s ease-in-out 0.4s infinite; }

/* ══════════════════════════════════════════════════════
   STATS
══════════════════════════════════════════════════════ */
@keyframes bar1-anim {
  0%, 100% { transform: scaleY(1);    }
  35%      { transform: scaleY(1.18); }
  68%      { transform: scaleY(0.85); }
}
@keyframes bar2-anim {
  0%, 100% { transform: scaleY(1);    }
  20%      { transform: scaleY(0.8);  }
  58%      { transform: scaleY(1.12); }
}
@keyframes bar3-anim {
  0%, 100% { transform: scaleY(1);    }
  45%      { transform: scaleY(1.22); }
  80%      { transform: scaleY(0.88); }
}
.c-bar1 { animation: bar1-anim 2s ease-in-out 0s    infinite; transform-box: fill-box; transform-origin: 50% 100%; }
.c-bar2 { animation: bar2-anim 2s ease-in-out 0.35s infinite; transform-box: fill-box; transform-origin: 50% 100%; }
.c-bar3 { animation: bar3-anim 2s ease-in-out 0.65s infinite; transform-box: fill-box; transform-origin: 50% 100%; }
</style>
