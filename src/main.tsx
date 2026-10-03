import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { simFastLevers } from './lib/eval/sim-fast-setting'
import { searchBudgetStamp } from './lib/eval/search-budget-setting'

// Round 59: the speed layer's override configures the main thread's engine too
simFastLevers()
// Round 61: the search budget's switch configures the main thread too
searchBudgetStamp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
