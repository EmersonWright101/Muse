<template>
  <div class="w-full h-full flex bg-[#f5f5f7] text-[13px] text-[#1d1d1f] font-sans overflow-hidden">
    
    <div class="w-[48%] h-full overflow-y-auto flex flex-col items-center py-10 gap-10 custom-scrollbar border-r border-gray-200/60 bg-[#eef0f4] relative shadow-[inset_-10px_0_20px_rgba(0,0,0,0.02)]">
      
      <div v-if="isProcessingFile" class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#eef0f4]/80 backdrop-blur-sm gap-3">
        <svg class="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-sm font-medium text-gray-600">{{ t('printer.generating_preview') }}</span>
      </div>

      <div v-else-if="!selectedFileName" class="m-auto flex flex-col items-center justify-center text-gray-400 gap-3">
        <PrinterIcon class="w-12 h-12 opacity-40" />
        <span class="text-sm font-medium">{{ t('printer.select_file_prompt') }}</span>
      </div>

      <template v-else>
        <div v-for="sheetIndex in totalSheets" :key="sheetIndex" class="flex flex-col items-center gap-4 w-full">
          
          <div 
            class="bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition-all duration-300 relative border border-gray-200/50"
            :style="paperStyle"
          >
            <div class="w-full h-full" :style="previewGridStyle">
              
              <div 
                v-for="cellIndex in parseInt(printConfig.pagesPerSheet)" 
                :key="cellIndex"
                class="relative w-full h-full flex items-center justify-center overflow-hidden"
                :class="{
                  'border border-solid border-gray-400': printConfig.border === 'single',
                  'border-[2px] border-solid border-gray-800': printConfig.border === 'thick',
                  'border border-dashed border-gray-200/70': printConfig.border === 'none' && printConfig.pagesPerSheet !== '1'
                }"
              >
                <template v-if="getDocPageIndex(sheetIndex, cellIndex) <= assumedTotalPages">
                  
                  <img 
                    v-if="selectedFileType.startsWith('image/') || isPdf" 
                    :src="getImageForPage(getDocPageIndex(sheetIndex, cellIndex))" 
                    class="w-full h-full object-contain pointer-events-none select-none bg-white shadow-[0_0_2px_rgba(0,0,0,0.1)] transition-all duration-300" 
                    :class="{ 'grayscale': printConfig.color === 'monochrome' }"
                    @error="handleImageError"
                  />

                  <div 
                    v-else-if="textContent" 
                    class="w-full h-full p-2 text-[6px] leading-tight text-gray-600 whitespace-pre-wrap font-mono overflow-hidden pointer-events-none select-none bg-white transition-all duration-300"
                    :class="{ 'grayscale': printConfig.color === 'monochrome' }"
                  >
                    {{ textContent }}
                  </div>

                </template>
                
                <div v-else class="w-full h-full bg-gray-50/50"></div>
              </div>

            </div>
          </div>

          <div class="px-5 py-1.5 bg-gray-300/60 text-gray-700 rounded-full text-[11px] font-semibold tracking-wide backdrop-blur-sm shadow-sm">
            {{ t('printer.sheet_label', { sheetIndex, totalSheets }) }}
          </div>
        </div>
      </template>
    </div>


    <div class="flex-1 h-full flex flex-col bg-white relative overflow-hidden">
      
      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <div class="p-8 max-w-[540px] mx-auto w-full flex flex-col gap-6 pb-8">
          
          <div 
            @click="triggerFileInput"
            class="w-full bg-[#fbfbfc] border border-gray-200/80 hover:border-blue-400 rounded-xl p-3 flex items-center justify-between cursor-pointer transition-all shadow-sm group"
          >
            <div class="flex items-center gap-3 overflow-hidden ml-1">
              <div class="p-1.5 bg-white rounded-lg shadow-sm border border-gray-100 group-hover:scale-105 transition-transform">
                <FileText class="w-4 h-4 text-blue-500 flex-shrink-0" />
              </div>
              <span v-if="selectedFileName" class="text-[13px] font-medium text-gray-800 truncate">{{ selectedFileName }}</span>
              <span v-else class="text-[13px] text-gray-400">{{ t('printer.select_document_prompt') }}</span>
            </div>
            <input type="file" ref="fileInput" @change="handleFileChange" class="hidden" accept=".pdf,image/*,.txt,.md,.csv" />
          </div>

          <div class="bg-[#f5f5f7] rounded-xl border border-gray-200/80 flex flex-col shadow-sm text-[13px]">
            <div class="flex items-center justify-between p-3.5 border-b border-gray-200/80">
              <label class="text-gray-600 font-medium">{{ t('printer.printer') }}</label>
              <select v-model="printConfig.printerGroupId" class="bg-transparent border-none text-right font-semibold text-gray-800 focus:outline-none focus:ring-0 cursor-pointer text-ellipsis max-w-[200px]">
                <option v-for="group in printerGroups" :key="group.id" :value="group.id">
                  {{ t('printer.printer_series', { base: group.base, location: group.location }) }}
                </option>
              </select>
            </div>
            <div class="flex items-center justify-between p-3.5 border-b border-gray-200/80">
              <label class="text-gray-600 font-medium">{{ t('printer.queue') }}</label>
              <select v-model="printConfig.printerQueue" class="bg-transparent border-none text-right font-semibold text-gray-800 focus:outline-none focus:ring-0 cursor-pointer">
                <option v-for="queue in currentGroupQueues" :key="queue" :value="queue">{{ queue }}</option>
              </select>
            </div>
            <div class="flex items-center justify-between p-3.5">
              <label class="text-gray-600 font-medium">{{ t('printer.presets') }}</label>
              <span class="font-semibold text-gray-800">{{ t('printer.default_settings') }}</span>
            </div>
          </div>

          <div class="bg-[#f5f5f7] rounded-xl border border-gray-200/80 p-3.5 flex items-center justify-between shadow-sm mt-2">
            <label class="text-gray-600 font-medium text-[13px]">{{ t('printer.soc_id') }}</label>
            <input 
              type="text" 
              v-model="studentName" 
              :placeholder="t('printer.soc_id_placeholder')"
              class="w-32 px-2 py-1 bg-white border border-gray-300 rounded-md text-right text-[13px] font-semibold text-gray-800 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all shadow-sm"
            />
          </div>

          <div class="flex flex-col gap-5 mt-2 px-1">
            <div class="flex items-center justify-between">
              <label class="text-gray-700 font-medium">{{ t('printer.copies') }}</label>
              <input 
                type="number" v-model="printConfig.copies" min="1" max="99"
                class="w-16 px-2 py-1 bg-white border border-blue-400 rounded-md text-center font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 shadow-sm"
              />
            </div>
            
            <div class="flex flex-col gap-2.5">
              <label class="text-gray-700 font-medium mb-0.5">{{ t('printer.pages') }}</label>
              <div class="flex items-center gap-2">
                <input type="radio" v-model="printConfig.pageRangeType" value="all" id="page-all" class="accent-blue-500 w-3.5 h-3.5" />
                <label for="page-all" class="text-gray-600 cursor-pointer">{{ t('printer.all_pages', { assumedTotalPages }) }}</label>
              </div>
              <div class="flex items-center gap-2">
                <input type="radio" v-model="printConfig.pageRangeType" value="custom" id="page-custom" class="accent-blue-500 w-3.5 h-3.5" />
                <label for="page-custom" class="text-gray-600 cursor-pointer flex items-center gap-2">
                  {{ t('printer.range_from') }}
                  <input type="text" v-model="printConfig.customRange" :disabled="printConfig.pageRangeType !== 'custom'" class="w-24 px-2 py-1 border border-gray-300 rounded text-center disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:border-blue-400" :placeholder="t('printer.range_placeholder')" />
                </label>
              </div>
            </div>

            <div class="w-full h-px bg-gray-200/80 my-1"></div>

            <div class="flex items-center justify-between">
              <label class="text-gray-700 font-medium">{{ t('printer.paper_size') }}</label>
              <select v-model="printConfig.paperSize" class="bg-transparent border-none text-right text-gray-600 font-medium focus:outline-none cursor-pointer">
                <option value="A4">{{ t('printer.paper_a4') }}</option>
                <option value="A3">{{ t('printer.paper_a3') }}</option>
              </select>
            </div>

            <div class="flex items-center justify-between mt-1">
              <label class="text-gray-700 font-medium">{{ t('printer.orientation') }}</label>
              <div class="flex items-center gap-5">
                <label class="flex items-center gap-1.5 cursor-pointer group">
                  <input type="radio" v-model="printConfig.orientation" value="portrait" class="accent-blue-500 w-3.5 h-3.5" />
                  <span class="text-gray-600 flex items-center gap-1.5 group-hover:text-gray-800 transition-colors"><User class="w-4 h-4"/> {{ t('printer.portrait') }}</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer group">
                  <input type="radio" v-model="printConfig.orientation" value="landscape" class="accent-blue-500 w-3.5 h-3.5" />
                  <span class="text-gray-600 flex items-center gap-1.5 group-hover:text-gray-800 transition-colors"><User class="w-4 h-4 -rotate-90"/> {{ t('printer.landscape') }}</span>
                </label>
              </div>
            </div>

            <div class="flex items-center justify-between mt-1">
              <label class="text-gray-700 font-medium">{{ t('printer.color') }}</label>
              <div class="flex items-center gap-5">
                <label class="flex items-center gap-1.5 cursor-pointer group">
                  <input type="radio" v-model="printConfig.color" value="monochrome" class="accent-blue-500 w-3.5 h-3.5" />
                  <span class="text-gray-600 group-hover:text-gray-800 transition-colors">{{ t('printer.black_white') }}</span>
                </label>
                <label class="flex items-center gap-1.5 cursor-pointer group">
                  <input type="radio" v-model="printConfig.color" value="color" class="accent-blue-500 w-3.5 h-3.5" />
                  <span class="text-gray-600 group-hover:text-gray-800 transition-colors">{{ t('printer.color_option') }}</span>
                </label>
              </div>
            </div>

          </div>

          <div class="mt-4 border border-gray-200/80 rounded-xl overflow-hidden shadow-sm">
            <div class="bg-[#fbfbfc] px-4 py-3 flex items-center gap-2 border-b border-gray-200/80">
              <ChevronDown class="w-4 h-4 text-gray-500" />
              <span class="font-semibold text-gray-700 tracking-wide">{{ t('printer.layout') }}</span>
            </div>
            <div class="p-5 bg-white flex flex-col gap-6">
              
              <div class="flex items-center justify-between">
                <label class="text-gray-600">{{ t('printer.pages_per_sheet') }}</label>
                <select v-model="printConfig.pagesPerSheet" class="px-3 py-1.5 border border-gray-200 rounded-md bg-[#f5f5f7] font-medium text-gray-700 focus:outline-none focus:border-blue-400 focus:bg-white transition-all shadow-sm">
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="6">6</option>
                  <option value="8">8</option>
                  <option value="12">12</option>
                  <option value="16">16</option>
                </select>
              </div>

              <div class="flex items-center justify-between" v-if="printConfig.pagesPerSheet !== '1'">
                <label class="text-gray-600">{{ t('printer.layout_direction') }}</label>
                <div class="flex bg-[#f5f5f7] rounded-md border border-gray-200 p-0.5 shadow-inner">
                  <button v-for="dir in layoutDirections" :key="dir.val" @click="printConfig.layoutDirection = dir.val"
                    class="px-2.5 py-1 rounded-[4px] flex items-center justify-center transition-all duration-200"
                    :class="printConfig.layoutDirection === dir.val ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-800'"
                  >
                    <component :is="dir.icon" class="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <label class="text-gray-600">{{ t('printer.border') }}</label>
                <select v-model="printConfig.border" class="px-3 py-1.5 border border-gray-200 rounded-md bg-[#f5f5f7] font-medium text-gray-700 focus:outline-none shadow-sm">
                  <option value="none">{{ t('printer.border_none') }}</option>
                  <option value="single">{{ t('printer.border_single') }}</option>
                  <option value="thick">{{ t('printer.border_thick') }}</option>
                </select>
              </div>

              <div class="w-full h-px bg-gray-100 my-1"></div>

              <div class="flex items-center justify-between">
                <label class="text-gray-600">{{ t('printer.two_sided') }}</label>
                <select v-model="printConfig.sides" class="px-3 py-1.5 border border-gray-200 rounded-md bg-[#f5f5f7] font-medium text-gray-700 focus:outline-none shadow-sm">
                  <option value="one-sided">{{ t('printer.two_sided_off') }}</option>
                  <option value="two-sided-long-edge">{{ t('printer.two_sided_long') }}</option>
                  <option value="two-sided-short-edge">{{ t('printer.two_sided_short') }}</option>
                </select>
              </div>

            </div>
          </div>

        </div>
      </div>

      <div class="w-full border-t border-gray-200/80 bg-[#fbfbfc] px-8 py-5 flex flex-col gap-4 shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-10 flex-shrink-0">
        
        <div class="w-full bg-[#1e1e1e] rounded-lg p-3.5 shadow-inner relative group border border-gray-800">
          <div class="flex items-center gap-1.5 mb-2 opacity-90">
            <Terminal class="w-3.5 h-3.5 text-emerald-400" />
            <span class="text-[10px] uppercase font-bold text-gray-400 tracking-wider">{{ t('printer.command') }}</span>
          </div>
          <code class="block font-mono text-emerald-400 text-xs break-all whitespace-pre-wrap leading-relaxed select-text pr-2 max-h-32 overflow-y-auto custom-scrollbar">
            {{ fullTerminalOutput }}
          </code>
        </div>

        <div class="flex items-center justify-between">
          <button class="px-3 py-1.5 bg-gray-200/80 hover:bg-gray-200 text-gray-700 rounded-md text-[13px] font-medium transition-colors flex items-center gap-1.5">
            <HelpCircle class="w-4 h-4" /> {{ t('printer.help') }}
          </button>
          
          <div class="flex items-center gap-3">
            <button class="px-6 py-1.5 bg-gray-200/80 hover:bg-gray-200 text-gray-700 rounded-md text-[13px] font-semibold transition-colors">
              {{ t('printer.cancel') }}
            </button>
            <button 
              @click="copyCommand"
              class="px-8 py-1.5 rounded-md text-[13px] font-semibold transition-all duration-200 shadow-sm flex items-center gap-1.5"
              :class="copied ? 'bg-emerald-500 text-white shadow-emerald-200' : 'bg-blue-500 hover:bg-blue-600 text-white shadow-blue-200'"
            >
              <component :is="copied ? Check : PrinterIcon" class="w-4 h-4" />
              {{ copied ? t('printer.copied_clipboard') : t('printer.copy_print') }}
            </button>
          </div>
        </div>

      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { 
  FileText, Terminal, Check, Printer as PrinterIcon, 
  ChevronDown, User, HelpCircle, 
  Type, 
  Sigma 
} from 'lucide-vue-next';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const { t } = useI18n();

const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref('');
const selectedFileType = ref('');
const selectedFileUrl = ref(''); 
const textContent = ref('');
const copied = ref(false);
const isProcessingFile = ref(false);

const studentName = ref(localStorage.getItem('nus_student_name') || '');
watch(studentName, (newVal) => {
  localStorage.setItem('nus_student_name', newVal);
});
const selectedFilePath = ref('');

const pdfPageImages = ref<Record<number, string>>({});
const assumedTotalPages = ref(1);

const isPdf = computed(() => selectedFileType.value === 'application/pdf' || selectedFileType.value === 'pdf');

const printerGroups = [
  { id: 'group_psc008', base: 'psc008', location: 'COM1, Basement', model: 'LEXMARK MS821DN', queues: ['psc008', 'psc008-sx', 'psc008-nb'] },
  { id: 'group_psc011', base: 'psc011', location: 'COM1, Basement', model: 'LEXMARK MS821DN', queues: ['psc011', 'psc011-sx', 'psc011-nb'] },
  { id: 'group_psts', base: 'psts', location: 'COM1, Level 1', model: 'LEXMARK MS821DN', queues: ['psts', 'psts-sx', 'psts-nb'] },
  { id: 'group_pstsb', base: 'pstsb', location: 'COM1, Level 1', model: 'LEXMARK MS821DN', queues: ['pstsb', 'pstsb-sx', 'pstsb-nb'] },
  { id: 'group_pstsc', base: 'pstsc', location: 'COM1, Level 1', model: 'LEXMARK MS821DN', queues: ['pstsc', 'pstsc-sx', 'pstsc-nb'] },
  { id: 'group_cptsc', base: 'cptsc', location: 'COM1-01-06', model: 'LEXMARK CS921DE', queues: ['cptsc', 'cptsc-dx'] },
  { id: 'group_cptsc_a3', base: 'cptsc-a3', location: 'COM1-01-06', model: 'LEXMARK CS921DE', queues: ['cptsc-a3', 'cptsc-a3-dx'] },
  { id: 'group_pse124', base: 'pse124', location: 'COM3-01-24', model: 'LEXMARK MS810', queues: ['pse124', 'pse124-sx'] },
  { id: 'group_psf204', base: 'psf204', location: 'COM4, Level 2', model: 'LEXMARK MS810', queues: ['psf204', 'psf204-sx'] }
];

const printConfig = reactive({
  printerGroupId: 'group_psts',
  printerQueue: 'psts',
  copies: 1,
  pageRangeType: 'all',
  customRange: '',
  paperSize: 'A4',
  orientation: 'portrait',
  color: 'monochrome', 
  pagesPerSheet: '4', 
  layoutDirection: 'lrtb',
  border: 'none',
  sides: 'one-sided'
});

const layoutDirections = [
  { val: 'lrtb', icon: Type },
  { val: 'tblr', icon: Sigma }
];

const selectedPrinterGroup = computed(() => printerGroups.find(g => g.id === printConfig.printerGroupId) || printerGroups[0]);
const currentGroupQueues = computed(() => selectedPrinterGroup.value.queues);

watch(() => printConfig.printerGroupId, () => {
  if (currentGroupQueues.value.length > 0) printConfig.printerQueue = currentGroupQueues.value[0];
});

const totalSheets = computed(() => {
  if (!selectedFileName.value) return 0;
  if (!isPdf.value && selectedFileType.value.startsWith('image/')) return 1;
  const pagesPerSheet = parseInt(printConfig.pagesPerSheet);
  return Math.ceil(assumedTotalPages.value / pagesPerSheet);
});

const layoutGrid = computed(() => {
  const n = parseInt(printConfig.pagesPerSheet);
  const isLandscape = printConfig.orientation === 'landscape';
  let cols = 1, rows = 1;

  if (n === 2) { cols = isLandscape ? 2 : 1; rows = isLandscape ? 1 : 2; } 
  else if (n === 4) { cols = 2; rows = 2; } 
  else if (n === 6) { cols = isLandscape ? 3 : 2; rows = isLandscape ? 2 : 3; }
  else if (n === 8) { cols = isLandscape ? 4 : 2; rows = isLandscape ? 2 : 4; }
  else if (n === 12) { cols = isLandscape ? 4 : 3; rows = isLandscape ? 3 : 4; }
  else if (n === 16) { cols = 4; rows = 4; }
  return { cols, rows };
});

const getDocPageIndex = (sheetIndex: number, cellIndex: number) => {
  const pagesPerSheet = parseInt(printConfig.pagesPerSheet);
  const baseOffset = (sheetIndex - 1) * pagesPerSheet;
  
  let visualToDataIndex = cellIndex - 1;
  const { cols, rows } = layoutGrid.value;
  
  if (printConfig.layoutDirection === 'tblr') { 
     const col = visualToDataIndex % cols;
     const row = Math.floor(visualToDataIndex / cols);
     visualToDataIndex = col * rows + row;
  }
  
  return baseOffset + visualToDataIndex + 1;
};

const getImageForPage = (pageIndex: number) => {
  if (isPdf.value) {
    return pdfPageImages.value[pageIndex] || ''; 
  }
  return selectedFileUrl.value;
};

const paperStyle = computed(() => {
  const isLandscape = printConfig.orientation === 'landscape';
  const isA3 = printConfig.paperSize === 'A3';
  const baseWidth = isA3 ? 460 : 380; 
  const ratio = 1.414; 
  
  if (isLandscape) return { width: `${baseWidth * ratio}px`, height: `${baseWidth}px` };
  return { width: `${baseWidth}px`, height: `${baseWidth * ratio}px` };
});

const previewGridStyle = computed(() => {
  const { cols, rows } = layoutGrid.value;
  const padding = printConfig.border !== 'none' ? '20px' : '24px';
  const gap = printConfig.border !== 'none' ? '0px' : '10px';
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gridTemplateRows: `repeat(${rows}, 1fr)`,
    gap, padding
  };
});

const handleImageError = (e: Event) => {
  (e.target as HTMLImageElement).style.display = 'none';
};

const triggerFileInput = () => fileInput.value?.click();

const processPdf = async (file: File) => {
  isProcessingFile.value = true;
  pdfPageImages.value = {}; 
  
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    assumedTotalPages.value = pdfDoc.numPages;

    const maxPagesToRender = Math.min(pdfDoc.numPages, 50);

    for (let pageNum = 1; pageNum <= maxPagesToRender; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      pdfPageImages.value[pageNum] = canvas.toDataURL('image/jpeg', 0.85);
    }
  } catch (error) {
    console.error(t('printer.pdf_render_error'), error);
  } finally {
    isProcessingFile.value = false;
  }
};

const handleFileChange = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    const file = target.files[0];
    selectedFileName.value = file.name;
    selectedFileType.value = file.type || file.name.split('.').pop()?.toLowerCase() || '';

    selectedFilePath.value = (file as any).path || file.name;
    
    if (selectedFileUrl.value.startsWith('blob:')) URL.revokeObjectURL(selectedFileUrl.value);

    if (selectedFileType.value.includes('text') || ['txt', 'csv', 'md'].includes(selectedFileType.value)) {
      selectedFileUrl.value = '';
      textContent.value = await file.text();
      assumedTotalPages.value = 1; 
    } 
    else if (isPdf.value) {
      textContent.value = '';
      await processPdf(file); 
    } 
    else {
      textContent.value = '';
      assumedTotalPages.value = 1;
      selectedFileUrl.value = URL.createObjectURL(file);
    }
  }
};

onUnmounted(() => {
  if (selectedFileUrl.value.startsWith('blob:')) URL.revokeObjectURL(selectedFileUrl.value);
});

const generatedCommand = computed(() => {
  let cmd = 'lp';
  if (printConfig.printerQueue) cmd += ` -d ${printConfig.printerQueue}`;
  if (printConfig.copies > 1) cmd += ` -n ${printConfig.copies}`;
  if (printConfig.pageRangeType === 'custom' && printConfig.customRange.trim()) cmd += ` -P ${printConfig.customRange.trim()}`;
  if (printConfig.paperSize !== 'A4') cmd += ` -o media=${printConfig.paperSize}`;
  if (printConfig.orientation === 'landscape') cmd += ` -o landscape`;
  
  if (printConfig.color === 'monochrome') {
    cmd += ` -o ColorModel=Gray`;
  } else {
    cmd += ` -o ColorModel=Color`;
  }

  cmd += ` -o sides=${printConfig.sides}`;
  
  if (printConfig.pagesPerSheet !== '1') {
    cmd += ` -o number-up=${printConfig.pagesPerSheet}`;
    if (printConfig.layoutDirection !== 'lrtb') cmd += ` -o number-up-layout=${printConfig.layoutDirection}`;
  }
  
  if (printConfig.border === 'single') cmd += ` -o page-border=single`;
  else if (printConfig.border === 'thick') cmd += ` -o page-border=single-thick`;

  const fileName = selectedFileName.value ? `"${selectedFileName.value}"` : '"[File]"';
  cmd += ` ${fileName}`;
  return cmd;
});

const fullTerminalOutput = computed(() => {
  const user = studentName.value.trim() || 'STUDENTNAME';
  const path = selectedFilePath.value ? `"${selectedFilePath.value}"` : '"[File_Path]"';
  
  const scpCmd = `scp ${path} ${user}@stu.comp.nus.edu.sg:~`;
  const sshCmd = `ssh ${user}@stu.comp.nus.edu.sg`;
  const lpCmd = generatedCommand.value;

  return `${t('printer.command_step1')}\n${scpCmd}\n\n${t('printer.command_step2')}\n${sshCmd}\n\n${t('printer.command_step3')}\n${lpCmd}`;
});

const copyCommand = async () => {
  if (copied.value || !selectedFileName.value) return;
  try {
    await navigator.clipboard.writeText(fullTerminalOutput.value);
    copied.value = true;
    setTimeout(() => copied.value = false, 2000);
  } catch (err) {}
};
</script>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 10px; }
.custom-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.25); }
.grayscale { filter: grayscale(100%); }
</style>
