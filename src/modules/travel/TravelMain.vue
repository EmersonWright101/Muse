<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { MapPin } from 'lucide-vue-next'

const { t } = useI18n()
</script>

<template>
  <div class="travel-main">
    <div class="placeholder-state">
      <div class="placeholder-icon">
        <MapPin :size="40" />
      </div>
      <p class="placeholder-text">{{ t('travel.placeholder') }}</p>
    </div>
  </div>
</template>

<style scoped>
.travel-main {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.placeholder-state {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.placeholder-icon {
  color: #c7c7cc;
}

.placeholder-text {
  font-size: 14px;
  color: #aeaeb2;
  margin: 0;
}
</style>
