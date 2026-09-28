import { T } from './checklistModulos';

interface Props { progress: number; doneCount: number; total: number }

// Topbar sticky de ChecklistPage — JSX y estilos copiados tal cual (el h1
// debe seguir siendo hijo directo de este div: el arnés visual lo usa).
export default function ChecklistTopbar({ progress, doneCount, total }: Props) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 10,
      background: T.card, borderBottom: `1px solid ${T.border}`,
      height: 72, padding: '0 32px', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, color: T.text, margin: 0, letterSpacing: '-0.02em' }}>
        Check-List
      </h1>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: progress === 100 ? T.successSoft : T.primarySoft,
        border: `1px solid ${progress === 100 ? T.successBorder : T.primaryBorder}`,
        borderRadius: 9999, padding: '6px 14px',
      }}>
        <span style={{ width: 96, height: 4, background: T.border, borderRadius: 2, overflow: 'hidden', display: 'inline-block' }}>
          <span style={{ width: `${progress}%`, height: '100%', background: progress === 100 ? T.success : T.primary, borderRadius: 2, display: 'block', transition: 'width 0.3s' }} />
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: progress === 100 ? T.success : T.primary, whiteSpace: 'nowrap' }}>
          {doneCount}/{total} · {progress}%
        </span>
      </div>
    </div>
  );
}
