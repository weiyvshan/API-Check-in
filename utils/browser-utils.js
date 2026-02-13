#!/usr/bin/env node
/**
 * 浏览器自动化相关的公共工具函数
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * 获取随机的现代浏览器 User Agent 字符串
 *
 * @returns {string} 随机选择的 User Agent 字符串
 */
export function getRandomUserAgent() {
	const userAgents = [
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
	];
	return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * 截取当前页面的屏幕截图
 *
 * @param {object} page - Playwright 页面对象
 * @param {string} reason - 截图原因描述
 * @param {string} accountName - 账号名称（用于日志输出和文件名）
 * @param {string} [screenshotsDir='screenshots'] - 截图保存目录
 * @returns {Promise<void>}
 *
 * Note: 通过环境变量 DEBUG=true 启用截图功能，默认为 false
 */
export async function takeScreenshot(page, reason, accountName, screenshotsDir = 'screenshots') {
	// 检查 DEBUG 环境变量
	const debugEnabled = ['true', '1', 'yes'].includes(process.env.DEBUG?.toLowerCase());

	if (!debugEnabled) {
		console.log(`🔍 ${accountName}: Screenshot skipped (DEBUG=false), reason: ${reason}`);
		return;
	}

	try {
		await fs.mkdir(screenshotsDir, { recursive: true });

		// 自动生成安全的账号名称
		const safeAccountName = accountName.replace(/[^a-zA-Z0-9]/g, '_');

		// 生成文件名: 账号名_时间戳_原因.png
		const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
		const safeReason = reason.replace(/[^a-zA-Z0-9]/g, '_');
		const filename = `${safeAccountName}_${timestamp}_${safeReason}.png`;
		const filepath = path.join(screenshotsDir, filename);

		await page.screenshot({ path: filepath, fullPage: true });
		console.log(`📸 ${accountName}: Screenshot saved to ${filepath}`);
	} catch (e) {
		console.log(`⚠️ ${accountName}: Failed to take screenshot: ${e.message}`);
	}
}

/**
 * 保存页面 HTML 到日志文件
 *
 * @param {object} page - Playwright 页面对象
 * @param {string} reason - 日志原因描述
 * @param {string} accountName - 账号名称（用于日志输出和文件名）
 * @param {string} [prefix=''] - 文件名前缀
 * @param {string} [logsDir='logs'] - 日志保存目录
 * @returns {Promise<void>}
 *
 * Note: 通过环境变量 DEBUG=true 启用保存 HTML 功能，默认为 false
 */
export async function savePageContentToFile(page, reason, accountName, prefix = '', logsDir = 'logs') {
	// 检查 DEBUG 环境变量
	const debugEnabled = ['true', '1', 'yes'].includes(process.env.DEBUG?.toLowerCase());

	if (!debugEnabled) {
		console.log(`🔍 ${accountName}: Save HTML skipped (DEBUG=false), reason: ${reason}`);
		return;
	}

	try {
		await fs.mkdir(logsDir, { recursive: true });

		// 自动生成安全的账号名称
		const safeAccountName = accountName.replace(/[^a-zA-Z0-9]/g, '_');

		const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
		const safeReason = reason.replace(/[^a-zA-Z0-9]/g, '_');

		// 构建文件名
		const filename = prefix
			? `${safeAccountName}_${timestamp}_${prefix}_${safeReason}.html`
			: `${safeAccountName}_${timestamp}_${safeReason}.html`;
		const filepath = path.join(logsDir, filename);

		const htmlContent = await page.content();
		await fs.writeFile(filepath, htmlContent, 'utf-8');

		console.log(`📄 ${accountName}: Page HTML saved to ${filepath}`);
	} catch (e) {
		console.log(`⚠️ ${accountName}: Failed to save HTML: ${e.message}`);
	}
}

/**
 * 阿里云验证码检查和处理
 *
 * 检查页面是否有阿里云验证码（通过 traceid 检测），如果有则尝试自动滑动验证
 *
 * @param {object} page - Playwright 页面对象
 * @param {string} accountName - 账号名称（用于日志输出）
 * @returns {Promise<boolean>} 验证码处理是否成功
 */
export async function aliyunCaptchaCheck(page, accountName) {
	// 检查是否有 traceid (阿里云验证码页面)
	try {
		const traceid = await page.evaluate(() => {
			const traceElement = document.getElementById('traceid');
			if (traceElement) {
				const text = traceElement.innerText || traceElement.textContent;
				const match = text.match(/TraceID:\s*([a-f0-9]+)/i);
				return match ? match[1] : null;
			}
			return null;
		});

		if (traceid) {
			console.log(`⚠️ ${accountName}: Aliyun captcha detected, traceid: ${traceid}`);
			try {
				await page.waitForSelector('#nocaptcha', { timeout: 60000 });

				const sliderElement = await page.$('#nocaptcha .nc_scale');
				const sliderHandle = await page.$('#nocaptcha .btn_slide');

				if (!sliderElement || !sliderHandle) {
					console.log(`❌ ${accountName}: Slider or handle not found`);
					await takeScreenshot(page, 'aliyun_captcha_error', accountName);
					return false;
				}

				const slider = await sliderElement.boundingBox();
				const handle = await sliderHandle.boundingBox();

				console.log(`ℹ️ ${accountName}: Slider bounding box:`, slider);
				console.log(`ℹ️ ${accountName}: Slider handle bounding box:`, handle);

				await takeScreenshot(page, 'aliyun_captcha_slider_start', accountName);

				// 执行滑动
				await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
				await page.mouse.down();
				await page.mouse.move(handle.x + slider.width, handle.y + handle.height / 2, { steps: 2 });
				await page.mouse.up();

				await takeScreenshot(page, 'aliyun_captcha_slider_completed', accountName);

				// 等待页面加载完成
				await page.waitForTimeout(20000);

				await takeScreenshot(page, 'aliyun_captcha_slider_result', accountName);
				return true;
			} catch (e) {
				console.log(`❌ ${accountName}: Error occurred while moving slider: ${e.message}`);
				await takeScreenshot(page, 'aliyun_captcha_error', accountName);
				return false;
			}
		} else {
			console.log(`ℹ️ ${accountName}: No traceid found`);
			return true;
		}
	} catch (e) {
		console.log(`❌ ${accountName}: Error occurred while getting traceid: ${e.message}`);
		await takeScreenshot(page, 'aliyun_captcha_error', accountName);
		return false;
	}
}

export default {
	getRandomUserAgent,
	takeScreenshot,
	savePageContentToFile,
	aliyunCaptchaCheck,
};
