#!/usr/bin/env node
/**
 * Linux.do 帖子浏览脚本
 * 使用 Playwright 登录 Linux.do 并浏览帖子
 *
 * name: Linux.do 帖子浏览
 * cron: 0 9 * * *
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { chromium } from 'playwright';
import { maskUsername } from './utils/mask-utils.js';
import { takeScreenshot, savePageContentToFile } from './utils/browser-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 默认缓存目录
const DEFAULT_STORAGE_STATE_DIR = 'storage-states';

// 帖子 ID 缓存目录
const TOPIC_ID_CACHE_DIR = 'linuxdo-reads';

// 默认帖子起始 ID
const DEFAULT_BASE_TOPIC_ID = Math.floor(Math.random() * 100000) + 1000000;

/**
 * Linux.do 帖子浏览类
 */
class LinuxDoReadPosts {
	/**
	 * @param {string} username - Linux.do 用户名
	 * @param {string} password - Linux.do 密码
	 * @param {string} [storageStateDir=DEFAULT_STORAGE_STATE_DIR] - 缓存目录
	 */
	constructor(username, password, storageStateDir = DEFAULT_STORAGE_STATE_DIR) {
		this.username = username;
		this.password = password;
		this.maskedUsername = maskUsername(username);
		this.storageStateDir = storageStateDir;

		// 使用用户名哈希生成缓存文件名
		this.usernameHash = crypto.createHash('sha256').update(username).digest('hex').slice(0, 8);

		// 每个用户独立的 topic_id 缓存文件
		this.topicIdCacheFile = path.join(TOPIC_ID_CACHE_DIR, `${this.usernameHash}_topic_id.txt`);
	}

	/**
	 * 确保目录存在
	 */
	async ensureDirs() {
		await fs.mkdir(this.storageStateDir, { recursive: true });
		await fs.mkdir(TOPIC_ID_CACHE_DIR, { recursive: true });
	}

	/**
	 * 检查是否已登录
	 * @param {object} page - Playwright 页面对象
	 * @returns {Promise<boolean>}
	 */
	async isLoggedIn(page) {
		try {
			console.log(`ℹ️ ${this.maskedUsername}: Checking login status...`);
			await page.goto('https://linux.do/', { waitUntil: 'domcontentloaded' });
			await page.waitForTimeout(3000);

			const currentUrl = page.url();
			console.log(`ℹ️ ${this.maskedUsername}: Current URL: ${currentUrl}`);

			// 如果跳转到登录页面，说明未登录
			if (currentUrl.startsWith('https://linux.do/login')) {
				console.log(`ℹ️ ${this.maskedUsername}: Redirected to login page, not logged in`);
				return false;
			}

			console.log(`✅ ${this.maskedUsername}: Already logged in`);
			return true;
		} catch (e) {
			console.log(`⚠️ ${this.maskedUsername}: Error checking login status: ${e.message}`);
			return false;
		}
	}

	/**
	 * 执行登录流程
	 * @param {object} page - Playwright 页面对象
	 * @returns {Promise<boolean>}
	 */
	async doLogin(page) {
		try {
			console.log(`ℹ️ ${this.maskedUsername}: Starting login process...`);

			// 如果当前不在登录页面，先导航到登录页面
			if (!page.url().startsWith('https://linux.do/login')) {
				await page.goto('https://linux.do/login', { waitUntil: 'domcontentloaded' });
			}

			await page.waitForTimeout(2000);

			// 填写用户名
			await page.fill('#login-account-name', this.username);
			await page.waitForTimeout(2000);

			// 填写密码
			await page.fill('#login-account-password', this.password);
			await page.waitForTimeout(2000);

			// 点击登录按钮
			await page.click('#login-button');
			await page.waitForTimeout(10000);

			await savePageContentToFile(page, 'login_result', this.username);

			// 检查是否遇到 Cloudflare 验证
			const currentUrl = page.url();
			console.log(`ℹ️ ${this.maskedUsername}: URL after login: ${currentUrl}`);

			if (currentUrl.includes('linux.do/challenge')) {
				console.log(`⚠️ ${this.maskedUsername}: Cloudflare challenge detected, waiting...`);
				try {
					await page.waitForURL('https://linux.do/', { timeout: 60000 });
					console.log(`✅ ${this.maskedUsername}: Cloudflare challenge bypassed`);
				} catch {
					console.log(`⚠️ ${this.maskedUsername}: Cloudflare challenge timeout`);
				}
			}

			// 再次检查是否登录成功
			if (page.url().startsWith('https://linux.do/login')) {
				console.log(`❌ ${this.maskedUsername}: Login failed, still on login page`);
				await takeScreenshot(page, 'login_failed', this.username);
				return false;
			}

			console.log(`✅ ${this.maskedUsername}: Login successful`);
			return true;
		} catch (e) {
			console.log(`❌ ${this.maskedUsername}: Error during login: ${e.message}`);
			await takeScreenshot(page, 'login_error', this.username);
			return false;
		}
	}

	/**
	 * 从缓存文件读取上次的 topic_id
	 * @returns {Promise<number>}
	 */
	async loadTopicId() {
		try {
			const content = await fs.readFile(this.topicIdCacheFile, 'utf-8');
			const trimmed = content.trim();
			if (trimmed) {
				return parseInt(trimmed, 10);
			}
			console.log(`⚠️ ${this.maskedUsername}: Failed to load topic ID from cache, content is empty`);
		} catch (e) {
			console.log(`⚠️ ${this.maskedUsername}: Failed to load topic ID from cache: ${e.message}`);
		}
		return 0;
	}

	/**
	 * 保存 topic_id 到缓存文件
	 * @param {number} topicId
	 */
	async saveTopicId(topicId) {
		try {
			await fs.writeFile(this.topicIdCacheFile, String(topicId), 'utf-8');
			console.log(`ℹ️ ${this.maskedUsername}: Saved topic ID ${topicId} to cache`);
		} catch (e) {
			console.log(`⚠️ ${this.maskedUsername}: Failed to save topic ID: ${e.message}`);
		}
	}

	/**
	 * 自动滚动浏览帖子内容
	 * @param {object} page - Playwright 页面对象
	 */
	async scrollToRead(page) {
		let lastCurrentPage = 0;
		let lastTotalPages = 0;

		while (true) {
			// 执行滚动
			await page.evaluate(() => window.scrollBy(0, window.innerHeight));

			// 每次滚动后等待 1-3 秒，模拟阅读
			await page.waitForTimeout(Math.floor(Math.random() * 2000) + 1000);

			// 检查 timeline-replies 内容判断是否到底
			const timelineElement = await page.$('.timeline-replies');
			if (!timelineElement) {
				console.log(`ℹ️ ${this.maskedUsername}: Timeline element not found, stopping`);
				break;
			}

			const innerText = await timelineElement.innerText();
			try {
				const parts = innerText.trim().split('/');
				if (parts.length === 2 && /^\d+$/.test(parts[0].trim()) && /^\d+$/.test(parts[1].trim())) {
					const currentPage = parseInt(parts[0].trim(), 10);
					const totalPages = parseInt(parts[1].trim(), 10);

					// 如果滚动后页数没变，说明已经到底了
					if (currentPage === lastCurrentPage && totalPages === lastTotalPages) {
						console.log(`ℹ️ ${this.maskedUsername}: Page not changing (${currentPage}/${totalPages}), reached bottom`);
						break;
					}

					// 如果当前页等于总页数，说明到底了
					if (currentPage >= totalPages) {
						console.log(`ℹ️ ${this.maskedUsername}: Reached end (${currentPage}/${totalPages}) after scrolling`);
						break;
					}

					// 缓存当前页数
					lastCurrentPage = currentPage;
					lastTotalPages = totalPages;
				} else {
					console.log(`ℹ️ ${this.maskedUsername}: Timeline read error(content: ${innerText}), stopping`);
					break;
				}
			} catch {
				// Ignore parse errors
			}
		}
	}

	/**
	 * 浏览帖子
	 * @param {object} page - Playwright 页面对象
	 * @param {number} baseTopicId - 起始帖子 ID
	 * @param {number} maxPosts - 最大浏览帖子数
	 * @returns {Promise<[number, number]>} [最后浏览的帖子ID, 实际阅读数量]
	 */
	async readPosts(page, baseTopicId, maxPosts) {
		// 从缓存文件读取上次的 topic_id
		const cachedTopicId = await this.loadTopicId();

		// 取环境变量和缓存中的最大值
		let currentTopicId = Math.max(baseTopicId, cachedTopicId);
		console.log(`ℹ️ ${this.maskedUsername}: Starting from topic ID ${currentTopicId} (base: ${baseTopicId}, cached: ${cachedTopicId})`);

		let readCount = 0;
		let invalidCount = 0;

		while (readCount < maxPosts) {
			// 如果连续无效超过5次，跳过50-100个ID
			if (invalidCount >= 5) {
				const jump = Math.floor(Math.random() * 50) + 50;
				currentTopicId += jump;
				console.log(`⚠️ ${this.maskedUsername}: Too many invalid topics, jumping ahead by ${jump} to ${currentTopicId}`);
				invalidCount = 0;
			} else {
				// 随机向上加 1-5
				currentTopicId += Math.floor(Math.random() * 5) + 1;
			}

			const topicUrl = `https://linux.do/t/topic/${currentTopicId}`;

			try {
				console.log(`ℹ️ ${this.maskedUsername}: Opening topic ${currentTopicId}...`);
				await page.goto(topicUrl, { waitUntil: 'domcontentloaded' });
				await page.waitForTimeout(3000);

				// 查找 timeline-replies 标签
				const timelineElement = await page.$('.timeline-replies');

				if (timelineElement) {
					// 获取 innerText 解析当前页/总页数
					const innerText = await timelineElement.innerText();
					console.log(`✅ ${this.maskedUsername}: Topic ${currentTopicId} - Progress: ${innerText.trim()}`);

					// 解析页数信息并滚动浏览
					try {
						const parts = innerText.trim().split('/');
						if (parts.length === 2 && /^\d+$/.test(parts[0].trim()) && /^\d+$/.test(parts[1].trim())) {
							const currentPage = parseInt(parts[0].trim(), 10);
							const totalPages = parseInt(parts[1].trim(), 10);

							// 有效帖子，重置无效计数
							invalidCount = 0;

							if (currentPage < totalPages) {
								console.log(`ℹ️ ${this.maskedUsername}: Scrolling to read remaining ${totalPages - currentPage} pages...`);
								// 自动滚动浏览剩余内容
								await this.scrollToRead(page);

								readCount += totalPages - currentPage;
								const remainingReadCount = Math.max(0, maxPosts - readCount);
								console.log(`ℹ️ ${this.maskedUsername}: ${readCount} read, ${remainingReadCount} remaining...`);
							}
						} else {
							console.log(`⚠️ ${this.maskedUsername}: Timeline read error(content: ${innerText}), continue`);
							invalidCount++;
							continue;
						}
					} catch (e) {
						console.log(`⚠️ ${this.maskedUsername}: Failed to parse progress: ${e.message}`);
						invalidCount++;
					}

					// 模拟阅读后等待
					await page.waitForTimeout(Math.floor(Math.random() * 1000) + 1000);
				} else {
					console.log(`⚠️ ${this.maskedUsername}: Topic ${currentTopicId} not found or invalid, skipping...`);
					invalidCount++;
				}
			} catch (e) {
				console.log(`⚠️ ${this.maskedUsername}: Error reading topic ${currentTopicId}: ${e.message}`);
				invalidCount++;
			}
		}

		// 保存当前 topic_id 到缓存
		await this.saveTopicId(currentTopicId);

		return [currentTopicId, readCount];
	}

	/**
	 * 执行浏览帖子任务
	 * @param {number} [maxPosts=100] - 最大浏览帖子数
	 * @returns {Promise<[boolean, object]>} [成功标志, 结果信息]
	 */
	async run(maxPosts = 100) {
		console.log(`ℹ️ ${this.maskedUsername}: Starting Linux.do read posts task`);

		await this.ensureDirs();

		// 缓存文件路径
		const cacheFilePath = path.join(this.storageStateDir, `linuxdo_${this.usernameHash}_storage_state.json`);

		// 从环境变量获取起始 ID
		const baseTopicIdStr = process.env.LINUXDO_BASE_TOPIC_ID || '';
		const baseTopicId = baseTopicIdStr ? parseInt(baseTopicIdStr, 10) : DEFAULT_BASE_TOPIC_ID;

		// 使用系统 chromium（青龙面板已安装）
		const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/chromium';
		
		// 代理配置
		const proxy = process.env.PROXY || '';
		const launchOptions = {
			headless: process.env.HEADLESS !== 'false',
			args: ['--no-sandbox', '--disable-setuid-sandbox'],
			executablePath,
		};
		
		if (proxy) {
			console.log(`ℹ️ ${this.maskedUsername}: Using proxy: ${proxy}`);
			launchOptions.proxy = { server: proxy };
		}
		
		const browser = await chromium.launch(launchOptions);

		try {
			// 加载缓存的 storage state（如果存在）
			let storageState = null;
			try {
				await fs.access(cacheFilePath);
				storageState = cacheFilePath;
				console.log(`ℹ️ ${this.maskedUsername}: Restoring storage state from cache`);
			} catch {
				console.log(`ℹ️ ${this.maskedUsername}: No cache file found, starting fresh`);
			}

			const context = await browser.newContext(storageState ? { storageState } : {});
			const page = await context.newPage();

			try {
				// 检查是否已登录
				const loggedIn = await this.isLoggedIn(page);

				// 如果未登录，执行登录流程
				if (!loggedIn) {
					const loginSuccess = await this.doLogin(page);
					if (!loginSuccess) {
						return [false, { error: 'Login failed' }];
					}

					// 保存会话状态
					await context.storageState({ path: cacheFilePath });
					console.log(`✅ ${this.maskedUsername}: Storage state saved to cache file`);
				}

				// 浏览帖子
				console.log(`ℹ️ ${this.maskedUsername}: Starting to read posts...`);
				const [lastTopicId, readCount] = await this.readPosts(page, baseTopicId, maxPosts);

				console.log(`✅ ${this.maskedUsername}: Successfully read ${readCount} posts`);
				return [true, { readCount, lastTopicId }];
			} catch (e) {
				console.log(`❌ ${this.maskedUsername}: Error occurred: ${e.message}`);
				await takeScreenshot(page, 'error', this.username);
				return [false, { error: e.message }];
			} finally {
				await page.close();
				await context.close();
			}
		} finally {
			await browser.close();
		}
	}
}

/**
 * 解析青龙面板管道格式的账号配置
 * 支持两种格式:
 *   - 简化格式: username|password
 *   - 完整格式: provider|api_user|cookies|github_user|github_pass|linuxdo_user|linuxdo_pass
 * @param {string} accountsStr - 账号配置字符串
 * @returns {Array<{username: string, password: string}>} Linux.do 账号列表
 */
function parsePipeAccounts(accountsStr) {
	const accounts = [];
	const seenUsernames = new Set();
	const lines = accountsStr.split('\n');

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith('#')) {
			const parts = trimmed.split('|');

			let username = '';
			let password = '';

			if (parts.length === 2) {
				// 简化格式: username|password
				username = parts[0]?.trim();
				password = parts[1]?.trim();
			} else if (parts.length >= 7) {
				// 完整格式: provider|api_user|cookies|github_user|github_pass|linuxdo_user|linuxdo_pass
				// 索引:       0       1         2          3            4            5             6
				username = parts[5]?.trim();
				password = parts[6]?.trim();
			}

			if (username && password) {
				// 去重
				if (seenUsernames.has(username)) {
					console.log(`ℹ️ Skipping duplicate Linux.do account: ${maskUsername(username)}`);
					continue;
				}
				seenUsernames.add(username);
				accounts.push({ username, password });
			}
		}
	}
	return accounts;
}

/**
 * 从环境变量加载 Linux.do 账号
 * 只使用 ACCOUNTS_LINUX_DO，支持管道格式和 JSON 格式
 *
 * @returns {Array<{username: string, password: string}>}
 */
function loadLinuxdoAccounts() {
	const linuxDoAccountsStr = process.env.ACCOUNTS_LINUX_DO;

	if (!linuxDoAccountsStr) {
		console.log('❌ ACCOUNTS_LINUX_DO environment variable not found');
		console.log('');
		console.log('💡 请在青龙面板中创建环境变量:');
		console.log('   变量名: ACCOUNTS_LINUX_DO');
		console.log('');
		console.log('💡 支持两种格式:');
		console.log('');
		console.log('   1) 管道格式（推荐）:');
		console.log('      anyrouter|12345|session=xxx|||your_username|your_password');
		console.log('');
		console.log('   2) JSON格式:');
		console.log('      [{"username":"your_user","password":"your_pass"}]');
		return [];
	}

	// 首先尝试管道格式（青龙面板推荐）
	const pipeAccounts = parsePipeAccounts(linuxDoAccountsStr);
	if (pipeAccounts.length > 0) {
		console.log(`ℹ️ Loaded ${pipeAccounts.length} account(s) from ACCOUNTS_LINUX_DO (pipe format)`);
		return pipeAccounts;
	}

	// 管道格式解析失败，尝试 JSON 格式
	try {
		const accountsData = JSON.parse(linuxDoAccountsStr);

		if (!Array.isArray(accountsData)) {
			console.log('❌ ACCOUNTS_LINUX_DO must be a JSON array or pipe format');
			return [];
		}

		const linuxdoAccounts = [];
		const seenUsernames = new Set();

		for (let i = 0; i < accountsData.length; i++) {
			const account = accountsData[i];
			if (typeof account !== 'object' || account === null) {
				console.log(`⚠️ ACCOUNTS_LINUX_DO[${i}] must be a dictionary, skipping`);
				continue;
			}

			const username = account.username;
			const password = account.password;

			if (!username || !password) {
				console.log(`⚠️ ACCOUNTS_LINUX_DO[${i}] missing username or password, skipping`);
				continue;
			}

			// 根据 username 去重
			if (seenUsernames.has(username)) {
				console.log(`ℹ️ Skipping duplicate account: ${maskUsername(username)}`);
				continue;
			}

			seenUsernames.add(username);
			linuxdoAccounts.push({ username, password });
		}

		if (linuxdoAccounts.length > 0) {
			console.log(`ℹ️ Loaded ${linuxdoAccounts.length} account(s) from ACCOUNTS_LINUX_DO (JSON format)`);
			return linuxdoAccounts;
		}
	} catch (e) {
		console.log(`⚠️ Failed to parse ACCOUNTS_LINUX_DO: ${e.message}`);
	}

	console.log('❌ No Linux.do accounts found in ACCOUNTS_LINUX_DO');
	console.log('');
	console.log('💡 管道格式示例:');
	console.log('   anyrouter|12345|session=xxx|||myuser|mypass');
	console.log('');
	console.log('💡 JSON格式示例:');
	console.log('   [{"username":"myuser","password":"mypass"}]');
	return [];
}

/**
 * 青龙面板通知
 * @param {string} title - 通知标题
 * @param {string} content - 通知内容
 */
function notify(title, content) {
	try {
		// 检查是否在青龙面板环境中
		if (typeof global.QLAPI !== 'undefined' && typeof global.QLAPI.notify === 'function') {
			global.QLAPI.notify(title, content);
			return;
		}
	} catch {
		// Ignore errors
	}

	// 回退到控制台输出
	console.log(`\n📢 Notification: ${title}`);
	console.log(content);
}

/**
 * 推送消息（兼容青龙面板通知）
 * @param {string} title - 消息标题
 * @param {string} content - 消息内容
 * @param {string} [msgType='text'] - 消息类型
 */
function pushMessage(title, content, msgType = 'text') {
	notify(title, content);
}

/**
 * 格式化时长为 HH:MM:SS
 * @param {number} totalSeconds - 总秒数
 * @returns {string}
 */
function formatDuration(totalSeconds) {
	const hours = Math.floor(totalSeconds / 3600);
	const remainder = totalSeconds % 3600;
	const minutes = Math.floor(remainder / 60);
	const seconds = remainder % 60;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 主函数
 */
async function main() {
	const now = new Date();
	console.log('🚀 Linux.do read posts script started');
	console.log(`🕒 Execution time: ${now.toISOString().slice(0, 19).replace('T', ' ')}`);

	// 加载配置了 linux.do 的账号
	const accounts = loadLinuxdoAccounts();

	if (accounts.length === 0) {
		console.log('❌ No accounts with linux.do configuration found');
		return;
	}

	console.log(`ℹ️ Found ${accounts.length} account(s) with linux.do configuration`);

	// 收集结果用于通知
	const results = [];

	// 为每个账号执行任务
	for (const account of accounts) {
		const username = account.username;
		const maskedUsername = maskUsername(username);
		const password = account.password;

		console.log(`\n${'='.repeat(50)}`);
		console.log(`📌 Processing: ${maskedUsername}`);
		console.log(`${'='.repeat(50)}`);

		try {
			const reader = new LinuxDoReadPosts(username, password);

			const startTime = Date.now();
			const maxPosts = Math.floor(Math.random() * 100) + 200; // 200-300
			const [success, result] = await reader.run(maxPosts);
			const endTime = Date.now();
			const durationSeconds = Math.floor((endTime - startTime) / 1000);
			const durationStr = formatDuration(durationSeconds);

			console.log(`Result: success=${success}, result=${JSON.stringify(result)}, duration=${durationStr}`);

			// 记录结果
			results.push({
				username,
				success,
				result,
				duration: durationStr,
			});
		} catch (e) {
			console.log(`❌ ${maskedUsername}: Exception occurred: ${e.message}`);
			results.push({
				username,
				success: false,
				result: { error: e.message },
				duration: '00:00:00',
			});
		}
	}

	// 发送通知
	if (results.length > 0) {
		const notificationLines = [
			`🕒 Execution time: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
			'',
		];

		let totalReadCount = 0;
		for (const r of results) {
			const username = r.username;
			const maskedUsername = maskUsername(username);
			const duration = r.duration;
			if (r.success) {
				const readCount = r.result.readCount || 0;
				totalReadCount += readCount;
				const lastTopicId = r.result.lastTopicId || 'unknown';
				const topicUrl = `https://linux.do/t/topic/${lastTopicId}`;
				notificationLines.push(`✅ ${maskedUsername}: Read ${readCount} posts (${duration})\n   Last topic: ${topicUrl}`);
			} else {
				const error = r.result.error || 'Unknown error';
				notificationLines.push(`❌ ${maskedUsername}: ${error} (${duration})`);
			}
		}

		// 添加阅读总数
		notificationLines.push('');
		notificationLines.push(`📊 Total read: ${totalReadCount} posts`);

		const notifyContent = notificationLines.join('\n');
		pushMessage('Linux.do Read Posts', notifyContent, 'text');
	}
}

/**
 * 运行主函数的包装函数
 */
export async function runMain() {
	try {
		await main();
	} catch (e) {
		console.log(`\n❌ Error occurred during program execution: ${e.message}`);
		process.exit(1);
	}
}

// 如果是直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
	runMain();
}

export default { LinuxDoReadPosts, runMain };
