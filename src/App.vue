<script setup lang="ts">
import { ref } from 'vue'
import AlarmStack from './components/AlarmStack.vue'
import ActivityView from './views/ActivityView.vue'
import PlcStatusIndicator from './components/PlcStatusIndicator.vue'
import RecordsView from './views/RecordsView.vue'

type ViewName = 'activity' | 'records'

const currentView = ref<ViewName>('activity')
</script>

<template>
  <div class="app">
    <header>
      <h1>HDT Traceability</h1>
      <nav>
        <button :class="{ active: currentView === 'activity' }" @click="currentView = 'activity'">
          Actividad
        </button>
        <button :class="{ active: currentView === 'records' }" @click="currentView = 'records'">
          Registros
        </button>
      </nav>
      <PlcStatusIndicator />
    </header>

    <main>
      <ActivityView v-show="currentView === 'activity'" />
      <RecordsView v-show="currentView === 'records'" />
    </main>

    <AlarmStack />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

header {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px 20px;
  background: #ffffff;
  border-bottom: 1px solid #d8e2ec;
}

h1 {
  font-size: 18px;
  color: #2b4a66;
  margin: 0;
}

nav {
  display: flex;
  gap: 8px;
}

nav button {
  font-size: 14px;
  padding: 7px 16px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #40566c;
  cursor: pointer;
}

nav button:hover {
  background: #e8f1fa;
}

nav button.active {
  background: #5ea3e0;
  color: #ffffff;
}

main {
  flex: 1;
  padding: 16px 20px;
  overflow: hidden;
}

main > * {
  height: 100%;
}
</style>
