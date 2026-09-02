/** The red inline alert used by the loader and the sets dialog. */
export function AlertBox({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      role="alert"
      style={{
        color: '#f3a6a6',
        background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.25)',
        borderRadius: 4,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
