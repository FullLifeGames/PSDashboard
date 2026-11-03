import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { simFastLevers } from './lib/eval/sim-fast-setting'
import { searchBudgetStamp } from './lib/eval/search-budget-setting'
import { installStaleChunkReloadOnWindow } from './lib/stale-chunk-reload'
import { startUiScale } from './lib/ui-scale-store'

// Round 81 (T298): a lazy chunk a deploy removed reloads the page once
installStaleChunkReloadOnWindow()
// Round 84 (T315): the app's size, Auto or the stored step, on the root before the first paint; it follows the window from here
startUiScale()
// Round 59: the speed layer's override configures the main thread's engine too
simFastLevers()
// Round 61: the search budget's switch configures the main thread too
searchBudgetStamp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
