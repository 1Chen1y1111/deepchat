<script setup lang="ts">
import { ref } from 'vue'

import AppBar from './components/AppBar.vue'

import { useDeviceVersion } from '@/composables/useDeviceVersion'

const { isWinMacOS } = useDeviceVersion()

const windowType = ref<'chat' | 'browser'>('chat')
</script>

<template>
  <div class="w-screen h-screen flex flex-col" :class="isWinMacOS ? '' : 'bg-background'">
    <AppBar ref="appBarRef" :window-type="windowType" />
    <div class="absolute bottom-0 left-0 w-full h-px bg-border z-10"></div>
  </div>
</template>

<style lang="scss" scoped></style>
