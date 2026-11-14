// A flex row, not the sign-in grid: in an `auto` grid track a wide card sets the track, and on a
// phone the text would reach past the window. Here the card is at most as wide as the row.
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return <main className="flex min-h-dvh items-center justify-center bg-bg p-4">{children}</main>;
}
