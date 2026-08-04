<script setup lang="ts">
import { usePlcStatus } from '../composables/usePlcStatus'
import type { PlcConnectionStatus } from '../types'

const { plcStatuses } = usePlcStatus()

const STATUS_LABEL: Record<PlcConnectionStatus, string> = {
  conectado: 'CONECTADO',
  desconectado: 'DESCONECTADO',
  reconectando: 'RECONECTANDO'
}
</script>

<template>
  <div class="plc-status">
    <div v-for="plc in plcStatuses" :key="plc.ip" class="chip">
      <span class="dot" :class="plc.status" />
      <span class="ip">PLC {{ plc.ip }}</span>
      <span class="state">{{ STATUS_LABEL[plc.status] }}</span>
    </div>
  </div>
</template>

<style scoped>
.plc-status {
  margin-left: auto;
  display: flex;
  gap: 8px;
  align-items: center;
}

.chip {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 11px;
  border: 1px solid #d8e2ec;
  border-radius: 999px;
  background: #ffffff;
  font-size: 13px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot.conectado {
  background: #1e7a34;
  box-shadow: 0 0 0 3px rgb(30 122 52 / 18%);
}

.dot.desconectado {
  background: #b32020;
  box-shadow: 0 0 0 3px rgb(179 32 32 / 18%);
}

.dot.reconectando {
  background: #e8930c;
  box-shadow: 0 0 0 3px rgb(232 147 12 / 18%);
}

.ip {
  color: #40566c;
  font-weight: 600;
}

.state {
  color: #7a8a99;
}
</style>
