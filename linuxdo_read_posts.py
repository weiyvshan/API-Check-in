#!/usr/bin/env python3
# newapi-ai-check-in - Linux.do 帖子浏览
#cron: 0 */8 * * *
#name: Linux.do Read Posts
"""
Linux.do 帖子浏览模块
使用 Camoufox 登录 Linux.do 并浏览帖子增加活跃度
"""

import asyncio
import hashlib
import os
import random
import sys
from datetime import datetime
from typing import Any

from camoufox.async_api import AsyncCamoufox

from utils.browser_utils import take_screenshot, save_page_content_to_file
from utils.notify import notify
from utils.mask_utils import mask_username
from utils.config import get_linuxdo_accounts, get_base_topic_id, get_max_posts


DEFAULT_STORAGE_STATE_DIR = 'storage-states'
TOPIC_ID_CACHE_DIR = 'linuxdo_reads'


class LinuxDoReadPosts:
	"""Linux.do 帖子浏览类"""

	def __init__(self, username: str, password: str):
		self.username = username
		self.password = password
		self.masked_username = mask_username(username)
		self.username_hash = hashlib.sha256(username.encode('utf-8')).hexdigest()[:8]

		os.makedirs(DEFAULT_STORAGE_STATE_DIR, exist_ok=True)
		os.makedirs(TOPIC_ID_CACHE_DIR, exist_ok=True)
		self.topic_id_cache_file = os.path.join(TOPIC_ID_CACHE_DIR, f'{self.username_hash}_topic_id.txt')

	async def _is_logged_in(self, page) -> bool:
		"""检查是否已登录"""
		try:
			print(f'ℹ️ {self.masked_username}: Checking login status...')
			await page.goto('https://linux.do/', wait_until='domcontentloaded')
			await page.wait_for_timeout(3000)

			current_url = page.url
			print(f'ℹ️ {self.masked_username}: Current URL: {current_url}')

			if current_url.startswith('https://linux.do/login'):
				print(f'ℹ️ {self.masked_username}: Redirected to login page, not logged in')
				return False

			print(f'✅ {self.masked_username}: Already logged in')
			return True
		except Exception as e:
			print(f'⚠️ {self.masked_username}: Error checking login status: {e}')
			return False

	async def _do_login(self, page) -> bool:
		"""执行登录流程"""
		try:
			print(f'ℹ️ {self.masked_username}: Starting login process...')

			if not page.url.startswith('https://linux.do/login'):
				await page.goto('https://linux.do/login', wait_until='domcontentloaded')

			await page.wait_for_timeout(2000)
			await page.fill('#login-account-name', self.username)
			await page.wait_for_timeout(2000)
			await page.fill('#login-account-password', self.password)
			await page.wait_for_timeout(2000)
			await page.click('#login-button')
			await page.wait_for_timeout(10000)

			await save_page_content_to_file(page, 'login_result', self.username)

			current_url = page.url
			print(f'ℹ️ {self.masked_username}: URL after login: {current_url}')

			if 'linux.do/challenge' in current_url:
				print(f'⚠️ {self.masked_username}: Cloudflare challenge detected, waiting...')
				try:
					await page.wait_for_url('https://linux.do/', timeout=60000)
					print(f'✅ {self.masked_username}: Cloudflare challenge bypassed')
				except Exception:
					print(f'⚠️ {self.masked_username}: Cloudflare challenge timeout')

			current_url = page.url
			if current_url.startswith('https://linux.do/login'):
				print(f'❌ {self.masked_username}: Login failed, still on login page')
				await take_screenshot(page, 'login_failed', self.username)
				return False

			print(f'✅ {self.masked_username}: Login successful')
			return True

		except Exception as e:
			print(f'❌ {self.masked_username}: Error during login: {e}')
			await take_screenshot(page, 'login_error', self.username)
			return False

	def _load_topic_id(self) -> int:
		"""从缓存文件读取上次的 topic_id"""
		try:
			if os.path.exists(self.topic_id_cache_file):
				with open(self.topic_id_cache_file, 'r', encoding='utf-8') as f:
					content = f.read().strip()
					if content:
						return int(content)
		 except (ValueError, IOError) as e:
			print(f'⚠️ {self.masked_username}: Failed to load topic ID from cache: {e}')
		return 0

	def _save_topic_id(self, topic_id: int) -> None:
		"""保存 topic_id 到缓存文件"""
		try:
			with open(self.topic_id_cache_file, 'w', encoding='utf-8') as f:
				f.write(str(topic_id))
			print(f'ℹ️ {self.masked_username}: Saved topic ID {topic_id} to cache')
		except IOError as e:
			print(f'⚠️ {self.masked_username}: Failed to save topic ID: {e}')

	async def _scroll_to_read(self, page) -> None:
		"""自动滚动浏览帖子内容"""
		last_current_page = 0
		last_total_pages = 0

		while True:
			await page.evaluate('window.scrollBy(0, window.innerHeight)')
			await page.wait_for_timeout(random.randint(1000, 3000))

			timeline_element = await page.query_selector('.timeline-replies')
			if not timeline_element:
				print(f'ℹ️ {self.masked_username}: Timeline element not found, stopping')
				break

			inner_html = await timeline_element.inner_text()
			try:
				parts = inner_html.strip().split('/')
				if len(parts) == 2 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
					current_page = int(parts[0].strip())
					total_pages = int(parts[1].strip())

					if current_page == last_current_page and total_pages == last_total_pages:
						print(f'ℹ️ {self.masked_username}: Page not changing ({current_page}/{total_pages}), reached bottom')
						break

					if current_page >= total_pages:
						print(f'ℹ️ {self.masked_username}: Reached end ({current_page}/{total_pages}) after scrolling')
						break

					last_current_page = current_page
					last_total_pages = total_pages
				else:
					print(f'ℹ️ {self.masked_username}: Timeline read error, stopping')
					break
			except (ValueError, IndexError):
				break

	async def _read_posts(self, page, base_topic_id: int, max_posts: int) -> tuple[int, int]:
		"""浏览帖子"""
		cached_topic_id = self._load_topic_id()
		current_topic_id = max(base_topic_id, cached_topic_id)
		print(f'ℹ️ {self.masked_username}: Starting from topic ID {current_topic_id}')

		read_count = 0
		invalid_count = 0

		while read_count < max_posts:
			if invalid_count >= 5:
				jump = random.randint(50, 100)
				current_topic_id += jump
				print(f'⚠️ {self.masked_username}: Too many invalid topics, jumping ahead by {jump} to {current_topic_id}')
				invalid_count = 0
			else:
				current_topic_id += random.randint(1, 5)

			topic_url = f'https://linux.do/t/topic/{current_topic_id}'

			try:
				print(f'ℹ️ {self.masked_username}: Opening topic {current_topic_id}...')
				await page.goto(topic_url, wait_until='domcontentloaded')
				await page.wait_for_timeout(3000)

				timeline_element = await page.query_selector('.timeline-replies')

				if timeline_element:
					inner_text = await timeline_element.inner_text()
					print(f'✅ {self.masked_username}: Topic {current_topic_id} - Progress: {inner_text.strip()}')

					try:
						parts = inner_text.strip().split('/')
						if len(parts) == 2 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
							current_page = int(parts[0].strip())
							total_pages = int(parts[1].strip())
							invalid_count = 0

							if current_page < total_pages:
								await self._scroll_to_read(page)
								read_count += total_pages - current_page
					except (ValueError, IndexError) as e:
						print(f'⚠️ {self.masked_username}: Failed to parse progress: {e}')
						invalid_count += 1

					await page.wait_for_timeout(random.randint(1000, 2000))
				else:
					print(f'⚠️ {self.masked_username}: Topic {current_topic_id} not found or invalid, skipping...')
					invalid_count += 1

			except Exception as e:
				print(f'⚠️ {self.masked_username}: Error reading topic {current_topic_id}: {e}')
				invalid_count += 1

		self._save_topic_id(current_topic_id)
		return current_topic_id, read_count

	async def run(self) -> tuple[bool, dict[str, Any]]:
		"""执行浏览帖子任务"""
		print(f'ℹ️ {self.masked_username}: Starting Linux.do read posts task')

		cache_file_path = f'{DEFAULT_STORAGE_STATE_DIR}/linuxdo_{self.username_hash}_storage_state.json'
		base_topic_id = get_base_topic_id()
		max_posts = get_max_posts()

		async with AsyncCamoufox(headless=False, humanize=True, locale='en-US') as browser:
			storage_state = cache_file_path if os.path.exists(cache_file_path) else None
			if storage_state:
				print(f'ℹ️ {self.masked_username}: Restoring storage state from cache')
			else:
				print(f'ℹ️ {self.masked_username}: No cache file found, starting fresh')

			context = await browser.new_context(storage_state=storage_state)
			page = await context.new_page()

			try:
				is_logged_in = await self._is_logged_in(page)

				if not is_logged_in:
					login_success = await self._do_login(page)
					if not login_success:
						return False, {'error': 'Login failed'}

					await context.storage_state(path=cache_file_path)
					print(f'✅ {self.masked_username}: Storage state saved to cache file')

				print(f'ℹ️ {self.masked_username}: Starting to read posts...')
				last_topic_id, read_count = await self._read_posts(page, base_topic_id, max_posts)

				print(f'✅ {self.masked_username}: Successfully read {read_count} posts')
				return True, {
					'read_count': read_count,
					'last_topic_id': last_topic_id,
				}

			except Exception as e:
				print(f'❌ {self.masked_username}: Error occurred: {e}')
				await take_screenshot(page, 'error', self.username)
				return False, {'error': str(e)}
			finally:
				await page.close()
				await context.close()


async def main():
	"""主函数"""
	print('🚀 Linux.do read posts script started')
	print(f'🕒 Execution time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')

	accounts = get_linuxdo_accounts()

	if not accounts:
		print('❌ No accounts with linux.do configuration found')
		return

	print(f'ℹ️ Found {len(accounts)} account(s) with linux.do configuration')

	results = []

	for account in accounts:
		username = account['username']
		password = account['password']
		masked_username = mask_username(username)

		print(f'\n{"="*50}')
		print(f'📌 Processing: {masked_username}')
		print(f'{"="*50}')

		try:
			reader = LinuxDoReadPosts(username=username, password=password)

			start_time = datetime.now()
			success, result = await reader.run()
			end_time = datetime.now()
			duration = end_time - start_time

			total_seconds = int(duration.total_seconds())
			hours, remainder = divmod(total_seconds, 3600)
			minutes, seconds = divmod(remainder, 60)
			duration_str = f'{hours:02d}:{minutes:02d}:{seconds:02d}'

			print(f'Result: success={success}, result={result}, duration={duration_str}')

			results.append({
				'username': username,
				'success': success,
				'result': result,
				'duration': duration_str,
			})
		except Exception as e:
			print(f'❌ {masked_username}: Exception occurred: {e}')
			results.append({
				'username': username,
				'success': False,
				'result': {'error': str(e)},
				'duration': '00:00:00',
			})

	if results:
		notification_lines = [
			f'🕒 Execution time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
			'',
		]

		total_read_count = 0
		for r in results:
			username = r['username']
			masked_username = mask_username(username)
			duration = r['duration']

			if r['success']:
				read_count = r['result'].get('read_count', 0)
				total_read_count += read_count
				last_topic_id = r['result'].get('last_topic_id', 'unknown')
				topic_url = f'https://linux.do/t/topic/{last_topic_id}'
				notification_lines.append(
					f'✅ {masked_username}: Read {read_count} posts ({duration})\n   Last topic: {topic_url}'
				)
			else:
				error = r['result'].get('error', 'Unknown error')
				notification_lines.append(f'❌ {masked_username}: {error} ({duration})')

		notification_lines.append('')
		notification_lines.append(f'📊 Total read: {total_read_count} posts')

		notify_content = '\n'.join(notification_lines)
		notify.push_message('Linux.do Read Posts', notify_content, msg_type='text')


def run_main():
	"""运行主函数的包装函数"""
	try:
		asyncio.run(main())
	except KeyboardInterrupt:
		print('\n⚠️ Program interrupted by user')
		sys.exit(1)
	except Exception as e:
		print(f'\n❌ Error occurred during program execution: {e}')
		sys.exit(1)


if __name__ == '__main__':
	run_main()
