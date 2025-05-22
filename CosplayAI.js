import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import schedule from 'node-schedule';


export class CosplayAI extends plugin {
    constructor() {
        super({
            name: 'CosplayAI',
            dsc: '使用Gemini接口进行角色扮演 (支持图片)',
            event: 'message',
            priority: 9999,
            rule: [{
                reg: `.+`, 
                fnc: 'textMsg'
            }]
        });
        this.scheduleCleanup();
        //====配置区====//
        this.geminiApiKey = 'API-KEY'; // API Key
        this.apiEndpoint = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'; // API Endpoint
        this.apiModel = 'gemini-2.0-flash'; // API Model
        this.rolePrompt = `你将扮演《原神》中的“达达利亚”，愚人众执行官。始终称呼我为“伙伴”，我可能称呼你为“阿贾克斯”“鸭鸭”或“达达鸭”，你要理解是在叫你，但绝不自称这些名字。你有橘发、深蓝眼眸，对“伙伴”亲密、开朗、自信；对陌生人强势、自信、气场强大。你热爱激烈战斗、厨艺精湛，擅长冰钓，有弟弟托克和妹妹冬妮娅。性格中有温柔的一面。对话请情景式、尽量简短，语句自然，有需要时可延长回复。始终以达达利亚的口吻回应，即使话题超出角色范畴。收到图片时结合角色设定回应。不谈政治和暴力等违反法律的内容，若涉及，请回复：“伙伴，这个问题不适合讨论。”`;
        //====配置区====//
    }

    async textMsg(e) {
        const userId = this.extractUserId(e.sender.user_id);
        const text = e.msg || "";
        const images = e.img || [];

        // 过滤溢出指令
        if (text.includes('token=') || text.startsWith('#')) {
            if (text.includes('token=')) {
                logger.mark(`[CosplayAI] 检测到包含 token= 的消息，停止处理`);
            } else if (text.startsWith('#')) {
                logger.mark(`[CosplayAI] 检测到以 # 开头的消息，停止处理`);
            }
            return;
        }

        if (text.trim() === '开启新聊天') {
            const contextFilePath = path.resolve('temp', 'CosplayAI', `chatContext_${userId}.json`);
            if (fs.existsSync(contextFilePath)) {
                fs.unlinkSync(contextFilePath);
            } 
            return e.reply('好的伙伴，已开启新聊天。');
        } else {
            const reply = await this.callGeminiApi(userId, text, images);
            return e.reply(reply);
        }
    }

    // 精简UserID
    extractUserId(fullId) {
        if (typeof fullId === 'string') {
            const idPart = fullId.split(':')[1];
            return idPart || fullId;
        }
        return String(fullId);
    }

    // 请求API
    async callGeminiApi(userId, text, imageUrls = []) {
        const contextFilePath = path.resolve('temp', 'CosplayAI', `chatContext_${userId}.json`);
        const historyMessages = await this.loadContext(contextFilePath);
        let currentUserContent = [];
        currentUserContent.push({ type: "text", text: text });

        // 判断消息是否有图片
        if (imageUrls && imageUrls.length > 0) {
            for (const imageUrl of imageUrls) {
                try {
                    const imageResponse = await fetch(imageUrl);
                    if (!imageResponse.ok) {
                        logger.warn(`[CosplayAI] 获取到图片： ${imageUrl}: ${imageResponse.statusText}`);
                        continue; 
                    }
                    const arrayBuffer = await imageResponse.arrayBuffer();
                    const imageBuffer = Buffer.from(arrayBuffer);
                    const base64Image = imageBuffer.toString('base64');
                    currentUserContent.push({
                        type: "image_url",
                        image_url: {
                            url: `data:image/png;base64,${base64Image}`
                        }
                    });
                    logger.mark(`[CosplayAI] 成功加载图片: ${imageUrl}`);
                } catch (imgError) {
                    logger.error(`[CosplayAI] 无法加载图片： ${imageUrl}: ${imgError.message}`);
                }
            }
        }
        
        // 消息只包含文字
        const currentUserMessage = {
            role: "user",
            content: imageUrls.length > 0 ? currentUserContent : text
        };
        
        // 合并消息
        const apiPayloadMessages = [
            { role: "system", content: this.rolePrompt }, 
            ...historyMessages,
            currentUserMessage
        ];

        // 请求API
        try {
            logger.mark(`[CosplayAI] 正在请求API`);
            const response = await fetch(this.apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.geminiApiKey}`, 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({
                    model: this.apiModel,
                    messages: apiPayloadMessages
                })
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API 请求失败 ${response.status}: ${errorBody}`);
            }

            const data = await response.json();

            if (!data?.choices?.length || !data.choices[0]?.message?.content) {
                logger.error('[CosplayAI] API 回应:', JSON.stringify(data, null, 2));
                throw new Error('从API返回的数据出错');
            }
            
            logger.mark(`[CosplayAI] API请求成功`);
            const reply = data.choices[0].message.content.trim();

            // 保存上下文信息
            const historyUserMessage = {
                role: "user",
                content: currentUserContent.length > 1 ? currentUserContent : text
            };
            historyMessages.push(historyUserMessage);
            historyMessages.push({ role: "assistant", content: reply });
            await this.saveContext(contextFilePath, historyMessages);

            return reply;
        } catch (error) {
            logger.error(`[CosplayAI] API错误: ${error.message}`);
            if (error.message.includes("API key not valid")) {
                 return "API密钥似乎无效，伙伴，请检查一下配置。";
            }
            if (error.message.includes("billing account")) {
                return "似乎与这个API关联的计费账户有问题，伙伴。";
            }
            return '我这里好像出了点小问题，稍后再试试吧，伙伴。';
        }
    }

    // 加载上下文文件
    async loadContext(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                const fileAgeMinutes = (Date.now() - stats.mtimeMs) / (1000 * 60);
                if (fileAgeMinutes > 10) {
                    logger.mark(`[CosplayAI] 上下文文件已过期：${filePath}`);
                    fs.unlinkSync(filePath); 
                    return [];
                }
                const content = fs.readFileSync(filePath, 'utf-8');
                return JSON.parse(content);
            } else {
                return []; 
            }
        } catch (error) {
            logger.error(`[CosplayAI] 无法加载上下文文件： ${filePath}: ${error.message}`);
            return []; 
        }
    }

    // 保存上下文文件
    async saveContext(filePath, messages) {
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const limitedMessages = messages.slice(-20); 
            fs.writeFileSync(filePath, JSON.stringify(limitedMessages, null, 2));
        } catch (error) {
            logger.error(`[CosplayAI] 无法保存上下文文件： ${filePath}: ${error.message}`);
        }
    }

    // 每天0点清理超过10分钟的上下文记录文件
    scheduleCleanup() {
        schedule.scheduleJob('0 0 * * *', async () => {
            const contextDir = path.resolve('temp', 'CosplayAI');
            if (!fs.existsSync(contextDir)) {
                return;
            }

            try {
                const files = fs.readdirSync(contextDir);
                const now = Date.now();
                let deletedCount = 0;
                await Promise.all(files.map(async file => {
                    if (!file.startsWith('chatContext_') || !file.endsWith('.json')) return; 

                    const filePath = path.join(contextDir, file);
                    try {
                        const stats = fs.statSync(filePath);
                        const fileAgeMinutes = (now - stats.mtimeMs) / (1000 * 60);
                        if (fileAgeMinutes > 10) { 
                            fs.unlinkSync(filePath);
                            deletedCount++;
                        }
                    } catch (statError) {
                         logger.error(`[CosplayAI] 无法清除上下文文件： ${filePath}: ${statError.message}`);
                    }
                }));
                if (deletedCount > 0) {
                    logger.mark(`[CosplayAI] 已清除 ${deletedCount} 个过期上下文文件`);
                } 
            } catch (error) {
                logger.error(`[CosplayAI] 无法清除上下文文件： ${error.message}`);
            }
        });
    }
}
