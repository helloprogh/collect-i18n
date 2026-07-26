<script setup lang="ts">
// This compact summary deliberately owns its public props instead of forwarding
// arbitrary attributes to one of its sibling sections.
defineOptions({ inheritAttrs: false })
defineProps<{
  title: string
  lead: string
  body: string
  footer: string
}>()
</script>

<template>
  <h4 class="fragment-title">{{ title }}</h4>
  <p class="fragment-line">{{ lead }}</p>
  <p class="fragment-line">{{ body }}</p>
  <p class="fragment-line">{{ footer }}</p>
</template>
