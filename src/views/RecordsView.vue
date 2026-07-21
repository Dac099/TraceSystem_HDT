<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { RecordFilters, ToolingRecord } from '../types'
import { useAlarms } from '../composables/useAlarms'

const PAGE_SIZE = 50

const form = reactive({
  stationId: '',
  modelId: '',
  toolingId: '',
  matrixReaded: '',
  startDate: '',
  endDate: ''
})

const records = ref<ToolingRecord[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const exporting = ref(false)
const { push } = useAlarms()

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

function buildFilters(): RecordFilters {
  const filters: RecordFilters = {}
  if (form.stationId) filters.stationId = form.stationId
  if (form.modelId.trim()) filters.modelId = form.modelId.trim()
  if (form.toolingId.trim()) filters.toolingId = form.toolingId.trim()
  if (form.matrixReaded.trim()) filters.matrixReaded = form.matrixReaded.trim()
  if (form.startDate) filters.startDate = new Date(form.startDate).toISOString()
  if (form.endDate) filters.endDate = new Date(form.endDate).toISOString()
  return filters
}

async function search(targetPage = 1): Promise<void> {
  loading.value = true
  try {
    const result = await window.traceability.records.query(buildFilters(), targetPage)
    records.value = result.rows
    total.value = result.total
    page.value = targetPage
  } catch {
    push('Error al consultar los registros')
  } finally {
    loading.value = false
  }
}

async function exportCsv(): Promise<void> {
  exporting.value = true
  try {
    const path = await window.traceability.records.exportCsv(buildFilters())
    if (path) push(`CSV exportado: ${path}`)
  } catch {
    push('Error al exportar el CSV')
  } finally {
    exporting.value = false
  }
}

function formatDate(value: string): string {
  const d = new Date(value)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

onMounted(() => search(1))
</script>

<template>
  <section class="view">
    <h2>Registros</h2>

    <form class="filters" @submit.prevent="search(1)">
      <label>
        Estación
        <select v-model="form.stationId">
          <option value="">Todas</option>
          <option v-for="n in 8" :key="n" :value="String(n)">{{ n }}</option>
        </select>
      </label>
      <label>
        Modelo
        <input v-model="form.modelId" type="text" placeholder="modelId" />
      </label>
      <label>
        Tooling
        <input v-model="form.toolingId" type="text" placeholder="toolingId" />
      </label>
      <label>
        Matriz
        <input v-model="form.matrixReaded" type="text" placeholder="matrixReaded" />
      </label>
      <label>
        Desde
        <input v-model="form.startDate" type="datetime-local" />
      </label>
      <label>
        Hasta
        <input v-model="form.endDate" type="datetime-local" />
      </label>
      <div class="actions">
        <button type="submit" :disabled="loading">Buscar</button>
        <button type="button" class="secondary" :disabled="exporting" @click="exportCsv">
          {{ exporting ? 'Exportando…' : 'Exportar CSV' }}
        </button>
      </div>
    </form>

    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>id</th>
            <th>stationId</th>
            <th>modelId</th>
            <th>toolingId</th>
            <th>matrixReaded</th>
            <th>status</th>
            <th>finalLeakRate</th>
            <th>finalPressure</th>
            <th>createdAt</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="record in records" :key="record.id">
            <td>{{ record.id }}</td>
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
            <td>{{ formatDate(record.createdAt) }}</td>
          </tr>
          <tr v-if="records.length === 0">
            <td colspan="9" class="empty">Sin registros</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button :disabled="page <= 1 || loading" @click="search(page - 1)">Anterior</button>
      <span>Página {{ page }} de {{ totalPages }} ({{ total }} registros)</span>
      <button :disabled="page >= totalPages || loading" @click="search(page + 1)">Siguiente</button>
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

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  background: #ffffff;
  border: 1px solid #d8e2ec;
  border-radius: 8px;
  padding: 12px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  color: #40566c;
}

input,
select {
  font-size: 14px;
  padding: 6px 8px;
  border: 1px solid #c3d2e0;
  border-radius: 6px;
  background: #fbfdff;
  color: #24394e;
}

.actions {
  display: flex;
  gap: 8px;
}

button {
  font-size: 14px;
  padding: 7px 16px;
  border: none;
  border-radius: 6px;
  background: #5ea3e0;
  color: #ffffff;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #3f8fd2;
}

button:disabled {
  opacity: 0.6;
  cursor: default;
}

button.secondary {
  background: #ffffff;
  color: #3f8fd2;
  border: 1px solid #5ea3e0;
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

.pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: center;
  font-size: 14px;
  color: #40566c;
}
</style>
