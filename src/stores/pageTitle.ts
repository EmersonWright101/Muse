import { ref } from 'vue'

export const pageTitle = ref('')

export function setPageTitle(title: string) {
  pageTitle.value = title
}

export function clearPageTitle() {
  pageTitle.value = ''
}
