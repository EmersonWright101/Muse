<template>
  <div class="w-full max-w-6xl mx-auto space-y-8 pb-10 p-8">
    
    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('latex.source_code') }}
        </label>
        <div class="flex items-center gap-2">
          <button
            @click="router.push('/tools/latex/latex2png/history')"
            class="text-xs text-slate-400 hover:text-purple-600 transition-colors px-2 py-1 rounded-md hover:bg-purple-50 flex items-center gap-1"
          >
            <History class="w-3.5 h-3.5" />
            <span>{{ t('latex.history.btn') }}</span>
          </button>
          <button
            v-if="inputLatex"
            @click="inputLatex = ''"
            class="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 flex items-center gap-1"
          >
            <XCircle class="w-3.5 h-3.5" />
            <span>{{ t('common.clear') }}</span>
          </button>
        </div>
      </div>
      
      <div class="relative group">
        <textarea 
          v-model="inputLatex" 
          class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[150px] text-slate-700 font-mono text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-y shadow-sm"
          :placeholder="t('latex.input_prompt')" 
        ></textarea>
        </div>
    </div>

    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1 h-8">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('latex.realtime_preview') }}
        </label>
        
        <div class="flex items-center gap-2">
          
          <Transition name="fade">
            <div v-if="inputLatex" class="flex items-center gap-2 mr-2 px-3 py-1 bg-slate-50 rounded-md border border-slate-100">
              <span class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{{ t('common.resolution') }}</span>
              <input 
                type="range" 
                v-model.number="resolution" 
                min="1" 
                max="10" 
                step="1"
                class="w-20 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-600"
              >
              <span class="text-xs font-mono font-medium text-slate-600 w-6 text-right">{{ resolution }}x</span>
            </div>
          </Transition>

          <Transition name="fade">
            <button 
              v-if="inputLatex"
              @click="copySource"
              class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
              :class="copiedSource ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
            >
              <component :is="copiedSource ? Check : Clipboard" class="w-3.5 h-3.5" />
              <span>{{ copiedSource ? t('latex.source_copied') : t('latex.copy_source') }}</span>
            </button>
          </Transition>

          <Transition name="fade">
            <button 
              v-if="inputLatex"
              @click="downloadPng"
              :disabled="isDownloading"
              class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 border border-transparent"
              :class="[
                downloadSuccess ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-purple-600 hover:bg-purple-50/80 hover:border-purple-100',
                isDownloading ? 'opacity-50 cursor-wait' : 'active:scale-95'
              ]"
              :title="t('latex.download_png')"
            >
              <component :is="downloadSuccess ? Check : Download" v-if="!isDownloading" class="w-3.5 h-3.5" />
              <svg v-else class="animate-spin h-3.5 w-3.5 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>{{ downloadText }}</span>
            </button>
          </Transition>
        </div>
      </div>

      <div class="relative group">
        <div class="w-full bg-white border border-slate-200 rounded-xl min-h-[120px] shadow-sm flex flex-col justify-center items-center overflow-x-auto p-8">
          
          <Transition name="slide-fade" mode="out-in">
            <div 
              v-if="inputLatex" 
              ref="previewRef"
              :key="inputLatex" 
              class="latex-output select-none inline-block text-slate-900 p-0" 
              v-html="previewHtml"
            ></div>
            
            <span v-else class="text-slate-300 italic text-sm select-none">{{ t('common.waiting_input') }} ...</span>
          </Transition>

        </div>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { Clipboard, Check, XCircle, Download, History } from 'lucide-vue-next';
import { toPng } from 'html-to-image';
import { useI18n } from 'vue-i18n';
import {
  addHistoryRecord,
  loadHistory,
  pendingRestore,
} from '../../stores/latex2png';

// 状态定义
const { t } = useI18n();
const router = useRouter();

const inputLatex = ref<string>('');
const resolution = ref<number>(5);

onMounted(async () => {
  await loadHistory();
  if (pendingRestore.value) {
    inputLatex.value = pendingRestore.value.latex;
    resolution.value = pendingRestore.value.resolution;
    pendingRestore.value = null;
  }
});
const copiedSource = ref(false);
const previewRef = ref<HTMLElement | null>(null);

const isDownloading = ref(false);
const downloadSuccess = ref(false);

const downloadText = computed(() => {
  // 🟢 修改：使用 common.saved / common.loading / latex.download_png
  if (downloadSuccess.value) return t('common.saved');
  if (isDownloading.value) return t('common.loading'); 
  return t('latex.download_png');
});

const previewHtml = computed(() => {
  if (!inputLatex.value) return '';
  try {
    return katex.renderToString(inputLatex.value, {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    });
  } catch (error) {
    // 这里的 "Syntax Error" 可以根据需要保留英文或硬编码中文，因为 i18n 文件中没有专门的语法错误 key
    return `<span class="text-red-500 font-mono text-sm">Syntax Error: ${(error as Error).message}</span>`;
  }
});

const copySource = async () => {
  if (!inputLatex.value || copiedSource.value) return;
  navigator.clipboard.writeText(inputLatex.value);
  copiedSource.value = true;
  setTimeout(() => copiedSource.value = false, 2000);
  await addHistoryRecord({ latex: inputLatex.value, resolution: resolution.value });
};

const downloadPng = async () => {
  if (!previewRef.value || isDownloading.value) return;

  isDownloading.value = true;

  try {
    const dataUrl = await toPng(previewRef.value, {
      backgroundColor: 'rgba(0,0,0,0)', 
      pixelRatio: resolution.value, 
      skipAutoScale: true,
      cacheBust: true,
    });

    const link = document.createElement('a');
    const filename = `latex_formula_${resolution.value}x_${Date.now()}.png`;
    
    link.download = filename;
    link.href = dataUrl;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    downloadSuccess.value = true;
    setTimeout(() => downloadSuccess.value = false, 2000);

    await addHistoryRecord({ latex: inputLatex.value, resolution: resolution.value });

  } catch (err) {
    console.error('Download Failed:', err);
    // 🟢 修改：使用 common.failed
    alert(t('common.failed') + ': ' + (err as Error).message);
  } finally {
    isDownloading.value = false;
  }
};
</script>

<style scoped>
/* 样式保持不变 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(5px);
  opacity: 0;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

:deep(.katex) {
  font-size: 1.5em;
}

:deep(.latex-output .katex-display) {
  margin: 0 !important;
}

.cursor-wait {
  cursor: wait;
}

input[type=range] {
  -webkit-appearance: none; 
  background: transparent; 
}

input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  height: 14px;
  width: 14px;
  border-radius: 50%;
  background: #3b82f6; 
  margin-top: -5px; 
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  transition: background 0.2s;
}

input[type=range]::-webkit-slider-thumb:hover {
  background: #2563eb; 
}

input[type=range]::-webkit-slider-runnable-track {
  width: 100%;
  height: 4px;
  cursor: pointer;
  background: #e2e8f0; 
  border-radius: 2px;
}
</style>