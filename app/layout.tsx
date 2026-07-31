import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") || "https";
  const metadataBase = host ? new URL(`${protocol}://${host}`) : undefined;

  return {
    metadataBase,
    title: "Private Media Archive",
    description:
      "本地记录书籍、电影及电视剧、动漫、综艺的进度、平台、评分和感想。",
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      title: "Private Media Archive",
      description: "书影音进度、平台、评分、感想与统计。",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Private Media Archive",
      description: "书影音进度、平台、评分、感想与统计。",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
