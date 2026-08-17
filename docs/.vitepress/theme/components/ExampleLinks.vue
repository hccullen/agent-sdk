<script setup lang="ts">
</script>

<template>
  <div class="example-links">
    <slot />
  </div>
</template>

<style scoped>
.example-links {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 0.6rem;
  margin: 0.75rem 0 0;
}
.example-links :deep(a) {
  display: block;
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  border-radius: 6px;
  padding: 0.65rem 0.9rem;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  transition: border-color 0.15s, color 0.15s;
}
.example-links :deep(a:hover) {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.example-links :deep(a span) {
  display: block;
  color: var(--vp-c-text-3);
  font-size: 0.8rem;
  margin-top: 0.2rem;
}
</style>
