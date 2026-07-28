import { createSSRApp } from 'vue'
import HundredChart from '../views/HundredChart.vue'

const app = createSSRApp(HundredChart)
app.mount('#app', true)
