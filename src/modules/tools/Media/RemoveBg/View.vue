<template>
  <div class="h-full flex flex-col p-6 gap-6">
    <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
      <p class="text-slate-600 text-base font-medium">
        <i18n-t keypath="image.support_paste" tag="span">
            <template #binding>
            <span class="font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">Ctrl + V</span>
            </template>
        </i18n-t>
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 rounded-lg shadow-sm h-8">
          <Settings2 class="w-3.5 h-3.5 text-slate-500" />
          <span class="text-xs font-semibold text-slate-700 whitespace-nowrap">{{ t('image.model') }}:</span>
          <select 
            v-model="selectedModel"
            :disabled="isProcessing"
            class="text-xs bg-slate-50 border-slate-200 rounded pl-2 pr-6 h-6 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
          >
            <option value="medium">{{ t('image.model_medium') }}</option>
            <option value="small">{{ t('image.model_small') }}</option>
          </select>
        </div>

        <div 
          class="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 rounded-lg shadow-sm h-8 cursor-pointer transition-colors select-none hover:bg-slate-50"
          @click="!isProcessing && (useGpu = !useGpu)"
          :class="{'opacity-50 cursor-not-allowed': isProcessing}"
        >
          <Cpu class="w-3.5 h-3.5" :class="useGpu ? 'text-indigo-600' : 'text-slate-500'" />
          <span class="text-xs font-semibold text-slate-700 whitespace-nowrap">{{ t('image.use_gpu') }}:</span>
          
          <div 
            class="w-7 h-3.5 rounded-full relative transition-colors duration-200 ease-in-out"
            :class="useGpu ? 'bg-indigo-600' : 'bg-slate-200'"
          >
            <div 
              class="absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform duration-200 shadow-sm"
              :class="{'translate-x-3.5': useGpu}"
            ></div>
          </div>
        </div>

        <div class="flex items-center gap-1.5 bg-white border border-slate-200 px-2.5 rounded-lg shadow-sm h-8">
          <Scaling class="w-3.5 h-3.5 text-slate-500" />
          <span class="text-xs font-semibold text-slate-700 whitespace-nowrap">{{ t('image.export_scale') }}:</span>
          <input 
            type="number" 
            v-model.number="exportScale" 
            min="10" 
            max="500"
            step="10"
            class="w-12 text-xs text-center bg-slate-50 border border-slate-200 rounded h-6 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <span class="text-xs text-slate-500">%</span>
          <input 
            type="range" 
            v-model.number="exportScale" 
            min="10" 
            max="500" 
            step="10"
            class="w-20 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
      </div>
    </div>

    <div v-if="errorMsg" class="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100 flex items-center gap-2">
       <span>⚠️</span> {{ errorMsg }}
    </div>

    <div class="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 min-h-0">
      
      <div class="flex flex-col h-full">
        <div class="flex items-center justify-between mb-2 h-8">
          <div class="text-sm font-semibold text-slate-700 flex items-center gap-2">
            <ImageIcon class="w-4 h-4" /> {{ t('image.original') }}
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="router.push('/tools/media/remove-bg/history')"
              class="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-md transition-all"
            >
              <History class="w-3.5 h-3.5" />
              {{ t('image.history.btn') }}
            </button>
            <button
              v-if="originalUrl"
              @click="clearAll"
              class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-md transition-colors shadow-sm"
            >
              <Trash2 class="w-3.5 h-3.5" />
              {{ t('common.clear') }}
            </button>
          </div>
        </div>
        
        <div 
          class="relative flex-1 rounded-xl border-2 transition-all overflow-hidden flex items-center justify-center bg-slate-50 group"
          :class="originalUrl ? 'border-slate-200' : 'border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'"
          @click="!originalUrl ? triggerFileInput() : null"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <input type="file" ref="fileInput" class="hidden" accept="image/*" @change="handleFileSelect" />

          <img v-if="originalUrl" :src="originalUrl" class="max-w-full max-h-full object-contain p-2" />

          <div v-else class="text-center p-6 pointer-events-none">
            <div class="w-14 h-14 bg-white rounded-full shadow-sm mx-auto mb-3 flex items-center justify-center">
              <UploadCloud class="w-7 h-7 text-indigo-500" />
            </div>
            <p class="text-sm text-slate-500 font-medium">{{ t('image.click_paste_prompt') }}</p>
          </div>
          
          <div v-if="isDragging" class="absolute inset-0 bg-indigo-500/10 border-2 border-indigo-500 rounded-xl z-20 flex items-center justify-center backdrop-blur-sm">
            <span class="text-indigo-600 font-bold">{{ t('image.drop_to_upload') }}</span>
          </div>
        </div>
      </div>

      <div class="flex flex-col h-full">
        <div class="flex items-center justify-between mb-2 h-8">
          <div class="flex items-center gap-2">
            <div class="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Layers class="w-4 h-4" /> 
              {{ t('image.processing_result') }}
            </div>
            
            <div v-if="processedUrl || isProcessing" class="flex items-center gap-2 ml-2 animate-in fade-in slide-in-from-left-2 duration-300">
              <span class="text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                {{ selectedModel === 'medium' ? t('image.high_precision') : t('image.fast_mode') }}
              </span>
              <span class="text-[10px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded uppercase">
                {{ useGpu ? 'GPU' : 'CPU' }}
              </span>
              <span 
                ref="timerRef"
                class="text-[10px] font-mono font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded flex items-center gap-1 min-w-[50px] justify-center transition-all"
              >
                <Timer class="w-3 h-3" :class="{'animate-pulse': isProcessing}" />
                {{ processingTime || '0.00s' }}
              </span>
            </div>
          </div>

          <button 
            v-if="processedUrl"
            @click="downloadImage"
            :disabled="saveStatus !== 'idle'"
            class="flex items-center gap-1.5 px-3 py-1 text-xs font-bold border rounded-md transition-all shadow-sm min-w-[80px] justify-center"
            :class="{
              'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100': saveStatus === 'idle',
              'text-white bg-green-600 border-green-600': saveStatus === 'success',
              'text-white bg-red-600 border-red-600': saveStatus === 'error'
            }"
          >
            <template v-if="saveStatus === 'idle'">
              <Download class="w-3.5 h-3.5" /> {{ t('common.download') }}
            </template>
            <template v-else-if="saveStatus === 'success'">
              <Check class="w-3.5 h-3.5" /> {{ t('common.saved') }}
            </template>
            <template v-else>
              <X class="w-3.5 h-3.5" /> {{ t('common.failed') }}
            </template>
          </button>
        </div>
        
        <div class="relative flex-1 rounded-xl border border-slate-200 bg-checkerboard overflow-hidden flex items-center justify-center">
          
          <div v-if="isProcessing" class="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center text-indigo-600">
             <Loader2 class="w-8 h-8 animate-spin mb-2" />
             <span class="text-sm font-medium">{{ t('image.processing') }}</span>
          </div>

          <img v-if="processedUrl" :src="processedUrl" class="relative z-0 max-w-full max-h-full object-contain p-2" />
          
          <div v-else-if="!isProcessing && !originalUrl" class="text-slate-300 text-xs select-none">
             {{ t('common.no_content') }}
          </div>
        </div>
      </div>
    </div>

    <div class="pt-4 border-t border-slate-100 flex justify-end">
      <button 
        v-if="originalUrl"
        @click="processImage" 
        :disabled="isProcessing"
        class="w-full md:w-auto px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-bold text-sm transition-all shadow-lg shadow-indigo-200 active:scale-95"
      >
        <Wand2 class="w-4 h-4" />
        {{ processedUrl ? t('image.re_remove') : t('image.start_remove') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  UploadCloud, Image as ImageIcon, Layers, Loader2, Download,
  Wand2, Trash2, Settings2, Check, X, Scaling, Timer, Cpu, History
} from 'lucide-vue-next';
import type { Config } from '@imgly/background-removal';
import { convertFileSrc } from '@tauri-apps/api/core';
import { exists, mkdir } from '@tauri-apps/plugin-fs';
import { toolsRemoveBgDir } from '../../../../utils/path';
import BgWorker from './bg-removal.worker.ts?worker';
import { useI18n } from 'vue-i18n';
import { addHistoryRecord, loadHistory, pendingRestore, readOriginalAsFile, readImageAsObjectUrl } from '../../stores/removeBg';

const { t } = useI18n();
const router = useRouter();

const fileInput = ref<HTMLInputElement | null>(null);
const timerRef = ref<HTMLElement | null>(null);

const isDragging = ref(false);
const isProcessing = ref(false);
const originalUrl = ref<string | null>(null);
const processedUrl = ref<string | null>(null);
const originalFile = ref<File | null>(null);
const errorMsg = ref<string | null>(null);

const selectedModel = ref<'medium' | 'small'>('medium');
const exportScale = ref(100); 
const useGpu = ref(true);

const saveStatus = ref<'idle' | 'success' | 'error'>('idle');
const processingTime = ref<string | null>(null);

const triggerFileInput = () => {
  if (fileInput.value) fileInput.value.value = '';
  fileInput.value?.click();
};

const resetTimerDom = () => {
  if (timerRef.value) {
    const iconElement = timerRef.value.querySelector('svg');
    const iconHtml = iconElement ? iconElement.outerHTML : '';
    timerRef.value.innerHTML = `${iconHtml} 0.00s`;
  }
};

const handleFile = (file: File) => {
  if (!file.type.startsWith('image/')) {
    // 🟢 修改：image.errors.upload_image
    errorMsg.value = t('image.errors.upload_image');
    return;
  }
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value);
  if (processedUrl.value) URL.revokeObjectURL(processedUrl.value);

  originalFile.value = file;
  originalUrl.value = URL.createObjectURL(file);
  processedUrl.value = null;
  errorMsg.value = null;
  saveStatus.value = 'idle';
  processingTime.value = null;
  resetTimerDom();
};

const clearAll = () => {
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value);
  if (processedUrl.value) URL.revokeObjectURL(processedUrl.value);
  
  originalFile.value = null;
  originalUrl.value = null;
  processedUrl.value = null;
  errorMsg.value = null;
  saveStatus.value = 'idle';
  processingTime.value = null;
  resetTimerDom();
  
  if (fileInput.value) fileInput.value.value = '';
};

const handleFileSelect = (e: Event) => {
  const files = (e.target as HTMLInputElement).files;
  if (files && files[0]) handleFile(files[0]);
};

const handleDrop = (e: DragEvent) => {
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files[0]) handleFile(files[0]);
};

const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      const file = item.getAsFile();
      if (file) handleFile(file);
      break;
    }
  }
};

onMounted(async () => {
  window.addEventListener('paste', handlePaste);
  loadHistory();

  if (pendingRestore.value) {
    const record = pendingRestore.value;
    pendingRestore.value = null;
    const file = await readOriginalAsFile(record);
    if (file) handleFile(file);
    const restoredUrl = await readImageAsObjectUrl(record.processedPath);
    if (restoredUrl) {
      processedUrl.value = restoredUrl;
      selectedModel.value = record.model;
      exportScale.value = record.exportScale;
      processingTime.value = record.processingTime;
    }
  }
});
onUnmounted(() => window.removeEventListener('paste', handlePaste));

const processImage = async () => {
  if (!originalFile.value) return;
  
  isProcessing.value = true;
  errorMsg.value = null;
  saveStatus.value = 'idle';
  processingTime.value = '0.00s';
  resetTimerDom();

  await new Promise(resolve => setTimeout(resolve, 50));

  const startTime = Date.now();

  const updateTimer = () => {
    if (!isProcessing.value) return;
    const now = Date.now();
    const duration = ((now - startTime) / 1000).toFixed(2);
    if (timerRef.value) {
      const iconElement = timerRef.value.querySelector('svg'); 
      const iconHtml = iconElement ? iconElement.outerHTML : '';
      timerRef.value.innerHTML = `${iconHtml} ${duration}s`;
    }
    requestAnimationFrame(updateTimer);
  };
  
  requestAnimationFrame(updateTimer);

  const removeBgDir = await toolsRemoveBgDir();
  await mkdir(removeBgDir, { recursive: true });

  const hasLocalModels = await exists(`${removeBgDir}/resources.json`);

  let baseUrl = '';
  if (hasLocalModels) {
    const assetUrl = convertFileSrc(removeBgDir);
    baseUrl = assetUrl.endsWith('/') ? assetUrl : `${assetUrl}/`;
  } else {
    // Fallback to CDN when local models are not available yet.
    // They will be downloaded on first use and later synced across devices.
    baseUrl = 'https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/';
  }

  const config: Config = {
    publicPath: baseUrl, 
    model: selectedModel.value as any, 
    device: useGpu.value ? 'gpu' : 'cpu',
    progress: () => {}
  };

  const worker = new BgWorker();

  worker.onmessage = (e) => {
    const { type, blob, error } = e.data;

    if (type === 'success') {
      processedUrl.value = URL.createObjectURL(blob);
      isProcessing.value = false;
      if (timerRef.value) processingTime.value = timerRef.value.innerText.trim();
      worker.terminate();

      // Save to history immediately on successful processing
      const snapModel = selectedModel.value;
      const snapScale = exportScale.value;
      const snapName = originalFile.value!.name;
      const snapTime = processingTime.value;
      ;(async () => {
        try {
          const originalData = new Uint8Array(await originalFile.value!.arrayBuffer());
          const processedData = new Uint8Array(await blob.arrayBuffer());
          await addHistoryRecord(
            { originalName: snapName, model: snapModel, exportScale: snapScale, processingTime: snapTime },
            originalData,
            processedData,
          );
        } catch (e) {
          console.error('removebg: failed to save history', e);
        }
      })();
    } else if (type === 'error') {
      console.error(error);
      // 🟢 修改：image.errors.process_failed
      errorMsg.value = `${t('image.errors.process_failed')}: ${error}`;
      isProcessing.value = false;
      worker.terminate();
    }
  };

  worker.onerror = (err) => {
    console.error("Worker generic error:", err);
    // 🟢 修改：image.errors.worker_error
    errorMsg.value = t('image.errors.worker_error');
    isProcessing.value = false;
    worker.terminate();
  };

  worker.postMessage({ 
    file: originalFile.value, 
    config: JSON.parse(JSON.stringify(config))
  });
};

const downloadImage = async () => {
  if (!processedUrl.value) return;
  try {
    const img = new Image();
    img.src = processedUrl.value;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    const canvas = document.createElement('canvas');
    const scale = Math.max(0.1, Math.min(5, exportScale.value / 100));
    canvas.width = img.naturalWidth * scale;
    canvas.height = img.naturalHeight * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Canvas context failed");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `removed-bg-${selectedModel.value}-x${exportScale.value}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    saveStatus.value = 'success';
    setTimeout(() => { saveStatus.value = 'idle'; }, 2000);
  } catch (e) {
    console.error("Save failed:", e);
    saveStatus.value = 'error';
    setTimeout(() => { saveStatus.value = 'idle'; }, 3000);
  }
};
</script>

<style scoped>
.bg-checkerboard {
  background-color: #ffffff;
  background-image: 
    linear-gradient(45deg, #f1f5f9 25%, transparent 25%), 
    linear-gradient(-45deg, #f1f5f9 25%, transparent 25%), 
    linear-gradient(45deg, transparent 75%, #f1f5f9 75%), 
    linear-gradient(-45deg, transparent 75%, #f1f5f9 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
}
</style>