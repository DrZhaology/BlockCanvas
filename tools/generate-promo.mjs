import fs from 'fs';
import path from 'path';

const imagesJsonPath = 'E:/Develop/promo-assets/images-base64.json';
const images = JSON.parse(fs.readFileSync(imagesJsonPath, 'utf8'));
const iconBase64 = 'data:image/png;base64,' + fs.readFileSync('E:/Develop/BlockCanvas/build/icon.png').toString('base64');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BlockCanvas · 积木画布 — 零基础专业静态网页构建工具</title>
  <link rel="icon" type="image/png" href="${iconBase64}" />
  <style>
    /* ==========================================================================
       1. DESIGN SYSTEM & CSS VARIABLES (Dark Cyberpunk / Titanium Dark Mode)
       ========================================================================== */
    :root {
      --bg-main: #0a0b0e;
      --bg-surface: #12141a;
      --bg-panel: #181a22;
      --bg-card: #1d202b;
      --bg-card-hover: #262a38;
      --border-light: rgba(255, 255, 255, 0.08);
      --border-focus: rgba(59, 130, 246, 0.5);
      --border-glow: rgba(59, 130, 246, 0.3);

      --text-main: #f3f4f6;
      --text-sub: #9ca3af;
      --text-muted: #6b7280;

      --blue: #3b82f6;
      --blue-light: #60a5fa;
      --cyan: #06b6d4;
      --purple: #8b5cf6;
      --orange: #f97316;
      --emerald: #10b981;
      --amber: #f59e0b;

      --logo-css: #2965f1;
      --logo-html: #e34f26;
      --logo-js: #f7df1e;

      --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
      --font-code: "JetBrains Mono", Consolas, Monaco, "Courier New", monospace;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      background-color: var(--bg-main);
      color: var(--text-main);
      font-family: var(--font-ui);
      scroll-behavior: smooth;
      color-scheme: dark;
      overflow-x: hidden;
    }

    body {
      background: radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.14) 0%, transparent 55%),
                  radial-gradient(circle at 90% 40%, rgba(139, 92, 246, 0.09) 0%, transparent 45%),
                  radial-gradient(circle at 10% 70%, rgba(6, 182, 212, 0.08) 0%, transparent 45%),
                  var(--bg-main);
      background-attachment: fixed;
      min-height: 100vh;
      line-height: 1.6;
      overflow-x: hidden;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #0c0d11; }
    ::-webkit-scrollbar-thumb { background: #252834; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #393d4e; }

    /* Background Ambient Grids & Lights */
    .ambient-grid {
      position: fixed;
      inset: 0;
      background-image: 
        linear-gradient(to right, rgba(255, 255, 255, 0.025) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
      background-size: 50px 50px;
      pointer-events: none;
      z-index: 0;
      mask-image: radial-gradient(circle at 50% 50%, black 40%, transparent 95%);
    }

    .ambient-orb {
      position: fixed;
      border-radius: 50%;
      filter: blur(120px);
      pointer-events: none;
      z-index: 0;
      opacity: 0.45;
    }
    .orb-1 { width: 500px; height: 500px; background: rgba(59, 130, 246, 0.16); top: 5%; left: 50%; transform: translateX(-50%); }
    .orb-2 { width: 400px; height: 400px; background: rgba(139, 92, 246, 0.14); top: 45%; right: 5%; }
    .orb-3 { width: 450px; height: 450px; background: rgba(6, 182, 212, 0.12); bottom: 10%; left: 5%; }

    /* ==========================================================================
       2. TOP NAVIGATION DOCK
       ========================================================================== */
    .top-dock {
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 8px 18px;
      background: rgba(18, 20, 26, 0.78);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-light);
      border-radius: 999px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.1);
      transition: all 0.3s ease;
    }
    .top-dock:hover {
      border-color: rgba(255, 255, 255, 0.18);
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
    }

    .brand-link {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #ffffff;
      font-weight: 700;
      font-size: 15px;
    }
    .brand-logo-img {
      width: 24px;
      height: 24px;
      display: block;
    }

    .nav-menu {
      display: flex;
      align-items: center;
      gap: 16px;
      list-style: none;
    }
    .nav-menu li a {
      color: var(--text-sub);
      text-decoration: none;
      font-size: 13.5px;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.2s ease;
    }
    .nav-menu li a:hover {
      color: #fff;
    }

    .btn-gh-badge {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      background: linear-gradient(135deg, #242735 0%, #1a1c24 100%);
      color: #fff;
      text-decoration: none;
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12.5px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.12);
      transition: all 0.2s ease;
    }
    .btn-gh-badge:hover {
      background: linear-gradient(135deg, #32374b 0%, #222533 100%);
      border-color: rgba(59, 130, 246, 0.5);
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
      transform: translateY(-1px);
    }
    .btn-gh-badge svg {
      width: 15px;
      height: 15px;
      fill: currentColor;
    }

    /* Right Floating HUD Progress Dots */
    .hud-track {
      position: fixed;
      right: 24px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 999;
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: rgba(18, 20, 26, 0.7);
      backdrop-filter: blur(12px);
      padding: 14px 10px;
      border-radius: 999px;
      border: 1px solid var(--border-light);
    }
    .hud-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      cursor: pointer;
      position: relative;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .hud-dot:hover {
      background: rgba(255, 255, 255, 0.6);
      transform: scale(1.3);
    }
    .hud-dot.active {
      background: var(--blue);
      box-shadow: 0 0 12px var(--blue);
      transform: scale(1.4);
    }
    .hud-dot .hud-tip {
      position: absolute;
      right: 26px;
      top: 50%;
      transform: translateY(-50%) translateX(10px);
      background: #181a22;
      border: 1px solid var(--border-light);
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 6px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: all 0.2s ease;
    }
    .hud-dot:hover .hud-tip {
      opacity: 1;
      transform: translateY(-50%) translateX(0);
    }

    /* ==========================================================================
       3. THE SCROLL-MORPH METAMORPHOSIS ENGINE
       ========================================================================== */
    .morph-track {
      position: relative;
      height: 520vh; /* Drives the 5 morphing stages */
      z-index: 10;
    }

    .morph-sticky-box {
      position: sticky;
      top: 0;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding-top: 50px;
    }

    /* Header text transitioning per stage */
    .stage-title-wrap {
      position: absolute;
      top: 85px;
      text-align: center;
      max-width: 860px;
      padding: 0 20px;
      z-index: 20;
      pointer-events: none;
    }
    .stage-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.5px;
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #93c5fd;
      margin-bottom: 10px;
      transition: all 0.4s ease;
    }
    .stage-headline {
      font-size: clamp(26px, 3.8vw, 44px);
      font-weight: 800;
      letter-spacing: -1px;
      line-height: 1.18;
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 8px;
      transition: all 0.4s ease;
    }
    .stage-sub {
      font-size: clamp(14px, 1.4vw, 16.5px);
      color: var(--text-sub);
      max-width: 660px;
      margin: 0 auto;
      line-height: 1.5;
      transition: all 0.4s ease;
    }

    /* Central Floating Morphing Viewport Window */
    .morph-stage-viewport {
      position: relative;
      width: min(92vw, 1140px);
      height: min(65vh, 640px);
      margin-top: 85px;
      perspective: 1200px;
      z-index: 15;
    }

    .morph-frame {
      position: absolute;
      inset: 0;
      background: #14161f;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05), 0 0 60px rgba(59, 130, 246, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-style: preserve-3d;
      transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Window Chrome */
    .window-header {
      height: 38px;
      background: #191c26;
      border-bottom: 1px solid var(--border-light);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 14px;
      user-select: none;
      flex-shrink: 0;
    }
    .win-dots {
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .dot {
      width: 11px;
      height: 11px;
      border-radius: 50%;
    }
    .dot-r { background: #ef4444; }
    .dot-y { background: #f59e0b; }
    .dot-g { background: #10b981; }

    .win-caption {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-sub);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .win-badge {
      font-size: 10.5px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 1px 7px;
      border-radius: 999px;
      font-weight: 600;
    }

    .win-tech-chips {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .chip {
      font-size: 10.5px;
      padding: 2px 7px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-muted);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    /* Inner Stage Content Layers */
    .win-body {
      position: relative;
      flex: 1;
      width: 100%;
      height: calc(100% - 38px);
      background: #0f1015;
      overflow: hidden;
    }

    .morph-layer {
      position: absolute;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      transform: scale(0.96) translateY(15px);
      transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1), transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      width: 100%;
      height: 100%;
    }
    .morph-layer.active {
      opacity: 1;
      pointer-events: auto;
      transform: scale(1) translateY(0);
    }

    .screen-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top left;
      display: block;
    }

    /* STAGE 2: Code Comparison Split Screen */
    .code-split-view {
      display: grid;
      grid-template-columns: 1fr 1fr;
      width: 100%;
      height: 100%;
      background: #0b0c10;
    }
    .code-panel {
      padding: 16px;
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .panel-bad {
      background: #130f11;
      border-right: 1px solid rgba(239, 68, 68, 0.2);
    }
    .panel-good {
      background: #0c141a;
      border-left: 1px solid rgba(16, 185, 129, 0.2);
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      margin-bottom: 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .tag-bad { color: #f87171; font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .tag-good { color: #34d399; font-weight: 700; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .code-content {
      font-family: var(--font-code);
      font-size: 12px;
      line-height: 1.6;
      color: #d1d5db;
      flex: 1;
      overflow-y: auto;
      white-space: pre;
    }
    .c-tag { color: #f43f5e; font-weight: 600; }
    .c-attr { color: #fbbf24; }
    .c-val { color: #34d399; }
    .c-cls { color: #60a5fa; font-weight: 600; }
    .c-comm { color: #6b7280; font-style: italic; }

    /* STAGE 3: Flex Layout & Inspector Sandbox */
    .flex-sandbox-view {
      display: flex;
      width: 100%;
      height: 100%;
      background: #12141a;
    }
    .flex-side-controls {
      width: 320px;
      background: #171a23;
      border-right: 1px solid var(--border-light);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .flex-side-preview {
      flex: 1;
      padding: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle, #1a1d26 10%, #101218 90%);
    }
    .interactive-stage-box {
      width: 100%;
      max-width: 480px;
      min-height: 240px;
      background: #1e222e;
      border: 2px dashed rgba(59, 130, 246, 0.4);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      flex-direction: row;
      justify-content: center;
      align-items: center;
      gap: 12px;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .box-block {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      padding: 16px 22px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
      cursor: pointer;
      transition: all 0.3s ease;
    }
    .box-block:hover {
      transform: translateY(-3px) scale(1.05);
      box-shadow: 0 8px 20px rgba(37, 99, 235, 0.5);
    }
    .seg-group {
      display: flex;
      background: #0e1016;
      border-radius: 8px;
      padding: 3px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .seg-item {
      flex: 1;
      text-align: center;
      padding: 6px 0;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-sub);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: none;
      background: transparent;
    }
    .seg-item.active {
      background: var(--blue);
      color: #fff;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.4);
    }

    /* Floating Orbiting Badges */
    .orbit-tag {
      position: absolute;
      background: rgba(24, 26, 34, 0.85);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-light);
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      z-index: 25;
      transition: transform 0.4s ease;
    }
    .orbit-css { top: -25px; left: -35px; border-left: 4px solid var(--logo-css); color: #93c5fd; }
    .orbit-html { bottom: -20px; right: -25px; border-left: 4px solid var(--logo-html); color: #fdba74; }
    .orbit-js { top: 45%; right: -55px; border-left: 4px solid var(--logo-js); color: #fef08a; }

    /* ==========================================================================
       4. SHOWCASE DEEP DIVE SECTIONS
       ========================================================================== */
    .main-wrap {
      position: relative;
      max-width: 1200px;
      margin: 0 auto;
      padding: 100px 24px;
      z-index: 10;
    }

    .sec-head {
      text-align: center;
      margin-bottom: 50px;
    }
    .sec-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--cyan);
      background: rgba(6, 182, 212, 0.1);
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid rgba(6, 182, 212, 0.3);
      margin-bottom: 12px;
    }
    .sec-title {
      font-size: clamp(30px, 3.5vw, 46px);
      font-weight: 800;
      letter-spacing: -1px;
      color: #fff;
      margin-bottom: 12px;
    }
    .sec-sub {
      font-size: 16.5px;
      color: var(--text-sub);
      max-width: 660px;
      margin: 0 auto;
    }

    /* 6 Pillars Cards Grid */
    .grid-pillars {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 24px;
    }
    .card-pillar {
      background: linear-gradient(180deg, rgba(28, 31, 41, 0.75) 0%, rgba(18, 20, 26, 0.75) 100%);
      border: 1px solid var(--border-light);
      border-radius: 18px;
      padding: 30px;
      backdrop-filter: blur(12px);
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }
    .card-pillar:hover {
      transform: translateY(-6px);
      border-color: rgba(59, 130, 246, 0.35);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.55), 0 0 30px rgba(59, 130, 246, 0.15);
    }
    .pillar-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: rgba(59, 130, 246, 0.12);
      border: 1px solid rgba(59, 130, 246, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      margin-bottom: 18px;
      color: #93c5fd;
    }
    .pillar-h { font-size: 19px; font-weight: 700; margin-bottom: 8px; color: #fff; }
    .pillar-p { font-size: 14.5px; color: var(--text-sub); line-height: 1.6; }

    /* Template Cards Showcase */
    .filter-tabs {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 36px;
      flex-wrap: wrap;
    }
    .tab-btn {
      padding: 7px 18px;
      border-radius: 999px;
      background: #171922;
      border: 1px solid var(--border-light);
      color: var(--text-sub);
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .tab-btn:hover, .tab-btn.active {
      background: var(--blue);
      border-color: var(--blue);
      color: #fff;
      box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35);
    }

    .grid-templates {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 26px;
    }
    .card-tpl {
      background: #161821;
      border: 1px solid var(--border-light);
      border-radius: 16px;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      display: flex;
      flex-direction: column;
    }
    .card-tpl:hover {
      transform: translateY(-6px);
      border-color: rgba(59, 130, 246, 0.4);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
    }
    .tpl-preview-box {
      width: 100%;
      height: 200px;
      background: #0d0e12;
      position: relative;
      overflow: hidden;
    }
    .tpl-preview-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      transition: transform 0.4s ease;
    }
    .card-tpl:hover .tpl-preview-box img {
      transform: scale(1.05);
    }
    .tpl-tag-float {
      position: absolute;
      top: 10px;
      left: 10px;
      background: rgba(18, 20, 26, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #93c5fd;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
    }
    .tpl-card-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .tpl-card-title { font-size: 17px; font-weight: 700; margin-bottom: 6px; color: #fff; }
    .tpl-card-desc { font-size: 13.5px; color: var(--text-sub); line-height: 1.5; margin-bottom: 16px; flex: 1; }
    .tpl-card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 12px;
    }
    .tpl-meta { font-size: 11.5px; color: var(--text-muted); font-family: var(--font-code); }
    .tpl-link { font-size: 12.5px; font-weight: 600; color: var(--blue-light); cursor: pointer; }

    /* Interactive Screenshot Gallery */
    .gallery-box {
      background: #14161f;
      border: 1px solid var(--border-light);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 70px rgba(0, 0, 0, 0.7);
    }
    .gallery-bar {
      display: flex;
      background: #1a1c26;
      border-bottom: 1px solid var(--border-light);
      overflow-x: auto;
      padding: 6px 10px;
      gap: 6px;
    }
    .g-btn {
      padding: 7px 14px;
      border-radius: 8px;
      background: transparent;
      border: none;
      color: var(--text-sub);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .g-btn:hover { background: #232734; color: #fff; }
    .g-btn.active {
      background: var(--blue);
      color: #fff;
      box-shadow: 0 2px 10px rgba(59, 130, 246, 0.4);
    }
    .gallery-view {
      position: relative;
      width: 100%;
      height: 580px;
      background: #090a0d;
    }
    .g-shot {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      opacity: 0;
      transition: opacity 0.35s ease;
    }
    .g-shot.active { opacity: 1; }

    /* CTA Section */
    .cta-hero {
      position: relative;
      background: radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.18) 0%, rgba(139, 92, 246, 0.08) 50%, transparent 80%),
                  #13151e;
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 24px;
      padding: 70px 30px;
      text-align: center;
      margin: 60px auto 100px;
      max-width: 1060px;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
    }
    .cta-logo-img { width: 64px; height: 64px; margin: 0 auto 18px; display: block; }
    .cta-h { font-size: clamp(30px, 3.8vw, 48px); font-weight: 800; letter-spacing: -1px; margin-bottom: 14px; color: #fff; }
    .cta-p { font-size: 17px; color: var(--text-sub); max-width: 600px; margin: 0 auto 30px; }
    .cta-actions {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 30px;
    }
    .btn-main {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
      padding: 13px 30px;
      border-radius: 999px;
      font-size: 15.5px;
      font-weight: 700;
      text-decoration: none;
      box-shadow: 0 10px 25px rgba(37, 99, 235, 0.4);
      transition: all 0.25s ease;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }
    .btn-main:hover {
      background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
      transform: translateY(-2px);
      box-shadow: 0 14px 35px rgba(37, 99, 235, 0.6);
    }
    .btn-sub {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #1e212c;
      color: #e5e7eb;
      padding: 13px 26px;
      border-radius: 999px;
      font-size: 14.5px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid var(--border-light);
      transition: all 0.25s ease;
    }
    .btn-sub:hover {
      background: #282d3c;
      color: #fff;
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }

    .term-box {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      background: #0a0b0e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      padding: 8px 16px;
      font-family: var(--font-code);
      font-size: 13px;
      color: #93c5fd;
      user-select: all;
    }
    .term-copy {
      background: #1c1f2b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #e5e7eb;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .term-copy:hover { background: #292e40; color: #fff; }

    /* Footer */
    footer {
      border-top: 1px solid var(--border-light);
      background: #090a0d;
      padding: 45px 20px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13.5px;
    }
    .foot-links {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-bottom: 14px;
      list-style: none;
    }
    .foot-links a { color: var(--text-sub); text-decoration: none; transition: color 0.2s; }
    .foot-links a:hover { color: #fff; }

    @media (max-width: 860px) {
      .nav-menu { display: none; }
      .hud-track { display: none; }
      .morph-stage-viewport { height: 50vh; }
      .code-split-view { grid-template-columns: 1fr; }
      .flex-sandbox-view { flex-direction: column; }
      .flex-side-controls { width: 100%; }
      .gallery-view { height: 350px; }
      .orbit-tag { display: none; }
    }
  </style>
</head>
<body>

  <!-- Ambient background elements -->
  <div class="ambient-grid"></div>
  <div class="ambient-orb orb-1"></div>
  <div class="ambient-orb orb-2"></div>
  <div class="ambient-orb orb-3"></div>

  <!-- Top Navigation Bar -->
  <header class="top-dock">
    <a href="#" class="brand-link">
      <img src="${iconBase64}" alt="BlockCanvas" class="brand-logo-img" />
      <span>BlockCanvas</span>
    </a>

    <ul class="nav-menu">
      <li><a onclick="jumpStage(0)">初心</a></li>
      <li><a onclick="jumpStage(1)">所见即所得</a></li>
      <li><a onclick="jumpStage(2)">纯净代码</a></li>
      <li><a onclick="jumpStage(3)">中文样式系统</a></li>
      <li><a onclick="jumpStage(4)">模板与便携</a></li>
      <li><a href="#templates-sec">模板库</a></li>
      <li><a href="#gallery-sec">真机截图</a></li>
    </ul>

    <a href="https://github.com/DrZhaology/BlockCanvas" target="_blank" rel="noopener noreferrer" class="btn-gh-badge">
      <svg viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
      <span>GitHub 源码</span>
    </a>
  </header>

  <!-- Right HUD Step Indicator -->
  <aside class="hud-track">
    <div class="hud-dot active" onclick="jumpStage(0)" data-i="0"><span class="hud-tip">01 初始 · 拒绝石山</span></div>
    <div class="hud-dot" onclick="jumpStage(1)" data-i="1"><span class="hud-tip">02 画布 · 所见即所得</span></div>
    <div class="hud-dot" onclick="jumpStage(2)" data-i="2"><span class="hud-tip">03 代码 · 手写级纯净</span></div>
    <div class="hud-dot" onclick="jumpStage(3)" data-i="3"><span class="hud-tip">04 属性 · 中文封装 Flex</span></div>
    <div class="hud-dot" onclick="jumpStage(4)" data-i="4"><span class="hud-tip">05 生态 · 模板与便携</span></div>
  </aside>

  <!-- =========================================================================
       SCROLL MORPHING METAMORPHOSIS TRACK
       ========================================================================= -->
  <section class="morph-track" id="morphTrack">
    <div class="morph-sticky-box">
      
      <!-- Stage Header Transitioning with Scroll -->
      <div class="stage-title-wrap">
        <div class="stage-pill" id="stagePill">
          <span>✨</span>
          <span id="stagePillText">阶段 01 / 桌面可视化网页工厂</span>
        </div>
        <h1 class="stage-headline" id="stageHeadline">让完全不懂代码的人，做出专业网页</h1>
        <p class="stage-sub" id="stageSub">
          像用画图软件一样拖拽搭建页面，导出纯净、语义化、手写级的 HTML / CSS。彻底告别传统可视化工具堆砌的 &lt;div&gt; 石山。
        </p>
      </div>

      <!-- Central Morphing Viewport Window -->
      <div class="morph-stage-viewport" id="morphViewport">
        
        <!-- Floating Orbiting Badges -->
        <div class="orbit-tag orbit-css" id="orbitCss">
          <span>🎨</span>
          <span>CSS 自动类名抽取 (.bc-s-*)</span>
        </div>
        <div class="orbit-tag orbit-html" id="orbitHtml">
          <span>🧱</span>
          <span>原生语义化 HTML5 标签</span>
        </div>
        <div class="orbit-tag orbit-js" id="orbitJs">
          <span>⚡</span>
          <span>便携单目录 · 0 依赖环境</span>
        </div>

        <div class="morph-frame" id="morphFrame">
          <!-- Window Header Bar -->
          <div class="window-header">
            <div class="win-dots">
              <span class="dot dot-r"></span>
              <span class="dot dot-y"></span>
              <span class="dot dot-g"></span>
            </div>
            <div class="win-caption">
              <span>BlockCanvas · 积木画布 0.3.1 (深色原生模式)</span>
              <span class="win-badge">便携就绪</span>
            </div>
            <div class="win-tech-chips">
              <span class="chip">Electron 33</span>
              <span class="chip">TypeScript 5.7</span>
              <span class="chip">React 18</span>
            </div>
          </div>

          <!-- Window Body Stage Layers -->
          <div class="win-body">
            
            <!-- STAGE 0: Initial Clean Dark Mode Workspace -->
            <div class="morph-layer active" id="layer0">
              <img src="${images['01-workspace-dark-empty.png']}" alt="初始深色工作台" class="screen-img" />
            </div>

            <!-- STAGE 1: WYSIWYG Flow Canvas Assembling Live -->
            <div class="morph-layer" id="layer1">
              <img src="${images['03-workspace-hero-dark.png']}" alt="画布构建" class="screen-img" />
            </div>

            <!-- STAGE 2: Clean Semantic HTML5 vs Div-Soup Code Generator -->
            <div class="morph-layer" id="layer2">
              <div class="code-split-view">
                <div class="code-panel panel-bad">
                  <div class="panel-head">
                    <div class="tag-bad">
                      <span>✕</span>
                      <span>传统工具生成的 &lt;div&gt; 石山 (无法维护)</span>
                    </div>
                    <span style="font-size: 11px; color: #9ca3af;">400+ 行冗余代码</span>
                  </div>
                  <div class="code-content">
<span class="c-comm">&lt;!-- 传统可视化工具：死板嵌套，充斥内联样式 --&gt;</span>
&lt;<span class="c-tag">div</span> <span class="c-attr">id</span>=<span class="c-val">"comp-k9z2"</span> <span class="c-attr">style</span>=<span class="c-val">"position:absolute;left:0;top:0;width:100%;height:400px;z-index:99;"</span>&gt;
  &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-val">"wrapper_k82x1"</span> <span class="c-attr">style</span>=<span class="c-val">"display:block;margin:0 auto;"</span>&gt;
    &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-val">"inner_992"</span> <span class="c-attr">style</span>=<span class="c-val">"padding-top:20px;box-sizing:border-box;"</span>&gt;
      &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-val">"text_block_883"</span> <span class="c-attr">style</span>=<span class="c-val">"font-size:36px;color:#fff;font-weight:bold;"</span>&gt;
        欢迎访问我们的品牌主页
      &lt;/<span class="c-tag">div</span>&gt;
      &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-val">"btn_wrap_01"</span> <span class="c-attr">style</span>=<span class="c-val">"cursor:pointer;background:#00f;"</span>&gt;
        &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-val">"btn_txt_02"</span>&gt;立即开始&lt;/<span class="c-tag">div</span>&gt;
      &lt;/<span class="c-tag">div</span>&gt;
    &lt;/<span class="c-tag">div</span>&gt;
  &lt;/<span class="c-tag">div</span>&gt;
&lt;/<span class="c-tag">div</span>&gt;
                  </div>
                </div>

                <div class="code-panel panel-good">
                  <div class="panel-head">
                    <div class="tag-good">
                      <span>✓</span>
                      <span>BlockCanvas 导出：手写级语义化纯净代码</span>
                    </div>
                    <span style="font-size: 11px; color: #34d399; font-weight: 600;">100% 语义化 · 0 依赖</span>
                  </div>
                  <div class="code-content">
<span class="c-comm">&lt;!-- BlockCanvas: 原生 HTML5 语义标签 + 自动抽类复用 --&gt;</span>
&lt;<span class="c-tag">section</span> <span class="c-attr">class</span>=<span class="c-cls">"hero-banner"</span>&gt;
  &lt;<span class="c-tag">div</span> <span class="c-attr">class</span>=<span class="c-cls">"container"</span>&gt;
    &lt;<span class="c-tag">h1</span> <span class="c-attr">class</span>=<span class="c-cls">"title"</span>&gt;让完全不懂代码的人，做出专业网页&lt;/<span class="c-tag">h1</span>&gt;
    &lt;<span class="c-tag">p</span> <span class="c-attr">class</span>=<span class="c-cls">"desc"</span>&gt;像画图一样所见即所得，导出干净整洁的 HTML/CSS。&lt;/<span class="c-tag">p</span>&gt;
    &lt;<span class="c-tag">button</span> <span class="c-attr">class</span>=<span class="c-cls">"btn-primary"</span>&gt;立即体验&lt;/<span class="c-tag">button</span>&gt;
  &lt;/<span class="c-tag">div</span>&gt;
&lt;/<span class="c-tag">section</span>&gt;

<span class="c-comm">/* 自动生成的干净 CSS（含 :hover 伪类与响应式规则） */</span>
<span class="c-cls">.hero-banner</span> { <span class="c-attr">display</span>: flex; <span class="c-attr">background</span>: #101828; <span class="c-attr">padding</span>: 64px 24px; }
<span class="c-cls">.btn-primary:hover</span> { <span class="c-attr">background</span>: #2563eb; <span class="c-attr">transform</span>: translateY(-2px); }
                  </div>
                </div>
              </div>
            </div>

            <!-- STAGE 3: Deep Chinese-Encapsulated CSS & Flex Layout Assistant -->
            <div class="morph-layer" id="layer3">
              <div class="flex-sandbox-view">
                <div class="flex-side-controls">
                  <div style="font-size: 13px; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 8px;">
                    <span style="color: var(--blue);">📐</span>
                    <span>中文封装的 Flex 布局助手</span>
                  </div>
                  <p style="font-size: 12px; color: var(--text-sub);">
                    无需记忆 flex-direction 等英文术语，点击中文胶囊即时生效。
                  </p>
                  
                  <div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">排列方向</div>
                    <div class="seg-group">
                      <button class="seg-item active" id="btnRow" onclick="setFlexDir('row')">横排 (Row)</button>
                      <button class="seg-item" id="btnCol" onclick="setFlexDir('column')">竖排 (Column)</button>
                    </div>
                  </div>

                  <div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">主轴对齐</div>
                    <div class="seg-group">
                      <button class="seg-item active" id="btnJCenter" onclick="setFlexJustify('center')">居中</button>
                      <button class="seg-item" id="btnJBetween" onclick="setFlexJustify('space-between')">两端分散</button>
                      <button class="seg-item" id="btnJStart" onclick="setFlexJustify('flex-start')">起始</button>
                    </div>
                  </div>

                  <div>
                    <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; font-weight: 600;">
                      <span>子元素间距 (Gap)</span>
                      <span id="gapVal" style="color: #93c5fd; font-family: var(--font-code);">16px</span>
                    </div>
                    <input type="range" min="0" max="48" value="16" style="width: 100%; accent-color: var(--blue);" oninput="setFlexGap(this.value)" />
                  </div>
                </div>

                <div class="flex-side-preview">
                  <div class="interactive-stage-box" id="flexDemoBox">
                    <div class="box-block">🧩 导航区块</div>
                    <div class="box-block">✨ 特性展示</div>
                    <div class="box-block">🚀 行动按钮</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- STAGE 4: Template Library & Pure Portable Data Ecosystem -->
            <div class="morph-layer" id="layer4">
              <img src="${images['02-template-library-dark.png']}" alt="模板资源包" class="screen-img" />
            </div>

          </div>
        </div>
      </div>

    </div>
  </section>

  <!-- =========================================================================
       SECTION 1: CORE PILLARS
       ========================================================================= -->
  <section class="main-wrap" id="features-sec">
    <div class="sec-head">
      <div class="sec-badge">Core Pillars · 核心特性</div>
      <h2 class="sec-title">专为小白打造，却拥有专业级的内核</h2>
      <p class="sec-sub">从流式画布、DOM 图层树到伪类交互与便携存储，每一个功能都精心雕琢。</p>
    </div>

    <div class="grid-pillars">
      <div class="card-pillar">
        <div class="pillar-icon">🖱️</div>
        <h3 class="pillar-h">流式文档流画布</h3>
        <p class="pillar-p">默认遵循现代 Web 真实文档流，元素垂直堆叠并自适应排版。随时按需切换为 <code>absolute</code> / <code>fixed</code> / <code>sticky</code>，所见即所见。</p>
      </div>

      <div class="card-pillar">
        <div class="pillar-icon">🏷️</div>
        <h3 class="pillar-h">24 种语义化元素</h3>
        <p class="pillar-p">内置 <code>header / nav / section / main / article / aside / footer / button / input</code> 等原生标签，从源头杜绝无意义的 div 堆砌。</p>
      </div>

      <div class="card-pillar">
        <div class="pillar-icon">🎯</div>
        <h3 class="pillar-h">智能样式抽类与复用</h3>
        <p class="pillar-p">编辑器自动计算样式哈希并抽类为 <code>.bc-s-*</code>，相同外观的元素共用同一条规则，支持用户自定义类名与全局自定义 CSS。</p>
      </div>

      <div class="card-pillar">
        <div class="pillar-icon">⚡</div>
        <h3 class="pillar-h">伪类交互可视化编辑</h3>
        <p class="pillar-p">支持 <code>:hover</code>、<code>:active</code>、<code>:focus</code>、<code>:link</code> 状态可视化编辑与画布即时预览，导出生成标准 CSS 伪类规则。</p>
      </div>

      <div class="card-pillar">
        <div class="pillar-icon">💾</div>
        <h3 class="pillar-h">纯绿色便携设计</h3>
        <p class="pillar-p">免安装、不写入 Windows 注册表和系统 AppData。所有工程文件、快照备份与配置全部存储在程序目录 <code>data/</code>，随身带走。</p>
      </div>

      <div class="card-pillar">
        <div class="pillar-icon">🧩</div>
        <h3 class="pillar-h">扩展系统与静默更新</h3>
        <p class="pillar-p">插件与资源包生态全面开放；启动时静默检测 GitHub Releases 最新版本，平滑升级且永久保留 <code>data/</code> 用户数据。</p>
      </div>
    </div>
  </section>

  <!-- =========================================================================
       SECTION 2: TEMPLATES SHOWCASE
       ========================================================================= -->
  <section class="main-wrap" id="templates-sec">
    <div class="sec-head">
      <div class="sec-badge">Template Showcase · 模板资源库</div>
      <h2 class="sec-title">内置 14 款全栈模板，一键拖拽插入</h2>
      <p class="sec-sub">涵盖品牌首页、营销转化、信息内容、组件零件。零类名冲突，开箱即用。</p>
    </div>

    <div class="filter-tabs">
      <button class="tab-btn active" onclick="filterTpls('all', this)">全部模板 (14)</button>
      <button class="tab-btn" onclick="filterTpls('brand', this)">品牌首页</button>
      <button class="tab-btn" onclick="filterTpls('marketing', this)">营销转化</button>
      <button class="tab-btn" onclick="filterTpls('content', this)">信息内容</button>
      <button class="tab-btn" onclick="filterTpls('components', this)">组件零件</button>
    </div>

    <div class="grid-templates" id="tplGrid">
      <div class="card-tpl" data-cat="brand">
        <div class="tpl-preview-box">
          <img src="${images['03-workspace-hero-dark.png']}" alt="左右分屏 Hero" />
          <span class="tpl-tag-float">品牌首页</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">左右分屏 Hero</h4>
          <p class="tpl-card-desc">左文右图经典招牌区，含标语、大标题、行动按钮与用户头像证明。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">hero-split.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>

      <div class="card-tpl" data-cat="marketing">
        <div class="tpl-preview-box">
          <img src="${images['02-template-library-dark.png']}" alt="三档定价方案" />
          <span class="tpl-tag-float">营销转化</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">三档定价方案</h4>
          <p class="tpl-card-desc">免费版 / 专业版 / 企业版对比卡片，推荐方案带高亮边框与徽标。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">pricing.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>

      <div class="card-tpl" data-cat="brand">
        <div class="tpl-preview-box">
          <img src="${images['04-inspector-properties-dark.png']}" alt="六宫格特性卡片" />
          <span class="tpl-tag-float">品牌首页</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">六宫格特性卡片</h4>
          <p class="tpl-card-desc">3×2 网格展示产品核心特性，每个卡片配有专属图标与描述。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">features.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>

      <div class="card-tpl" data-cat="content">
        <div class="tpl-preview-box">
          <img src="${images['05-layer-tree-dark.png']}" alt="常见问题 FAQ" />
          <span class="tpl-tag-float">信息内容</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">常见问题折叠列表</h4>
          <p class="tpl-card-desc">标准 FAQ 问答卡片组，适合放置在营销页面底部提升转化率。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">faq.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>

      <div class="card-tpl" data-cat="content">
        <div class="tpl-preview-box">
          <img src="${images['01-workspace-dark-empty.png']}" alt="博客文章网格" />
          <span class="tpl-tag-float">信息内容</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">博客文章网格</h4>
          <p class="tpl-card-desc">三列文章卡片，含彩色渐变封面、分类标签与阅读全文链接。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">blog-grid.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>

      <div class="card-tpl" data-cat="components">
        <div class="tpl-preview-box">
          <img src="${images['03-workspace-hero-dark.png']}" alt="顶部导航栏与页脚" />
          <span class="tpl-tag-float">组件零件</span>
        </div>
        <div class="tpl-card-body">
          <h4 class="tpl-card-title">响应式导航栏 & 页脚</h4>
          <p class="tpl-card-desc">Logo 站点名 + 多链接 + 行动按钮，双击即可修改文字。</p>
          <div class="tpl-card-foot">
            <span class="tpl-meta">navbar.json</span>
            <span class="tpl-link">一键插入 →</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- =========================================================================
       SECTION 3: REAL PROGRAM SCREENSHOTS
       ========================================================================= -->
  <section class="main-wrap" id="gallery-sec">
    <div class="sec-head">
      <div class="sec-badge">Real Screenshots · 真实截图</div>
      <h2 class="sec-title">全暗色原生界面，极简深邃的工作台</h2>
      <p class="sec-sub">以下截图均直接截取自正在运行的 BlockCanvas 桌面程序，所见即所得。</p>
    </div>

    <div class="gallery-box">
      <div class="gallery-bar">
        <button class="g-btn active" onclick="switchG(0, this)"><span>01</span> 初始工作台</button>
        <button class="g-btn" onclick="switchG(1, this)"><span>02</span> 模板资源库</button>
        <button class="g-btn" onclick="switchG(2, this)"><span>03</span> 画布构建 Hero</button>
        <button class="g-btn" onclick="switchG(3, this)"><span>04</span> 样式属性面板</button>
        <button class="g-btn" onclick="switchG(4, this)"><span>05</span> DOM 图层树</button>
        <button class="g-btn" onclick="switchG(5, this)"><span>06</span> 个性化设置中心</button>
        <button class="g-btn" onclick="switchG(6, this)"><span>07</span> 扩展与插件管理器</button>
      </div>

      <div class="gallery-view">
        <img src="${images['01-workspace-dark-empty.png']}" alt="初始工作台" class="g-shot active" id="gImg0" />
        <img src="${images['02-template-library-dark.png']}" alt="模板资源库" class="g-shot" id="gImg1" />
        <img src="${images['03-workspace-hero-dark.png']}" alt="画布构建 Hero" class="g-shot" id="gImg2" />
        <img src="${images['04-inspector-properties-dark.png']}" alt="样式属性面板" class="g-shot" id="gImg3" />
        <img src="${images['05-layer-tree-dark.png']}" alt="DOM 图层树" class="g-shot" id="gImg4" />
        <img src="${images['06-settings-modal-dark.png']}" alt="个性化设置中心" class="g-shot" id="gImg5" />
        <img src="${images['07-extensions-modal-dark.png']}" alt="扩展与插件管理器" class="g-shot" id="gImg6" />
      </div>
    </div>
  </section>

  <!-- =========================================================================
       SECTION 4: GITHUB CTA & DOWNLOAD
       ========================================================================= -->
  <section class="main-wrap" id="cta-sec">
    <div class="cta-hero">
      <img src="${iconBase64}" alt="BlockCanvas" class="cta-logo-img" />
      <h2 class="cta-h">准备好开启全新的网页创作之旅了吗？</h2>
      <p class="cta-p">BlockCanvas 采用 MIT 开源许可证。完全免费、无广告、纯便携绿色运行。</p>

      <div class="cta-actions">
        <a href="https://github.com/DrZhaology/BlockCanvas" target="_blank" rel="noopener noreferrer" class="btn-main">
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
          <span>在 GitHub 上 Star & 查看源码</span>
        </a>

        <a href="https://github.com/DrZhaology/BlockCanvas/releases" target="_blank" rel="noopener noreferrer" class="btn-sub">
          <span>📦 获取最新 Windows 便携版</span>
        </a>
      </div>

      <div>
        <div class="term-box">
          <span>$ git clone https://github.com/DrZhaology/BlockCanvas.git</span>
          <button class="term-copy" onclick="copyClone(this)">复制命令</button>
        </div>
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <ul class="foot-links">
      <li><a href="https://github.com/DrZhaology/BlockCanvas" target="_blank">GitHub 仓库</a></li>
      <li><a href="https://github.com/DrZhaology/BlockCanvas/blob/main/LICENSE" target="_blank">MIT 许可证</a></li>
      <li><a href="https://github.com/DrZhaology/BlockCanvas/releases" target="_blank">版本更新日志</a></li>
    </ul>
    <p>© 2026 BlockCanvas (积木画布) · Developed with ❤️ by <a href="https://github.com/DrZhaology" target="_blank" style="color: #93c5fd; text-decoration: none;">Dr.Zhaology</a></p>
    <p style="font-size: 12px; margin-top: 6px; color: #4b5563;">让完全不懂代码的人，也能做出专业网页</p>
  </footer>

  <!-- =========================================================================
       SCRIPT ENGINE
       ========================================================================= -->
  <script>
    const STAGES = [
      {
        badge: '阶段 01 / 桌面可视化网页工厂',
        title: '让完全不懂代码的人，做出专业网页',
        desc: '像用画图软件一样拖拽搭建页面，导出纯净、语义化、手写级的 HTML / CSS。彻底告别传统可视化工具堆砌的 <div> 石山。',
        rotX: 12, rotY: -6, scale: 0.88, layerId: 'layer0'
      },
      {
        badge: '阶段 02 / 所见即所得的流式画布',
        title: '所见即所得，遵循现代 Web 真实文档流',
        desc: '鼠标拖拽插入 24 种原生语义化标签，双击直接编辑文案，支持响应式自适应与吸附对齐。',
        rotX: 0, rotY: 0, scale: 1, layerId: 'layer1'
      },
      {
        badge: '阶段 03 / 优雅纯净的代码生成器',
        title: '告别 <div> 山，导出真正的原生 HTML5 + CSS',
        desc: '智能样式哈希抽类复用（.bc-s-*），支持用户自定义类名与全局 CSS。产物结构清晰、体积轻量，0 运行时依赖。',
        rotX: 0, rotY: 0, scale: 1, layerId: 'layer2'
      },
      {
        badge: '阶段 04 / 深度中文封装的 CSS 属性系统',
        title: '把复杂的 CSS 术语，变成直观的中文调节器',
        desc: '盒模型、Flex 弹性布局、伪类交互 (:hover / :active)、阴影与渐变全部带中文胶囊预设和滑块，零记忆负担。',
        rotX: 0, rotY: 0, scale: 1, layerId: 'layer3'
      },
      {
        badge: '阶段 05 / 模板资源库与纯便携架构',
        title: '14+ 精美全栈模板，纯绿色免安装随身带',
        desc: '所有工程与配置均存储在 data/ 目录，不写入系统注册表和 AppData。支持第三方插件热启停与自动静默更新。',
        rotX: 4, rotY: 2, scale: 0.95, layerId: 'layer4'
      }
    ];

    let currentStage = 0;
    const morphTrack = document.getElementById('morphTrack');
    const morphFrame = document.getElementById('morphFrame');
    const stagePillText = document.getElementById('stagePillText');
    const stageHeadline = document.getElementById('stageHeadline');
    const stageSub = document.getElementById('stageSub');
    const hudDots = document.querySelectorAll('.hud-dot');

    const orbitCss = document.getElementById('orbitCss');
    const orbitHtml = document.getElementById('orbitHtml');
    const orbitJs = document.getElementById('orbitJs');

    function onScroll() {
      const rect = morphTrack.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / (rect.height - window.innerHeight)));
      const targetStage = Math.min(STAGES.length - 1, Math.floor(progress * STAGES.length));

      if (targetStage !== currentStage) {
        currentStage = targetStage;
        setStage(currentStage);
      }

      const stageProgress = (progress * STAGES.length) % 1;
      const cur = STAGES[currentStage];
      const next = STAGES[Math.min(STAGES.length - 1, currentStage + 1)];

      const rotX = cur.rotX + (next.rotX - cur.rotX) * stageProgress;
      const rotY = cur.rotY + (next.rotY - cur.rotY) * stageProgress;
      const scale = cur.scale + (next.scale - cur.scale) * stageProgress;

      morphFrame.style.transform = \`rotateX(\${rotX}deg) rotateY(\${rotY}deg) scale(\${scale})\`;

      if (orbitCss && orbitHtml && orbitJs) {
        const floatY = Math.sin(progress * Math.PI * 4) * 14;
        orbitCss.style.transform = \`translateY(\${floatY}px) translateZ(40px)\`;
        orbitHtml.style.transform = \`translateY(\${-floatY}px) translateZ(30px)\`;
        orbitJs.style.transform = \`translateY(\${floatY * 0.8}px) translateZ(50px)\`;
      }
    }

    function setStage(idx) {
      const s = STAGES[idx];
      stagePillText.textContent = s.badge;
      stageHeadline.textContent = s.title;
      stageSub.textContent = s.desc;

      hudDots.forEach((dot, i) => dot.classList.toggle('active', i === idx));

      document.querySelectorAll('.morph-layer').forEach(l => l.classList.remove('active'));
      const activeL = document.getElementById(s.layerId);
      if (activeL) activeL.classList.add('active');
    }

    function jumpStage(idx) {
      const trackHeight = morphTrack.offsetHeight - window.innerHeight;
      const targetY = morphTrack.offsetTop + (idx / STAGES.length) * trackHeight + 10;
      window.scrollTo({ top: targetY, behavior: 'smooth' });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    onScroll();

    // Flex Sandbox Controls
    const flexDemoBox = document.getElementById('flexDemoBox');
    function setFlexDir(dir) {
      flexDemoBox.style.flexDirection = dir;
      document.getElementById('btnRow').classList.toggle('active', dir === 'row');
      document.getElementById('btnCol').classList.toggle('active', dir === 'column');
    }
    function setFlexJustify(j) {
      flexDemoBox.style.justifyContent = j;
      document.getElementById('btnJCenter').classList.toggle('active', j === 'center');
      document.getElementById('btnJBetween').classList.toggle('active', j === 'space-between');
      document.getElementById('btnJStart').classList.toggle('active', j === 'flex-start');
    }
    function setFlexGap(val) {
      flexDemoBox.style.gap = val + 'px';
      document.getElementById('gapVal').textContent = val + 'px';
    }

    // Template Filtering
    function filterTpls(cat, btn) {
      document.querySelectorAll('.filter-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.card-tpl').forEach(card => {
        if (cat === 'all' || card.getAttribute('data-cat') === cat) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }

    // Screenshot Gallery Switcher
    function switchG(idx, btn) {
      document.querySelectorAll('.g-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.g-shot').forEach((img, i) => {
        img.classList.toggle('active', i === idx);
      });
    }

    // Copy command
    function copyClone(btn) {
      navigator.clipboard.writeText('git clone https://github.com/DrZhaology/BlockCanvas.git').then(() => {
        const old = btn.textContent;
        btn.textContent = '已复制 ✓';
        btn.style.background = '#059669';
        setTimeout(() => {
          btn.textContent = old;
          btn.style.background = '';
        }, 2000);
      });
    }
  </script>
</body>
</html>
`;

fs.writeFileSync('E:/Develop/index.html', html, 'utf8');
fs.writeFileSync('E:/Develop/BlockCanvas/promo.html', html, 'utf8');
console.log('Finished writing promotional page successfully.');
