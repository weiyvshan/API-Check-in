#!/usr/bin/env node
/**
 * 敏感信息掩码工具模块
 */

/**
 * 对用户名进行掩码处理
 *
 * 规则：
 * - 如果用户名长度 <= 2，全部用 * 替换
 * - 如果用户名长度 <= 4，保留首字符，其余用 * 替换
 * - 如果用户名长度 > 4，保留首尾各一个字符，中间用 * 替换（最多显示 4 个 *）
 *
 * @param {string} username - 原始用户名
 * @returns {string} 掩码后的用户名
 */
export function maskUsername(username) {
	if (!username) {
		return '';
	}

	const length = username.length;

	if (length <= 2) {
		return '*'.repeat(length);
	} else if (length <= 4) {
		return username[0] + '*'.repeat(length - 1);
	} else {
		// 中间用 * 替换，最多 4 个 *
		const maskLen = Math.min(length - 2, 4);
		return username[0] + '*'.repeat(maskLen) + username[length - 1];
	}
}

export default { maskUsername };
