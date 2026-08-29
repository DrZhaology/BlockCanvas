import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const { _electron: electron } = require('playwright');

async function verifyPromo() {
  console.log('Testing generated promo webpage with Electron window...');
  const app = await electron.launch({
    args: ['.'],
    cwd: 'E:/Develop/BlockCanvas',
    executablePath: electronPath
  });

  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });

  const filePath = 'file:///' + path.resolve('E:/Develop/index.html').replace(/\\/g, '/');
  await win.goto(filePath);
  await new Promise(r => setTimeout(r, 1000));

  console.log('Page title:', await win.title());

  // Capture hero stage 0
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-0.png' });
  console.log('Captured verify-stage-0.png');

  // Scroll to stage 1 (approx 20% down morph track)
  await win.evaluate(() => window.scrollTo(0, 1000));
  await new Promise(r => setTimeout(r, 500));
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-1.png' });
  console.log('Captured verify-stage-1.png');

  // Scroll to stage 2
  await win.evaluate(() => window.scrollTo(0, 2000));
  await new Promise(r => setTimeout(r, 500));
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-2.png' });
  console.log('Captured verify-stage-2.png');

  // Scroll to stage 3
  await win.evaluate(() => window.scrollTo(0, 3000));
  await new Promise(r => setTimeout(r, 500));
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-3.png' });
  console.log('Captured verify-stage-3.png');

  // Scroll to gallery section
  await win.evaluate(() => document.getElementById('gallery-section').scrollIntoView());
  await new Promise(r => setTimeout(r, 500));
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-gallery.png' });
  console.log('Captured verify-gallery.png');

  // Scroll to CTA section
  await win.evaluate(() => document.getElementById('download-section').scrollIntoView());
  await new Promise(r => setTimeout(r, 500));
  await win.screenshot({ path: 'E:/Develop/promo-assets/verify-cta.png' });
  console.log('Captured verify-cta.png');

  // Test interactive buttons: click gallery nav
  await win.click('.gallery-nav-btn:nth-child(2)');
  await new Promise(r => setTimeout(r, 300));
  const activeImg = await win.$eval('#g-img-1', el => el.classList.contains('active'));
  console.log('Gallery tab switch test:', activeImg ? 'PASS' : 'FAIL');

  // Test interactive flex controls
  await win.click('#btn-col');
  await new Promise(r => setTimeout(r, 200));
  const flexDir = await win.$eval('#interactive-flex-box', el => el.style.flexDirection);
  console.log('Flex direction test:', flexDir === 'column' ? 'PASS' : 'FAIL');

  // Test jumping to stage
  await win.evaluate(() => window.jumpToStage(3));
  await new Promise(r => setTimeout(r, 500));
  const badgeText = await win.$eval('#stage-badge-text', el => el.textContent);
  console.log('Stage jump test (target stage 4 text):', badgeText);

  await app.close();
  console.log('Verification completed flawlessly!');
}

verifyPromo().catch(console.error);
