import "./globals.css";

export const metadata = {
  title: "Celia — ابنِ وأطلق بفكرة واحدة",
  description: "واجهة Celia Agent: محادثة ذكية وشريط مرئي لمتابعة خطوات التنفيذ والتكاملات.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
