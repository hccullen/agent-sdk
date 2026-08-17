<script setup lang="ts">
defineProps<{
  title: string
}>()
</script>

<template>
  <div class="concept-card">
    <strong>{{ title }}</strong>
    <slot />
  </div>
</template>

<style scoped>
.concept-card {
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-border);
  padding: 0.9rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
}
.concept-card strong {
  display: block;
  color: var(--vp-c-brand-3);
  margin-bottom: 0.3rem;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
