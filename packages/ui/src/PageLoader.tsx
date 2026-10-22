import { COLORS } from './theme';

const LOADER_CSS = `
@keyframes cc-spin { to { transform: rotate(360deg); } }
@keyframes cc-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
@keyframes cc-reveal { from { opacity: 0; } to { opacity: 1; } }
`;

/**
 * The full-screen loader, as on CoreStock: a spinning ring over the product
 * name and a thin running bar along the foot, in the CoreCheck blue.
 * `slowHint` fades in after a few seconds, for waits on a cold server.
 */
export const PageLoader = ({
  label = 'CoreCheck',
  slowHint,
}: {
  label?: string;
  slowHint?: string;
}) => (
  <div
    role="status"
    aria-live="polite"
    style={{
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      backgroundColor: 'white',
    }}
  >
    <style>{LOADER_CSS}</style>
    <div
      aria-hidden
      style={{
        width: 48,
        height: 48,
        borderRadius: '50%',
        border: `2px solid ${COLORS.title}`,
        borderTopColor: 'var(--mantine-color-brand-5)',
        borderLeftColor: 'var(--mantine-color-brand-5)',
        animation: 'cc-spin 0.8s linear infinite',
      }}
    />
    <span
      style={{
        fontSize: 18,
        fontWeight: 700,
        color: COLORS.secondaryText,
      }}
    >
      {label}
      <span style={{ position: 'absolute', left: -9999 }}>Loading…</span>
    </span>
    {slowHint && (
      <span
        style={{
          maxWidth: 360,
          padding: '0 16px',
          textAlign: 'center',
          fontSize: 14,
          color: COLORS.secondaryText,
          animation: 'cc-reveal 0.4s ease-out 3s both',
        }}
      >
        {slowHint}
      </span>
    )}
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: '100%',
        height: 4,
        overflow: 'hidden',
        backgroundColor: COLORS.border,
      }}
    >
      <div
        style={{
          width: '25%',
          height: '100%',
          backgroundColor: 'var(--mantine-color-brand-5)',
          animation: 'cc-shimmer 2s linear infinite',
        }}
      />
    </div>
  </div>
);
