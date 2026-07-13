import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import "../index.css";
import Providers from "@/components/providers";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

export const metadata: Metadata = {
	description: "小红书内容生成与发布工作台",
	icons: {
		icon: [{ type: "image/svg+xml", url: "/mercury-mark.svg" }],
		shortcut: "/mercury-mark.svg",
	},
	title: "Mercury · 小红书发布台",
};

export const viewport: Viewport = {
	themeColor: [
		{ color: "#f5f7fa", media: "(prefers-color-scheme: light)" },
		{ color: "#17191f", media: "(prefers-color-scheme: dark)" },
	],
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="zh-CN" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<Providers>
					<a
						className="sr-only rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
						href="#main-content"
					>
						跳到主要内容
					</a>
					{children}
				</Providers>
			</body>
		</html>
	);
}
