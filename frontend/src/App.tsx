import { useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DemoBanner } from './components/DemoBanner'
import { Glossary } from './components/Glossary'
import { StatusPill } from './components/StatusPill'
import { WizardSteps } from './components/WizardSteps'
import { useFlow } from './flow/useFlow'
import { ApproveStep } from './screens/ApproveStep'
import { AuditStep } from './screens/AuditStep'
import { GenerateStep } from './screens/GenerateStep'
import { PresetStep } from './screens/PresetStep'
import { ScenarioStep } from './screens/ScenarioStep'
import { SimulateStep } from './screens/SimulateStep'

const SCREENS = [PresetStep, GenerateStep, ApproveStep, ScenarioStep, SimulateStep, AuditStep]

export default function App() {
  const flow = useFlow()
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const Screen = SCREENS[flow.step]
  const version = flow.approved?.spec.version ?? (flow.gen.status === 'ready' ? flow.gen.data.strategy.version : null)

  const openGlossary = () => {
    setGlossaryOpen(true)
    requestAnimationFrame(() => document.getElementById('glossary')?.scrollIntoView({ behavior: 'smooth' }))
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="ta-gridground min-h-screen">
        <DemoBanner />
        <header className="ta-wrap">
          <div className="ta-hdr">
            <div className="ta-brand">
              TradeAgent AI<span>Your trading rules, written out, approved and audited.</span>
            </div>
            <div className="ta-row">
              <Button variant="ghost" onClick={openGlossary}>
                <CircleHelp data-icon="inline-start" />
                Labels explained
              </Button>
              {version !== null && (
                <StatusPill
                  value={`${flow.approved ? 'APPROVED' : 'DRAFT'} · v${version}`}
                  tone={flow.approved ? 'approved' : 'draft'}
                />
              )}
            </div>
          </div>
          <WizardSteps current={flow.step} reached={flow.reached} onGo={flow.go} />
        </header>
        <main className="ta-wrap py-8">
          <Screen flow={flow} />
        </main>
        <footer className="ta-wrap ta-footer ta-stack">
          <Glossary open={glossaryOpen} onOpenChange={setGlossaryOpen} />
          <span>
            Educational prototype. The engine replays synthetic sessions with mock fills; no real market data and no
            real orders. Futures involve substantial risk; this is not financial advice.
          </span>
        </footer>
      </div>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
