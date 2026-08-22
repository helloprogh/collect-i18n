import { createApp } from "vue";
import {
  ElAlert,
  ElButton,
  ElEmpty,
  ElInput,
  ElInputNumber,
  ElOption,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
} from "element-plus";
import "element-plus/dist/index.css";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);
for (const component of [
  ElAlert,
  ElButton,
  ElEmpty,
  ElInput,
  ElInputNumber,
  ElOption,
  ElProgress,
  ElSelect,
  ElSwitch,
  ElTable,
  ElTableColumn,
  ElTag,
]) app.use(component);
app.mount("#app");
