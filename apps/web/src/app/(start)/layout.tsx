/** The first start (R5a): a page of its own, outside the shell, before the person has a menu. */
export default function StartLayout({ children }: LayoutProps<"/">) {
  return <main className="grid min-h-dvh place-items-center bg-bg p-4">{children}</main>;
}
