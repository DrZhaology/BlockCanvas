import { chromium } from 'playwright';
import path from 'path';

async function verifyPromo() {
  console.log('Testing generated promo webpage in Chromium...');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  const filePath = 'file:///' + path.resolve('E:/Develop/index.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });

  console.log('Page title:', await page.title());

  // Capture hero stage 0
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-0.png' });
  console.log('Captured verify-stage-0.png');

  // Scroll to stage 1 (approx 20% down morph track)
  const track = await page.$('#morph-track');
  const box = await track.boundingBox();
  
  await page.evaluate(() => window.scrollTo(0, 1000));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-1.png' });
  console.log('Captured verify-stage-1.png');

  // Scroll to stage 2
  await page.evaluate(() => window.scrollTo(0, 2000));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-2.png' });
  console.log('Captured verify-stage-2.png');

  // Scroll to stage 3
  await page.evaluate(() => window.scrollTo(0, 3000));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-stage-3.png' });
  console.log('Captured verify-stage-3.png');

  // Scroll to gallery section
  await page.evaluate(() => document.getElementById('gallery-section').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-gallery.png' });
  console.log('Captured verify-gallery.png');

  // Scroll to CTA section
  await page.evaluate(() => document.getElementById('download-section').scrollIntoView());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/Develop/promo-assets/verify-cta.png' });
  console.log('Captured verify-cta.png');

  // Test interactive buttons: click gallery nav
  await page.click('.gallery-nav-btn:nth-child(2)');
  await page.waitForTimeout(300);
  const activeImg = await page.$eval('#g-img-1', el => el.classList.contains('active'));
  console.log('Gallery tab switch test:', activeImg ? 'PASS' : 'FAIL');

  // Test interactive flex controls
  await page.click('#btn-col');
  await page.waitForTimeout(200);
  const flexDir = await page.$eval('#interactive-flex-box', el => el.style.flexDirection);
  console.log('Flex direction test:', flexDir === 'column' ? 'PASS' : 'FAIL');

  await browser.close();
  console.log('Verification script completed successfully!');
}

verifyPromo().catch(console.error);
