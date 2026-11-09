"use client";

import React from "react";
import GlobalQuantDeskView from "@/components/forex/GlobalQuantDeskView";

export default function ForexRootPage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
      <GlobalQuantDeskView />
    </div>
  );
}

