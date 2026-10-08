'use strict';
/*
 * 我们的小屋 · 情侣回忆相册（联网版）
 * - 密码保护（APP_PASSWORD）
 * - 多人同时上传、编辑、删除
 * - 通过 SSE 实时同步到所有已打开页面
 * - 纯 Node 内置模块，零依赖，方便部署
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'love520';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('album::' + APP_PASSWORD).digest('hex');
const MAX_BYTES = 15 * 1024 * 1024; // 15MB / 张

/* ===== 单文件版：前端页面直接内置在这个文件里 ===== */
const INDEX_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#fff6ee" />
<title>我们的小屋 · 情侣回忆相册</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
<link href="https://cdn.jsdelivr.net/npm/@fontsource-variable/newsreader@5.2.10/index.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-serif-sc@5.2.10/index.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fontsource-variable/nunito-sans@5.2.7/index.css" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-sc@5.2.10/index.css" rel="stylesheet">
<style>
  :root {
    --bg: #fff6ee; --surface: #ffffff; --surface-2: #fff1e7;
    --fg: #43302b; --muted: #9c7f72; --border: #f1ddd1;
    --accent: #e07a56; --accent-2: #c15a44;
    --accent-soft: color-mix(in oklch, var(--accent) 14%, transparent);
    --font-display: "Newsreader Variable", "Noto Serif SC Variable", "Songti SC", Georgia, serif;
    --font-body: "Nunito Sans Variable", "Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
    --radius: 12px; --radius-lg: 18px;
    --shadow-soft: 0 18px 40px -24px color-mix(in oklch, var(--accent-2) 45%, transparent);
    --shadow-card: 0 12px 26px -16px rgba(80,45,30,0.35);
    --container: 1120px; --gutter: 28px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  body {
    margin: 0; color: var(--fg); font-family: var(--font-body);
    font-size: 16px; line-height: 1.62; -webkit-font-smoothing: antialiased;
    background: radial-gradient(1100px 520px at 82% -6%, color-mix(in oklch, var(--accent) 20%, transparent), transparent 62%),
      radial-gradient(900px 480px at -8% 12%, color-mix(in oklch, var(--accent) 12%, transparent), transparent 60%), var(--bg);
    overflow-x: hidden; padding-left: env(safe-area-inset-left); padding-right: env(safe-area-inset-right);
  }
  img { display: block; max-width: 100%; }
  button { font: inherit; cursor: pointer; }
  p { text-wrap: pretty; } h1, h2, h3 { text-wrap: balance; }
  .container { max-width: var(--container); margin-inline: auto; padding-inline: var(--gutter); }
  .section { padding-block: clamp(48px, 7vw, 88px); }
  h1, h2 { font-family: var(--font-display); font-weight: 600; margin: 0; letter-spacing: -0.015em; }
  h1 { font-size: clamp(38px, 6vw, 62px); line-height: 1.06; }
  h2 { font-size: clamp(28px, 3.6vw, 40px); line-height: 1.14; }
  h3 { font-size: 20px; font-weight: 700; margin: 0; line-height: 1.3; }
  .lead { font-size: 18px; color: var(--muted); max-width: 34em; margin: 0; }
  .eyebrow { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin: 0 0 18px; }

  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 9px; padding: 12px 22px; border-radius: 999px; border: 1px solid transparent; font-size: 15px; font-weight: 700; white-space: nowrap; transition: transform .06s, background .16s, border-color .16s, box-shadow .16s; min-height: 46px; }
  .btn svg { width: 18px; height: 18px; } .btn:active { transform: translateY(1px); }
  .btn-primary { background: var(--accent); color: #fff; box-shadow: var(--shadow-soft); } .btn-primary:hover { background: var(--accent-2); }
  .btn-secondary { background: var(--surface); color: var(--fg); border-color: var(--border); } .btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
  .btn[disabled] { opacity: .6; cursor: default; }

  .hidden { display: none !important; }

  /* ── login ── */
  .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .login-card { width: 100%; max-width: 420px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-soft); padding: clamp(30px, 6vw, 44px); text-align: center; }
  .login-badge { width: 70px; height: 70px; margin: 0 auto 18px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .login-badge svg { width: 34px; height: 34px; }
  .login-card h1 { font-size: 30px; margin-bottom: 8px; }
  .login-card p { color: var(--muted); font-size: 14.5px; margin: 0 0 24px; }
  .login-field { position: relative; margin-bottom: 14px; }
  .login-field input { width: 100%; padding: 14px 46px 14px 16px; border: 1px solid var(--border); border-radius: 12px; font: inherit; font-size: 16px; background: var(--surface-2); color: var(--fg); }
  .login-field input:focus { outline: none; border-color: var(--accent); background: var(--surface); }
  .login-field .toggle { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: var(--muted); padding: 8px; display: grid; place-items: center; }
  .login-field .toggle svg { width: 20px; height: 20px; }
  .login-msg { min-height: 20px; font-size: 13.5px; color: var(--accent-2); margin: 4px 0 14px; }
  .login-card .btn { width: 100%; }

  /* ── nav ── */
  .topnav { position: sticky; top: 0; z-index: 40; background: color-mix(in oklch, var(--bg) 88%, transparent); backdrop-filter: blur(14px); border-bottom: 1px solid var(--border); padding-top: env(safe-area-inset-top); }
  .topnav-inner { display: flex; align-items: center; justify-content: space-between; padding-block: 14px; gap: 16px; }
  .brand { display: flex; align-items: center; gap: 10px; font-family: var(--font-display); font-size: 20px; font-weight: 600; }
  .brand .heart { color: var(--accent); display: grid; place-items: center; } .brand .heart svg { width: 22px; height: 22px; }
  .topnav .nav-right { display: flex; align-items: center; gap: 18px; }
  .topnav nav { display: flex; gap: 28px; }
  .topnav nav a { font-size: 14.5px; color: var(--muted); font-weight: 600; text-decoration: none; } .topnav nav a:hover { color: var(--accent); }
  .live { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--muted); font-weight: 600; }
  .live .dot { width: 8px; height: 8px; border-radius: 50%; background: #7bb87b; box-shadow: 0 0 0 3px rgba(123,184,123,.22); }
  .live.off .dot { background: #c9b3a8; box-shadow: 0 0 0 3px rgba(201,179,168,.2); }
  .logout { border: 0; background: transparent; color: var(--muted); font-size: 13.5px; font-weight: 600; text-decoration: none; }
  .logout:hover { color: var(--accent); }

  /* ── counter ── */
  .counter-card { display: grid; grid-template-columns: auto 1fr; gap: clamp(20px,4vw,44px); align-items: center; background: linear-gradient(135deg, var(--surface), var(--surface-2)); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: clamp(26px,4vw,44px); box-shadow: var(--shadow-soft); }
  .counter-num { font-family: var(--font-display); font-weight: 600; line-height: 1; }
  .counter-num .big { font-size: clamp(56px,9vw,96px); color: var(--accent); letter-spacing: -.03em; }
  .counter-num .unit { font-size: clamp(20px,3vw,28px); margin-left: 6px; }
  .counter-body h3 { margin-bottom: 6px; } .counter-body p { margin: 0 0 14px; color: var(--muted); font-size: 15px; }
  .date-field { display: inline-flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 8px 16px; }
  .date-field svg { width: 17px; height: 17px; color: var(--accent); flex: none; }
  .date-field input { border: 0; background: transparent; font: inherit; font-size: 16px; color: var(--fg); font-weight: 600; min-height: 28px; } .date-field input:focus { outline: none; }

  /* ── upload ── */
  .dropzone { border: 2px dashed color-mix(in oklch, var(--accent) 45%, var(--border)); border-radius: var(--radius-lg); background: color-mix(in oklch, var(--surface) 70%, transparent); padding: clamp(30px,5vw,52px) clamp(18px,4vw,40px); text-align: center; transition: background .18s, border-color .18s, transform .18s; cursor: pointer; }
  .dropzone.dragover { background: var(--accent-soft); border-color: var(--accent); transform: scale(1.008); }
  .dropzone .dz-icon { width: 62px; height: 62px; margin: 0 auto 18px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .dropzone .dz-icon svg { width: 28px; height: 28px; }
  .dropzone h3 { font-family: var(--font-display); font-size: 23px; font-weight: 600; margin-bottom: 8px; }
  .dropzone p { color: var(--muted); margin: 0 auto 22px; max-width: 42ch; font-size: 15px; }
  .dz-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .dz-hint { margin-top: 16px; font-size: 12.5px; color: var(--muted); min-height: 18px; } .dz-hint.warn { color: var(--accent-2); }
  .progress { height: 6px; border-radius: 999px; background: var(--surface-2); overflow: hidden; margin: 16px auto 0; max-width: 320px; display: none; }
  .progress.on { display: block; } .progress .bar { height: 100%; width: 0; background: var(--accent); transition: width .2s; }

  /* ── gallery ── */
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: clamp(28px,5vw,52px); flex-wrap: wrap; }
  .section-head p { margin: 8px 0 0; color: var(--muted); font-size: 15px; }
  .count-pill { background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 9px 18px; font-size: 14px; font-weight: 700; color: var(--accent); white-space: nowrap; }

  .gallery-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: clamp(26px, 3.4vw, 46px) clamp(18px, 2.6vw, 34px);
    align-items: start;
  }

  .photo-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 10px;
    box-shadow: 0 1px 2px rgba(80,45,30,.04), 0 16px 36px -28px rgba(80,45,30,.5);
    transition: transform .55s cubic-bezier(.22,.61,.36,1),
                box-shadow .55s cubic-bezier(.22,.61,.36,1),
                border-color .55s;
  }
  .photo-card .tape { display: none; }

  .photo-card:hover {
    transform: translateY(-6px);
    border-color: color-mix(in oklch, var(--accent) 26%, var(--border));
    box-shadow: 0 2px 4px rgba(80,45,30,.05), 0 34px 60px -32px rgba(80,45,30,.55);
    z-index: 2;
  }

  .photo-frame {
    position: relative;
    border-radius: 13px;
    overflow: hidden;
    background: var(--surface-2);
    cursor: zoom-in;
    aspect-ratio: 1 / 1;
    isolation: isolate;
  }
  .photo-frame::after {
    content: '';
    position: absolute; inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px rgba(80,45,30,.07);
    background: linear-gradient(to top, rgba(58,33,22,.34), rgba(58,33,22,0) 46%);
    opacity: 0;
    transition: opacity .55s cubic-bezier(.22,.61,.36,1);
    pointer-events: none;
  }
  .photo-card:hover .photo-frame::after { opacity: 1; }

  .photo-frame img {
    width: 100%; height: 100%;
    object-fit: cover;
    transition: transform 1.2s cubic-bezier(.22,.61,.36,1);
  }
  .photo-card:hover .photo-frame img { transform: scale(1.05); }

  .photo-remove {
    position: absolute; top: 10px; right: 10px;
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,.5);
    background: rgba(255,255,255,.82);
    color: var(--accent-2);
    display: grid; place-items: center;
    opacity: 0; transform: translateY(-4px) scale(.94);
    transition: opacity .35s, transform .35s, background .2s, color .2s;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    box-shadow: 0 6px 16px -8px rgba(80,45,30,.5);
    z-index: 3;
  }
  .photo-remove svg { width: 16px; height: 16px; }
  .photo-remove:hover { background: #fff; color: #b3402c; }
  @media (hover: hover) { .photo-card:hover .photo-remove { opacity: 1; transform: translateY(0) scale(1); } }
  @media (hover: none) { .photo-remove { opacity: .9; transform: none; } }

  .photo-meta { padding: 14px 8px 16px; }
  .photo-caption {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 16.5px;
    line-height: 1.55;
    color: var(--fg);
    min-height: 24px;
    margin: 0 0 10px;
    padding: 3px 5px;
    border-radius: 7px;
    outline: none;
    overflow-wrap: anywhere;
    transition: background .25s, box-shadow .25s;
  }
  .photo-caption:empty::before { content: '写下这一刻…'; color: var(--muted); font-style: italic; }
  .photo-caption:focus { background: var(--surface-2); box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 22%, transparent); }

  .photo-date {
    display: inline-flex; align-items: center; gap: 7px;
    color: var(--muted); font-size: 12.5px; font-weight: 600;
  }
  .photo-date svg { width: 14px; height: 14px; flex: none; color: color-mix(in oklch, var(--accent) 70%, var(--muted)); }
  .photo-date input {
    border: 0; background: transparent; font: inherit; font-size: 13px;
    color: var(--muted); min-height: 26px;
  }
  .photo-date input:focus { outline: none; color: var(--accent); }

  .empty-state { grid-column: 1/-1; text-align: center; padding: clamp(32px,6vw,64px) 20px; border: 1.5px dashed var(--border); border-radius: var(--radius-lg); background: color-mix(in oklch, var(--surface) 60%, transparent); }
  .empty-state .es-ico { width: 64px; height: 64px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
  .empty-state .es-ico svg { width: 30px; height: 30px; }
  .empty-state h3 { font-family: var(--font-display); font-size: 22px; font-weight: 600; margin-bottom: 6px; }
  .empty-state p { color: var(--muted); margin: 0 auto; max-width: 36ch; font-size: 15px; }

  .pagefoot { text-align: center; padding-block: 56px; border-top: 1px solid var(--border); margin-top: 92px; padding-bottom: calc(56px + env(safe-area-inset-bottom)); }
  .pagefoot .fh { font-family: var(--font-display); font-size: 22px; margin-bottom: 8px; }
  .pagefoot .fh .heart { color: var(--accent); }
  .pagefoot p { color: var(--muted); font-size: 13.5px; margin: 0; }

  .lightbox { position: fixed; inset: 0; z-index: 80; display: none; background: color-mix(in oklch, #2a1a14 90%, transparent); padding: clamp(16px,5vw,60px); backdrop-filter: blur(6px); }
  .lightbox.open { display: grid; place-items: center; }
  .lightbox figure { margin: 0; max-width: min(920px, 92vw); text-align: center; }
  .lightbox img { max-height: 72vh; width: auto; margin: 0 auto; border-radius: 8px; box-shadow: 0 30px 70px -30px rgba(0,0,0,.6); }
  .lightbox figcaption { color: #f7e9e2; font-family: var(--font-display); font-style: italic; font-size: 19px; margin-top: 18px; }
  .lb-close { position: absolute; top: calc(16px + env(safe-area-inset-top)); right: 20px; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.12); color: #fff; display: grid; place-items: center; }
  .lb-close svg { width: 22px; height: 22px; } .lb-close:hover { background: rgba(255,255,255,.24); }

  .toast { position: fixed; left: 50%; bottom: calc(24px + env(safe-area-inset-bottom)); transform: translateX(-50%) translateY(20px); background: var(--fg); color: #fff; padding: 12px 22px; border-radius: 999px; font-size: 14px; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; z-index: 90; max-width: 90vw; text-align: center; }
  .toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }

  @media (max-width: 920px) {
    .counter-card { grid-template-columns: 1fr; text-align: center; } .counter-num { justify-self: center; }
    .gallery-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 600px) {
    :root { --gutter: 18px; }
    .topnav nav { gap: 16px; } .topnav nav a { font-size: 13px; } .brand { font-size: 17px; }
    .live span.txt { display: none; }
    .gallery-grid { grid-template-columns: 1fr; }
    .dz-actions .btn, .hero-cta .btn { flex: 1 1 auto; }
  }
</style>
</head>
<body>

<!-- LOGIN -->
<div class="login-wrap" id="loginView">
  <form class="login-card" id="loginForm" autocomplete="off">
    <div class="login-badge">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.2C.3 8.6 2.2 4.5 6 4.5c2.2 0 3.7 1.2 4.6 2.6.9-1.4 2.4-2.6 4.6-2.6 3.8 0 5.7 4.1 4 7.3C19.5 16.4 12 21 12 21z"/></svg>
    </div>
    <h1>我们的小屋</h1>
    <p>这是只属于我们的回忆相册，输入密码即可进入 ♥</p>
    <div class="login-field">
      <input type="password" id="pw" placeholder="请输入访问密码" autocomplete="current-password" aria-label="访问密码" />
      <button type="button" class="toggle" id="pwToggle" aria-label="显示或隐藏密码">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>
    <p class="login-msg" id="loginMsg"></p>
    <button class="btn btn-primary" type="submit" id="loginBtn">进入我们的小屋</button>
  </form>
</div>

<!-- APP -->
<div id="appView" class="hidden">
  <header class="topnav">
    <div class="container topnav-inner">
      <div class="brand">
        <span class="heart" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-10-9.2C.3 8.6 2.2 4.5 6 4.5c2.2 0 3.7 1.2 4.6 2.6.9-1.4 2.4-2.6 4.6-2.6 3.8 0 5.7 4.1 4 7.3C19.5 16.4 12 21 12 21z"/></svg></span>
        我们的小屋
      </div>
      <div class="nav-right">
        <span class="live" id="liveBadge"><span class="dot"></span><span class="txt">实时同步中</span></span>
        <nav><a href="#gallery">相册</a><a href="#upload">上传</a></nav>
        <button class="logout" id="logoutBtn" type="button">退出</button>
      </div>
    </div>
  </header>

  <main id="top">
    <!-- HERO -->
    <section class="section" style="padding-top:clamp(36px,6vw,72px)">
      <div class="container">
        <p class="eyebrow">A little corner of us</p>
        <h1>把和你在一起的<b style="color:var(--accent);font-style:italic">每个瞬间</b>，都好好收起来。</h1>
        <p class="lead" style="margin-top:18px">这里是我们两个人的回忆小屋。上传一张张照片，写下当时的心里的活 —— 无论谁在什么地方上传，另一个人都能立刻看到。</p>
      </div>
    </section>

    <!-- COUNTER -->
    <section class="section" style="padding-top:0">
      <div class="container">
        <div class="counter-card">
          <div class="counter-num"><span class="big" id="daysNum">—</span><span class="unit">天</span></div>
          <div class="counter-body">
            <h3>我们已经在一起</h3>
            <p>设下属于你们的纪念日，小屋会替你记着，每一个一起走过的日子。</p>
            <label class="date-field">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <input type="date" id="anniversary" value="" aria-label="我们的纪念日" />
            </label>
          </div>
        </div>
      </div>
    </section>

    <!-- UPLOAD -->
    <section class="section" id="upload">
      <div class="container">
        <div class="section-head"><div><p class="eyebrow">Add a memory</p><h2>把新的回忆放进小屋</h2></div></div>
        <div class="dropzone" id="dropzone">
          <div class="dz-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.2"/><path d="M8 5l1.5-2h5L16 5"/></svg></div>
          <h3>点击这里选择照片</h3>
          <p>支持一次选择多张图片（JPG / PNG / WEBP）。手机上也能直接从相册里挑选，上传后大家都能立即看到。</p>
          <div class="dz-actions"><button class="btn btn-primary" id="pickBtn" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></svg>选择照片</button></div>
          <input type="file" id="fileInput" accept="image/*" multiple hidden />
          <div class="progress" id="progress"><div class="bar" id="progressBar"></div></div>
          <p class="dz-hint" id="uploadStatus">照片会保存到小屋的服务器上，两个人共用同一份相册。</p>
        </div>
      </div>
    </section>

    <!-- GALLERY -->
    <section class="section" id="gallery">
      <div class="container">
        <div class="section-head">
          <div><p class="eyebrow">Our album</p><h2>我们的回忆相册</h2><p>点击照片可以放大欣赏，点一下文字就能写备注 —— 改动会实时同步。</p></div>
          <span class="count-pill" id="countPill">共 0 张回忆</span>
        </div>
        <div class="gallery-grid" id="galleryGrid"></div>
      </div>
    </section>
  </main>

  <footer class="pagefoot">
    <div class="container">
      <p class="fh">愿我们把平淡的日子，过成<span class="heart">♥</span>这些温柔的记忆</p>
      <p>我们的小屋 · 只属于两个人的回忆相册</p>
    </div>
  </footer>
</div>

<div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="照片预览">
  <button class="lb-close" id="lbClose" aria-label="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
  <figure><img id="lbImg" src="" alt="照片预览" /><figcaption id="lbCaption"></figcaption></figure>
</div>

<div class="toast" id="toast"></div>

<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var photos = [];
  var editingId = null;   // photo currently being edited locally (to avoid SSE clobber)
  var es = null;

  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove("on"); }, 2600);
  }
  function esc(s) { return String(s || "").replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw Object.assign(new Error(j.error || "请求失败"), { status: r.status });
        return j;
      });
    });
  }

  /* ── auth flow ── */
  function showApp() { $("loginView").classList.add("hidden"); $("appView").classList.remove("hidden"); }
  function showLogin() { $("appView").classList.add("hidden"); $("loginView").classList.remove("hidden"); if (es) { es.close(); es = null; } }

  $("pwToggle").addEventListener("click", function () {
    var inp = $("pw"); inp.type = inp.type === "password" ? "text" : "password"; inp.focus();
  });

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("pw").value;
    if (!pw) { $("loginMsg").textContent = "请输入密码"; return; }
    $("loginBtn").disabled = true; $("loginMsg").textContent = "正在进入…";
    api("POST", "/api/login", { password: pw }).then(function () {
      $("pw").value = ""; $("loginMsg").textContent = "";
      showApp(); boot();
    }).catch(function (err) {
      $("loginMsg").textContent = err.message || "密码不正确";
    }).then(function () { $("loginBtn").disabled = false; });
  });

  $("logoutBtn").addEventListener("click", function () {
    api("POST", "/api/logout").then(function () { location.reload(); }).catch(function () { location.reload(); });
  });

  /* ── render ── */
  function render() {
    $("countPill").textContent = "共 " + photos.length + " 张回忆";
    var grid = $("galleryGrid");
    if (!photos.length) {
      grid.innerHTML = '<div class="empty-state"><div class="es-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg></div><h3>相册还空空的</h3><p>上传你们的第一张照片，开始记录属于两个人的回忆吧。</p></div>';
      return;
    }
    grid.innerHTML = photos.map(function (p) {
      return '<article class="photo-card" data-id="' + p.id + '">' +
        '<div class="photo-frame"><img src="' + esc(p.url) + '" alt="' + esc(p.caption || "我们的照片") + '" loading="lazy" />' +
        '<button class="photo-remove" data-remove="' + p.id + '" title="删除这张照片" aria-label="删除照片"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div>' +
        '<div class="photo-meta"><div class="photo-caption" contenteditable="true" data-caption="' + p.id + '">' + esc(p.caption) + '</div>' +
        '<label class="photo-date"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
        '<input type="date" value="' + (p.date || "") + '" data-date="' + p.id + '" /></label></div></article>';
    }).join("");
  }

  function updateDays() {
    var v = $("anniversary").value;
    if (!v) { $("daysNum").textContent = "—"; return; }
    var diff = Math.floor((new Date() - new Date(v + "T00:00:00")) / 86400000) + 1;
    $("daysNum").textContent = diff > 0 ? diff.toLocaleString("zh-CN") : "0";
  }

  function setPhotos(list, isEnough) {
    photos = list || [];
    render();
  }

  /* ── upload ── */
  function fileToDataURL(f) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(f); });
  }
  function loadImage(dataUrl) {
    return new Promise(function (res, rej) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = dataUrl; });
  }
  // downscale to keep uploads fast and within server limits
  function compress(dataUrl, maxSide, quality) {
    return loadImage(dataUrl).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, maxSide / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement("canvas"); c.width = cw; c.height = ch;
      c.getContext("2d").drawImage(img, 0, 0, cw, ch);
      var out = c.toDataURL("image/jpeg", quality);
      return out.length < dataUrl.length ? out : dataUrl;
    }).catch(function () { return dataUrl; });
  }

  function addFiles(files) {
    var imgs = Array.prototype.filter.call(files, function (f) { return f.type && f.type.indexOf("image/") === 0; });
    if (!imgs.length) { setStatus("没有检测到图片文件，请选择 JPG / PNG / WEBP。", true); return; }
    var prog = $("progress"), bar = $("progressBar"); prog.classList.add("on"); bar.style.width = "0%";
    var total = imgs.length, done = 0, failed = 0, today = new Date().toISOString().slice(0, 10);

    function step(f) {
      return fileToDataURL(f)
        .then(function (d) { return compress(d, 1600, 0.82); })
        .then(function (d) { return api("POST", "/api/photos", { data: d, caption: "", date: today }); })
        .catch(function () { failed++; });
    }
    var chain = Promise.resolve();
    imgs.forEach(function (f) {
      chain = chain.then(function () {
        return step(f).then(function () {
          done++; bar.style.width = Math.round((done + failed) / total * 100) + "%";
        });
      });
    });
    chain.then(function () {
      prog.classList.remove("on");
      if (failed) setStatus("已上传 " + (done) + " 张，" + failed + " 张失败，请重试。", true);
      else setStatus("已上传 " + total + " 张照片，大家都能看到啦 ♥", false);
    });
  }
  function setStatus(text, warn) { var el = $("uploadStatus"); el.textContent = text; el.classList.toggle("warn", !!warn); }

  $("pickBtn").addEventListener("click", function (e) { e.stopPropagation(); $("fileInput").click(); });
  $("dropzone").addEventListener("click", function () { $("fileInput").click(); });
  $("fileInput").addEventListener("change", function () { if (this.files && this.files.length) addFiles(this.files); this.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) { $("dropzone").addEventListener(t, function (e) { e.preventDefault(); $("dropzone").classList.add("dragover"); }); });
  ["dragleave", "drop"].forEach(function (t) { $("dropzone").addEventListener(t, function (e) { e.preventDefault(); $("dropzone").classList.remove("dragover"); }); });
  $("dropzone").addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  /* ── gallery interactions ── */
  $("galleryGrid").addEventListener("focusin", function (e) { var c = e.target.closest("[data-caption]"); if (c) editingId = c.getAttribute("data-caption"); });
  $("galleryGrid").addEventListener("focusout", function (e) {
    var cap = e.target.closest("[data-caption]");
    if (cap) {
      var id = cap.getAttribute("data-caption");
      api("PATCH", "/api/photos/" + encodeURIComponent(id), { caption: cap.textContent.trim() }).catch(function () {});
      editingId = null;
    }
  });
  $("galleryGrid").addEventListener("input", function (e) {
    var d = e.target.closest("[data-date]");
    if (d) { api("PATCH", "/api/photos/" + encodeURIComponent(d.getAttribute("data-date")), { date: d.value }).catch(function () {}); }
  });
  $("galleryGrid").addEventListener("click", function (e) {
    var rm = e.target.closest("[data-remove]");
    if (rm) {
      var id = rm.getAttribute("data-remove");
      if (confirm("确定要删除这张照片吗？删除后两个人都会看不到它。")) {
        api("DELETE", "/api/photos/" + encodeURIComponent(id)).catch(function () { toast("删除失败，请重试"); });
      }
      return;
    }
    var frame = e.target.closest(".photo-frame");
    if (frame) {
      var card = frame.closest(".photo-card");
      var p = photos.filter(function (x) { return x.id === card.getAttribute("data-id"); })[0];
      if (p) openLightbox(p);
    }
  });

  var lightbox = $("lightbox"), lbImg = $("lbImg"), lbCaption = $("lbCaption");
  function openLightbox(p) { lbImg.src = p.url; lbCaption.textContent = p.caption ? p.caption : (p.date || ""); lightbox.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeLightbox() { lightbox.classList.remove("open"); lbImg.src = ""; document.body.style.overflow = ""; }
  $("lbClose").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", function (e) { if (e.target === lightbox) closeLightbox(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeLightbox(); });

  /* ── anniversary ── */
  $("anniversary").addEventListener("change", function () {
    updateDays();
    api("POST", "/api/anniversary", { date: $("anniversary").value }).catch(function () { toast("保存失败，请重试"); });
  });

  /* ── realtime ── */
  function setLive(on) { $("liveBadge").classList.toggle("off", !on); $("liveBadge").querySelector(".txt").textContent = on ? "实时同步中" : "离线，重连中…"; }
  function connect() {
    if (es) es.close();
    es = new EventSource("/api/events");
    es.addEventListener("state", function (e) { var d = JSON.parse(e.data); setPhotos(d.photos); $("anniversary").value = d.anniversary || ""; updateDays(); setLive(true); });
    es.addEventListener("photos", function (e) { if (editingId) return; setPhotos(JSON.parse(e.data).photos); });
    es.addEventListener("anniversary", function (e) { var d = JSON.parse(e.data); if (document.activeElement !== $("anniversary")) { $("anniversary").value = d.anniversary || ""; updateDays(); } });
    es.onopen = function () { setLive(true); };
    es.onerror = function () { setLive(false); };
  }

  /* ── boot ── */
  function boot() { connect(); }
  function init() {
    api("GET", "/api/me").then(function (r) { if (r.authed) { showApp(); boot(); } else { showLogin(); } })
      .catch(function () { showLogin(); });
  }
  init();
})();
</script>
</body>
</html>
`;

/* 首次运行时自动放进相册的第一张照片
 * ⚠️ 请把原来那段以 "data:image/jpeg;base64,/9j/4AAQ..." 开头、以 "/2Q==" 结尾的完整 Base64 字符串
 *    粘贴回下面的双引号里（保持原样，不要改动内容），即可恢复默认首图。 */
const SEED_IMG = "data:image/jpeg;base64,请在此处粘贴原来那段完整的 Base64 数据（原样保留）";


fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadDB() {
  try { const d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); if (!d.photos) d.photos = []; return d; }
  catch (e) { return { anniversary: '', photos: [] }; }
}
let db = loadDB();
/* 首次运行：如果还没有数据库，就放入那张合照作为第一张回忆 */
if (!fs.existsSync(DB_FILE)) {
  try {
    var _m = /^data:image\/([a-zA-Z]+);base64,(.*)$/.exec(SEED_IMG);
    if (_m && _m[2] && _m[2].length > 100) {
      var _ext = _m[1] === 'jpeg' ? 'jpg' : _m[1];
      var _id = crypto.randomUUID();
      var _file = _id + '.' + _ext;
      fs.writeFileSync(path.join(UPLOAD_DIR, _file), Buffer.from(_m[2], 'base64'));
      db.photos.unshift({ id: _id, file: _file, caption: '我们俩的第一张合照 ♥', date: '2026-10-08', ts: Date.now() });
      saveDB();
    }
  } catch (e) { console.error('seed failed', e); }
}
function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/* ── auth ── */
function sign(exp) { return crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex'); }
function makeToken() { const exp = Date.now() + 1000 * 60 * 60 * 24 * 30; return exp + '.' + sign(exp); }
function validToken(t) {
  if (!t) return false;
  const i = t.lastIndexOf('.');
  if (i < 0) return false;
  const exp = t.slice(0, i), sig = t.slice(i + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const s = sign(exp);
  return s.length === sig.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig));
}
function parseCookies(req) {
  const h = req.headers.cookie || '', o = {};
  h.split(';').forEach(function (p) {
    const idx = p.indexOf('=');
    if (idx > 0) o[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return o;
}
function isAuthed(req) { return validToken(parseCookies(req)['album_sid']); }

/* ── SSE broadcast ── */
const clients = new Set();
function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of clients) { try { res.write(payload); } catch (e) {} }
}

function sendJSON(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}
function publicPhotos() {
  return db.photos.map(function (p) {
    return { id: p.id, url: '/uploads/' + p.file, caption: p.caption || '', date: p.date || '', ts: p.ts };
  });
}
function pushPhotos() { broadcast('photos', { photos: publicPhotos() }); }

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json'
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

const server = http.createServer(async function (req, res) {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  try {
    /* login / logout / identity (no auth) */
    if (req.method === 'POST' && p === '/api/login') {
      const body = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
      if (String(body.password) === APP_PASSWORD) {
        res.writeHead(200, {
          'Set-Cookie': 'album_sid=' + makeToken() + '; HttpOnly; Path=/; Max-Age=' + (60 * 60 * 24 * 30) + '; SameSite=Lax',
          'Content-Type': 'application/json'
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      return sendJSON(res, 401, { ok: false, error: '密码不正确，请再试一次' });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      res.writeHead(200, { 'Set-Cookie': 'album_sid=; HttpOnly; Path=/; Max-Age=0', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (p === '/api/me') return sendJSON(res, 200, { authed: isAuthed(req) });

    /* auth-required APIs */
    if (p.indexOf('/api/') === 0) {
      if (!isAuthed(req)) return sendJSON(res, 401, { error: 'unauthorized' });

      if (req.method === 'GET' && p === '/api/state') {
        return sendJSON(res, 200, { anniversary: db.anniversary || '', photos: publicPhotos() });
      }

      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });
        res.write('retry: 3000\n\n');
        res.write('event: state\ndata: ' + JSON.stringify({ anniversary: db.anniversary || '', photos: publicPhotos() }) + '\n\n');
        clients.add(res);
        const hb = setInterval(function () { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
        req.on('close', function () { clearInterval(hb); clients.delete(res); });
        return;
      }

      if (req.method === 'POST' && p === '/api/photos') {
        const body = JSON.parse((await readBody(req, 20 * 1024 * 1024)).toString() || '{}');
        const dataUrl = body.data;
        if (!dataUrl || dataUrl.indexOf('data:') !== 0) return sendJSON(res, 400, { error: '缺少图片数据' });
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(dataUrl);
        if (!m) return sendJSON(res, 400, { error: '图片格式不支持' });
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > MAX_BYTES) return sendJSON(res, 413, { error: '图片过大，请压缩后再上传（单张 ≤ 15MB）' });
        const ext = EXT[m[1]] || 'jpg';
        const id = crypto.randomUUID();
        const file = id + '.' + ext;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), buf);
        db.photos.unshift({ id: id, file: file, caption: body.caption || '', date: body.date || '', ts: Date.now() });
        saveDB(); pushPhotos();
        return sendJSON(res, 200, { ok: true, id: id });
      }

      if (req.method === 'PATCH' && p.indexOf('/api/photos/') === 0) {
        const id = decodeURIComponent(p.slice('/api/photos/'.length));
        const body = JSON.parse((await readBody(req, 2e5)).toString() || '{}');
        const ph = db.photos.find(function (x) { return x.id === id; });
        if (!ph) return sendJSON(res, 404, { error: '照片不存在' });
        if (typeof body.caption === 'string') ph.caption = body.caption;
        if (typeof body.date === 'string') ph.date = body.date;
        saveDB(); pushPhotos();
        return sendJSON(res, 200, { ok: true });
      }

      if (req.method === 'DELETE' && p.indexOf('/api/photos/') === 0) {
        const id = decodeURIComponent(p.slice('/api/photos/'.length));
        const idx = db.photos.findIndex(function (x) { return x.id === id; });
        if (idx < 0) return sendJSON(res, 404, { error: '照片不存在' });
        const removed = db.photos.splice(idx, 1)[0];
        try { fs.unlinkSync(path.join(UPLOAD_DIR, removed.file)); } catch (e) {}
        saveDB(); pushPhotos();
        return sendJSON(res, 200, { ok: true });
      }

      if (req.method === 'POST' && p === '/api/anniversary') {
        const body = JSON.parse((await readBody(req, 2e5)).toString() || '{}');
        db.anniversary = String(body.date || '');
        saveDB();
        broadcast('anniversary', { anniversary: db.anniversary });
        return sendJSON(res, 200, { ok: true });
      }

      return sendJSON(res, 404, { error: '接口不存在' });
    }

    /* uploaded images */
    if (p.indexOf('/uploads/') === 0) {
      const name = path.basename(p);
      const fp = path.join(UPLOAD_DIR, name);
      if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
      return fs.createReadStream(fp).pipe(res);
    }

    /* 首页：直接返回内置页面 */
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(INDEX_HTML);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (e) {
    sendJSON(res, 500, { error: (e && e.message) || '服务器错误' });
  }
});

server.listen(PORT, function () {
  console.log('[album] 我们的小屋 running on http://0.0.0.0:' + PORT);
  console.log('[album] 访问密码已通过 APP_PASSWORD 设置: ' + (process.env.APP_PASSWORD ? '是' : '否（使用默认密码 love520）'));
});