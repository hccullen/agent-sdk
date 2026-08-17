<script setup lang="ts">
import { computed, useSlots } from "vue";

const slots = useSlots();
const cards = computed(() => {
  const def = slots.default?.() ?? [];
  return def.filter((v) => v.type?.__name === "ConceptCard" || typeof v.type === "symbol");
});
</script>

<template>
  <div class="concept-grid">
    <slot />
  </div>
</template>

<style scoped>
.concept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
  margin: 1.25rem 0;
}
</style>
