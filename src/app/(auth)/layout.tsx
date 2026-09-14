export default function AuthLayout({ children }: LayoutProps<"/">) {
  return <main className="grid min-h-dvh place-items-center bg-bg p-4">{children}</main>;
}
