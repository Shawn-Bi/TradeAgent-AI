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
  const Screen = SCREENS[flow.step]
  const version = flow.approved?.spec.version ?? (flow.gen.status === 'ready' ? flow.gen.data.strategy.version : null)

  return (
    <div className="ta-gridground min-h-screen">
      <DemoBanner />
      <header className="ta-wrap">
        <div className="ta-hdr">
          <div className="ta-brand">
            TradeAgent AI<span>Your trading rules, written out, approved and audited.</span>
          </div>
          {version !== null && (
            <StatusPill
              value={`${flow.approved ? 'APPROVED' : 'DRAFT'} · v${version}`}
              tone={flow.approved ? 'approved' : 'draft'}
            />
          )}
        </div>
        <WizardSteps current={flow.step} reached={flow.reached} onGo={flow.go} />
      </header>
      <main className="ta-wrap py-8">
        <Screen flow={flow} />
      </main>
      <footer className="ta-wrap ta-footer ta-stack">
        <Glossary />
        <span>
          Educational prototype. The engine replays synthetic sessions with mock fills; no real market data and no real
          orders. Futures involve substantial risk; this is not financial advice.
        </span>
      </footer>
    </div>
  )
}
