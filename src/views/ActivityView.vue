<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { ToolingRecord } from '../types'

const LATEST_LIMIT = 100

const records = ref<ToolingRecord[]>([])
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  try {
    records.value = await window.traceability.records.getLatest()
  } catch {
    records.value = []
  }
  unsubscribe = window.traceability.onRecordSaved((record) => {
    records.value = [record, ...records.value].slice(0, LATEST_LIMIT)
  })
})

onUnmounted(() => unsubscribe?.())
</script>

<template>
  <section class="view">
    <h2>Actividad en tiempo real</h2>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>stationId</th>
            <th>modelId</th>
            <th>toolingId</th>
            <th>matrixReaded</th>
            <th>status</th>
            <th>finalLeakRate</th>
            <th>finalPressure</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td>{{ record.stationId }}</td>
            <td>{{ record.modelId }}</td>
            <td>{{ record.toolingId }}</td>
            <td class="ellipsis" :title="record.matrixReaded ?? ''">{{ record.matrixReaded }}</td>
            <td>
              <span class="badge" :class="record.status ? 'ok' : 'ng'">
                {{ record.status ? 'OK' : 'NG' }}
              </span>
            </td>
            <td>{{ record.finalLeakRate }}</td>
            <td>{{ record.finalPressure }}</td>
          </tr>
          <tr v-if="records.length === 0">
            <td colspan="7" class="empty">Sin registros</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.table-container {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: #ffffff;
  border: 1px solid #d8e2ec;
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th,
td {
  padding: 8px 12px;
  text-align: left;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
}

th {
  position: sticky;
  top: 0;
  background: #e8f1fa;
  color: #2b4a66;
  border-bottom: 2px solid #bcd6ec;
  z-index: 1;
}

tbody tr:nth-child(odd) {
  background: #ffffff;
}

tbody tr:nth-child(even) {
  background: #f2f7fc;
}

.ellipsis {
  text-overflow: ellipsis;
}

.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  font-weight: 600;
}

.badge.ok {
  background: #dff3e3;
  color: #1e7a34;
}

.badge.ng {
  background: #fbe0e0;
  color: #b32020;
}

.empty {
  text-align: center;
  color: #7a8a99;
  padding: 24px;
}
</style>
