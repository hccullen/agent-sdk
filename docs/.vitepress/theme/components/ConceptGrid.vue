<script setup lang="ts">
</script>

<template>
  <div class="concept-grid">
    <slot />
  </div>
</template>

<style scoped>
.concept-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(200px, 100%), 1fr));
  gap: 0.75rem;
  margin: 1.25rem 0;
}
</style>
