/** A share bar: one segment per account, widths proportional to their balances. */
export function CompositionBar({
  parts,
}: {
  parts: readonly { label: string; share: number; color: string }[];
}) {
  return (
    <div aria-hidden className="flex h-2.5 overflow-hidden rounded-tag bg-track">
      {parts.map((part) => (
        <div
          key={part.label}
          title={part.label}
          style={{ width: `${(part.share * 100).toFixed(2)}%`, background: part.color }}
        />
      ))}
    </div>
  );
}
