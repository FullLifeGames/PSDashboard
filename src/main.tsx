import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { simFastLevers } from './lib/eval/sim-fast-setting'
import { searchBudgetStamp } from './lib/eval/search-budget-setting'
import { installStaleChunkReloadOnWindow } from './lib/stale-chunk-reload'
import { startUiScale } from './lib/ui-scale-store'
import { startTeambuilderTablePart } from './lib/teambuilder-table'

installStaleChunkReloadOnWindow()
// The app's size goes on the root before the first paint; the store follows the window from here
startUiScale()
simFastLevers()
searchBudgetStamp()
startTeambuilderTablePart()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
