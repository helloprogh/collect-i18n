<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const showDialog = ref(false)

function confirmAndNotify() {
  ElMessage.success(t('dictionary.message'))
  showDialog.value = false
}
</script>

<template>
  <div class="page">
    <h2>{{ t('dictionary.title') }}</h2>
    <p class="subtitle">{{ t('dictionary.subtitle') }}</p>
    <p class="desc">{{ t('dictionary.description') }}</p>
    <div class="grid">
      <section class="card">
        <h3>{{ t('dictionary.sections.s01.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s01.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s01.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s01.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s01.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s01.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s02.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s02.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s02.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s02.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s02.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s02.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s03.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s03.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s03.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s03.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s03.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s03.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s04.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s04.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s04.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s04.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s04.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s04.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s05.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s05.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s05.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s05.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s05.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s05.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s06.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s06.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s06.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s06.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s06.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s06.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s07.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s07.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s07.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s07.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s07.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s07.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s08.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s08.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s08.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s08.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s08.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s08.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s09.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s09.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s09.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s09.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s09.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s09.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s10.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s10.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s10.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s10.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s10.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s10.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s11.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s11.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s11.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s11.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s11.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s11.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s12.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s12.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s12.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s12.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s12.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s12.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s13.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s13.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s13.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s13.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s13.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s13.items.i05') }}</li>
        </ul>
      </section>
      <section class="card">
        <h3>{{ t('dictionary.sections.s14.header') }}</h3>
        <ul>
          <li>{{ t('dictionary.sections.s14.items.i01') }}</li>
          <li>{{ t('dictionary.sections.s14.items.i02') }}</li>
          <li>{{ t('dictionary.sections.s14.items.i03') }}</li>
          <li>{{ t('dictionary.sections.s14.items.i04') }}</li>
          <li>{{ t('dictionary.sections.s14.items.i05') }}</li>
        </ul>
      </section>
    </div>
    <div class="actions">
      <el-button type="primary" data-testid="open-dialog" @click="showDialog = true">{{ t('dictionary.dialog.title') }}</el-button>
    </div>
    <el-dialog v-model="showDialog" :title="t('dictionary.dialog.title')" width="520">
      <p>{{ t('dictionary.dialog.body') }}</p>
      <template #footer>
        <el-button data-testid="dialog-confirm" @click="confirmAndNotify">{{ t('dictionary.dialog.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>
