"use client";

import { Header } from "@/components/Header";
import { StatusBar } from "@/components/StatusBar";
import { AttackSimulator } from "@/components/AttackSimulator";

export default function Home() {
  return (
    <div className="min-h-screen pb-8">
      <Header />

      {/* Scanline overlay */}
      <div className="fixed inset-0 scanline z-40 pointer-events-none" />

      <main className="max-w-[1600px] mx-auto px-4 pt-6 pb-12">
        <AttackSimulator />
      </main>

      <StatusBar />
    </div>
  );
}
