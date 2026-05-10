<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import enMessages from './i18n/en'
import zhMessages from './i18n/zh'

const { mergeLocaleMessage } = useI18n()

onMounted(() => {
  mergeLocaleMessage('en-US', enMessages)
  mergeLocaleMessage('zh-CN', zhMessages)
})
</script>

<template>
  <div class="tools-main">
    <router-view />
  </div>
</template>

<style scoped>
.tools-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}
</style>
