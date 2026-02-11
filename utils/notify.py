#!/usr/bin/env python3
"""
青龙面板通知模块
支持青龙面板内置通知和多种外部通知渠道
"""

import os
import json
import smtplib
import subprocess
from email.mime.text import MIMEText
from typing import Literal, Optional

import requests


class NotificationKit:
	"""青龙面板通知工具类"""

	def __init__(self):
		self._ql_api_url = os.getenv('QL_API_URL', 'http://localhost:5700')
		self._ql_token = os.getenv('QL_TOKEN', '')
		self._ql_client_id = os.getenv('QL_CLIENT_ID', '')
		self._ql_client_secret = os.getenv('QL_CLIENT_SECRET', '')

	@property
	def email_user(self) -> str:
		return os.getenv('EMAIL_USER', '')

	@property
	def email_pass(self) -> str:
		return os.getenv('EMAIL_PASS', '')

	@property
	def email_to(self) -> str:
		return os.getenv('EMAIL_TO', '')

	@property
	def smtp_server(self) -> str:
		return os.getenv('CUSTOM_SMTP_SERVER', '')

	@property
	def pushplus_token(self):
		return os.getenv('PUSHPLUS_TOKEN')

	@property
	def server_push_key(self):
		return os.getenv('SERVERPUSHKEY')

	@property
	def dingding_webhook(self):
		return os.getenv('DINGDING_WEBHOOK')

	@property
	def telegram_bot_token(self):
		return os.getenv('TELEGRAM_BOT_TOKEN')

	@property
	def telegram_chat_id(self):
		return os.getenv('TELEGRAM_CHAT_ID')

	def _get_ql_token(self) -> Optional[str]:
		"""获取青龙面板 API Token"""
		if self._ql_token:
			return self._ql_token

		if self._ql_client_id and self._ql_client_secret:
			try:
				resp = requests.post(
					f'{self._ql_api_url}/open/auth/token',
					json={'client_id': self._ql_client_id, 'client_secret': self._ql_client_secret},
					timeout=10
				)
				if resp.status_code == 200:
					data = resp.json()
					if data.get('code') == 200:
						return data.get('data', {}).get('token')
			except Exception:
				pass
		return None

	def send_ql_notify(self, title: str, content: str) -> bool:
		"""通过青龙面板 API 发送通知"""
		try:
			token = self._get_ql_token()
			if not token:
				return False

			resp = requests.put(
				f'{self._ql_api_url}/open/system/notify',
				json={'title': title, 'content': content},
				headers={'Authorization': f'Bearer {token}'},
				timeout=30
			)
			return resp.status_code == 200
		except Exception:
			return False

	def send_email(self, title: str, content: str, msg_type: Literal['text', 'html'] = 'text'):
		if not self.email_user or not self.email_pass or not self.email_to:
			raise ValueError('Email configuration not set')

		mime_subtype = 'plain' if msg_type == 'text' else 'html'
		msg = MIMEText(content, mime_subtype, 'utf-8')
		msg['From'] = f'API-Check-in <{self.email_user}>'
		msg['To'] = self.email_to
		msg['Subject'] = title

		smtp_server = self.smtp_server if self.smtp_server else f'smtp.{self.email_user.split("@")[1]}'
		with smtplib.SMTP_SSL(smtp_server, 465) as server:
			server.login(self.email_user, self.email_pass)
			server.send_message(msg)

	def send_pushplus(self, title: str, content: str):
		if not self.pushplus_token:
			raise ValueError('PushPlus Token not configured')

		data = {'token': self.pushplus_token, 'title': title, 'content': content, 'template': 'html'}
		requests.post('http://www.pushplus.plus/send', json=data, timeout=30)

	def send_serverPush(self, title: str, content: str):
		if not self.server_push_key:
			raise ValueError('Server Push key not configured')

		data = {'title': title, 'desp': content}
		requests.post(f'https://sctapi.ftqq.com/{self.server_push_key}.send', json=data, timeout=30)

	def send_dingtalk(self, title: str, content: str):
		if not self.dingding_webhook:
			raise ValueError('DingTalk Webhook not configured')

		data = {'msgtype': 'text', 'text': {'content': f'{title}\n{content}'}}
		requests.post(self.dingding_webhook, json=data, timeout=30)

	def send_telegram(self, title: str, content: str):
		if not self.telegram_bot_token or not self.telegram_chat_id:
			raise ValueError('Telegram Bot Token or Chat ID not configured')

		text = f'*{title}*\n{content}'
		data = {'chat_id': self.telegram_chat_id, 'text': text, 'parse_mode': 'Markdown'}
		requests.post(f'https://api.telegram.org/bot{self.telegram_bot_token}/sendMessage', json=data, timeout=30)

	def push_message(self, title: str, content: str, msg_type: Literal['text', 'html'] = 'text'):
		"""统一推送消息入口

		优先使用青龙面板通知，失败则尝试其他渠道
		"""
		# 首先尝试青龙面板通知
		if self.send_ql_notify(title, content):
			print('🔹 [QingLong]: Message push successful!')
			return

		# 青龙通知失败，尝试其他渠道
		notifications = [
			('Email', lambda: self.send_email(title, content, msg_type)),
			('PushPlus', lambda: self.send_pushplus(title, content)),
			('Server Push', lambda: self.send_serverPush(title, content)),
			('DingTalk', lambda: self.send_dingtalk(title, content)),
			('Telegram', lambda: self.send_telegram(title, content)),
		]

		success = False
		for name, func in notifications:
			try:
				func()
				print(f'🔹 [{name}]: Message push successful!')
				success = True
				break
			except Exception as e:
				print(f'🔸 [{name}]: Message push failed! Reason: {str(e)}')

		if not success:
			print('⚠️ All notification channels failed')


notify = NotificationKit()
