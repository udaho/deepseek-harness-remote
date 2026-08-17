import { createRoot } from 'react-dom/client'
import { App } from './views/App.tsx'
import { css } from './styles.ts'

const style = document.createElement('style')
style.dataset.plugin = 'harness-remote/mobile'
style.textContent = css
document.head.appendChild(style)
const root = document.getElementById('root')
if (!root) throw new Error('Harness Remote mobile root is missing')
createRoot(root).render(<App />)
