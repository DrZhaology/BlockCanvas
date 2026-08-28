// BlockCanvas · 自动化建站与导出脚本
// 用途：程序化构建一个专业、高品质的网页完整 SceneGraph，
// 充分利用「关系选择器（.hero > h1、.card > h3、.site-nav > a 等）」与组件结构，
// 并调用 exportHTML 导出为标准的 HTML 文件，供人工审查生成的 HTML 与 CSS 结构。

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 模拟导出依赖库（直接使用打包产物或纯 TS 编译版本）
const ebPath = process.env.TEMP + '/bc-exporter-bundle.cjs';

// 构建一个精美的完整产品落地页 SceneGraph
const demoScene = {
  root: {
    id: 'root-body',
    type: 'div',
    text: '',
    style: {
      backgroundColor: '#f8fafc',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: '#1e293b',
      minHeight: '100vh'
    },
    attrs: {},
    children: [
      // 1. 顶部导航条（使用关系选择器 .site-header > .nav-brand, .site-nav > a）
      {
        id: 'header-1',
        type: 'header',
        text: '',
        attrs: { className: 'site-header' },
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '16px',
          paddingRight: '32px',
          paddingBottom: '16px',
          paddingLeft: '32px',
          backgroundColor: '#ffffff',
          borderBottomWidth: '1px',
          borderStyle: 'solid',
          borderColor: '#e2e8f0',
          boxSizing: 'border-box'
        },
        children: [
          {
            id: 'brand-1',
            type: 'span',
            text: '⚡ BlockCanvas',
            attrs: { relSelector: '.site-header > span' },
            style: {
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#0f172a',
              letterSpacing: '-0.5px'
            },
            children: []
          },
          {
            id: 'nav-1',
            type: 'nav',
            text: '',
            attrs: { className: 'site-nav' },
            style: {
              display: 'flex',
              gap: '20px',
              alignItems: 'center'
            },
            children: [
              {
                id: 'nav-a1',
                type: 'a',
                text: '产品特性',
                attrs: { href: '#features', relSelector: '.site-nav > a:first-of-type' },
                style: { color: '#2563eb', textDecoration: 'none', fontSize: '14px', fontWeight: 'bold' },
                children: []
              },
              {
                id: 'nav-a2',
                type: 'a',
                text: '使用文档',
                attrs: { href: '#docs', relSelector: '.site-nav > a:nth-of-type(2)' },
                style: { color: '#64748b', textDecoration: 'none', fontSize: '14px' },
                children: []
              },
              {
                id: 'nav-a3',
                type: 'a',
                text: '关于我们',
                attrs: { href: '#about', relSelector: '.site-nav > a:last-of-type' },
                style: { color: '#64748b', textDecoration: 'none', fontSize: '14px' },
                children: []
              }
            ]
          }
        ]
      },

      // 2. Hero 大标题区（使用关系选择器 .hero-section > h1, .hero-section > p, .hero-section > button）
      {
        id: 'hero-1',
        type: 'section',
        text: '',
        attrs: { className: 'hero-section' },
        style: {
          paddingTop: '80px',
          paddingRight: '24px',
          paddingBottom: '80px',
          paddingLeft: '24px',
          textAlign: 'center',
          backgroundColor: '#0f172a',
          color: '#ffffff'
        },
        children: [
          {
            id: 'hero-h1',
            type: 'h1',
            text: '下一代静态网页可视化构建器',
            attrs: { relSelector: '.hero-section > h1' },
            style: {
              fontSize: '44px',
              fontWeight: '800',
              color: '#ffffff',
              marginBottom: '16px',
              letterSpacing: '-1px'
            },
            children: []
          },
          {
            id: 'hero-p',
            type: 'p',
            text: '像玩积木一样自由绘制现代网页，导出纯净、手写级语义化 HTML 与 CSS 代码。',
            attrs: { relSelector: '.hero-section > p' },
            style: {
              fontSize: '18px',
              color: '#94a3b8',
              maxWidth: '640px',
              marginLeft: 'auto',
              marginRight: 'auto',
              marginBottom: '32px',
              lineHeight: '1.6'
            },
            children: []
          },
          {
            id: 'hero-btn',
            type: 'button',
            text: '立即免费体验 →',
            attrs: { relSelector: '.hero-section > button' },
            style: {
              backgroundColor: '#2563eb',
              color: '#ffffff',
              paddingTop: '12px',
              paddingRight: '28px',
              paddingBottom: '12px',
              paddingLeft: '28px',
              fontSize: '16px',
              fontWeight: '600',
              borderStyle: 'none',
              borderTopLeftRadius: '8px',
              borderTopRightRadius: '8px',
              borderBottomRightRadius: '8px',
              borderBottomLeftRadius: '8px',
              cursor: 'pointer'
            },
            children: []
          }
        ]
      },

      // 3. 特性卡片区域（使用关系选择器 .card-grid > .card, .card > h3, .card > p）
      {
        id: 'features-sec',
        type: 'section',
        text: '',
        attrs: { id: 'features', className: 'features-section' },
        style: {
          paddingTop: '64px',
          paddingRight: '32px',
          paddingBottom: '64px',
          paddingLeft: '32px',
          maxWidth: '1100px',
          marginLeft: 'auto',
          marginRight: 'auto'
        },
        children: [
          {
            id: 'sec-title',
            type: 'h2',
            text: '核心技术亮点',
            attrs: { relSelector: '.features-section > h2' },
            style: {
              fontSize: '28px',
              fontWeight: '700',
              textAlign: 'center',
              marginBottom: '40px',
              color: '#0f172a'
            },
            children: []
          },
          {
            id: 'card-container',
            type: 'div',
            text: '',
            attrs: { className: 'card-grid' },
            style: {
              display: 'flex',
              gap: '24px',
              justifyContent: 'space-between'
            },
            children: [
              {
                id: 'card-1',
                type: 'div',
                text: '',
                attrs: { className: 'card' },
                style: {
                  flex: '1 1 0px',
                  backgroundColor: '#ffffff',
                  paddingTop: '24px',
                  paddingRight: '24px',
                  paddingBottom: '24px',
                  paddingLeft: '24px',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: '#e2e8f0',
                  borderTopLeftRadius: '12px',
                  borderTopRightRadius: '12px',
                  borderBottomRightRadius: '12px',
                  borderBottomLeftRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                },
                children: [
                  {
                    id: 'card-1-h',
                    type: 'h3',
                    text: '⚡ 智能关系选择器',
                    attrs: { relSelector: '.card > h3' },
                    style: { fontSize: '18px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' },
                    children: []
                  },
                  {
                    id: 'card-1-p',
                    type: 'p',
                    text: '自动推导父子与后代选择器，子元素无需堆砌 class，CSS 结构整洁如资深前端手写。',
                    attrs: { relSelector: '.card > p' },
                    style: { fontSize: '14px', color: '#64748b', lineHeight: '1.6' },
                    children: []
                  }
                ]
              },
              {
                id: 'card-2',
                type: 'div',
                text: '',
                attrs: { className: 'card' },
                style: {
                  flex: '1 1 0px',
                  backgroundColor: '#ffffff',
                  paddingTop: '24px',
                  paddingRight: '24px',
                  paddingBottom: '24px',
                  paddingLeft: '24px',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: '#e2e8f0',
                  borderTopLeftRadius: '12px',
                  borderTopRightRadius: '12px',
                  borderBottomRightRadius: '12px',
                  borderBottomLeftRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                },
                children: [
                  {
                    id: 'card-2-h',
                    type: 'h3',
                    text: '🎨 所见即所得调色',
                    attrs: { relSelector: '.card > h3' },
                    style: { fontSize: '18px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' },
                    children: []
                  },
                  {
                    id: 'card-2-p',
                    type: 'p',
                    text: '支持 RGB/RGBA/HEX/颜色名实时对比切换，深色模式平滑过渡，所选即所见。',
                    attrs: { relSelector: '.card > p' },
                    style: { fontSize: '14px', color: '#64748b', lineHeight: '1.6' },
                    children: []
                  }
                ]
              },
              {
                id: 'card-3',
                type: 'div',
                text: '',
                attrs: { className: 'card' },
                style: {
                  flex: '1 1 0px',
                  backgroundColor: '#ffffff',
                  paddingTop: '24px',
                  paddingRight: '24px',
                  paddingBottom: '24px',
                  paddingLeft: '24px',
                  borderWidth: '1px',
                  borderStyle: 'solid',
                  borderColor: '#e2e8f0',
                  borderTopLeftRadius: '12px',
                  borderTopRightRadius: '12px',
                  borderBottomRightRadius: '12px',
                  borderBottomLeftRadius: '12px',
                  boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                },
                children: [
                  {
                    id: 'card-3-h',
                    type: 'h3',
                    text: '🚀 绿色便携零污染',
                    attrs: { relSelector: '.card > h3' },
                    style: { fontSize: '18px', fontWeight: '700', color: '#1e293b', marginBottom: '8px' },
                    children: []
                  },
                  {
                    id: 'card-3-p',
                    type: 'p',
                    text: '扩展与模板全部便携存放，即开即用，无需复杂配置，让网页构建回归纯粹乐趣。',
                    attrs: { relSelector: '.card > p' },
                    style: { fontSize: '14px', color: '#64748b', lineHeight: '1.6' },
                    children: []
                  }
                ]
              }
            ]
          }
        ]
      },

      // 4. 引言块（Blockquote 关系选择器）
      {
        id: 'quote-sec',
        type: 'section',
        text: '',
        attrs: { className: 'quote-section' },
        style: {
          paddingTop: '32px',
          paddingRight: '32px',
          paddingBottom: '32px',
          paddingLeft: '32px',
          maxWidth: '800px',
          marginLeft: 'auto',
          marginRight: 'auto',
          marginBottom: '64px'
        },
        children: [
          {
            id: 'quote-1',
            type: 'blockquote',
            text: '“最好的代码是干净且不言自明的代码。BlockCanvas 导出的不仅仅是网页，更是一份标准、体面的前端工程产物。”',
            attrs: { relSelector: '.quote-section > blockquote' },
            style: {
              fontSize: '16px',
              fontStyle: 'italic',
              color: '#334155',
              borderLeftWidth: '4px',
              borderStyle: 'solid',
              borderColor: '#3b82f6',
              paddingLeft: '16px',
              lineHeight: '1.7'
            },
            children: []
          }
        ]
      },

      // 5. 页脚（关系选择器 .site-footer > p）
      {
        id: 'footer-1',
        type: 'footer',
        text: '',
        attrs: { className: 'site-footer' },
        style: {
          paddingTop: '32px',
          paddingRight: '24px',
          paddingBottom: '32px',
          paddingLeft: '24px',
          backgroundColor: '#0f172a',
          textAlign: 'center',
          color: '#64748b',
          fontSize: '13px'
        },
        children: [
          {
            id: 'footer-p',
            type: 'p',
            text: '© 2026 BlockCanvas 积木画布 · 由可视化引擎自动构建',
            attrs: { relSelector: '.site-footer > p' },
            style: { color: '#64748b', fontSize: '13px' },
            children: []
          }
        ]
      }
    ]
  },
  selectedId: null,
  selectedIds: [],
  quickCss: {
    resetMargin: '1',
    resetHeadingMargin: '1'
  }
};

// 执行构建
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

async function run() {
  const { exportHTML } = require(ebPath);
  const result = exportHTML(demoScene);

  const outputPath = 'E:/Develop/demo-page.html';
  writeFileSync(outputPath, result.html, 'utf-8');

  console.log('==============================================');
  console.log('✅ 自动化建站与导出脚本执行成功！');
  console.log('📄 产物路径:', outputPath);
  console.log('⚠️ 导出警告数:', result.warnings.length);
  console.log('🏷️ 未命名元素数:', result.unclassified.length);
  console.log('==============================================\n');
  console.log('【导出的 HTML 源码节选】:');
  console.log(result.html.slice(0, 1500));
  console.log('\n... (余下内容见导出文件)\n');
}

run().catch((e) => {
  console.error('构建脚本出错:', e);
  process.exit(1);
});
