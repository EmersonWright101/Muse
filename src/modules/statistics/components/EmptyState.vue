<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'
</script>

<template>
  <div class="empty-state">
    <Inbox :size="36" class="empty-icon" />
    <div class="empty-title">还没有数据</div>
    <div class="empty-desc">开始对话后，统计数据将自动在这里显示</div>
  </div>
</template>

<style scoped>
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 20px;
  color: #8e8e93;
}

.empty-icon {
  color: #c7c7cc;
  margin-bottom: 4px;
}

.empty-title {
  font-size: 15px;
  font-weight: 500;
  color: #3c3c43;
}

.empty-desc {
  font-size: 13px;
  color: #8e8e93;
  text-align: center;
}
</style>
