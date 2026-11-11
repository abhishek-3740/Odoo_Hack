import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'

import { Providers } from './app/Providers'
import { router } from './app/router'
import './styles/theme.css'

const container = document.getElementById('root')
if (!container) throw new Error('The #root element is missing from index.html.')

// The prerendered marketing HTML is a crawlable fallback, not hydration input —
// React owns the tree from here, so the static copy is cleared before mounting.
container.replaceChildren()

createRoot(container).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
)
