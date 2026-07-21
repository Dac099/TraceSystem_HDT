<script setup lang="ts">
import { useAlarms } from '../composables/useAlarms'

const { alarms, dismiss } = useAlarms()
</script>

<template>
  <div class="alarm-stack" aria-live="polite">
    <TransitionGroup name="alarm">
      <div v-for="alarm in alarms" :key="alarm.id" class="alarm" @click="dismiss(alarm.id)">
        {{ alarm.message }}
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.alarm-stack {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 360px;
}

.alarm {
  background: #fff4e5;
  border: 1px solid #f0b35e;
  border-left: 4px solid #e8930c;
  color: #6b4e12;
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 14px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
  cursor: pointer;
}

.alarm-enter-active,
.alarm-leave-active {
  transition: all 0.25s ease;
}

.alarm-enter-from,
.alarm-leave-to {
  opacity: 0;
  transform: translateX(24px);
}
</style>
