#!/usr/bin/env python3
"""
青龙面板配置模块
处理环境变量和账号配置
"""

import os
import json
from typing import Any

from utils.mask_utils import mask_username


def parse_accounts(accounts_str: str) -> list[dict]:
	"""解析青龙面板管道格式的账号配置

	格式: provider|api_user|cookies|github_user|github_pass|linuxdo_user|linuxdo_pass

	Args:
		accounts_str: 账号配置字符串（多行）

	Returns:
		账号配置列表
	"""
	accounts = []
	seen_usernames = set()

	for line in accounts_str.split('\n'):
		line = line.strip()
		if not line or line.startswith('#'):
			continue

		parts = line.split('|')
		if len(parts) < 2:
			continue

		account = {
			'provider': parts[0] if len(parts) > 0 else '',
			'api_user': parts[1] if len(parts) > 1 else '',
			'cookies': parts[2] if len(parts) > 2 else '',
			'github_username': parts[3] if len(parts) > 3 else '',
			'github_password': parts[4] if len(parts) > 4 else '',
			'linuxdo_username': parts[5] if len(parts) > 5 else '',
			'linuxdo_password': parts[6] if len(parts) > 6 else '',
		}

		# 去重（基于 provider + api_user 或 linuxdo_username）
		key = f"{account['provider']}:{account.get('api_user') or account.get('linuxdo_username')}"
		if key in seen_usernames:
			print(f"⚠️ Skipping duplicate account: {mask_username(account.get('api_user') or account.get('linuxdo_username', ''))}")
			continue

		seen_usernames.add(key)
		accounts.append(account)

	return accounts


def load_config() -> dict[str, Any]:
	"""加载完整配置

	Returns:
		包含 accounts, providers, proxy 的配置字典
	"""
	accounts_str = os.getenv('ACCOUNTS', '')
	providers_str = os.getenv('PROVIDERS', '{}')
	proxy = os.getenv('PROXY', '')

	try:
		providers = json.loads(providers_str) if providers_str else {}
	except json.JSONDecodeError:
		print('⚠️ Failed to parse PROVIDERS, using empty dict')
		providers = {}

	return {
		'accounts': parse_accounts(accounts_str),
		'providers': providers,
		'proxy': proxy,
	}


def get_linuxdo_accounts() -> list[dict]:
	"""获取配置了 Linux.do 的账号列表

	Returns:
		包含 linuxdo_username 和 linuxdo_password 的账号列表
	"""
	config = load_config()
	accounts = []

	for account in config['accounts']:
		username = account.get('linuxdo_username', '').strip()
		password = account.get('linuxdo_password', '').strip()

		if username and password:
			accounts.append({
				'username': username,
				'password': password,
			})

	return accounts


def get_base_topic_id() -> int:
	"""获取帖子起始 ID

	从环境变量 LINUXDO_BASE_TOPIC_ID 获取，默认随机 1000000-1100000

	Returns:
		起始帖子 ID
	"""
	import random
	base_id_str = os.getenv('LINUXDO_BASE_TOPIC_ID', '')
	if base_id_str and base_id_str.isdigit():
		return int(base_id_str)
	return random.randint(1000000, 1100000)


def get_max_posts() -> int:
	"""获取最大阅读帖子数

	从环境变量 LINUXDO_MAX_POSTS 获取，默认 200-300 随机

	Returns:
		最大阅读帖子数
	"""
	import random
	max_posts_str = os.getenv('LINUXDO_MAX_POSTS', '')
	if max_posts_str and max_posts_str.isdigit():
		return int(max_posts_str)
	return random.randint(200, 300)
