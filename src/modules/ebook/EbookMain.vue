<script setup lang="ts">
import { computed } from 'vue'
import { useEbookStore } from '../../stores/ebook'
import BookLibrary from './components/BookLibrary.vue'
import BookReader from './components/BookReader.vue'

const store = useEbookStore()

const activeBook = computed(() => store.activeBook)

function closeReader() {
  store.setActiveBook(null)
}
</script>

<template>
  <div class="ebook-main">
    <Transition name="reader-fade" mode="out-in">
      <BookReader
        v-if="activeBook"
        :key="activeBook.id"
        :book="activeBook"
        @close="closeReader"
      />
      <BookLibrary v-else />
    </Transition>
  </div>
</template>

<style scoped>
.ebook-main {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: #ffffff;
}

.reader-fade-enter-active,
.reader-fade-leave-active { transition: opacity 0.18s ease; }
.reader-fade-enter-from,
.reader-fade-leave-to { opacity: 0; }
</style>
