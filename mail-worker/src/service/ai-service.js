import emailUtils from '../utils/email-utils';
import { settingConst } from '../const/entity-const';

const aiService = {
	async extractCode(c, email, options = {}) {
		if (!this.shouldExtractCode(options.aiCode, options.aiCodeFilter, email)) {
			return '';
		}

		const ai = c.env.ai;

		try {
			const subject = email.subject || '';
			const text = emailUtils.formatText(email.text || '');
			const htmlText = emailUtils.htmlToText(email.html || '');
			const body = (htmlText || text).slice(0, 6000);

			if (!subject && !body) {
				return '';
			}

			const result = await ai.run(c.env.ai_model || '@cf/meta/llama-3.1-8b-instruct-fast', {
				messages: [
					{
						role: 'system',
						content: 'You extract verification codes from emails. Return only JSON like {"code":"12345678"} or {"code":""}. The code must be 8 characters or fewer and must not contain spaces. If the code is longer than 8 characters or contains spaces, return {"code":""}. Do not explain.'
					},
					{
						role: 'user',
						content: `Subject: ${subject}\n\n${body}`
					}
				],
				temperature: 0,
				max_tokens: 32
			});

			const content = typeof result === 'string' ? result : result?.response || '';
			const json = typeof content === 'string' ? JSON.parse(content) : content;
			if (typeof json.code !== 'string') {
				return '';
			}

			if (json.code.length > 8 || /\s/.test(json.code)) {
				return '';
			}

			return json.code;
		} catch (e) {
			console.error('验证码提取失败: ', e);
			return '';
		}
	},

	shouldExtractCode(aiCode, aiCodeFilterStr, email) {
		if (aiCode !== settingConst.aiCode.OPEN) {
			return false;
		}

		const filterList = aiCodeFilterStr ? aiCodeFilterStr.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) : [];

		if (filterList.length === 0) {
			return true;
		}

		const fromEmail = (email.from?.address || '').trim().toLowerCase();
		const fromDomain = emailUtils.getDomain(fromEmail).toLowerCase();

		return filterList.some(item => item === fromEmail || item === fromDomain);
	},

	detectLang(text) {
		const sample = (text || '').slice(0, 2000);
		const count = (re) => (sample.match(re) || []).length;
		if (count(/[\u3040-\u30ff]/g) > 0) return 'ja';
		if (count(/[\uac00-\ud7af]/g) > 0) return 'ko';
		if (count(/[\u0e00-\u0e7f]/g) > 0) return 'th';
		if (count(/[\u0600-\u06ff]/g) > 0) return 'ar';
		if (count(/[\u0400-\u04ff]/g) > 0) return 'ru';
		if (count(/[\u0900-\u097f]/g) > 0) return 'hi';
		if (count(/[\u4e00-\u9fff]/g) > 0) return 'zh';
		return 'en';
	},

	chunkText(text, size) {
		const chunks = [];
		const paragraphs = String(text || '').split(/\n+/);
		let cur = '';
		for (const p of paragraphs) {
			if (p.length > size) {
				if (cur) { chunks.push(cur); cur = ''; }
				for (let i = 0; i < p.length; i += size) chunks.push(p.slice(i, i + size));
				continue;
			}
			if (cur && (cur.length + p.length + 1) > size) { chunks.push(cur); cur = p; }
			else { cur = cur ? cur + '\n' + p : p; }
		}
		if (cur) chunks.push(cur);
		return chunks.length ? chunks : [''];
	},

	async translateText(c, text, targetLang) {
		const sourceLang = this.detectLang(text);
		if (!text || !text.trim() || sourceLang === targetLang) {
			return { text: text || '', sourceLang };
		}
		const ai = c.env.ai;
		const chunks = this.chunkText(text, 700);
		const out = [];
		for (const chunk of chunks) {
			if (!chunk.trim()) { out.push(''); continue; }
			const r = await ai.run('@cf/meta/m2m100-1.2b', { text: chunk, source_lang: sourceLang, target_lang: targetLang });
			out.push((r && r.translated_text) || chunk);
		}
		return { text: out.join('\n'), sourceLang };
	}
};

export default aiService;
