<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showDialog = ref(false)

function confirmAndNotify() {
  ElMessage.success(t('dashboard.message'))
  showDialog.value = false
}
</script>

<template>
  <div class="page">
    <h2>{{ t('dashboard.title') }}</h2>
    <p class="subtitle">{{ t('dashboard.subtitle') }}</p>
    <p class="desc">{{ t('dashboard.description') }}</p>
    <div class="grid">
      <section class="card">
        <h3>{{ t('dashboard.sections.s01.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s01.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s01.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s01.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s01.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s01.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s02.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s02.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s02.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s02.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s02.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s02.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s03.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s03.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s03.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s03.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s03.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s03.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s04.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s04.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s04.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s04.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s04.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s04.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s05.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s05.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s05.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s05.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s05.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s05.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s06.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s06.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s06.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s06.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s06.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s06.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s07.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s07.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s07.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s07.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s07.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s07.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s08.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s08.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s08.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s08.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s08.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s08.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s09.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s09.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s09.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s09.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s09.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s09.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s10.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s10.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s10.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s10.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s10.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s10.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s11.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s11.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s11.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s11.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s11.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s11.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s12.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s12.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s12.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s12.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s12.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s12.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s13.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s13.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s13.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s13.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s13.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s13.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dashboard.sections.s14.header') }}</h3>
        <ul>
          <li>{{ t('dashboard.sections.s14.items.i01') }}</li>
          <li>{{ t('dashboard.sections.s14.items.i02') }}</li>
          <li>{{ t('dashboard.sections.s14.items.i03') }}</li>
          <li>{{ t('dashboard.sections.s14.items.i04') }}</li>
          <li>{{ t('dashboard.sections.s14.items.i05') }}</li>
        </ul>
      </section>
    </div>
    <div class="actions">
      <el-button type="primary" data-testid="open-dialog" @click="showDialog = true">{{ t('dashboard.dialog.title') }}</el-button>
    </div>
    <el-dialog v-model="showDialog" :title="t('dashboard.dialog.title')" width="520">
      <p>{{ t('dashboard.dialog.body') }}</p>
      <template #footer>
        <el-button data-testid="dialog-confirm" @click="confirmAndNotify">{{ t('dashboard.dialog.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>
