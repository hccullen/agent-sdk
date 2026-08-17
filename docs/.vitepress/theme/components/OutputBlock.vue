<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <div class="output-block">
    <slot />
  </div>
</template>

<style scoped>
.output-block {
  background: #0a0c10;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 1rem 1.15rem;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  line-height: 1.6;
  color: #b8c2d4;
  overflow-x: auto;
  white-space: pre;
  margin: 1rem 0;
}
</style>
