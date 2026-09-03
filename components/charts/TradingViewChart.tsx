"use client";

import React, { useEffect, useRef, memo } from "react";

interface TradingViewChartProps {
  symbol: string;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

function TradingViewChartComponent({ symbol }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const containerId = `tv_chart_${Math.random().toString(36).substring(7)}`;
    if (containerRef.current) {
      containerRef.current.id = containerId;
    }

    let tvWidget: any = null;

    const initWidget = () => {
      if (typeof window.TradingView !== "undefined" && containerRef.current) {
        tvWidget = new window.TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: "15",
          timezone: "Etc/UTC",
          theme: "dark",
          style: "1",
          locale: "en",
          enable_publishing: false,
          backgroundColor: "#090d16",
          gridColor: "#1e293b",
          hide_top_toolbar: false,
          hide_legend: false,
          save_image: false,
          container_id: containerId,
          toolbar_bg: "#0d1322",
        });
      }
    };

    if (document.getElementById("tradingview-widget-script")) {
      initWidget();
    } else {
      const script = document.createElement("script");
      script.id = "tradingview-widget-script";
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      if (tvWidget && typeof tvWidget.remove === "function") {
        try {
          tvWidget.remove();
        } catch {
          // Ignore parentNode cleanup errors
        }
      }
    };
  }, [symbol]);

  return (
    <div className="w-full h-full relative border border-slate-800/80 rounded-2xl overflow-hidden bg-[#090d16]">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

export const TradingViewChart = memo(TradingViewChartComponent);
