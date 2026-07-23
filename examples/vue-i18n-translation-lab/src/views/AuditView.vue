<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showDialog = ref(false)

function confirmAndNotify() {
  ElMessage.success(t('audit.message'))
  showDialog.value = false
}
</script>

<template>
  <div class="page">
    <h2>{{ t('audit.title') }}</h2>
    <p class="subtitle">{{ t('audit.subtitle') }}</p>
    <p class="desc">{{ t('audit.description') }}</p>
    <div class="grid">
      <section class="card">
        <h3>{{ t('audit.sections.s01.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s01.items.i01') }}</li>
          <li>{{ t('audit.sections.s01.items.i02') }}</li>
          <li>{{ t('audit.sections.s01.items.i03') }}</li>
          <li>{{ t('audit.sections.s01.items.i04') }}</li>
          <li>{{ t('audit.sections.s01.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s02.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s02.items.i01') }}</li>
          <li>{{ t('audit.sections.s02.items.i02') }}</li>
          <li>{{ t('audit.sections.s02.items.i03') }}</li>
          <li>{{ t('audit.sections.s02.items.i04') }}</li>
          <li>{{ t('audit.sections.s02.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s03.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s03.items.i01') }}</li>
          <li>{{ t('audit.sections.s03.items.i02') }}</li>
          <li>{{ t('audit.sections.s03.items.i03') }}</li>
          <li>{{ t('audit.sections.s03.items.i04') }}</li>
          <li>{{ t('audit.sections.s03.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s04.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s04.items.i01') }}</li>
          <li>{{ t('audit.sections.s04.items.i02') }}</li>
          <li>{{ t('audit.sections.s04.items.i03') }}</li>
          <li>{{ t('audit.sections.s04.items.i04') }}</li>
          <li>{{ t('audit.sections.s04.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s05.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s05.items.i01') }}</li>
          <li>{{ t('audit.sections.s05.items.i02') }}</li>
          <li>{{ t('audit.sections.s05.items.i03') }}</li>
          <li>{{ t('audit.sections.s05.items.i04') }}</li>
          <li>{{ t('audit.sections.s05.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s06.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s06.items.i01') }}</li>
          <li>{{ t('audit.sections.s06.items.i02') }}</li>
          <li>{{ t('audit.sections.s06.items.i03') }}</li>
          <li>{{ t('audit.sections.s06.items.i04') }}</li>
          <li>{{ t('audit.sections.s06.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s07.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s07.items.i01') }}</li>
          <li>{{ t('audit.sections.s07.items.i02') }}</li>
          <li>{{ t('audit.sections.s07.items.i03') }}</li>
          <li>{{ t('audit.sections.s07.items.i04') }}</li>
          <li>{{ t('audit.sections.s07.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s08.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s08.items.i01') }}</li>
          <li>{{ t('audit.sections.s08.items.i02') }}</li>
          <li>{{ t('audit.sections.s08.items.i03') }}</li>
          <li>{{ t('audit.sections.s08.items.i04') }}</li>
          <li>{{ t('audit.sections.s08.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s09.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s09.items.i01') }}</li>
          <li>{{ t('audit.sections.s09.items.i02') }}</li>
          <li>{{ t('audit.sections.s09.items.i03') }}</li>
          <li>{{ t('audit.sections.s09.items.i04') }}</li>
          <li>{{ t('audit.sections.s09.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s10.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s10.items.i01') }}</li>
          <li>{{ t('audit.sections.s10.items.i02') }}</li>
          <li>{{ t('audit.sections.s10.items.i03') }}</li>
          <li>{{ t('audit.sections.s10.items.i04') }}</li>
          <li>{{ t('audit.sections.s10.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s11.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s11.items.i01') }}</li>
          <li>{{ t('audit.sections.s11.items.i02') }}</li>
          <li>{{ t('audit.sections.s11.items.i03') }}</li>
          <li>{{ t('audit.sections.s11.items.i04') }}</li>
          <li>{{ t('audit.sections.s11.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s12.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s12.items.i01') }}</li>
          <li>{{ t('audit.sections.s12.items.i02') }}</li>
          <li>{{ t('audit.sections.s12.items.i03') }}</li>
          <li>{{ t('audit.sections.s12.items.i04') }}</li>
          <li>{{ t('audit.sections.s12.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s13.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s13.items.i01') }}</li>
          <li>{{ t('audit.sections.s13.items.i02') }}</li>
          <li>{{ t('audit.sections.s13.items.i03') }}</li>
          <li>{{ t('audit.sections.s13.items.i04') }}</li>
          <li>{{ t('audit.sections.s13.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('audit.sections.s14.header') }}</h3>
        <ul>
          <li>{{ t('audit.sections.s14.items.i01') }}</li>
          <li>{{ t('audit.sections.s14.items.i02') }}</li>
          <li>{{ t('audit.sections.s14.items.i03') }}</li>
          <li>{{ t('audit.sections.s14.items.i04') }}</li>
          <li>{{ t('audit.sections.s14.items.i05') }}</li>
        </ul>
      </section>
    </div>
    <div class="actions">
      <el-button type="primary" data-testid="open-dialog" @click="showDialog = true">{{ t('audit.dialog.title') }}</el-button>
    </div>
    <el-dialog v-model="showDialog" :title="t('audit.dialog.title')" width="520">
      <p>{{ t('audit.dialog.body') }}</p>
      <template #footer>
        <el-button data-testid="dialog-confirm" @click="confirmAndNotify">{{ t('audit.dialog.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>
