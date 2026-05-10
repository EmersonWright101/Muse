<template>
  <div class="w-full max-w-6xl mx-auto space-y-8 pb-10 p-8">

    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('text.source') }}
        </label>
        <div class="flex items-center gap-2">
          <button
            @click="router.push('/tools/text/case-converter/history')"
            class="text-xs text-slate-400 hover:text-blue-500 transition-colors px-2 py-1 rounded-md hover:bg-blue-50 flex items-center gap-1"
          >
            <History class="w-3.5 h-3.5" />
            <span>{{ t('text.history.btn') }}</span>
          </button>
          <button
            v-if="inputText"
            @click="inputText = ''"
            class="text-xs text-slate-400 hover:text-red-500 transition-colors px-2 py-1 rounded-md hover:bg-red-50 flex items-center gap-1"
          >
            <XCircle class="w-3.5 h-3.5" />
            <span>{{ t('common.clear') }}</span>
          </button>
        </div>
      </div>
      
      <div class="relative group">
        <textarea 
          v-model="inputText" 
          class="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 min-h-[200px] text-slate-700 text-base placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-sm"
          :placeholder="t('text.input_prompt')" 
        ></textarea>
        </div>
    </div>

    <div class="relative bg-slate-100/80 p-1 rounded-lg inline-flex flex-wrap shadow-inner border border-slate-200/50 backdrop-blur-sm">
      <div 
        class="absolute top-1 bottom-1 bg-white rounded-md shadow-sm ring-1 ring-black/5 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]"
        :style="gliderStyle"
      ></div>

      <button 
        v-for="(mode, index) in modes" 
        :key="mode.value"
        :ref="(el) => { if(el) buttonRefs[index] = el as HTMLButtonElement }"
        @click="switchMode(mode.value)"
        class="relative z-10 px-4 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 whitespace-nowrap"
        :class="currentMode === mode.value ? 'text-slate-800' : 'text-slate-500 hover:text-slate-600'"
      >
        {{ mode.label }}
      </button>
    </div>

    <div class="space-y-3">
      <div class="flex items-center justify-between ml-1 h-8">
        <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          {{ t('text.result') }}
        </label>
        
        <Transition name="fade">
          <button 
            v-if="resultText"
            @click="copyToClipboard"
            class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-all duration-200 active:scale-95 border border-transparent"
            :class="copied ? 'text-green-600 bg-green-50 border-green-100' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50/80 hover:border-blue-100'"
          >
            <component :is="copied ? Check : Clipboard" class="w-3.5 h-3.5 transition-transform" :class="{ 'scale-110': copied }" />
            <span>{{ copied ? t('common.copied') : t('text.copy_result') }}</span>
          </button>
        </Transition>
      </div>

      <div class="relative group">
        <div class="w-full bg-white border border-slate-200 rounded-xl p-4 min-h-[80px] text-slate-800 break-all shadow-sm flex items-center">
          <Transition name="slide-fade" mode="out-in">
            <span :key="resultText + currentMode" v-if="resultText" class="block select-text">
              {{ resultText }}
            </span>
            <span v-else class="text-slate-300 italic text-sm select-none">{{ t('common.waiting_input') }}...</span>
          </Transition>
        </div>
        </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { convertText, type ConversionMode } from './converter';
import { Clipboard, Check, XCircle, History } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { addHistoryRecord, loadHistory } from '../../stores/textConverter';

const { t } = useI18n();
const router = useRouter();
const route = useRoute();

const inputText = ref('');
const currentMode = ref<ConversionMode>('camel');
const copied = ref(false); // 控制复制成功的状态

// 按钮引用数组和滑块样式
const buttonRefs = ref<HTMLButtonElement[]>([]);
const gliderStyle = ref({ width: '0px', transform: 'translateX(0px)', opacity: '0' });

// 模式定义：修改为引用 text.modes 下的具体 key
const modes = computed(() => [
  { label: t('text.modes.uppercase'), value: 'uppercase' },
  { label: t('text.modes.lowercase'), value: 'lowercase' },
  { label: t('text.modes.titleCase'), value: 'firstUpper' },
  { label: t('text.modes.uncapitalize'), value: 'firstLower' as any }, 
  { label: t('text.modes.UpperCamelCase'), value: 'Camel' as any },
  { label: t('text.modes.lowerCamelCase'), value: 'camel' },
  { label: t('text.modes.snake_case'), value: 'snake' },
]);
// 注意：我把 modes 改成了 computed，这样当语言切换时，按钮文字会自动更新。
// 如果不需要动态切换语言支持，保持原来的 const 数组写法也可以，但用 computed 是最佳实践。

const resultText = computed(() => convertText(inputText.value, currentMode.value));

// 计算滑块位置
const updateGlider = () => {
  // modes 现在是 computed，需要用 modes.value
  const index = modes.value.findIndex(m => m.value === currentMode.value);
  // 增加安全检查，防止 index 为 -1
  if (index < 0 || !buttonRefs.value[index]) return;
  
  const button = buttonRefs.value[index];
  gliderStyle.value = {
    width: `${button.offsetWidth}px`,
    transform: `translateX(${button.offsetLeft}px)`,
    opacity: '1' // 计算完成后再显示滑块，避免闪烁
  };
};

const switchMode = (mode: ConversionMode) => {
  currentMode.value = mode;
  updateGlider();
};

onMounted(() => {
  loadHistory();

  // Restore from history query params (e.g., navigated from HistoryView)
  if (route.query.input) {
    inputText.value = String(route.query.input);
  }
  if (route.query.mode) {
    const m = String(route.query.mode) as ConversionMode;
    if (modes.value.some(mode => mode.value === m)) {
      currentMode.value = m;
    }
  }

  setTimeout(() => {
    nextTick(updateGlider);
  }, 100);
});

window.addEventListener('resize', updateGlider);

// 复制并保存历史
const copyToClipboard = () => {
  if (!resultText.value || copied.value) return;
  navigator.clipboard.writeText(resultText.value);

  addHistoryRecord({
    inputText: inputText.value,
    outputText: resultText.value,
    mode: currentMode.value,
  });

  copied.value = true;
  setTimeout(() => copied.value = false, 2000);
};
</script>

<style scoped>
/* 文字切换动画 */
.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.25, 1, 0.5, 1);
}
.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(5px);
  opacity: 0;
}

/* 按钮淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>